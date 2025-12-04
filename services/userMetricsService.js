const { supabaseAdmin } = require("../utils/supabaseClient");

/**
 * Добавление новой метрики тела пользователя
 * @param {object} params - Параметры метрики
 * @param {string} params.userId - ID пользователя (UUID)
 * @param {number} params.weightKg - Вес в килограммах
 * @param {number} [params.bodyFatPct] - Процент жира (опционально)
 * @param {string} [params.recordedAt] - Дата и время фиксации (ISO string, опционально, по умолчанию now())
 * @param {string} [params.notes] - Заметки (опционально)
 * @param {number} [params.heightCm] - Рост в сантиметрах (опционально, обновит профиль)
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function addBodyMetric({ userId, weightKg, bodyFatPct, recordedAt, notes, heightCm }) {
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

    if (!weightKg || weightKg <= 0) {
      return {
        data: null,
        error: {
          message: "weightKg is required and must be greater than 0",
          code: "VALIDATION_ERROR",
        },
      };
    }

    // Используем переданную дату или текущее время
    const recordedAtValue = recordedAt || new Date().toISOString();

    // 1. Создаём запись в user_body_metrics
    const metricData = {
      user_id: userId,
      weight_kg: weightKg,
      recorded_at: recordedAtValue,
    };

    if (bodyFatPct !== undefined && bodyFatPct !== null) {
      metricData.body_fat_pct = bodyFatPct;
    }

    if (notes !== undefined && notes !== null) {
      metricData.notes = notes;
    }

    const { data: metric, error: metricError } = await supabaseAdmin
      .from("user_body_metrics")
      .insert([metricData])
      .select()
      .single();

    if (metricError) {
      return {
        data: null,
        error: {
          message: `Failed to create body metric: ${metricError.message}`,
          code: "DATABASE_ERROR",
        },
      };
    }

    // 2. Обновляем user_profiles.weight_kg (и опционально height_cm)
    const profileUpdate = {
      weight_kg: weightKg,
    };

    if (heightCm !== undefined && heightCm !== null && heightCm > 0) {
      profileUpdate.height_cm = heightCm;
    }

    const { error: profileError } = await supabaseAdmin
      .from("user_profiles")
      .upsert(
        {
          user_id: userId,
          ...profileUpdate,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id",
          ignoreDuplicates: false,
        }
      );

    if (profileError) {
      // Логируем ошибку, но не прерываем выполнение (метрика уже создана)
      console.warn(`Failed to update user profile weight: ${profileError.message}`);
    }

    return {
      data: {
        metric: metric,
        profileUpdated: !profileError,
      },
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error: {
        message: err.message || "Internal server error",
        code: "INTERNAL_ERROR",
      },
    };
  }
}

/**
 * Получение последней метрики тела пользователя
 * @param {string} userId - ID пользователя (UUID)
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function getLatestBodyMetric(userId) {
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
      .from("user_body_metrics")
      .select("*")
      .eq("user_id", userId)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .single();

    if (error) {
      // Если запись не найдена, возвращаем null без ошибки (graceful degradation)
      if (error.code === "PGRST116") {
        return { data: null, error: null };
      }
      return { data: null, error };
    }

    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: {
        message: err.message || "Internal server error",
        code: "INTERNAL_ERROR",
      },
    };
  }
}

/**
 * Получение истории метрик тела пользователя
 * @param {string} userId - ID пользователя (UUID)
 * @param {object} [options] - Опции фильтрации
 * @param {number} [options.limit] - Лимит записей (по умолчанию 30)
 * @param {string} [options.from] - Начальная дата (ISO string, опционально)
 * @param {string} [options.to] - Конечная дата (ISO string, опционально)
 * @returns {Promise<{data: array|null, error: object|null}>}
 */
async function getBodyMetricHistory(userId, options = {}) {
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

    const { limit = 30, from, to } = options;

    let query = supabaseAdmin
      .from("user_body_metrics")
      .select("*")
      .eq("user_id", userId)
      .order("recorded_at", { ascending: false });

    // Фильтрация по дате
    if (from) {
      query = query.gte("recorded_at", from);
    }
    if (to) {
      query = query.lte("recorded_at", to);
    }

    // Лимит
    if (limit > 0) {
      query = query.limit(limit);
    }

    const { data, error } = await query;

    if (error) {
      return { data: null, error };
    }

    return {
      data: data || [],
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error: {
        message: err.message || "Internal server error",
        code: "INTERNAL_ERROR",
      },
    };
  }
}

module.exports = {
  addBodyMetric,
  getLatestBodyMetric,
  getBodyMetricHistory,
};

