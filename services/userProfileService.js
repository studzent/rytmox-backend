const { supabaseAdmin } = require("../utils/supabaseClient");
const crypto = require("crypto");

function dbEnvFromApi(env) {
  if (!env) return null;
  // Для совместимости: фронт исторически шлет "outdoor", а в БД у вас "workout"
  if (env === "outdoor") return "workout";
  return env;
}

function apiEnvFromDb(env) {
  if (!env) return null;
  // Для совместимости с текущим Expo: "workout" отдаём как "outdoor"
  if (env === "workout") return "outdoor";
  return env;
}

async function getLatestUserWeightKg(userId) {
  const { data, error } = await supabaseAdmin
    .from("users_measurements")
    .select("weight_kg")
    .eq("user_id", userId)
    .order("measured_at", { ascending: false })
    .limit(1);
  if (error) return { data: null, error };
  return { data: data?.[0]?.weight_kg ?? null, error: null };
}

async function getUserActiveEquipmentSlugs(userId) {
  const { data, error } = await supabaseAdmin
    .from("users_equipment")
    .select("equipment_item_slug, availability, active")
    .eq("user_id", userId)
    .eq("active", true);

  if (error) return { data: null, error };
  return {
    data: (data || [])
      .filter((r) => (r.availability ? r.availability !== "unavailable" : true))
      .map((r) => r.equipment_item_slug)
      .filter(Boolean),
    error: null,
  };
}

async function getUserActiveTrainingEnvironmentSlug(userId) {
  const { data: linkRows, error: linkErr } = await supabaseAdmin
    .from("users_training_environment_profiles")
    .select("training_environment_profile_id")
    .eq("user_id", userId)
    .eq("active", true)
    .order("added_at", { ascending: false })
    .limit(1);

  if (linkErr) return { data: null, error: linkErr };
  const profileId = linkRows?.[0]?.training_environment_profile_id;
  if (!profileId) return { data: null, error: null };

  const { data: profile, error: profErr } = await supabaseAdmin
    .from("training_environment_profiles")
    .select("slug")
    .eq("id", profileId)
    .single();

  if (profErr) return { data: null, error: profErr };
  return { data: profile?.slug ?? null, error: null };
}

async function setUserActiveTrainingEnvironment(userId, envRaw) {
  const envSlug = dbEnvFromApi(envRaw);
  if (!envSlug) return { error: null };

  const { data: envProfile, error: envErr } = await supabaseAdmin
    .from("training_environment_profiles")
    .select("id, slug")
    .eq("slug", envSlug)
    .single();
  if (envErr) return { error: envErr };

  const { error: deactErr } = await supabaseAdmin
    .from("users_training_environment_profiles")
    .update({ active: false })
    .eq("user_id", userId);
  if (deactErr) return { error: deactErr };

  await supabaseAdmin
    .from("users_training_environment_profiles")
    .delete()
    .eq("user_id", userId)
    .eq("training_environment_profile_id", envProfile.id);

  const { error: insErr } = await supabaseAdmin
    .from("users_training_environment_profiles")
    .insert([
      {
        user_id: userId,
        training_environment_profile_id: envProfile.id,
        active: true,
        added_at: new Date().toISOString(),
      },
    ]);

  if (insErr) {
    return {
      error: {
        message: insErr.message || "Failed to insert users_training_environment_profiles row",
        code: insErr.code || "DATABASE_ERROR",
        details: insErr.details || null,
        hint: insErr.hint || null,
      },
    };
  }
  return { error: null };
}

async function replaceUserEquipment(userId, equipmentSlugs) {
  const { error: deactErr } = await supabaseAdmin
    .from("users_equipment")
    .update({ active: false })
    .eq("user_id", userId);
  if (deactErr) return { error: deactErr };

  const slugs = Array.isArray(equipmentSlugs) ? equipmentSlugs.filter(Boolean) : [];
  if (slugs.length === 0) return { error: null };

  await supabaseAdmin
    .from("users_equipment")
    .delete()
    .eq("user_id", userId)
    .in("equipment_item_slug", slugs);

  const rows = slugs.map((slug) => ({
    user_id: userId,
    equipment_item_slug: slug,
    availability: "available",
    active: true,
    added_at: new Date().toISOString(),
  }));

  const { error: insErr } = await supabaseAdmin.from("users_equipment").insert(rows);
  if (insErr) {
    return {
      error: {
        message: insErr.message || "Failed to insert users_equipment rows",
        code: insErr.code || "DATABASE_ERROR",
        details: insErr.details || null,
        hint: insErr.hint || null,
      },
    };
  }
  return { error: null };
}

