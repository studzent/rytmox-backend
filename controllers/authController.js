const authService = require("../services/authService");
const { signUserToken } = require("../utils/jwt");

/**
 * POST /auth/anonymous
 * Создание анонимного пользователя и выдача JWT токена
 */
exports.createAnonymous = async (req, res) => {
  try {
    // Создаём анонимного пользователя
    const { data, error } = await authService.createAnonymousUser();

    if (error) {
      console.error("Error creating anonymous user:", error);
      const statusCode = error.code === "DATABASE_ERROR" ? 500 : 500;
      return res.status(statusCode).json({ error: error.message });
    }

    // Подписываем JWT токен
    let token;
    try {
      token = signUserToken({
        userId: data.userId,
        authType: data.authType,
      });
    } catch (tokenError) {
      console.error("Error signing token:", tokenError);
      return res.status(500).json({ error: "Failed to generate authentication token" });
    }

    // Возвращаем userId, token и authType
    return res.status(201).json({
      userId: data.userId,
      token: token,
      authType: data.authType,
    });
  } catch (err) {
    console.error("Unexpected error in createAnonymous controller:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

