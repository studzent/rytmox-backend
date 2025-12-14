const userProfileService = require("../services/userProfileService");

/**
 * GET /profile/:userId
 * Получение профиля пользователя
 */
exports.getProfile = async (req, res) => {
  try {
    // Извлечение userId: приоритет у токена, затем params
    const userIdFromToken = req.user?.id;
    const userIdFromParams = req.params.userId;
    const userId = userIdFromToken || userIdFromParams;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const { data, error } = await userProfileService.getUserProfile(userId);

    if (error) {
      console.error("Error getting user profile:", error);
      const statusCode = error.code === "VALIDATION_ERROR" ? 400 : 500;
      return res.status(statusCode).json({ error: error.message });
    }

    // Если профиль не найден, возвращаем 404
    if (!data) {
      return res.status(404).json({ error: "Profile not found" });
    }

    // Формируем ответ в нужном формате
    const response = {
      userId: data.id || data.user_id,
      level: data.level || null,
      goal: data.goal || null,
      preferred_equipment: data.preferred_equipment || [],
      preferred_muscles: data.preferred_muscles || [],
      language: data.language || null,
      restrictions: data.restrictions || {},
      training_environment: data.training_environment || null,
      equipment_items: data.equipment_items || [],
    };

    return res.status(200).json(response);
  } catch (err) {
    console.error("Unexpected error in getProfile controller:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * PUT /profile/:userId
 * Обновление профиля пользователя (частичное обновление разрешено)
 */
exports.updateProfile = async (req, res) => {
  try {
    // Извлечение userId: приоритет у токена, затем params
    const userIdFromToken = req.user?.id;
    const userIdFromParams = req.params.userId;
    const userId = userIdFromToken || userIdFromParams;
    const payload = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    // Валидация полей (опционально, можно расширить)
    if (payload.level && !["beginner", "intermediate", "advanced"].includes(payload.level)) {
      return res.status(400).json({
        error: "level must be one of: beginner, intermediate, advanced",
      });
    }

    if (
      payload.goal &&
      !["fat_loss", "muscle_gain", "health", "performance"].includes(payload.goal)
    ) {
      return res.status(400).json({
        error: "goal must be one of: fat_loss, muscle_gain, health, performance",
      });
    }

    if (
      payload.training_environment &&
      !["home", "gym", "outdoor", "workout"].includes(payload.training_environment)
    ) {
      return res.status(400).json({
        error: "training_environment must be one of: home, gym, outdoor, workout",
      });
    }

    if (payload.equipment_items !== undefined && !Array.isArray(payload.equipment_items)) {
      return res.status(400).json({
        error: "equipment_items must be an array of strings",
      });
    }

    const { data, error } = await userProfileService.upsertUserProfile(userId, payload);

    if (error) {
      console.error("Error updating user profile:", error);
      const statusCode = error.code === "VALIDATION_ERROR" ? 400 : 500;
      return res.status(statusCode).json({ error: error.message });
    }

    // ВАЖНО: upsertUserProfile возвращает запись из users (без нормализованных полей).
    // Поэтому сразу подтягиваем "истину" через getUserProfile (users_measurements/users_equipment/users_training_environment_profiles).
    const { data: hydrated, error: hydrateErr } = await userProfileService.getUserProfile(userId);
    if (hydrateErr) {
      console.error("Error hydrating user profile after update:", hydrateErr);
      // Фолбэк: отдаём хотя бы то, что сохранили в users, чтобы не ломать клиент.
      const fallback = {
        userId: data?.id || data?.user_id || userId,
        level: data?.level || null,
        goal: data?.goal || null,
        preferred_equipment: data?.preferred_equipment || [],
        preferred_muscles: data?.preferred_muscles || [],
        language: data?.language || null,
        restrictions: data?.restrictions || {},
        training_environment: null,
        equipment_items: [],
      };
      return res.status(200).json(fallback);
    }

    const response = {
      userId: hydrated.id || hydrated.user_id,
      level: hydrated.level || null,
      goal: hydrated.goal || null,
      preferred_equipment: hydrated.preferred_equipment || [],
      preferred_muscles: hydrated.preferred_muscles || [],
      language: hydrated.language || null,
      restrictions: hydrated.restrictions || {},
      training_environment: hydrated.training_environment || null,
      equipment_items: hydrated.equipment_items || [],
    };

    return res.status(200).json(response);
  } catch (err) {
    console.error("Unexpected error in updateProfile controller:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

