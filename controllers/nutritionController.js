const nutritionService = require("../services/nutritionService");
const { supabaseAdmin } = require("../utils/supabaseClient");

/**
 * POST /nutrition/analyze-text
 * Анализ еды из текстового описания
 */
exports.analyzeText = async (req, res) => {
  try {
    const userIdFromToken = req.user?.id;
    const userIdFromBody = req.body.userId;
    const userId = userIdFromToken || userIdFromBody || null;

    const { text } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({
        error: "text is required",
      });
    }

    const { data, error } = await nutritionService.analyzeFoodFromText(text);

    if (error) {
      console.error("Error analyzing food from text:", error);
      const statusCode = error.code === "VALIDATION_ERROR" ? 400 : 500;
      return res.status(statusCode).json({ error: error.message });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("Unexpected error in analyzeText controller:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * POST /nutrition/analyze-image
 * Анализ еды из фото
 */
exports.analyzeImage = async (req, res) => {
  try {
    const userIdFromToken = req.user?.id;
    const userIdFromBody = req.body.userId;
    const userId = userIdFromToken || userIdFromBody || null;

    const { imageBase64 } = req.body;

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({
        error: "imageBase64 is required",
      });
    }

    const { data, error } = await nutritionService.analyzeFoodFromImage(imageBase64);

    if (error) {
      console.error("Error analyzing food from image:", error);
      const statusCode = error.code === "VALIDATION_ERROR" ? 400 : 500;
      return res.status(statusCode).json({ error: error.message });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("Unexpected error in analyzeImage controller:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * POST /nutrition/entries
 * Сохранение записи питания
 */
exports.createEntry = async (req, res) => {
  try {
    const userIdFromToken = req.user?.id;
    const userIdFromBody = req.body.userId;
    const userId = userIdFromToken || userIdFromBody;

    if (!userId) {
      return res.status(400).json({
        error: "userId is required",
      });
    }

    const { date, meal_type, title, calories, carbs, protein, fat } = req.body;

    // Валидация
    if (!date || !meal_type || !title || calories === undefined) {
      return res.status(400).json({
        error: "date, meal_type, title, and calories are required",
      });
    }

    const validMealTypes = ['breakfast', 'lunch', 'dinner', 'snack'];
    if (!validMealTypes.includes(meal_type)) {
      return res.status(400).json({
        error: `meal_type must be one of: ${validMealTypes.join(', ')}`,
      });
    }

    const { data, error } = await supabaseAdmin
      .from("nutrition_entries")
      .insert([
        {
          user_id: userId,
          date,
          meal_type,
          title,
          calories: Math.round(calories),
          carbs: carbs ? parseFloat(carbs) : null,
          protein: protein ? parseFloat(protein) : null,
          fat: fat ? parseFloat(fat) : null,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("Error creating nutrition entry:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json(data);
  } catch (err) {
    console.error("Unexpected error in createEntry controller:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /nutrition/entries/:date
 * Получение записей питания за день
 */
exports.getEntries = async (req, res) => {
  try {
    const userIdFromToken = req.user?.id;
    const userIdFromBody = req.body.userId;
    const userIdFromQuery = req.query.userId;
    const userId = userIdFromToken || userIdFromBody || userIdFromQuery;

    if (!userId) {
      return res.status(400).json({
        error: "userId is required",
      });
    }

    const { date } = req.params;

    if (!date) {
      return res.status(400).json({
        error: "date is required",
      });
    }

    const { data, error } = await supabaseAdmin
      .from("nutrition_entries")
      .select("*")
      .eq("user_id", userId)
      .eq("date", date)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching nutrition entries:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json(data || []);
  } catch (err) {
    console.error("Unexpected error in getEntries controller:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /nutrition/favorites
 * Получение избранных блюд
 */
exports.getFavorites = async (req, res) => {
  try {
    const userIdFromToken = req.user?.id;
    const userIdFromBody = req.body.userId;
    const userIdFromQuery = req.query.userId;
    const userId = userIdFromToken || userIdFromBody || userIdFromQuery;

    if (!userId) {
      return res.status(400).json({
        error: "userId is required",
      });
    }

    const { data, error } = await supabaseAdmin
      .from("favorite_meals")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching favorite meals:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json(data || []);
  } catch (err) {
    console.error("Unexpected error in getFavorites controller:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * POST /nutrition/favorites
 * Добавление в избранное
 */
exports.createFavorite = async (req, res) => {
  try {
    const userIdFromToken = req.user?.id;
    const userIdFromBody = req.body.userId;
    const userId = userIdFromToken || userIdFromBody;

    if (!userId) {
      return res.status(400).json({
        error: "userId is required",
      });
    }

    const { title, calories, carbs, protein, fat } = req.body;

    if (!title || calories === undefined) {
      return res.status(400).json({
        error: "title and calories are required",
      });
    }

    const { data, error } = await supabaseAdmin
      .from("favorite_meals")
      .insert([
        {
          user_id: userId,
          title,
          calories: Math.round(calories),
          carbs: carbs ? parseFloat(carbs) : null,
          protein: protein ? parseFloat(protein) : null,
          fat: fat ? parseFloat(fat) : null,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("Error creating favorite meal:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json(data);
  } catch (err) {
    console.error("Unexpected error in createFavorite controller:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * DELETE /nutrition/favorites/:id
 * Удаление из избранного
 */
exports.deleteFavorite = async (req, res) => {
  try {
    const userIdFromToken = req.user?.id;
    const userIdFromBody = req.body.userId;
    const userIdFromQuery = req.query.userId;
    const userId = userIdFromToken || userIdFromBody || userIdFromQuery;

    if (!userId) {
      return res.status(400).json({
        error: "userId is required",
      });
    }

    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        error: "id is required",
      });
    }

    // Проверяем, что запись принадлежит пользователю
    const { data: favorite, error: fetchError } = await supabaseAdmin
      .from("favorite_meals")
      .select("user_id")
      .eq("id", id)
      .single();

    if (fetchError || !favorite) {
      return res.status(404).json({
        error: "Favorite meal not found",
      });
    }

    if (favorite.user_id !== userId) {
      return res.status(403).json({
        error: "Forbidden",
      });
    }

    const { error } = await supabaseAdmin
      .from("favorite_meals")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      console.error("Error deleting favorite meal:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Unexpected error in deleteFavorite controller:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

