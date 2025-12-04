const { supabaseAdmin } = require("../utils/supabaseClient");

/**
 * Получение списка оборудования с фильтрами
 * @param {object} filters - Объект с фильтрами
 * @param {string} [filters.environment] - Окружение: 'home' | 'gym' | 'outdoor'
 * @returns {Promise<{data: array|null, error: object|null}>}
 */
async function getEquipmentItems(filters = {}) {
  try {
    let query = supabaseAdmin.from("equipment_items").select("*");

    // Применяем фильтр по environment, если указан
    if (filters.environment) {
      query = query.eq("environment", filters.environment);
    }

    // Сортировка: environment ASC, name_en ASC
    query = query.order("environment", { ascending: true });
    query = query.order("name_en", { ascending: true });

    const { data: equipmentItems, error: equipmentError } = await query;

    if (equipmentError) {
      return {
        data: null,
        error: {
          message: `Failed to load equipment items: ${equipmentError.message}`,
          code: "DATABASE_ERROR",
        },
      };
    }

    // Формируем ответ с нужными полями
    const equipmentList = (equipmentItems || []).map((item) => ({
      slug: item.slug,
      name_en: item.name_en,
      name_ru: item.name_ru,
      environment: item.environment,
      image_url: item.image_url || null,
      description_en: item.description_en || null,
      description_ru: item.description_ru || null,
    }));

    return {
      data: equipmentList,
      error: null,
    };
  } catch (err) {
    console.error("Error in getEquipmentItems:", err);
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
  getEquipmentItems,
};

