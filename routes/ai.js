const express = require("express");
const router = express.Router();
const aiController = require("../controllers/aiController");
const { authOptional } = require("../middleware/authMiddleware");

// AI routes
router.post("/workout", authOptional, aiController.generateWorkout);
router.post("/nutrition", aiController.generateNutrition);
router.post("/form-check", aiController.formCheck);

module.exports = router;