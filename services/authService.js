const { supabaseAdmin } = require("../utils/supabaseClient");

/**
 * Создание анонимного пользователя
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function createAnonymousUser() {
  try {
    // Создаём пользователя с минимальными данными - только id (автогенерируется)
    // Не передаём никаких полей, чтобы Supabase использовал значения по умолчанию
    const { data, error } = await supabaseAdmin
      .from("users")
      .insert([{}])
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

