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
          auth_type: "anonymous",
          email: null,
          password_hash: null,
          is_active: true,
          profile_data: {},
        },
      ])
      .select("id, auth_type")
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
        authType: data.auth_type,
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

