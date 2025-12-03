const express = require("express");
const router = express.Router();
const aiController = require("../controllers/aiController");

// AI routes
router.post("/workout", aiController.generateWorkout);
router.post("/nutrition", aiController.generateNutrition);
router.post("/form-check", aiController.formCheck);

module.exports = router;