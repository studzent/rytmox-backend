const express = require("express");
const router = express.Router();
const chatController = require("../controllers/chatController");
const { authOptional } = require("../middleware/authMiddleware");

// Chat routes
router.post("/send", authOptional, chatController.sendMessage);
router.get("/thread/:threadId", authOptional, chatController.getThread);

module.exports = router;


