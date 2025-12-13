const trainingEnvironmentService = require("../services/trainingEnvironmentService");

/**
 * GET /locations
 * Получить список всех профилей пользователя
 */
exports.listLocations = async (req, res) => {
  try {
    const userIdFromToken = req.user?.id;
    const userIdFromParams = req.query.userId || req.body.userId;
    const userId = userIdFromToken || userIdFromParams;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const { data, error } = await trainingEnvironmentService.listUserProfiles(userId);

    if (error) {
      console.error("Error listing locations:", error);
      const statusCode = error.code === "VALIDATION_ERROR" ? 400 : 500;
      return res.status(statusCode).json({ error: error.message });
    }

    return res.status(200).json(data || []);
  } catch (err) {
    console.error("Unexpected error in listLocations:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * POST /locations
 * Создать новый профиль
 */
exports.createLocation = async (req, res) => {
  try {
    const userIdFromToken = req.user?.id;
    const userIdFromParams = req.body.userId;
    const userId = userIdFromToken || userIdFromParams;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const { name, slug, equipment_slugs } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }

    if (!slug || !["home", "gym", "workout", "outdoor"].includes(slug)) {
      return res.status(400).json({
        error: "slug must be one of: home, gym, workout, outdoor",
      });
    }

    if (!Array.isArray(equipment_slugs)) {
      return res.status(400).json({ error: "equipment_slugs must be an array" });
    }

    const { data, error } = await trainingEnvironmentService.createProfile(
      userId,
      name,
      slug,
      equipment_slugs
    );

    if (error) {
      console.error("Error creating location:", error);
      const statusCode =
        error.code === "VALIDATION_ERROR" || error.code === "NOT_FOUND" ? 400 : 500;
      return res.status(statusCode).json({ error: error.message });
    }

    return res.status(201).json(data);
  } catch (err) {
    console.error("Unexpected error in createLocation:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * PUT /locations/:id
 * Обновить профиль (название и/или тренажеры)
 */
exports.updateLocation = async (req, res) => {
  try {
    const userIdFromToken = req.user?.id;
    const userIdFromParams = req.body.userId;
    const userId = userIdFromToken || userIdFromParams;
    const profileId = req.params.id;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    if (!profileId) {
      return res.status(400).json({ error: "profileId is required" });
    }

    const { name, equipment_slugs } = req.body;

    const updates = {};
    if (name !== undefined) {
      if (!name || !name.trim()) {
        return res.status(400).json({ error: "name cannot be empty" });
      }
      updates.name = name.trim();
    }
    if (equipment_slugs !== undefined) {
      if (!Array.isArray(equipment_slugs)) {
        return res.status(400).json({ error: "equipment_slugs must be an array" });
      }
      updates.equipment_slugs = equipment_slugs;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No updates provided" });
    }

    const { data, error } = await trainingEnvironmentService.updateProfile(
      userId,
      profileId,
      updates
    );

    if (error) {
      console.error("Error updating location:", error);
      const statusCode =
        error.code === "VALIDATION_ERROR" || error.code === "NOT_FOUND" ? 400 : 500;
      return res.status(statusCode).json({ error: error.message });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("Unexpected error in updateLocation:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * PUT /locations/:id/activate
 * Активировать профиль (деактивирует остальные)
 */
exports.activateLocation = async (req, res) => {
  try {
    const userIdFromToken = req.user?.id;
    const userIdFromParams = req.body.userId;
    const userId = userIdFromToken || userIdFromParams;
    const profileId = req.params.id;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    if (!profileId) {
      return res.status(400).json({ error: "profileId is required" });
    }

    const { data, error } = await trainingEnvironmentService.activateProfile(userId, profileId);

    if (error) {
      console.error("Error activating location:", error);
      const statusCode =
        error.code === "VALIDATION_ERROR" || error.code === "NOT_FOUND" ? 400 : 500;
      return res.status(statusCode).json({ error: error.message });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("Unexpected error in activateLocation:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * DELETE /locations/:id
 * Удалить профиль
 */
exports.deleteLocation = async (req, res) => {
  try {
    const userIdFromToken = req.user?.id;
    const userIdFromParams = req.query.userId || req.body.userId;
    const userId = userIdFromToken || userIdFromParams;
    const profileId = req.params.id;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    if (!profileId) {
      return res.status(400).json({ error: "profileId is required" });
    }

    const { data, error } = await trainingEnvironmentService.deleteProfile(userId, profileId);

    if (error) {
      console.error("Error deleting location:", error);
      const statusCode =
        error.code === "VALIDATION_ERROR" || error.code === "NOT_FOUND" ? 400 : 500;
      return res.status(statusCode).json({ error: error.message });
    }

    return res.status(200).json(data || { success: true });
  } catch (err) {
    console.error("Unexpected error in deleteLocation:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

