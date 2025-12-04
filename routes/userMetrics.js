const express = require("express");
const router = express.Router();
const userMetricsController = require("../controllers/userMetricsController");
const { authOptional } = require("../middleware/authMiddleware");

// Body metrics routes
router.post("/body", authOptional, userMetricsController.addBodyMetric);
router.get("/body/user/:userId", authOptional, userMetricsController.getBodyMetricHistory);

module.exports = router;

