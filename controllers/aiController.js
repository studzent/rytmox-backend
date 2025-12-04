const aiService = require("../services/aiService");

exports.generateWorkout = async (req, res) => {
  try {
    // Извлечение userId: приоритет у токена, затем body, затем null
    const userIdFromToken = req.user?.id;
    const userIdFromBody = req.body.userId;
    const userId = userIdFromToken || userIdFromBody || null;

    // Извлечение параметров из req.body
    const {
      level,
      equipment,
      targetMuscles,
      goal,
      durationMinutes,
      exercisesCount,
      workoutType,
      profileData,
      ignoreHistory,
    } = req.body;

    // Вызов сервиса
    const { data, error } = await aiService.generateWorkout({
      userId: userId,
      level,
      equipment,
      targetMuscles,
      goal,
      durationMinutes,
      exercisesCount,
      workoutType,
      profileData: profileData || null,
      ignoreHistory: ignoreHistory || false,
    });

    // Обработка ошибок
    if (error) {
      console.error("Error generating workout:", error);
      const statusCode = error.code === "VALIDATION_ERROR" ? 400 : 500;
      return res.status(statusCode).json({ error: error.message });
    }

    // Успешный ответ
    return res.status(200).json(data);
  } catch (err) {
    console.error("Unexpected error in generateWorkout controller:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
  
  exports.generateNutrition = async (req, res) => {
    res.json({ message: "AI nutrition route — placeholder" });
  };
  
  exports.formCheck = async (req, res) => {
    res.json({ message: "AI form check — placeholder" });
  };