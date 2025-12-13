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

    // НЕ фильтруем на уровне SQL - сделаем фильтрацию после загрузки
    // Это нужно, чтобы правильно обработать environment='gym_home_workout', 'all' и т.д.

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

    // Фильтруем по environment после загрузки (чтобы учесть gym_home_workout, all и т.д.)
    let filteredItems = equipmentItems || [];
    if (filters.environment) {
      filteredItems = filteredItems.filter((item) => {
        const env = item.environment || '';
        // Точное совпадение
        if (env === filters.environment) return true;
        // Универсальное оборудование
        if (env === 'gym_home_workout' || env === 'all') return true;
        // Для workout показываем также outdoor
        if (filters.environment === 'workout' && env === 'outdoor') return true;
        // Для home показываем также gym_home
        if (filters.environment === 'home' && (env === 'gym_home' || env === 'home_gym')) return true;
        // Для gym показываем также gym_home
        if (filters.environment === 'gym' && (env === 'gym_home' || env === 'home_gym')) return true;
        return false;
      });
    }

    // Формируем ответ с нужными полями, ВКЛЮЧАЯ equipment_group
    const equipmentList = filteredItems.map((item) => ({
      slug: item.slug,
      name_en: item.name_en,
      name_ru: item.name_ru,
      environment: item.environment,
      image_url: item.image_url || null,
      description_en: item.description_en || null,
      description_ru: item.description_ru || null,
      equipment_group: item.equipment_group || null, // ВАЖНО: добавляем equipment_group для группировки на фронтенде
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

