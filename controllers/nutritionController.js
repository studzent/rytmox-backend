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

    console.log("[createEntry] Request received:", {
      userIdFromToken: !!userIdFromToken,
      userIdFromBody: !!userIdFromBody,
      userId: userId,
      bodyKeys: Object.keys(req.body),
    });

    if (!userId) {
      console.error("[createEntry] userId is missing");
      return res.status(400).json({
        error: "userId is required",
      });
    }

    const { date, meal_type, title, calories, carbs, protein, fat, weight_grams, ingredients } = req.body;

    // Валидация
    if (!date || !meal_type || !title || calories === undefined) {
      console.error("[createEntry] Missing required fields:", { date: !!date, meal_type: !!meal_type, title: !!title, calories: calories !== undefined });
      return res.status(400).json({
        error: "date, meal_type, title, and calories are required",
      });
    }

    const validMealTypes = ['breakfast', 'lunch', 'dinner', 'snack'];
    if (!validMealTypes.includes(meal_type)) {
      console.error("[createEntry] Invalid meal_type:", meal_type);
      return res.status(400).json({
        error: `meal_type must be one of: ${validMealTypes.join(', ')}`,
      });
    }

    console.log("[createEntry] Inserting entry:", { userId, date, meal_type, title, calories, weight_grams, ingredients });
    
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
          weight_grams: weight_grams ? parseInt(weight_grams) : null,
          ingredients: ingredients ? String(ingredients).trim() : null,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("[createEntry] Supabase error:", error);
      console.error("[createEntry] Error details:", JSON.stringify(error, null, 2));
      return res.status(500).json({ error: error.message || "Database error" });
    }

    console.log("[createEntry] Success, created entry:", data?.id);
    return res.status(201).json(data);
  } catch (err) {
    console.error("[createEntry] Unexpected error:", err);
    console.error("[createEntry] Error stack:", err.stack);
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

    console.log("[getEntries] Request received:", {
      userIdFromToken: !!userIdFromToken,
      userIdFromBody: !!userIdFromBody,
      userIdFromQuery: !!userIdFromQuery,
      userId: userId,
      date: req.params.date,
    });

    if (!userId) {
      console.error("[getEntries] userId is missing");
      return res.status(400).json({
        error: "userId is required",
      });
    }

    const { date } = req.params;

    if (!date) {
      console.error("[getEntries] date is missing");
      return res.status(400).json({
        error: "date is required",
      });
    }

    console.log("[getEntries] Querying nutrition_entries for userId:", userId, "date:", date);
    
    try {
      const { data, error } = await supabaseAdmin
        .from("nutrition_entries")
        .select("*")
        .eq("user_id", userId)
        .eq("date", date)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("[getEntries] Supabase error:", error);
        console.error("[getEntries] Error code:", error.code);
        console.error("[getEntries] Error message:", error.message);
        console.error("[getEntries] Error details:", JSON.stringify(error, null, 2));
        
        // Проверка на отсутствие таблицы
        if (error.message && error.message.includes("relation") && error.message.includes("does not exist")) {
          return res.status(500).json({ 
            error: "Table 'nutrition_entries' not found. Please apply migrations and wait 30 seconds for schema cache to update.",
            code: "TABLE_NOT_FOUND"
          });
        }
        
        return res.status(500).json({ error: error.message || "Database error" });
      }

      console.log("[getEntries] Success, found", data?.length || 0, "entries");
      return res.status(200).json(data || []);
    } catch (queryError) {
      console.error("[getEntries] Query execution error:", queryError);
      console.error("[getEntries] Query error stack:", queryError.stack);
      throw queryError; // Пробросим дальше для обработки в catch блоке
    }

  } catch (err) {
    console.error("[getEntries] Unexpected error:", err);
    console.error("[getEntries] Error name:", err.name);
    console.error("[getEntries] Error message:", err.message);
    console.error("[getEntries] Error stack:", err.stack);
    
    // Более детальное сообщение об ошибке
    const errorMessage = err.message || "Internal server error";
    return res.status(500).json({ 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
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

    console.log("[getFavorites] Request received:", {
      userIdFromToken: !!userIdFromToken,
      userIdFromBody: !!userIdFromBody,
      userIdFromQuery: !!userIdFromQuery,
      userId: userId,
    });

    if (!userId) {
      console.error("[getFavorites] userId is missing");
      return res.status(400).json({
        error: "userId is required",
      });
    }

    console.log("[getFavorites] Querying favorite_meals for userId:", userId);
    
    const { data, error } = await supabaseAdmin
      .from("favorite_meals")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[getFavorites] Supabase error:", error);
      console.error("[getFavorites] Error details:", JSON.stringify(error, null, 2));
      return res.status(500).json({ error: error.message || "Database error" });
    }

    console.log("[getFavorites] Success, found", data?.length || 0, "favorites");
    return res.status(200).json(data || []);
  } catch (err) {
    console.error("[getFavorites] Unexpected error:", err);
    console.error("[getFavorites] Error stack:", err.stack);
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

    console.log("[createFavorite] Request received:", {
      userIdFromToken: !!userIdFromToken,
      userIdFromBody: !!userIdFromBody,
      userId: userId,
      bodyKeys: Object.keys(req.body),
    });

    if (!userId) {
      console.error("[createFavorite] userId is missing");
      return res.status(400).json({
        error: "userId is required",
      });
    }

    const { title, calories, carbs, protein, fat } = req.body;

    if (!title || calories === undefined) {
      console.error("[createFavorite] Missing required fields:", { title: !!title, calories: calories !== undefined });
      return res.status(400).json({
        error: "title and calories are required",
      });
    }

    console.log("[createFavorite] Inserting favorite:", { userId, title, calories });
    
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
      console.error("[createFavorite] Supabase error:", error);
      console.error("[createFavorite] Error details:", JSON.stringify(error, null, 2));
      return res.status(500).json({ error: error.message || "Database error" });
    }

    console.log("[createFavorite] Success, created favorite:", data?.id);
    return res.status(201).json(data);
  } catch (err) {
    console.error("[createFavorite] Unexpected error:", err);
    console.error("[createFavorite] Error stack:", err.stack);
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

