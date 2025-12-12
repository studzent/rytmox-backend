const { supabaseAdmin } = require("../utils/supabaseClient");

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

    return { data, error: null };
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
    if (payload.preferred_equipment !== undefined) {
      profileData.preferred_equipment = Array.isArray(payload.preferred_equipment)
        ? payload.preferred_equipment
        : [];
    }
    if (payload.preferred_muscles !== undefined) {
      profileData.preferred_muscles = Array.isArray(payload.preferred_muscles)
        ? payload.preferred_muscles
        : [];
    }
    if (payload.language !== undefined) {
      profileData.language = payload.language;
    }
    if (payload.restrictions !== undefined) {
      profileData.restrictions =
        typeof payload.restrictions === "object" && payload.restrictions !== null
          ? payload.restrictions
          : {};
    }
    if (payload.training_environment !== undefined) {
      const validEnvironments = ["home", "gym", "outdoor"];
      if (payload.training_environment && !validEnvironments.includes(payload.training_environment)) {
        return {
          data: null,
          error: {
            message: `training_environment must be one of: ${validEnvironments.join(", ")}`,
            code: "VALIDATION_ERROR",
          },
        };
      }
      profileData.training_environment = payload.training_environment;
    }
    if (payload.equipment_items !== undefined) {
      profileData.equipment_items = Array.isArray(payload.equipment_items)
        ? payload.equipment_items
        : [];
    }
    if (payload.weight_kg !== undefined) {
      if (payload.weight_kg !== null && (isNaN(payload.weight_kg) || payload.weight_kg <= 0)) {
        return {
          data: null,
          error: {
            message: "weight_kg must be a positive number or null",
            code: "VALIDATION_ERROR",
          },
        };
      }
      profileData.weight_kg = payload.weight_kg;
    }
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
    if (payload.special_programs !== undefined) {
      profileData.special_programs = Array.isArray(payload.special_programs)
        ? payload.special_programs
        : [];
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

    // Проверяем, существует ли пользователь
    const { data: existingUser, error: checkError } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (checkError && checkError.code !== "PGRST116") {
      console.error("[upsertUserProfile] Error checking user existence:", checkError);
      return { data: null, error: checkError };
    }

    let result;
    if (existingUser) {
      // Обновляем существующего пользователя
      console.log(`[upsertUserProfile] Updating existing user ${userId}`);
      console.log(`[upsertUserProfile] Profile data keys:`, Object.keys(profileData));
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
      const newUserData = {
        id: userId, // При создании нужно указать id
        email: `anonymous_${Date.now()}_${userId.substring(0, 8)}@rytmox.local`, // Обязательное поле
        password_hash: 'anonymous', // Обязательное поле
        ...profileData,
        // Убираем auth_type и is_active - их может не быть в схеме
      };
      console.log(`[upsertUserProfile] New user data keys:`, Object.keys(newUserData));
      console.log(`[upsertUserProfile] New user data:`, JSON.stringify(newUserData, null, 2));
      result = await supabaseAdmin
        .from("users")
        .insert([newUserData])
        .select()
        .single();
    }

    if (result.error) {
      console.error("[upsertUserProfile] Error saving profile:", result.error);
      return { data: null, error: result.error };
    }

    console.log(`[upsertUserProfile] Successfully saved profile for user ${userId}`);
    return { data: result.data, error: null };
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

