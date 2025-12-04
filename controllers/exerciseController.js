const exerciseService = require("../services/exerciseService");

/**
 * GET /exercises
 * Получение списка упражнений с фильтрами
 */
exports.listExercises = async (req, res) => {
  try {
    // Извлекаем query-параметры
    const filters = {
      level: req.query.level || null,
      equipment: req.query.equipment || null,
      main_muscle: req.query.main_muscle || null,
      search: req.query.search || null,
    };

    // Удаляем null значения
    Object.keys(filters).forEach((key) => {
      if (filters[key] === null) {
        delete filters[key];
      }
    });

    const { data, error } = await exerciseService.getExercises(filters);

    if (error) {
      console.error("Error getting exercises:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json(data || []);
  } catch (err) {
    console.error("Unexpected error in listExercises controller:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /exercises/:slug
 * Получение детальной информации об упражнении по slug
 */
exports.getExercise = async (req, res) => {
  try {
    const slug = req.params.slug;

    if (!slug) {
      return res.status(400).json({ error: "Slug is required" });
    }

    const { data, error } = await exerciseService.getExerciseBySlug(slug);

    if (error) {
      console.error("Error getting exercise:", error);
      const statusCode = error.code === "NOT_FOUND" ? 404 : 500;
      return res.status(statusCode).json({ error: error.message });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("Unexpected error in getExercise controller:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

