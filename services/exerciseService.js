const { supabaseAdmin } = require("../utils/supabaseClient");

/**
 * Получение списка упражнений с фильтрами
 * @param {object} filters - Объект с фильтрами
 * @param {string} [filters.level] - Уровень: 'beginner' | 'intermediate' | 'advanced'
 * @param {string} [filters.equipment] - Оборудование: 'bodyweight' | 'dumbbells' | 'barbell' | 'gym' и т.п.
 * @param {string} [filters.main_muscle] - Основная группа мышц: 'Chest' | 'Legs' | 'Glutes' | 'Core' | 'Back' и т.п.
 * @param {string} [filters.search] - Поисковая строка для фильтрации по name_en и name_ru
 * @returns {Promise<{data: array|null, error: object|null}>}
 */
async function getExercises(filters = {}) {
  try {
    let query = supabaseAdmin.from("exercises").select("*");

    // Применяем фильтры
    if (filters.level) {
      query = query.eq("level", filters.level);
    }

    if (filters.equipment) {
      query = query.eq("equipment", filters.equipment);
    }

    if (filters.main_muscle) {
      // Используем ILIKE для case-insensitive поиска
      query = query.ilike("main_muscle", filters.main_muscle);
    }

    if (filters.search) {
      // Поиск по name_en или name_ru (ILIKE для case-insensitive)
      // Используем формат PostgREST: * для wildcards
      query = query.or(
        `name_en.ilike.*${filters.search}*,name_ru.ilike.*${filters.search}*`
      );
    }

    // Сортировка: main_muscle ASC, name_en ASC
    query = query.order("main_muscle", { ascending: true });
    query = query.order("name_en", { ascending: true });

    // Лимит: 200 записей
    query = query.limit(200);

    const { data: exercises, error: exercisesError } = await query;

    if (exercisesError) {
      return {
        data: null,
        error: {
          message: `Failed to load exercises: ${exercisesError.message}`,
          code: "DATABASE_ERROR",
        },
      };
    }

    // Получаем все exercise_id для проверки наличия видео
    const exerciseIds = (exercises || []).map((ex) => ex.id);

    // Проверяем наличие видео для каждого упражнения
    let videosMap = {};
    if (exerciseIds.length > 0) {
      const { data: videos, error: videosError } = await supabaseAdmin
        .from("exercise_videos")
        .select("exercise_id")
        .in("exercise_id", exerciseIds);

      if (!videosError && videos) {
        // Создаем Set для быстрой проверки
        const exerciseIdsWithVideos = new Set(
          videos.map((v) => v.exercise_id)
        );
        videosMap = exerciseIdsWithVideos;
      }
    }

    // Формируем ответ с добавлением поля has_video
    const exercisesList = (exercises || []).map((exercise) => ({
      id: exercise.id,
      slug: exercise.slug,
      name_en: exercise.name_en,
      name_ru: exercise.name_ru,
      main_muscle: exercise.main_muscle,
      equipment: exercise.equipment,
      level: exercise.level,
      thumbnail_url: exercise.thumbnail_url || null,
      has_video: videosMap.has(exercise.id),
    }));

    return {
      data: exercisesList,
      error: null,
    };
  } catch (err) {
    console.error("Error in getExercises:", err);
    return {
      data: null,
      error: {
        message: err.message || "Internal server error",
        code: "INTERNAL_ERROR",
      },
    };
  }
}

/**
 * Получение упражнения по slug с видео
 * @param {string} slug - Slug упражнения
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function getExerciseBySlug(slug) {
  try {
    if (!slug) {
      return {
        data: null,
        error: {
          message: "Slug is required",
          code: "VALIDATION_ERROR",
        },
      };
    }

    // 1. Получаем упражнение по slug
    const { data: exercise, error: exerciseError } = await supabaseAdmin
      .from("exercises")
      .select("*")
      .eq("slug", slug)
      .single();

    if (exerciseError) {
      // Проверяем, если это ошибка "не найдено"
      if (exerciseError.code === "PGRST116") {
        return {
          data: null,
          error: {
            message: "Exercise not found",
            code: "NOT_FOUND",
          },
        };
      }
      return {
        data: null,
        error: {
          message: `Failed to load exercise: ${exerciseError.message}`,
          code: "DATABASE_ERROR",
        },
      };
    }

    if (!exercise) {
      return {
        data: null,
        error: {
          message: "Exercise not found",
          code: "NOT_FOUND",
        },
      };
    }

    // 2. Получаем все видео для этого упражнения
    const { data: videos, error: videosError } = await supabaseAdmin
      .from("exercise_videos")
      .select("*")
      .eq("exercise_id", exercise.id)
      .order("created_at", { ascending: true });

    if (videosError) {
      console.error("Error loading exercise videos:", videosError);
      // Не возвращаем ошибку, просто пустой массив видео
    }

    // 3. Формируем ответ
    const response = {
      id: exercise.id,
      slug: exercise.slug,
      name_en: exercise.name_en,
      name_ru: exercise.name_ru,
      main_muscle: exercise.main_muscle,
      secondary_muscles: exercise.secondary_muscles || [],
      equipment: exercise.equipment,
      level: exercise.level,
      instructions_en: exercise.instructions_en || null,
      instructions_ru: exercise.instructions_ru || null,
      thumbnail_url: exercise.thumbnail_url || null,
      videos: (videos || []).map((video) => ({
        id: video.id,
        variant: video.variant || null,
        language: video.language || null,
        aspect_ratio: video.aspect_ratio || null,
        video_url: video.video_url || null,
        thumbnail_url: video.thumbnail_url || null,
        notes: video.notes || null,
      })),
    };

    return {
      data: response,
      error: null,
    };
  } catch (err) {
    console.error("Error in getExerciseBySlug:", err);
    return {
      data: null,
      error: {
        message: err.message || "Internal server error",
        code: "INTERNAL_ERROR",
      },
    };
  }
}

module.exports = {
  getExercises,
  getExerciseBySlug,
};

