const { verifyToken } = require("../utils/jwt");

/**
 * Middleware для обязательной авторизации
 * Требует наличия валидного JWT токена в заголовке Authorization
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next function
 */
function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Проверяем формат "Bearer <token>"
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = parts[1];

  try {
    const payload = verifyToken(token);
    
    // Защита от неожиданных значений
    if (!payload || typeof payload !== 'object') {
      console.error("[authRequired] verifyToken returned invalid payload:", payload);
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    if (!payload.userId) {
      console.error("[authRequired] payload missing userId:", payload);
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    req.user = {
      id: payload.userId,
      authType: payload.authType,
    };
    next();
  } catch (err) {
    console.error("[authRequired] Token verification error:", err.message);
    return res.status(401).json({ error: "Unauthorized" });
  }
}

/**
 * Middleware для опциональной авторизации
 * Если токен присутствует, проверяет его и устанавливает req.user
 * Если токена нет, просто пропускает запрос дальше
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next function
 */
function authOptional(req, res, next) {
  const authHeader = req.headers.authorization;

  // Если заголовка нет, просто продолжаем без ошибки
  if (!authHeader) {
    return next();
  }

  // Если заголовок есть, пытаемся проверить токен
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    // Неправильный формат - возвращаем 401 (более безопасный вариант)
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = parts[1];

  try {
    const payload = verifyToken(token);
    
    // Защита от неожиданных значений
    if (!payload || typeof payload !== 'object') {
      console.error("[authOptional] verifyToken returned invalid payload:", payload);
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    if (!payload.userId) {
      console.error("[authOptional] payload missing userId:", payload);
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    req.user = {
      id: payload.userId,
      authType: payload.authType,
    };
    next();
  } catch (err) {
    // Токен невалиден - возвращаем 401 (более безопасный вариант)
    console.error("[authOptional] Token verification error:", err.message);
    return res.status(401).json({ error: "Unauthorized" });
  }
}

module.exports = {
  authRequired,
  authOptional,
};

