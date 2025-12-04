const equipmentService = require("../services/equipmentService");

/**
 * GET /equipment
 * Получение списка оборудования с фильтрами
 */
exports.listEquipment = async (req, res) => {
  try {
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

    const { data, error } = await equipmentService.getEquipmentItems(filters);

    if (error) {
      console.error("Error getting equipment items:", error);
      const statusCode = error.code === "VALIDATION_ERROR" ? 400 : 500;
      return res.status(statusCode).json({ error: error.message });
    }

    return res.status(200).json(data || []);
  } catch (err) {
    console.error("Unexpected error in listEquipment controller:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

