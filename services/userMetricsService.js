const { supabaseAdmin } = require("../utils/supabaseClient");

/**
 * Добавление новой метрики тела пользователя
 * @param {object} params - Параметры метрики
 * @param {string} params.userId - ID пользователя (UUID)
 * @param {number} params.weightKg - Вес в килограммах
 * @param {number} [params.bodyFatPct] - Процент жира (не поддерживается в users_measurements, игнорируется)
 * @param {string} [params.recordedAt] - Дата и время фиксации (ISO string, опционально, по умолчанию now())
 * @param {string} [params.notes] - Заметки (не поддерживается в users_measurements, игнорируется)
 * @param {number} [params.heightCm] - Рост в сантиметрах (не поддерживается в users_measurements, игнорируется)
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
    const measuredAtValue = recordedAt || new Date().toISOString();

    // users_measurements: (id uuid, user_id uuid, measured_at timestamptz, weight_kg numeric, source text)
    const measurementRow = {
      user_id: userId,
      measured_at: measuredAtValue,
      weight_kg: weightKg,
      source: "metrics",
    };

    // Поля bodyFatPct/notes/heightCm в users_measurements не поддерживаются — логируем для отладки
    if (bodyFatPct !== undefined || notes !== undefined || heightCm !== undefined) {
      console.log("[userMetricsService.addBodyMetric] Ignoring unsupported fields for users_measurements:", {
        hasBodyFatPct: bodyFatPct !== undefined,
        hasNotes: notes !== undefined,
        hasHeightCm: heightCm !== undefined,
      });
    }

    const { data: measurement, error: metricError } = await supabaseAdmin
      .from("users_measurements")
      .insert([measurementRow])
      .select()
      .single();

    if (metricError) {
      return {
        data: null,
        error: {
          message: `Failed to create measurement: ${metricError.message}`,
          code: "DATABASE_ERROR",
        },
      };
    }

    return {
      data: {
        metric: measurement,
        profileUpdated: false,
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
      .from("users_measurements")
      .select("*")
      .eq("user_id", userId)
      .order("measured_at", { ascending: false })
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
      .from("users_measurements")
      .select("*")
      .eq("user_id", userId)
      .order("measured_at", { ascending: false });

    // Фильтрация по дате
    if (from) {
      query = query.gte("measured_at", from);
    }
    if (to) {
      query = query.lte("measured_at", to);
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

