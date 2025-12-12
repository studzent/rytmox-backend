const { supabaseAdmin } = require("../utils/supabaseClient");

/**
 * Создание анонимного пользователя
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function createAnonymousUser() {
  try {
    const { data, error } = await supabaseAdmin
      .from("users")
      .insert([
        {
          // Убираем auth_type, email, password_hash, is_active - их может не быть в схеме
          // Используем только обязательные поля или те, что точно есть
          profile_data: {},
        },
      ])
      .select("id")
      .single();

    if (error) {
      return {
        data: null,
        error: {
          message: `Failed to create anonymous user: ${error.message}`,
          code: "DATABASE_ERROR",
        },
      };
    }

    return {
      data: {
        userId: data.id,
        authType: "anonymous", // Возвращаем как константу, не из БД
      },
      error: null,
    };
  } catch (err) {
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
  createAnonymousUser,
};

