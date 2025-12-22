const jwt = require("jsonwebtoken");

/**
 * Подписание JWT токена для пользователя
 * @param {object} user - Объект пользователя
 * @param {string} user.userId - ID пользователя (UUID)
 * @param {string} user.authType - Тип авторизации ('anonymous', 'email', 'apple', 'google')
 * @returns {string} - JWT токен
 */
function signUserToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set in environment variables");
  }

  const payload = {
    userId: user.userId,
    authType: user.authType,
  };

  // Токен действителен 30 дней
  const expiresIn = "30d";

  return jwt.sign(payload, secret, { expiresIn });
}

/**
 * Проверка и декодирование JWT токена
 * @param {string} token - JWT токен
 * @returns {object} - Декодированный payload с userId и authType
 * @throws {Error} - Если токен невалиден или истёк
 */
function verifyToken(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set in environment variables");
  }

  try {
    const decoded = jwt.verify(token, secret);
    
    // Защита от неожиданной структуры токена
    if (!decoded || typeof decoded !== 'object') {
      throw new Error("Invalid token structure");
    }
    
    if (!decoded.userId) {
      throw new Error("Token missing userId");
    }
    
    return {
      userId: decoded.userId,
      authType: decoded.authType || null,
    };
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      throw new Error("Token has expired");
    } else if (err.name === "JsonWebTokenError") {
      throw new Error("Invalid token");
    } else {
      throw new Error(`Token verification failed: ${err.message}`);
    }
  }
}

module.exports = {
  signUserToken,
  verifyToken,
};

