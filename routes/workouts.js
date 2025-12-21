const router = require("express").Router();
const workoutController = require("../controllers/workoutController");
const { authOptional } = require("../middleware/authMiddleware");

// Важно: более специфичные роуты должны быть ДО "/:id"
router.get("/today", authOptional, workoutController.getTodayWorkout);
router.get("/history/:userId", authOptional, workoutController.getWorkoutHistory);
router.get("/:id", workoutController.getWorkout);
router.get("/user/:userId", authOptional, workoutController.getUserWorkouts);

module.exports = router;

