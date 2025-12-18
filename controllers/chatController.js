const chatService = require("../services/chatService");

/**
 * Отправить сообщение в чат
 * POST /chat/send
 */
exports.sendMessage = async (req, res) => {
  try {
    // Извлечение userId: приоритет у токена, затем body, затем null
    const userIdFromToken = req.user?.id;
    const userIdFromBody = req.body.userId;
    const userId = userIdFromToken || userIdFromBody || null;

    if (!userId) {
      return res.status(400).json({
        error: "userId is required",
      });
    }

    const { mode, text, threadId } = req.body;

    // Валидация
    if (!mode) {
      return res.status(400).json({
        error: "mode is required",
      });
    }

    const validModes = ["team", "trainer", "doctor", "psychologist", "nutritionist"];
    if (!validModes.includes(mode)) {
      return res.status(400).json({
        error: `mode must be one of: ${validModes.join(", ")}`,
      });
    }

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return res.status(400).json({
        error: "text is required and must be a non-empty string",
      });
    }

    // Вызов сервиса
    const { data, error } = await chatService.sendChatMessage(userId, mode, text.trim(), threadId || null);

    // Обработка ошибок
    if (error) {
      console.error("Error sending chat message:", error);
      const statusCode =
        error.code === "VALIDATION_ERROR" || error.code === "UNAUTHORIZED" || error.code === "THREAD_NOT_FOUND"
          ? 400
          : error.code === "OPENAI_API_ERROR"
            ? 502
            : 500;
      return res.status(statusCode).json({ error: error.message });
    }

    // Успешный ответ
    return res.status(200).json(data);
  } catch (err) {
    console.error("Unexpected error in sendMessage controller:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Получить thread с историей сообщений
 * GET /chat/thread/:threadId
 */
exports.getThread = async (req, res) => {
  try {
    const { threadId } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    if (!threadId) {
      return res.status(400).json({
        error: "threadId is required",
      });
    }

    // Вызов сервиса
    const { data, error } = await chatService.getThread(threadId, limit);

    // Обработка ошибок
    if (error) {
      console.error("Error getting thread:", error);
      const statusCode = error.code === "THREAD_NOT_FOUND" ? 404 : 500;
      return res.status(statusCode).json({ error: error.message });
    }

    // Успешный ответ
    return res.status(200).json(data);
  } catch (err) {
    console.error("Unexpected error in getThread controller:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Принять handoff на тренера
 * POST /chat/handoff/accept
 */
exports.acceptHandoff = async (req, res) => {
  try {
    const userIdFromToken = req.user?.id;
    const userIdFromBody = req.body.userId;
    const userId = userIdFromToken || userIdFromBody || null;

    if (!userId) {
      return res.status(400).json({
        error: "userId is required",
      });
    }

    const { threadId, handoffId } = req.body;

    if (!threadId) {
      return res.status(400).json({
        error: "threadId is required",
      });
    }

    // Получить последнее сообщение пользователя из thread
    const { data: threadData, error: threadError } = await chatService.getThread(threadId, 10);
    if (threadError) {
      return res.status(400).json({ error: threadError.message });
    }

    const lastUserMessage = threadData?.messages
      ?.filter((msg) => msg.role === "user")
      ?.slice(-1)[0]?.content || "Вопрос от пользователя";

    // Получить метаданные thread для определения fromRole
    const { supabaseAdmin } = require("../utils/supabaseClient");
    const { data: threadMeta, error: metaError } = await supabaseAdmin
      .from("chat_threads")
      .select("metadata, mode")
      .eq("id", threadId)
      .single();

    if (metaError || !threadMeta) {
      return res.status(400).json({ error: "Thread not found" });
    }

    const fromRole = threadMeta.metadata?.pending_handoff?.from || threadMeta.mode;
    const actualHandoffId = handoffId || threadMeta.metadata?.pending_handoff?.id;

    if (!actualHandoffId) {
      return res.status(400).json({ error: "handoffId is required" });
    }

    // Вызов сервиса
    const { data, error } = await chatService.acceptHandoffToTrainer(
      userId,
      threadId,
      fromRole,
      lastUserMessage,
      actualHandoffId
    );

    if (error) {
      console.error("Error accepting handoff:", error);
      const statusCode = error.code === "UNAUTHORIZED" || error.code === "THREAD_NOT_FOUND" ? 400 : 500;
      return res.status(statusCode).json({ error: error.message });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("Unexpected error in acceptHandoff controller:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Отменить handoff
 * POST /chat/handoff/cancel
 */
exports.cancelHandoff = async (req, res) => {
  try {
    const userIdFromToken = req.user?.id;
    const userIdFromBody = req.body.userId;
    const userId = userIdFromToken || userIdFromBody || null;

    if (!userId) {
      return res.status(400).json({
        error: "userId is required",
      });
    }

    const { threadId } = req.body;

    if (!threadId) {
      return res.status(400).json({
        error: "threadId is required",
      });
    }

    // Вызов сервиса
    const { data, error } = await chatService.cancelHandoff(userId, threadId);

    if (error) {
      console.error("Error canceling handoff:", error);
      const statusCode = error.code === "UNAUTHORIZED" || error.code === "THREAD_NOT_FOUND" ? 400 : 500;
      return res.status(statusCode).json({ error: error.message });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("Unexpected error in cancelHandoff controller:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};




