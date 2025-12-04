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
      .from("user_profiles")
      .select("*")
      .eq("user_id", userId)
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

    // Подготовка данных для upsert
    const profileData = {
      user_id: userId,
      updated_at: new Date().toISOString(),
    };

    // Добавляем только переданные поля (частичное обновление)
    if (payload.level !== undefined) {
      profileData.level = payload.level;
    }
    if (payload.goal !== undefined) {
      profileData.goal = payload.goal;
    }
    if (payload.preferred_equipment !== undefined) {
      // Убеждаемся, что это массив
      profileData.preferred_equipment = Array.isArray(payload.preferred_equipment)
        ? payload.preferred_equipment
        : [];
    }
    if (payload.preferred_muscles !== undefined) {
      // Убеждаемся, что это массив
      profileData.preferred_muscles = Array.isArray(payload.preferred_muscles)
        ? payload.preferred_muscles
        : [];
    }
    if (payload.language !== undefined) {
      profileData.language = payload.language;
    }
    if (payload.restrictions !== undefined) {
      // Убеждаемся, что это объект
      profileData.restrictions =
        typeof payload.restrictions === "object" && payload.restrictions !== null
          ? payload.restrictions
          : {};
    }
    if (payload.training_environment !== undefined) {
      // Валидация training_environment
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
      // Убеждаемся, что это массив строк
      profileData.equipment_items = Array.isArray(payload.equipment_items)
        ? payload.equipment_items
        : [];
    }
    if (payload.weight_kg !== undefined) {
      // Валидация weight_kg
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
      // Валидация height_cm
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

    // Используем upsert (INSERT ... ON CONFLICT UPDATE)
    const { data, error } = await supabaseAdmin
      .from("user_profiles")
      .upsert(profileData, {
        onConflict: "user_id",
        ignoreDuplicates: false,
      })
      .select()
      .single();

    if (error) {
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

module.exports = {
  getUserProfile,
  upsertUserProfile,
};

