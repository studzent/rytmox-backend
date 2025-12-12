const { supabaseAdmin } = require("../utils/supabaseClient");

/**
 * Создание анонимного пользователя
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function createAnonymousUser() {
  try {
    // Создаём пользователя - используем только id (автогенерируется)
    // Если в БД есть обязательные поля email/password_hash, нужно их передать
    // Но сначала пробуем без них
    let data, error;
    
    // Пробуем создать без обязательных полей
    const result = await supabaseAdmin
      .from("users")
      .insert([{}])
      .select("id")
      .single();
    
    data = result.data;
    error = result.error;
    
    // Если ошибка из-за обязательных полей, пробуем с пустыми строками
    if (error && (error.message.includes('email') || error.message.includes('password_hash') || error.message.includes('NOT NULL'))) {
      console.log('[createAnonymousUser] Retrying with email and password_hash...');
      const retryResult = await supabaseAdmin
        .from("users")
        .insert([
          {
            email: `anonymous_${Date.now()}@rytmox.local`,
            password_hash: 'anonymous',
          },
        ])
        .select("id")
        .single();
      
      data = retryResult.data;
      error = retryResult.error;
    }

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

