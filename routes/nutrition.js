const router = require("express").Router();
const nutritionController = require("../controllers/nutritionController");
const { authOptional } = require("../middleware/authMiddleware");

// Test route to verify nutrition routes are loaded
router.get("/test", (req, res) => {
  res.json({ status: "Nutrition routes are working" });
});

// Анализ еды
router.post("/analyze-text", authOptional, nutritionController.analyzeText);
router.post("/analyze-image", authOptional, nutritionController.analyzeImage);

// Загрузка изображения
router.post("/upload-image", authOptional, nutritionController.uploadNutritionImage);

// Записи питания
router.post("/entries", authOptional, nutritionController.createEntry);
router.get("/entries/:date", authOptional, nutritionController.getEntries);
router.put("/entries/:id", authOptional, nutritionController.updateEntry);
router.delete("/entries/:id", authOptional, nutritionController.deleteEntry);

// Избранное
router.get("/favorites", authOptional, nutritionController.getFavorites);
router.post("/favorites", authOptional, nutritionController.createFavorite);
router.delete("/favorites/:id", authOptional, nutritionController.deleteFavorite);

module.exports = router;