async function insertUserWeightMeasurement(userId, weightKg, source = "profile") {
  if (weightKg === undefined || weightKg === null) return { error: null };
  if (isNaN(weightKg) || Number(weightKg) <= 0) {
    return {
      error: {
        message: "weight_kg must be a positive number or null",
        code: "VALIDATION_ERROR",
      },
    };
  }
  const row = {
    id: crypto.randomUUID(),
    user_id: userId,
    measured_at: new Date().toISOString(),
    weight_kg: Number(weightKg),
    source,
  };
  const { error } = await supabaseAdmin.from("users_measurements").insert([row]);
  if (error) {
    // Важно: часто причина — отсутствие DEFAULT для id в таблице users_measurements
    return {
      error: {
        message: error.message || "Failed to insert users_measurements row",
        code: error.code || "DATABASE_ERROR",
        details: error.details || null,
        hint: error.hint || null,
      },
    };
  }
  return { error: null };
}

/**
 * Получение профиля пользователя
 * @param {string} userId - ID пользователя (UUID)
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function getUserProfile(userId) {
  try {
    if (!userId) {
      return {
        data: null,
        error: {
          message: "userId is required",
          code: "VALIDATION_ERROR",
        },
      };
    }

    const { data, error } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (error) {
      // Если профиль не найден, возвращаем null без ошибки (graceful degradation)
      if (error.code === "PGRST116") {
        return { data: null, error: null };
      }
      return { data: null, error };
    }

    const [weightRes, equipmentRes, envRes] = await Promise.all([
      getLatestUserWeightKg(userId),
      getUserActiveEquipmentSlugs(userId),
      getUserActiveTrainingEnvironmentSlug(userId),
    ]);

    if (weightRes.error) {
      console.warn("[getUserProfile] Failed to load users_measurements:", weightRes.error.message);
    }
    if (equipmentRes.error) {
      console.warn("[getUserProfile] Failed to load users_equipment:", equipmentRes.error.message);
    }
    if (envRes.error) {
      console.warn(
        "[getUserProfile] Failed to load users_training_environment_profiles:",
        envRes.error.message
      );
    }

    return {
      data: {
        ...data,
        weight_kg: weightRes.data ?? null,
        equipment_items: equipmentRes.data ?? [],
        training_environment: apiEnvFromDb(envRes.data),
      },
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error: { message: err.message, code: "INTERNAL_ERROR" },
    };
  }
}

/**
 * Создание или обновление профиля пользователя (upsert)
 * @param {string} userId - ID пользователя (UUID)
 * @param {object} payload - Данные профиля для обновления
 * @param {string} [payload.level] - Уровень: 'beginner' | 'intermediate' | 'advanced'
 * @param {string} [payload.goal] - Цель: 'fat_loss' | 'muscle_gain' | 'health' | 'performance'
 * @param {string[]} [payload.preferred_equipment] - Массив оборудования
 * @param {string[]} [payload.preferred_muscles] - Массив целевых мышц
 * @param {string} [payload.language] - Язык: 'ru' | 'en'
 * @param {object} [payload.restrictions] - Ограничения в формате JSON
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function upsertUserProfile(userId, payload) {
  try {
    if (!userId) {
      return {
        data: null,
        error: {
          message: "userId is required",
          code: "VALIDATION_ERROR",
        },
      };
    }

    // Подготовка данных для update/insert
    // Сохраняем данные в отдельные колонки таблицы users
    console.log(`[upsertUserProfile] Starting profile update for user ${userId}`);
    console.log(`[upsertUserProfile] Received payload keys:`, Object.keys(payload));
    console.log(`[upsertUserProfile] Received payload:`, JSON.stringify(payload, null, 2));
    
    const profileData = {
      // id не добавляем - он используется только для WHERE в UPDATE или INSERT
      // updated_at убран - этой колонки нет в таблице users
    };

    // Добавляем только переданные поля (частичное обновление) - сохраняем в отдельные колонки
    if (payload.level !== undefined) {
      profileData.level = payload.level;
    }
    if (payload.goal !== undefined) {
      profileData.goal = payload.goal;
    }
    // preferred_equipment и preferred_muscles НЕ сохраняем в users - этих полей нет в таблице
    // Они могут быть в payload для совместимости, но игнорируем их
    if (payload.language !== undefined) {
      profileData.language = payload.language;
    }
    if (payload.restrictions !== undefined) {
      profileData.restrictions =
        typeof payload.restrictions === "object" && payload.restrictions !== null
          ? payload.restrictions
          : {};
    }
    // equipment_weights сохраняем в restrictions, так как отдельного поля нет в таблице
    if (payload.equipment_weights !== undefined) {
      // Инициализируем restrictions, если его еще нет
      if (!profileData.restrictions) {
        profileData.restrictions = {};
      }
      // Проверяем, что restrictions - это объект (не массив и не null)
      if (typeof profileData.restrictions === "object" && profileData.restrictions !== null && !Array.isArray(profileData.restrictions)) {
        profileData.restrictions.equipment_weights = payload.equipment_weights;
        console.log(`[upsertUserProfile] Added equipment_weights to restrictions:`, Object.keys(payload.equipment_weights || {}).length, 'items');
      } else {
        console.warn(`[upsertUserProfile] Cannot add equipment_weights: restrictions is not a valid object`);
      }
    }
    // training_environment/equipment_items/weight_kg НЕ пишем в users.
    // Они сохраняются в нормализованные таблицы: users_training_environment_profiles, users_equipment, users_measurements.
    if (payload.training_environment !== undefined) {
      const validEnvironments = ["home", "gym", "outdoor", "workout"];
      if (payload.training_environment && !validEnvironments.includes(payload.training_environment)) {
        return {
          data: null,
          error: {
            message: `training_environment must be one of: ${validEnvironments.join(", ")}`,
            code: "VALIDATION_ERROR",
          },
        };
      }
    }
    if (payload.equipment_items !== undefined && !Array.isArray(payload.equipment_items)) {
      return {
        data: null,
        error: {
          message: "equipment_items must be an array of strings",
          code: "VALIDATION_ERROR",
        },
      };
    }
    // weight_kg валидируем при insertUserWeightMeasurement
    if (payload.height_cm !== undefined) {
      if (payload.height_cm !== null && (isNaN(payload.height_cm) || payload.height_cm <= 0)) {
        return {
          data: null,
          error: {
            message: "height_cm must be a positive number or null",
            code: "VALIDATION_ERROR",
          },
        };
      }
      profileData.height_cm = payload.height_cm;
    }
    if (payload.coach_style !== undefined) {
      const validStyles = ["sergeant", "partner", "scientist"];
      if (payload.coach_style && !validStyles.includes(payload.coach_style)) {
        return {
          data: null,
          error: {
            message: `coach_style must be one of: ${validStyles.join(", ")}`,
            code: "VALIDATION_ERROR",
          },
        };
      }
      profileData.coach_style = payload.coach_style;
    }
    if (payload.date_of_birth !== undefined) {
      profileData.date_of_birth = payload.date_of_birth;
    }
    if (payload.goals !== undefined) {
      profileData.goals = Array.isArray(payload.goals) ? payload.goals : [];
      if (profileData.goals.length > 2) {
        return {
          data: null,
          error: {
            message: "goals array must contain at most 2 items",
            code: "VALIDATION_ERROR",
          },
        };
      }
    }
    // special_programs НЕ сохраняем в users - этого поля нет в таблице
    // Они могут быть в payload для совместимости, но игнорируем их
    if (payload.training_days_per_week !== undefined) {
      if (
        payload.training_days_per_week !== null &&
        (isNaN(payload.training_days_per_week) || payload.training_days_per_week < 0)
      ) {
        return {
          data: null,
          error: {
            message: "training_days_per_week must be a non-negative number or null",
            code: "VALIDATION_ERROR",
          },
        };
      }
      profileData.training_days_per_week = payload.training_days_per_week;
    }
    if (payload.name !== undefined) {
      profileData.name = payload.name;
    }
    if (payload.gender !== undefined) {
      const validGenders = ["male", "female", "other", "prefer_not_to_say"];
      if (payload.gender && !validGenders.includes(payload.gender)) {
        return {
          data: null,
          error: {
            message: `gender must be one of: ${validGenders.join(", ")}`,
            code: "VALIDATION_ERROR",
          },
        };
      }
      profileData.gender = payload.gender;
    }
    if (payload.contraindications !== undefined) {
      profileData.contraindications =
        typeof payload.contraindications === "object" && payload.contraindications !== null
          ? payload.contraindications
          : {};
    }
    if (payload.notifications_enabled !== undefined) {
      profileData.notifications_enabled = Boolean(payload.notifications_enabled);
    }
    if (payload.nutrition_enabled !== undefined) {
      profileData.nutrition_enabled = Boolean(payload.nutrition_enabled);
    }
    if (payload.current_step !== undefined) {
      if (payload.current_step !== null && (isNaN(payload.current_step) || payload.current_step < 0)) {
        return {
          data: null,
          error: {
            message: "current_step must be a non-negative number or null",
            code: "VALIDATION_ERROR",
          },
        };
      }
      profileData.current_step = payload.current_step;
    }

    // Логируем, что собрали в profileData
    console.log(`[upsertUserProfile] Profile data prepared:`, {
      keysCount: Object.keys(profileData).length,
      keys: Object.keys(profileData),
      hasGender: 'gender' in profileData,
      hasName: 'name' in profileData,
      hasLevel: 'level' in profileData,
      hasGoal: 'goal' in profileData,
      profileData: JSON.stringify(profileData, null, 2),
    });

    // Проверяем, существует ли пользователь
    console.log(`[upsertUserProfile] Checking if user ${userId} exists...`);
    const { data: existingUser, error: checkError } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (checkError && checkError.code !== "PGRST116") {
      console.error("[upsertUserProfile] Error checking user existence:", checkError);
      return { data: null, error: checkError };
    }
    
    console.log(`[upsertUserProfile] User ${userId} ${existingUser ? 'exists' : 'does not exist'}`);

    let result;
    if (existingUser) {
      // Обновляем существующего пользователя
      console.log(`[upsertUserProfile] Updating existing user ${userId}`);
      console.log(`[upsertUserProfile] Profile data keys (${Object.keys(profileData).length} fields):`, Object.keys(profileData));
      console.log(`[upsertUserProfile] Profile data:`, JSON.stringify(profileData, null, 2));
      result = await supabaseAdmin
        .from("users")
        .update(profileData)
        .eq("id", userId)
        .select()
        .single();
    } else {
      // Создаём нового пользователя (если его нет)
      console.log(`[upsertUserProfile] Creating new user ${userId}`);
      // Добавляем обязательные поля для нового пользователя
      // created_at устанавливается автоматически в БД (DEFAULT NOW())
      // Генерируем уникальный email для избежания конфликтов
      const timestamp = Date.now();
      const userIdShort = userId.substring(0, 8);
      const uniqueEmail = `anonymous_${timestamp}_${userIdShort}@rytmox.local`;
      
      const newUserData = {
        id: userId, // При создании нужно указать id
        email: uniqueEmail, // Обязательное поле, уникальное
        password_hash: 'anonymous', // Обязательное поле
        ...profileData,
        // Убираем auth_type и is_active - их может не быть в схеме
      };
      console.log(`[upsertUserProfile] New user data keys (${Object.keys(newUserData).length} total):`, Object.keys(newUserData));
      console.log(`[upsertUserProfile] New user data (excluding sensitive):`, JSON.stringify({
        ...newUserData,
        password_hash: '[REDACTED]'
      }, null, 2));
      console.log(`[upsertUserProfile] About to INSERT into users table...`);
      result = await supabaseAdmin
        .from("users")
        .insert([newUserData])
        .select()
        .single();
    }

    if (result.error) {
      console.error("[upsertUserProfile] ❌ Error saving profile:", {
        message: result.error.message,
        code: result.error.code,
        details: result.error.details,
        hint: result.error.hint,
        fullError: JSON.stringify(result.error, null, 2),
      });
      return { data: null, error: result.error };
    }

    console.log(`[upsertUserProfile] ✅ Successfully saved profile for user ${userId}`);
    console.log(`[upsertUserProfile] Saved data keys (${Object.keys(result.data || {}).length}):`, Object.keys(result.data || {}));
    console.log(`[upsertUserProfile] Saved profile summary:`, {
      id: result.data?.id,
      name: result.data?.name,
      gender: result.data?.gender,
      level: result.data?.level,
      goal: result.data?.goal,
      height_cm: result.data?.height_cm,
      goals_count: Array.isArray(result.data?.goals) ? result.data.goals.length : 0,
      hasEmail: !!result.data?.email,
    });

    // Сохраняем нормализованные поля (если они были в payload)
    console.log(`[upsertUserProfile] Saving normalized fields:`, {
      hasWeight: payload.weight_kg !== undefined,
      weightValue: payload.weight_kg,
      hasEquipment: payload.equipment_items !== undefined,
      equipmentCount: Array.isArray(payload.equipment_items) ? payload.equipment_items.length : 0,
      hasEnvironment: payload.training_environment !== undefined,
      environmentValue: payload.training_environment,
    });

    if (payload.weight_kg !== undefined) {
      console.log(`[upsertUserProfile] Inserting weight measurement: ${payload.weight_kg} kg`);
      const { error: wErr } = await insertUserWeightMeasurement(userId, payload.weight_kg, "profile");
      if (wErr) {
        console.error("[upsertUserProfile] ❌ Failed to insert users_measurements:", {
          message: wErr.message,
          code: wErr.code,
          details: wErr.details,
          hint: wErr.hint,
          fullError: JSON.stringify(wErr, null, 2),
        });
      } else {
        console.log(`[upsertUserProfile] ✅ Successfully inserted weight measurement`);
      }
    }
    if (payload.equipment_items !== undefined) {
      console.log(`[upsertUserProfile] Replacing equipment: ${Array.isArray(payload.equipment_items) ? payload.equipment_items.length : 0} items`);
      const { error: eErr } = await replaceUserEquipment(userId, payload.equipment_items);
      if (eErr) {
        console.error("[upsertUserProfile] ❌ Failed to replace users_equipment:", {
          message: eErr.message,
          code: eErr.code,
          details: eErr.details,
          hint: eErr.hint,
          fullError: JSON.stringify(eErr, null, 2),
        });
      } else {
        console.log(`[upsertUserProfile] ✅ Successfully replaced equipment`);
      }
    }
    if (payload.training_environment !== undefined) {
      console.log(`[upsertUserProfile] Setting training environment: ${payload.training_environment}`);
      const { error: envErr } = await setUserActiveTrainingEnvironment(
        userId,
        payload.training_environment
      );
      if (envErr) {
        console.error("[upsertUserProfile] ❌ Failed to set users_training_environment_profiles:", {
          message: envErr.message,
          code: envErr.code,
          details: envErr.details,
          hint: envErr.hint,
          fullError: JSON.stringify(envErr, null, 2),
        });
      } else {
        console.log(`[upsertUserProfile] ✅ Successfully set training environment`);
      }
    }

    // Возвращаем обогащенный профиль, чтобы /profile был консистентен
    const { data: enriched, error: enrErr } = await getUserProfile(userId);
    if (enrErr) {
      return { data: result.data, error: null };
    }
    return { data: enriched, error: null };
  } catch (err) {
    return {
      data: null,
      error: { message: err.message, code: "INTERNAL_ERROR" },
    };
  }
}

module.exports = {
  getUserProfile,
  upsertUserProfile,
};

