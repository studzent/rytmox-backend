const equipmentService = require("../services/equipmentService");

/**
 * GET /equipment
 * Получение списка оборудования с фильтрами
 */
exports.listEquipment = async (req, res) => {
  try {
    console.log('[listEquipment] Request received:', {
      environment: req.query.environment,
      query: req.query,
    });

    // Извлекаем query-параметры
    const filters = {
      environment: req.query.environment || null,
    };

    // Удаляем null значения
    Object.keys(filters).forEach((key) => {
      if (filters[key] === null) {
        delete filters[key];
      }
    });

    console.log('[listEquipment] Calling getEquipmentItems with filters:', filters);
    const { data, error } = await equipmentService.getEquipmentItems(filters);

    if (error) {
      console.error("[listEquipment] Error getting equipment items:", error);
      const statusCode = error.code === "VALIDATION_ERROR" ? 400 : 500;
      return res.status(statusCode).json({ error: error.message });
    }

    console.log('[listEquipment] Success, returning', data?.length || 0, 'groups');
    return res.status(200).json(data || []);
  } catch (err) {
    console.error("[listEquipment] Unexpected error:", err);
    console.error("[listEquipment] Error stack:", err.stack);
    return res.status(500).json({ 
      error: "Internal server error",
      message: err.message,
    });
  }
};

