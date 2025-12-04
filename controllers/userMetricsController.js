const userMetricsService = require("../services/userMetricsService");

/**
 * POST /metrics/body
 * Добавление новой метрики тела пользователя
 */
exports.addBodyMetric = async (req, res) => {
  try {
    // Извлечение userId: приоритет у токена, затем body
    const userIdFromToken = req.user?.id;
    const userIdFromBody = req.body.userId;
    const userId = userIdFromToken || userIdFromBody;

    const { weightKg, bodyFatPct, recordedAt, notes, heightCm } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    if (!weightKg || weightKg <= 0) {
      return res.status(400).json({
        error: "weightKg is required and must be greater than 0",
      });
    }

    const { data, error } = await userMetricsService.addBodyMetric({
      userId,
      weightKg,
      bodyFatPct,
      recordedAt,
      notes,
      heightCm,
    });

    if (error) {
      console.error("Error adding body metric:", error);
      const statusCode = error.code === "VALIDATION_ERROR" ? 400 : 500;
      return res.status(statusCode).json({ error: error.message });
    }

    return res.status(201).json({
      metric: data.metric,
      profileUpdated: data.profileUpdated,
    });
  } catch (err) {
    console.error("Unexpected error in addBodyMetric controller:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /metrics/body/user/:userId
 * Получение истории метрик тела пользователя
 */
exports.getBodyMetricHistory = async (req, res) => {
  try {
    // Извлечение userId: приоритет у токена, затем params
    const userIdFromToken = req.user?.id;
    const userIdFromParams = req.params.userId;
    const userId = userIdFromToken || userIdFromParams;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 30;
    const from = req.query.from || null;
    const to = req.query.to || null;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const { data, error } = await userMetricsService.getBodyMetricHistory(userId, {
      limit,
      from,
      to,
    });

    if (error) {
      console.error("Error getting body metric history:", error);
      const statusCode = error.code === "VALIDATION_ERROR" ? 400 : 500;
      return res.status(statusCode).json({ error: error.message });
    }

    return res.status(200).json({
      metrics: data || [],
    });
  } catch (err) {
    console.error("Unexpected error in getBodyMetricHistory controller:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

