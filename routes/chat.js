const express = require("express");
const router = express.Router();
const chatController = require("../controllers/chatController");
const { authOptional } = require("../middleware/authMiddleware");

// Chat routes
router.post("/send", authOptional, chatController.sendMessage);
router.get("/thread/:threadId", authOptional, chatController.getThread);
router.post("/handoff/accept", authOptional, chatController.acceptHandoff);
router.post("/handoff/cancel", authOptional, chatController.cancelHandoff);
router.post("/transcribe", authOptional, chatController.transcribeAudio);

module.exports = router;


