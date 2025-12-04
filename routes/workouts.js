const router = require("express").Router();
const workoutController = require("../controllers/workoutController");
const { authOptional } = require("../middleware/authMiddleware");

router.get("/:id", workoutController.getWorkout);
router.get("/user/:userId", authOptional, workoutController.getUserWorkouts);

module.exports = router;

