const workoutService = require("../services/workoutService");

/**
 * GET /workouts/:id
 * Получение детальной информации о тренировке
 */
exports.getWorkout = async (req, res) => {
  try {
    const workoutId = req.params.id;

    if (!workoutId) {
      return res.status(400).json({ error: "Workout ID is required" });
    }

    const { data, error } = await workoutService.getWorkoutById(workoutId);

    if (error) {
      console.error("Error getting workout:", error);
      const statusCode = error.code === "NOT_FOUND" ? 404 : 500;
      return res.status(statusCode).json({ error: error.message });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("Unexpected error in getWorkout controller:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /workouts/user/:userId
 * Получение списка тренировок пользователя
 */
exports.getUserWorkouts = async (req, res) => {
  try {
    // Извлечение userId: приоритет у токена, затем params
    const userIdFromToken = req.user?.id;
    const userIdFromParams = req.params.userId;
    const userId = userIdFromToken || userIdFromParams;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const { data, error } = await workoutService.getWorkoutsByUser(userId);

    if (error) {
      console.error("Error getting user workouts:", error);
      return res.status(500).json({ error: error.message });
    }

    // Возвращаем пустой массив, если тренировок нет
    return res.status(200).json(data || []);
  } catch (err) {
    console.error("Unexpected error in getUserWorkouts controller:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /workouts/today
 * Получение тренировки на сегодня (если существует)
 */
exports.getTodayWorkout = async (req, res) => {
  try {
    // userId: приоритет у токена, затем query param
    const userIdFromToken = req.user?.id;
    const userIdFromQuery = req.query.userId;
    const userId = userIdFromToken || userIdFromQuery;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const { data, error } = await workoutService.getTodayWorkout(userId);

    if (error) {
      console.error("Error getting today's workout:", error);
      const statusCode = error.code === "VALIDATION_ERROR" ? 400 : 500;
      return res.status(statusCode).json({ error: error.message });
    }

    // Если на сегодня нет тренировки — возвращаем null
    return res.status(200).json(data || null);
  } catch (err) {
    console.error("Unexpected error in getTodayWorkout controller:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

