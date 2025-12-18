const express = require("express");
const router = express.Router();
const chatController = require("../controllers/chatController");
const { authOptional } = require("../middleware/authMiddleware");

// Chat routes
router.post("/send", authOptional, chatController.sendMessage);
router.get("/thread/:threadId", authOptional, chatController.getThread);
router.post("/handoff/accept", authOptional, chatController.acceptHandoff);
router.post("/handoff/cancel", authOptional, chatController.cancelHandoff);
// Для транскрибации нужен увеличенный лимит размера body (до 50MB для base64 аудио)
router.post("/transcribe", express.json({ limit: '50mb' }), authOptional, chatController.transcribeAudio);

module.exports = router;


