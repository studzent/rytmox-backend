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
  console.log(`[getUserActiveEquipmentSlugs] Loading equipment for userId: ${userId}`);
  
  const { data, error } = await supabaseAdmin
    .from("users_equipment")
    .select("equipment_item_slug, availability, active")
    .eq("user_id", userId)
    .eq("active", true);

  if (error) {
    console.error(`[getUserActiveEquipmentSlugs] ❌ Error loading equipment:`, {
      error: error.message,
      code: error.code,
      details: error.details,
    });
    return { data: null, error };
  }
  
  console.log(`[getUserActiveEquipmentSlugs] Raw data from DB:`, {
    raw_count: data?.length || 0,
    raw_sample: data?.slice(0, 5) || [],
  });
  
  const filtered = (data || [])
    .filter((r) => (r.availability ? r.availability !== "unavailable" : true))
    .map((r) => r.equipment_item_slug)
    .filter(Boolean);
  
  console.log(`[getUserActiveEquipmentSlugs] ✅ Filtered equipment slugs:`, {
    filtered_count: filtered.length,
    filtered_slugs: filtered.slice(0, 10),
  });
  
  return {
    data: filtered,
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

  // Используем .limit(1) вместо .single() для устойчивости к дубликатам slug
  const { data: envProfiles, error: envErr } = await supabaseAdmin
    .from("training_environment_profiles")
    .select("id, slug")
    .eq("slug", envSlug)
    .limit(1);
  
  if (envErr) return { error: envErr };
  
  let envProfile = envProfiles && envProfiles.length > 0 ? envProfiles[0] : null;
  
  // Если профиля нет, создаем базовый профиль
  if (!envProfile) {
    const baseNameMap = {
      home: "Дом",
      gym: "Тренажерный зал",
      workout: "Воркаут",
    };
    const baseName = baseNameMap[envSlug] || envSlug;
    
    const { data: newProfile, error: createErr } = await supabaseAdmin
      .from("training_environment_profiles")
      .insert([
        {
          id: crypto.randomUUID(),
          slug: envSlug,
          name: baseName,
        },
      ])
      .select()
      .single();
    
    if (createErr || !newProfile) {
      return {
        error: {
          message: createErr?.message || "Failed to create base training environment profile",
          code: createErr?.code || "DATABASE_ERROR",
          details: createErr?.details || null,
          hint: createErr?.hint || null,
        },
      };
    }
    envProfile = newProfile;
  }

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

/**
 * Validate equipment slugs against equipment_items table
 * @param {string[]} slugs - Array of equipment slugs to validate
 * @returns {Promise<{validSlugs: string[], invalidSlugs: string[], error: object|null}>}
 */
async function validateEquipmentSlugs(slugs) {
  if (!Array.isArray(slugs) || slugs.length === 0) {
    return { validSlugs: [], invalidSlugs: [], error: null };
  }

  try {
    const { data: validItems, error } = await supabaseAdmin
      .from("equipment_items")
      .select("slug")
      .in("slug", slugs);

    if (error) {
      return { validSlugs: [], invalidSlugs: slugs, error };
    }

    const validSlugSet = new Set((validItems || []).map(item => item.slug));
    const validSlugs = slugs.filter(slug => validSlugSet.has(slug));
    const invalidSlugs = slugs.filter(slug => !validSlugSet.has(slug));

    return { validSlugs, invalidSlugs, error: null };
  } catch (err) {
    return {
      validSlugs: [],
      invalidSlugs: slugs,
      error: { message: err.message, code: "INTERNAL_ERROR" },
    };
  }
}

async function replaceUserEquipment(userId, equipmentSlugs) {
  console.log(`[replaceUserEquipment] Starting replacement for userId: ${userId}`, {
    equipmentSlugs: equipmentSlugs,
    equipmentSlugs_type: typeof equipmentSlugs,
    equipmentSlugs_isArray: Array.isArray(equipmentSlugs),
    equipmentSlugs_count: Array.isArray(equipmentSlugs) ? equipmentSlugs.length : 0,
    equipmentSlugs_sample: Array.isArray(equipmentSlugs) ? equipmentSlugs.slice(0, 10) : [],
  });
  
  const { error: deactErr } = await supabaseAdmin
    .from("users_equipment")
    .update({ active: false })
    .eq("user_id", userId);
  if (deactErr) {
    console.error(`[replaceUserEquipment] ❌ Error deactivating existing equipment:`, deactErr);
    return { error: deactErr };
  }

  const slugs = Array.isArray(equipmentSlugs) ? equipmentSlugs.filter(Boolean) : [];
  console.log(`[replaceUserEquipment] Filtered slugs:`, {
    original_count: Array.isArray(equipmentSlugs) ? equipmentSlugs.length : 0,
    filtered_count: slugs.length,
    filtered_slugs: slugs.slice(0, 10),
  });
  
  if (slugs.length === 0) {
    console.log(`[replaceUserEquipment] No equipment slugs to insert, returning success`);
    return { error: null, validatedSlugs: [] };
  }

  // Validate equipment slugs against equipment_items table
  const { validSlugs, invalidSlugs, error: validationError } = await validateEquipmentSlugs(slugs);
  
  if (validationError) {
    console.error(`[replaceUserEquipment] ❌ Error validating equipment slugs:`, validationError);
    // Continue with original slugs if validation fails (graceful degradation)
  }

  if (invalidSlugs.length > 0) {
    console.warn(`[replaceUserEquipment] ⚠️ Invalid equipment slugs found:`, invalidSlugs);
    // Log invalid slugs to ai_logs
    try {
      const aiService = require("./aiService");
      await aiService.logAIRequest(
        userId,
        "onboarding_validation",
        {
          type: "equipment_validation",
          invalid_slugs: invalidSlugs,
          valid_slugs: validSlugs,
        },
        {
          action: "filtered_invalid_equipment",
          removed_count: invalidSlugs.length,
        }
      );
    } catch (logError) {
      console.error(`[replaceUserEquipment] Failed to log validation warning:`, logError);
    }
  }

  const validatedSlugs = validSlugs.length > 0 ? validSlugs : slugs; // Fallback to original if validation failed
  
  if (validatedSlugs.length === 0) {
    console.log(`[replaceUserEquipment] No valid equipment slugs to insert, returning success`);
    return { error: null, validatedSlugs: [] };
  }

  await supabaseAdmin
    .from("users_equipment")
    .delete()
    .eq("user_id", userId)
    .in("equipment_item_slug", validatedSlugs);

  const rows = validatedSlugs.map((slug) => ({
    user_id: userId,
    equipment_item_slug: slug,
    availability: "available",
    active: true,
    added_at: new Date().toISOString(),
  }));

  console.log(`[replaceUserEquipment] Inserting ${rows.length} equipment rows:`, {
    rows_count: rows.length,
    rows_sample: rows.slice(0, 5).map(r => ({ user_id: r.user_id, equipment_item_slug: r.equipment_item_slug })),
  });

  const { data: insertedData, error: insErr } = await supabaseAdmin
    .from("users_equipment")
    .insert(rows)
    .select();
    
  if (insErr) {
    console.error(`[replaceUserEquipment] ❌ Error inserting equipment rows:`, {
      error: insErr.message,
      code: insErr.code,
      details: insErr.details,
      hint: insErr.hint,
      rows_count: rows.length,
      rows_sample: rows.slice(0, 5),
    });
    return {
      error: {
        message: insErr.message || "Failed to insert users_equipment rows",
        code: insErr.code || "DATABASE_ERROR",
        details: insErr.details || null,
        hint: insErr.hint || null,
      },
    };
  }
  
  console.log(`[replaceUserEquipment] ✅ Successfully inserted ${insertedData?.length || 0} equipment rows`);
  return { error: null, validatedSlugs };
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

    const equipmentItems = equipmentRes.data ?? [];
    console.log(`[getUserProfile] ✅ Returning profile with equipment_items:`, {
      userId: data.id,
      equipment_items: equipmentItems,
      equipment_items_count: equipmentItems.length,
      equipment_items_sample: equipmentItems.slice(0, 10),
      training_environment: apiEnvFromDb(envRes.data),
      weight_kg: weightRes.data ?? null,
    });

    return {
      data: {
        ...data,
        weight_kg: weightRes.data ?? null,
        equipment_items: equipmentItems,
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
    console.log(`[upsertUserProfile] ===== START =====`);
    console.log(`[upsertUserProfile] Starting profile update for user ${userId}`);
    console.log(`[upsertUserProfile] Received payload keys (${Object.keys(payload).length}):`, Object.keys(payload));
    console.log(`[upsertUserProfile] Full received payload:`, JSON.stringify(payload, null, 2));
    console.log(`[upsertUserProfile] Payload field values:`, {
      level: payload.level,
      goal: payload.goal,
      name: payload.name,
      gender: payload.gender,
      training_days_per_week: payload.training_days_per_week,
      training_environment: payload.training_environment,
      weight_kg: payload.weight_kg,
      height_cm: payload.height_cm,
      equipment_items_count: Array.isArray(payload.equipment_items) ? payload.equipment_items.length : 0,
      goals_count: Array.isArray(payload.goals) ? payload.goals.length : 0,
      special_programs_count: Array.isArray(payload.special_programs) ? payload.special_programs.length : 0,
      coach_style: payload.coach_style,
      date_of_birth: payload.date_of_birth,
      notifications_enabled: payload.notifications_enabled,
      nutrition_enabled: payload.nutrition_enabled,
      current_step: payload.current_step,
      hasRestrictions: !!payload.restrictions,
      hasContraindications: !!payload.contraindications,
    });
    
    const profileData = {
      // id не добавляем - он используется только для WHERE в UPDATE или INSERT
      // updated_at убран - этой колонки нет в таблице users
    };

    // Добавляем только переданные поля (частичное обновление) - сохраняем в отдельные колонки
    if (payload.level !== undefined) {
      // Ensure level is never null - default to 'intermediate' if not provided or invalid
      if (payload.level && ['beginner', 'intermediate', 'advanced'].includes(payload.level)) {
        profileData.level = payload.level;
      } else {
        profileData.level = 'intermediate';
      }
    } else {
      // If level is not provided at all, set default to 'intermediate'
      profileData.level = 'intermediate';
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
    // Сохраняем special_programs в restrictions, так как колонка special_programs может не существовать
    if (payload.special_programs !== undefined) {
      // Инициализируем restrictions, если его еще нет
      if (!profileData.restrictions) {
        profileData.restrictions = {};
      }
      // Проверяем, что restrictions - это объект (не массив и не null)
      if (typeof profileData.restrictions === "object" && profileData.restrictions !== null && !Array.isArray(profileData.restrictions)) {
        const filteredPrograms = Array.isArray(payload.special_programs) 
          ? payload.special_programs.filter(sp => sp !== 'none')
          : [];
        profileData.restrictions.specialPrograms = filteredPrograms;
        console.log(`[upsertUserProfile] Added special_programs to restrictions: ${filteredPrograms.length} items`);
      } else {
        console.warn(`[upsertUserProfile] Cannot add special_programs: restrictions is not a valid object`);
      }
    }
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
      if (typeof payload.contraindications === "object" && payload.contraindications !== null) {
        // Normalize contraindication keys: lowercase, replace spaces/hyphens with underscores
        const normalized = {};
        for (const [key, value] of Object.entries(payload.contraindications)) {
          const normalizedKey = String(key).toLowerCase().replace(/[\s-]/g, '_');
          normalized[normalizedKey] = value;
        }
        profileData.contraindications = normalized;
      } else {
        profileData.contraindications = {};
      }
    }
    if (payload.notifications_enabled !== undefined) {
      profileData.notifications_enabled = Boolean(payload.notifications_enabled);
    }
    if (payload.nutrition_enabled !== undefined) {
      profileData.nutrition_enabled = Boolean(payload.nutrition_enabled);
    }
    if (payload.weight_unit !== undefined) {
      // Validate weight_unit: must be 'kg' or 'lb' (or 'lbs')
      const validUnits = ['kg', 'lb', 'lbs'];
      const normalizedUnit = payload.weight_unit === 'lbs' ? 'lb' : payload.weight_unit;
      if (validUnits.includes(normalizedUnit)) {
        profileData.weight_unit = normalizedUnit;
      } else {
        profileData.weight_unit = 'kg'; // Default to kg if invalid
      }
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
    if (payload.body_focus_zones !== undefined) {
      profileData.body_focus_zones = Array.isArray(payload.body_focus_zones) ? payload.body_focus_zones : [];
      // Validate max 3 selections
      if (profileData.body_focus_zones.length > 3) {
        return {
          data: null,
          error: {
            message: "body_focus_zones array must contain at most 3 items",
            code: "VALIDATION_ERROR",
          },
        };
      }
    }
    if (payload.emphasized_muscles !== undefined) {
      profileData.emphasized_muscles = Array.isArray(payload.emphasized_muscles) ? payload.emphasized_muscles : [];
      // Validate max 4 selections
      if (profileData.emphasized_muscles.length > 4) {
        return {
          data: null,
          error: {
            message: "emphasized_muscles array must contain at most 4 items",
            code: "VALIDATION_ERROR",
          },
        };
      }
    }

    // Логируем, что собрали в profileData
    console.log(`[upsertUserProfile] ===== PROFILE DATA PREPARED =====`);
    console.log(`[upsertUserProfile] Profile data keys (${Object.keys(profileData).length}):`, Object.keys(profileData));
    console.log(`[upsertUserProfile] Full profileData:`, JSON.stringify(profileData, null, 2));
    console.log(`[upsertUserProfile] Profile data field values:`, {
      hasGender: 'gender' in profileData,
      gender: profileData.gender,
      hasName: 'name' in profileData,
      name: profileData.name,
      hasLevel: 'level' in profileData,
      level: profileData.level,
      hasGoal: 'goal' in profileData,
      goal: profileData.goal,
      hasTrainingDaysPerWeek: 'training_days_per_week' in profileData,
      training_days_per_week: profileData.training_days_per_week,
      hasHeightCm: 'height_cm' in profileData,
      height_cm: profileData.height_cm,
      hasCoachStyle: 'coach_style' in profileData,
      coach_style: profileData.coach_style,
      hasDateOfBirth: 'date_of_birth' in profileData,
      date_of_birth: profileData.date_of_birth,
      hasGoals: 'goals' in profileData,
      goals_count: Array.isArray(profileData.goals) ? profileData.goals.length : 0,
      hasNotificationsEnabled: 'notifications_enabled' in profileData,
      notifications_enabled: profileData.notifications_enabled,
      hasNutritionEnabled: 'nutrition_enabled' in profileData,
      nutrition_enabled: profileData.nutrition_enabled,
      hasCurrentStep: 'current_step' in profileData,
      current_step: profileData.current_step,
      hasRestrictions: 'restrictions' in profileData,
      hasContraindications: 'contraindications' in profileData,
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
    console.log(`[upsertUserProfile] ===== SAVED TO DATABASE =====`);
    console.log(`[upsertUserProfile] Saved data keys (${Object.keys(result.data || {}).length}):`, Object.keys(result.data || {}));
    console.log(`[upsertUserProfile] Full saved data:`, JSON.stringify(result.data, null, 2));
    console.log(`[upsertUserProfile] Saved profile summary:`, {
      id: result.data?.id,
      name: result.data?.name,
      gender: result.data?.gender,
      level: result.data?.level,
      goal: result.data?.goal,
      training_days_per_week: result.data?.training_days_per_week,
      height_cm: result.data?.height_cm,
      coach_style: result.data?.coach_style,
      date_of_birth: result.data?.date_of_birth,
      goals_count: Array.isArray(result.data?.goals) ? result.data.goals.length : 0,
      special_programs_count: Array.isArray(result.data?.special_programs) ? result.data.special_programs.length : 0,
      notifications_enabled: result.data?.notifications_enabled,
      nutrition_enabled: result.data?.nutrition_enabled,
      current_step: result.data?.current_step,
      hasEmail: !!result.data?.email,
    });
    console.log(`[upsertUserProfile] ===== END =====`);

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
      // Получаем старое оборудование для сравнения
      const { data: oldEquipmentData } = await getUserActiveEquipmentSlugs(userId);
      const oldEquipment = oldEquipmentData || [];
      const oldEquipmentSorted = [...oldEquipment].sort().join(',');
      
      console.log(`[upsertUserProfile] Replacing equipment: ${Array.isArray(payload.equipment_items) ? payload.equipment_items.length : 0} items`);
      const { error: eErr, validatedSlugs } = await replaceUserEquipment(userId, payload.equipment_items);
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
        
        // Clean equipment_weights to only include validated slugs
        if (validatedSlugs && validatedSlugs.length > 0 && payload.equipment_weights) {
          const validatedSlugSet = new Set(validatedSlugs);
          const cleanedWeights = {};
          for (const [slug, weight] of Object.entries(payload.equipment_weights)) {
            if (validatedSlugSet.has(slug)) {
              cleanedWeights[slug] = weight;
            }
          }
          
          // Update restrictions.equipment_weights with cleaned version
          if (!profileData.restrictions) {
            profileData.restrictions = {};
          }
          if (typeof profileData.restrictions === "object" && profileData.restrictions !== null && !Array.isArray(profileData.restrictions)) {
            profileData.restrictions.equipment_weights = cleanedWeights;
            console.log(`[upsertUserProfile] Cleaned equipment_weights: ${Object.keys(cleanedWeights).length} valid items (removed ${Object.keys(payload.equipment_weights).length - Object.keys(cleanedWeights).length} invalid)`);
          }
        }
        
        // Проверяем, изменилось ли оборудование
        const newEquipment = validatedSlugs || payload.equipment_items || [];
        const newEquipmentSorted = [...newEquipment].sort().join(',');
        
        if (oldEquipmentSorted !== newEquipmentSorted) {
          console.log(`[upsertUserProfile] Equipment changed, regenerating future workouts`);
          console.log(`[upsertUserProfile] Old equipment: ${oldEquipment.length} items, New equipment: ${newEquipment.length} items`);
          
          // Регенерируем тренировки в фоне (не блокируем ответ)
          regenerateWorkoutsAfterEquipmentChange(userId, newEquipment).catch((error) => {
            console.error(`[upsertUserProfile] Error regenerating workouts after equipment change:`, error);
            // Не прерываем обновление профиля из-за ошибки регенерации
          });
        }
      }
    }
    if (payload.training_environment !== undefined) {
      console.log(`[upsertUserProfile] Setting training environment: ${payload.training_environment}`);
      
      // Если пользователь выбрал окружение и есть (или будут) тренажёры, гарантируем,
      // что у пользователя появится активный профиль окружения (users_training_environment_profiles).
      // Это критично для клиента: GET /profile и GET /locations должны отражать выбор онбординга.
      const equipmentCount =
        Array.isArray(payload.equipment_items) ? payload.equipment_items.length : 0;
      // Окружение должно быть активным даже если оборудование пустое:
      // пользователь всё равно выбрал место тренировки (home/gym/workout).
      const shouldEnsureActiveEnv = Boolean(payload.training_environment);
      
      if (shouldEnsureActiveEnv) {
        const { error: ensureEnvErr } = await setUserActiveTrainingEnvironment(
          userId,
          payload.training_environment
        );
        if (ensureEnvErr) {
          console.error("[upsertUserProfile] ❌ Failed to ensure active training environment:", {
            message: ensureEnvErr.message,
            code: ensureEnvErr.code,
            details: ensureEnvErr.details,
            hint: ensureEnvErr.hint,
          });
        } else {
          console.log("[upsertUserProfile] ✅ Ensured active training environment link");
        }
      }
      
      // ВАЖНО: Проверяем наличие профилей ПОСЛЕ сохранения equipment_items,
      // чтобы автовосстановление в listUserProfiles могло использовать свежие данные
      // Проверяем, есть ли уже профили у пользователя
      const { data: existingProfiles, error: checkProfilesErr } = await supabaseAdmin
        .from("users_training_environment_profiles")
        .select("training_environment_profile_id")
        .eq("user_id", userId)
        .limit(1);
      
      const hasExistingProfiles = !checkProfilesErr && existingProfiles && existingProfiles.length > 0;
      console.log(`[upsertUserProfile] User has existing profiles: ${hasExistingProfiles}`, {
        profilesCount: existingProfiles?.length || 0,
        checkError: checkProfilesErr?.message,
      });
      
      // Если есть equipment_items, создаем профиль с тренажерами (только если профилей еще нет)
      // Используем equipment_items из payload (уже сохранены в users_equipment выше)
      if (!hasExistingProfiles && payload.equipment_items && Array.isArray(payload.equipment_items) && payload.equipment_items.length > 0) {
        const trainingEnvironmentService = require("./trainingEnvironmentService");
        
        // Определяем название профиля на основе окружения
        const envNameMap = {
          home: "Дом",
          gym: "Тренажерный зал",
          workout: "Воркаут",
          outdoor: "Воркаут",
        };
        const profileName = envNameMap[payload.training_environment] || "Мой зал";
        
        console.log(`[upsertUserProfile] Creating profile with equipment: ${profileName}, ${payload.equipment_items.length} items`);
        
        // Создаем профиль с тренажерами
        const { data: profileData, error: createErr } = await trainingEnvironmentService.createProfile(
          userId,
          profileName,
          payload.training_environment,
          payload.equipment_items
        );
        
        if (createErr) {
          console.error("[upsertUserProfile] ❌ Failed to create training environment profile:", {
            message: createErr.message,
            code: createErr.code,
            details: createErr.details,
            hint: createErr.hint,
            fullError: JSON.stringify(createErr, null, 2),
          });

          // Если createProfile падает (например, из-за UNIQUE по slug),
          // active env link уже пытались обеспечить выше. Здесь просто логируем.
        } else {
          console.log(`[upsertUserProfile] ✅ Successfully created training environment profile: ${profileData?.id}`);
          
          // Активируем созданный профиль
          const { error: activateErr } = await trainingEnvironmentService.activateProfile(
            userId,
            profileData.id
          );
          
          if (activateErr) {
            console.error("[upsertUserProfile] ❌ Failed to activate profile:", activateErr.message);
          } else {
            console.log(`[upsertUserProfile] ✅ Successfully activated profile`);
          }
        }
      } else if (!hasExistingProfiles) {
        // Если нет тренажеров и нет профилей, используем старую логику (базовый профиль)
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
      } else {
        console.log(`[upsertUserProfile] User already has profiles, skipping creation`);
      }
    }

    // Логируем успешное сохранение онбординга
    try {
      const aiService = require("./aiService");
      const savedTablesSummary = {
        users: true,
        users_equipment: payload.equipment_items !== undefined,
        users_training_environment_profiles: payload.training_environment !== undefined,
        users_measurements: payload.weight_kg !== undefined,
      };
      await aiService.logAIRequest(
        userId,
        "onboarding_submit",
        {
          payload_keys: Object.keys(payload),
          level: profileData.level,
          goal: profileData.goal,
          training_environment: payload.training_environment,
          equipment_count: Array.isArray(payload.equipment_items) ? payload.equipment_items.length : 0,
          has_contraindications: !!payload.contraindications && Object.keys(payload.contraindications).length > 0,
          has_body_focus_zones: Array.isArray(payload.body_focus_zones) && payload.body_focus_zones.length > 0,
          has_emphasized_muscles: Array.isArray(payload.emphasized_muscles) && payload.emphasized_muscles.length > 0,
        },
        {
          saved_tables: savedTablesSummary,
          success: true,
        }
      );
    } catch (logError) {
      console.error("[upsertUserProfile] Failed to log onboarding_submit:", logError);
      // Don't fail the request if logging fails
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

/**
 * Получает даты тренировок на следующую неделю
 * @param {number} daysPerWeek - Количество тренировок в неделю
 * @returns {string[]} Массив дат в формате YYYY-MM-DD
 */
function getNextWeekWorkoutDates(daysPerWeek) {
  if (!daysPerWeek || daysPerWeek <= 0) {
    return [];
  }

  // Распределяем дни недели равномерно
  const dayOffsets = [];
  if (daysPerWeek === 1) {
    dayOffsets.push(1); // Завтра
  } else if (daysPerWeek === 2) {
    dayOffsets.push(1, 4); // Пн, Чт
  } else if (daysPerWeek === 3) {
    dayOffsets.push(1, 3, 5); // Пн, Ср, Пт
  } else if (daysPerWeek === 4) {
    dayOffsets.push(1, 2, 4, 6); // Пн, Вт, Чт, Сб
  } else if (daysPerWeek === 5) {
    dayOffsets.push(1, 2, 3, 5, 6); // Пн-Ср, Пт-Сб
  } else if (daysPerWeek === 6) {
    dayOffsets.push(1, 2, 3, 4, 5, 6); // Пн-Сб
  } else {
    dayOffsets.push(1, 2, 3, 4, 5, 6, 7); // Все дни
  }

  const start = new Date();
  start.setDate(start.getDate() + 1); // Начинаем с завтра

  const dates = dayOffsets.map((offset) => {
    const d = new Date(start);
    d.setDate(start.getDate() + offset - 1);
    return d.toISOString().split('T')[0]; // YYYY-MM-DD
  });

  return Array.from(new Set(dates)).sort();
}

/**
 * Рассчитывает параметры тренировки на основе цели и уровня
 * @param {string} goal - Цель тренировки
 * @param {string} level - Уровень пользователя
 * @param {number} dayOfWeek - День недели (0-6, опционально)
 * @returns {{durationMinutes: number, exercisesCount: number}}
 */
function calculateWorkoutParams(goal, level, dayOfWeek = 0) {
  // Базовые параметры в зависимости от цели
  let baseDuration = 30;
  let baseExercises = 8;

  switch (goal) {
    case 'fat_loss':
      baseDuration = 30;
      baseExercises = 7;
      break;
    case 'muscle_gain':
      baseDuration = 50;
      baseExercises = 10;
      break;
    case 'performance':
      baseDuration = 37;
      baseExercises = 8;
      break;
    case 'health':
    default:
      baseDuration = 25;
      baseExercises = 7;
      break;
  }

  // Вариация по дню недели
  let dayVariation = 0;
  if (dayOfWeek <= 1) {
    dayVariation = 0.1; // Пн-Вт: +10%
  } else if (dayOfWeek <= 3) {
    dayVariation = 0; // Ср-Чт: без изменений
  } else {
    dayVariation = -0.05; // Пт-Вс: -5%
  }

  let finalDuration = Math.round(baseDuration * (1 + dayVariation));
  let finalExercises = Math.round(baseExercises * (1 + dayVariation));

  // Ограничения
  finalDuration = Math.max(15, Math.min(90, finalDuration));
  finalExercises = Math.max(4, Math.min(15, finalExercises));

  return {
    durationMinutes: finalDuration,
    exercisesCount: finalExercises,
  };
}

/**
 * Получает индекс дня недели из даты (0 = Понедельник, 6 = Воскресенье)
 * @param {string} dateStr - Дата в формате YYYY-MM-DD
 * @returns {number} Индекс дня недели
 */
function getDayIndexFromDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00.000Z');
  const day = date.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
  return day === 0 ? 6 : day - 1; // Преобразуем в формат (0 = Monday)
}

/**
 * Регенерирует тренировки после изменения оборудования
 * @param {string} userId - ID пользователя
 * @param {string[]} newEquipment - Новый список оборудования
 */
async function regenerateWorkoutsAfterEquipmentChange(userId, newEquipment) {
  try {
    console.log(`[regenerateWorkoutsAfterEquipmentChange] Starting regeneration for userId: ${userId}`);
    
    // 1. Удаляем все будущие тренировки (date >= сегодня)
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    const { error: deleteError } = await supabaseAdmin
      .from('workouts')
      .delete()
      .eq('user_id', userId)
      .gte('date', today);
    
    if (deleteError) {
      console.error(`[regenerateWorkoutsAfterEquipmentChange] Error deleting future workouts:`, deleteError);
      return;
    }
    
    console.log(`[regenerateWorkoutsAfterEquipmentChange] Deleted future workouts for userId: ${userId}`);
    
    // 2. Получаем профиль пользователя
    const { data: profile, error: profileError } = await getUserProfile(userId);
    
    if (profileError || !profile) {
      console.error(`[regenerateWorkoutsAfterEquipmentChange] Error getting user profile:`, profileError);
      return;
    }
    
    const goal = profile.goal || 'health';
    const level = profile.level || 'beginner';
    const trainingDaysPerWeek = profile.training_days_per_week || 0;
    
    if (!trainingDaysPerWeek || trainingDaysPerWeek <= 0) {
      console.log(`[regenerateWorkoutsAfterEquipmentChange] No training days per week configured, skipping regeneration`);
      return;
    }
    
    console.log(`[regenerateWorkoutsAfterEquipmentChange] Profile data:`, {
      goal,
      level,
      trainingDaysPerWeek,
      equipmentCount: newEquipment.length,
    });
    
    // 3. Получаем даты тренировок на неделю
    const workoutDates = getNextWeekWorkoutDates(trainingDaysPerWeek);
    
    if (workoutDates.length === 0) {
      console.log(`[regenerateWorkoutsAfterEquipmentChange] No workout dates to generate`);
      return;
    }
    
    console.log(`[regenerateWorkoutsAfterEquipmentChange] Generating ${workoutDates.length} workouts for dates:`, workoutDates);
    
    // 4. Генерируем тренировки для каждой даты в фоне
    const aiService = require('./aiService');
    
    workoutDates.forEach((workoutDate, index) => {
      // Небольшая задержка между запросами, чтобы не перегружать API
      setTimeout(async () => {
        try {
          const dayIndex = getDayIndexFromDate(workoutDate);
          const workoutParams = calculateWorkoutParams(goal, level, dayIndex);
          
          console.log(`[regenerateWorkoutsAfterEquipmentChange] Generating workout for ${workoutDate} (day ${dayIndex}) with params:`, workoutParams);
          
          const { data: workoutData, error: generateError } = await aiService.generateWorkout({
            userId: userId,
            equipment: newEquipment,
            level: level,
            goal: goal,
            durationMinutes: workoutParams.durationMinutes,
            exercisesCount: workoutParams.exercisesCount,
            date: workoutDate,
            ignoreHistory: true, // Игнорируем историю для разнообразия
          });
          
          if (generateError) {
            console.error(`[regenerateWorkoutsAfterEquipmentChange] Error generating workout for ${workoutDate}:`, generateError);
          } else {
            console.log(`[regenerateWorkoutsAfterEquipmentChange] Successfully generated workout for ${workoutDate}:`, workoutData?.workoutId);
          }
        } catch (error) {
          console.error(`[regenerateWorkoutsAfterEquipmentChange] Unexpected error generating workout for ${workoutDate}:`, error);
        }
      }, index * 500); // Задержка 500ms между запросами
    });
    
    console.log(`[regenerateWorkoutsAfterEquipmentChange] ✅ Regeneration process started for ${workoutDates.length} workouts`);
  } catch (error) {
    console.error(`[regenerateWorkoutsAfterEquipmentChange] Unexpected error:`, error);
  }
}

module.exports = {
  getUserProfile,
  upsertUserProfile,
  replaceUserEquipment,
};

