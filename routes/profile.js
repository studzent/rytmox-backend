const express = require("express");
const router = express.Router();
const userProfileController = require("../controllers/userProfileController");
const { authOptional } = require("../middleware/authMiddleware");

// Profile routes
router.get("/:userId", authOptional, userProfileController.getProfile);
router.put("/:userId", authOptional, userProfileController.updateProfile);

module.exports = router;

