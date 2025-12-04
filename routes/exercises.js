const router = require("express").Router();
const exerciseController = require("../controllers/exerciseController");

router.get("/", exerciseController.listExercises);
router.get("/:slug", exerciseController.getExercise);

module.exports = router;

