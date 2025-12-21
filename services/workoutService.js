const { supabaseAdmin } = require("../utils/supabaseClient");

/**
 * Извлечение goal и description из workouts.notes (JSON)
 * @param {string|null} notes - JSON строка с метаданными
 * @returns {object} - { goal: string|null, description: string|null }
 */
function parseWorkoutNotes(notes) {
  if (!notes) {
    return { goal: null, description: null };
  }

  try {
    const parsed = JSON.parse(notes);
    return {
      goal: parsed.goal || null,
      description: parsed.description || null,
    };
  } catch (err) {
    // Если не JSON, возвращаем null
    return { goal: null, description: null };
  }
}

/**
 * Получение тренировки по ID с полной информацией об упражнениях
 * @param {string} workoutId - UUID тренировки
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function getWorkoutById(workoutId) {
  try {
    // 1. Получаем тренировку
    const { data: workout, error: workoutError } = await supabaseAdmin
      .from("workouts")
      .select("*")
      .eq("id", workoutId)
      .single();

    if (workoutError) {
      return {
        data: null,
        error: {
          message: "Workout not found",
          code: "NOT_FOUND",
        },
      };
    }

    if (!workout) {
      return {
        data: null,
        error: {
          message: "Workout not found",
          code: "NOT_FOUND",
        },
      };
    }

    // 2. Парсим notes для получения goal и description
    const { goal, description } = parseWorkoutNotes(workout.notes);

    // 3. Получаем упражнения тренировки
    const { data: workoutExercises, error: exercisesError } = await supabaseAdmin
      .from("workout_exercises")
      .select("*")
      .eq("workout_id", workoutId)
      .order("order_index", { ascending: true });

    if (exercisesError) {
      return {
        data: null,
        error: {
          message: `Failed to load workout exercises: ${exercisesError.message}`,
          code: "DATABASE_ERROR",
        },
      };
    }

    // 4. Для каждого упражнения подгружаем данные из exercises и видео
    const exercisesWithDetails = await Promise.all(
      (workoutExercises || []).map(async (we) => {
        // Получаем упражнение
        const { data: exercise, error: exerciseError } = await supabaseAdmin
          .from("exercises")
          .select("id, slug, name_en, name_ru, main_muscle, equipment, thumbnail_url")
          .eq("id", we.exercise_id)
          .single();

        if (exerciseError || !exercise) {
          // Если упражнение не найдено, пропускаем
          return null;
        }

        // Получаем видео (предпочтительно variant='default', language='en', или любое)
        const { data: videos } = await supabaseAdmin
          .from("exercise_videos")
          .select("id, video_url, thumbnail_url, variant, language")
          .eq("exercise_id", we.exercise_id);

        let video = null;
        if (videos && videos.length > 0) {
          // Ищем предпочтительно default/en, затем default, затем любое
          const preferredVideo =
            videos.find((v) => v.variant === "default" && v.language === "en") ||
            videos.find((v) => v.variant === "default") ||
            videos[0];

          video = {
            id: preferredVideo.id,
            video_url: preferredVideo.video_url || null,
            thumbnail_url: preferredVideo.thumbnail_url || null,
            variant: preferredVideo.variant || null,
            language: preferredVideo.language || null,
          };
        }

        return {
          order_index: we.order_index,
          exercise_id: exercise.id,
          slug: exercise.slug,
          name_en: exercise.name_en,
          name_ru: exercise.name_ru || null,
          main_muscle: exercise.main_muscle,
          equipment: exercise.equipment,
          thumbnail_url: exercise.thumbnail_url || null,
          sets: we.sets,
          reps: we.reps,
          rest_sec: we.rest_seconds,
          // tempo и notes не хранятся в БД, но могут быть в ответе AI
          // Для полноты оставляем null, если нужно - можно добавить в ai_logs
          tempo: null,
          notes: null,
          video: video,
        };
      })
    );

    // Фильтруем null (упражнения, которые не найдены)
    const validExercises = exercisesWithDetails.filter((ex) => ex !== null);

    // 5. Преобразуем date в ISO string (если это строка YYYY-MM-DD, добавляем время)
    let dateISO = workout.date;
    if (typeof workout.date === "string" && workout.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      // Если это DATE формат YYYY-MM-DD, преобразуем в ISO string с временем 00:00:00
      dateISO = new Date(workout.date + "T00:00:00.000Z").toISOString();
    } else if (workout.date instanceof Date) {
      dateISO = workout.date.toISOString();
    }

    // 6. Формируем ответ
    return {
      data: {
        id: workout.id,
        name: workout.name,
        date: dateISO,
        goal: goal,
        description: description,
        exercises: validExercises,
      },
      error: null,
    };
  } catch (err) {
    console.error("Error in getWorkoutById:", err);
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
 * Получение тренировки по ID в формате AIWorkoutResponse (как /ai/workout)
 * Нужно для фронта: PlanScreen ожидает поле plan, а не exercises.
 * @param {string} workoutId
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function getWorkoutByIdAI(workoutId) {
  const { data: workoutDetails, error } = await getWorkoutById(workoutId);
  if (error) return { data: null, error };
  if (!workoutDetails) return { data: null, error: null };

  const plan = (workoutDetails.exercises || []).map((ex) => ({
    exercise_id: ex.exercise_id,
    exercise_slug: ex.slug,
    name_en: ex.name_en,
    name_ru: ex.name_ru || null,
    main_muscle: ex.main_muscle,
    equipment: ex.equipment,
    thumbnail_url: ex.thumbnail_url || null,
    sets: ex.sets ?? null,
    reps: ex.reps === null || ex.reps === undefined ? null : String(ex.reps),
    rest_sec: ex.rest_sec ?? null,
    tempo: ex.tempo ?? null,
    notes: ex.notes ?? null,
  }));

  return {
    data: {
      workoutId: workoutDetails.id,
      workout: {
        id: workoutDetails.id,
        title: workoutDetails.name,
        goal: workoutDetails.goal || null,
        userId: null,
      },
      plan,
      meta: {
        title: workoutDetails.name,
        description: workoutDetails.description || undefined,
      },
    },
    error: null,
  };
}

/**
 * Получение списка тренировок пользователя (краткая информация)
 * @param {string} userId - UUID пользователя
 * @returns {Promise<{data: array|null, error: object|null}>}
 */
async function getWorkoutsByUser(userId) {
  try {
    // Получаем все тренировки пользователя, отсортированные по дате (новые сверху)
    const { data: workouts, error: workoutsError } = await supabaseAdmin
      .from("workouts")
      .select("id, name, date, notes")
      .eq("user_id", userId)
      .order("date", { ascending: false });

    if (workoutsError) {
      return {
        data: null,
        error: {
          message: `Failed to load workouts: ${workoutsError.message}`,
          code: "DATABASE_ERROR",
        },
      };
    }

    // Формируем краткий список с goal из notes
    const workoutsList = (workouts || []).map((workout) => {
      const { goal } = parseWorkoutNotes(workout.notes);

      // Преобразуем date в ISO string
      let dateISO = workout.date;
      if (typeof workout.date === "string" && workout.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
        dateISO = new Date(workout.date + "T00:00:00.000Z").toISOString();
      } else if (workout.date instanceof Date) {
        dateISO = workout.date.toISOString();
      }

      return {
        id: workout.id,
        name: workout.name,
        date: dateISO,
        goal: goal,
      };
    });

    return {
      data: workoutsList,
      error: null,
    };
  } catch (err) {
    console.error("Error in getWorkoutsByUser:", err);
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
 * Получение истории тренировок пользователя с полными данными об упражнениях
 * @param {string} userId - UUID пользователя
 * @param {object} [options] - Опции
 * @param {number} [options.limit] - Лимит тренировок (по умолчанию без лимита)
 * @returns {Promise<{data: array|null, error: object|null}>}
 */
async function getWorkoutHistory(userId, options = {}) {
  try {
    if (!userId) {
      return {
        data: null,
        error: {
          message: "userId is required",
          code: "VALIDATION_ERROR",
        },
      };
    }

    const { limit } = options;

    // 1. Получаем все тренировки пользователя, отсортированные по дате завершения или дате (новые сверху)
    let query = supabaseAdmin
      .from("workouts")
      .select("id, name, date, notes, completed_at, created_at")
      .eq("user_id", userId)
      .order("completed_at", { ascending: false, nullsLast: true })
      .order("date", { ascending: false });

    if (limit) {
      query = query.limit(limit);
    }

    const { data: workouts, error: workoutsError } = await query;

    if (workoutsError) {
      return {
        data: null,
        error: {
          message: `Failed to load workouts: ${workoutsError.message}`,
          code: "DATABASE_ERROR",
        },
      };
    }

    if (!workouts || workouts.length === 0) {
      return {
        data: [],
        error: null,
      };
    }

    // 2. Для каждой тренировки получаем упражнения
    const historyItems = await Promise.all(
      workouts.map(async (workout) => {
        // Получаем упражнения тренировки
        const { data: workoutExercises, error: exercisesError } = await supabaseAdmin
          .from("workout_exercises")
          .select("exercise_id, sets, reps, weight, rest_seconds, order_index")
          .eq("workout_id", workout.id)
          .order("order_index", { ascending: true });

        if (exercisesError) {
          console.warn(`Failed to load exercises for workout ${workout.id}:`, exercisesError);
          return null;
        }

        // Получаем детали упражнений
        const exercises = await Promise.all(
          (workoutExercises || []).map(async (we) => {
            const { data: exercise, error: exerciseError } = await supabaseAdmin
              .from("exercises")
              .select("id, slug, name_en, name_ru, main_muscle")
              .eq("id", we.exercise_id)
              .single();

            if (exerciseError || !exercise) {
              return null;
            }

            return {
              id: exercise.id,
              slug: exercise.slug,
              name: exercise.name_ru || exercise.name_en,
              main_muscle: exercise.main_muscle,
              sets: we.sets || 0,
              reps: we.reps || 0,
              weight: we.weight ? parseFloat(we.weight) : null,
              rest_seconds: we.rest_seconds || 0,
              order_index: we.order_index || 0,
            };
          })
        );

        // Фильтруем null (упражнения, которые не найдены)
        const validExercises = exercises.filter((ex) => ex !== null);

        // Преобразуем даты в ISO строки
        let dateISO = workout.date;
        if (typeof workout.date === "string" && workout.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
          dateISO = workout.date;
        } else if (workout.date instanceof Date) {
          dateISO = workout.date.toISOString().split("T")[0];
        }

        let completedAtISO = null;
        if (workout.completed_at) {
          if (workout.completed_at instanceof Date) {
            completedAtISO = workout.completed_at.toISOString();
          } else if (typeof workout.completed_at === "string") {
            completedAtISO = workout.completed_at;
          }
        } else if (workout.created_at) {
          // Fallback на created_at, если completed_at не установлен
          if (workout.created_at instanceof Date) {
            completedAtISO = workout.created_at.toISOString();
          } else if (typeof workout.created_at === "string") {
            completedAtISO = workout.created_at;
          }
        }

        return {
          id: workout.id,
          name: workout.name,
          date: dateISO,
          completed_at: completedAtISO,
          exercises: validExercises,
        };
      })
    );

    // Фильтруем null (тренировки с ошибками загрузки упражнений)
    const validHistoryItems = historyItems.filter((item) => item !== null);

    return {
      data: validHistoryItems,
      error: null,
    };
  } catch (err) {
    console.error("Error in getWorkoutHistory:", err);
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
 * Получение истории тренировок пользователя в компактном формате для AI-контекста
 * @param {string} userId - UUID пользователя
 * @param {object} [options] - Опции
 * @param {number} [options.limit] - Лимит тренировок (по умолчанию 10)
 * @returns {Promise<{data: array|null, error: object|null}>}
 */
async function getUserWorkoutSessions(userId, options = {}) {
  try {
    if (!userId) {
      return {
        data: null,
        error: {
          message: "userId is required",
          code: "VALIDATION_ERROR",
        },
      };
    }

    const { limit = 10 } = options;

    // 1. Получаем последние тренировки пользователя
    const { data: workouts, error: workoutsError } = await supabaseAdmin
      .from("workouts")
      .select("id, name, date")
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .limit(limit);

    if (workoutsError) {
      return {
        data: null,
        error: {
          message: `Failed to load workouts: ${workoutsError.message}`,
          code: "DATABASE_ERROR",
        },
      };
    }

    if (!workouts || workouts.length === 0) {
      return {
        data: [],
        error: null,
      };
    }

    // 2. Для каждой тренировки получаем упражнения и агрегируем данные
    const sessions = await Promise.all(
      workouts.map(async (workout) => {
        // Получаем упражнения тренировки
        const { data: workoutExercises, error: exercisesError } = await supabaseAdmin
          .from("workout_exercises")
          .select("exercise_id, sets, reps, weight")
          .eq("workout_id", workout.id);

        if (exercisesError || !workoutExercises || workoutExercises.length === 0) {
          // Если упражнений нет, возвращаем базовую информацию
          return {
            date: workout.date,
            muscles: [],
            totalVolumeEstimate: 0,
            status: "completed",
          };
        }

        // Получаем информацию об упражнениях для определения мышц
        const exerciseIds = workoutExercises.map((we) => we.exercise_id);
        const { data: exercises } = await supabaseAdmin
          .from("exercises")
          .select("id, main_muscle")
          .in("id", exerciseIds);

        // Собираем уникальные группы мышц
        const musclesSet = new Set();
        if (exercises) {
          exercises.forEach((ex) => {
            if (ex.main_muscle) {
              // Нормализуем название мышцы (первая буква заглавная)
              const muscleName = ex.main_muscle
                .split("_")
                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                .join(" ");
              musclesSet.add(muscleName);
            }
          });
        }

        // Вычисляем примерный объём (sets × reps × weight)
        let totalVolumeEstimate = 0;
        workoutExercises.forEach((we) => {
          const sets = we.sets || 0;
          const reps = we.reps || 0;
          const weight = parseFloat(we.weight) || 0;
          totalVolumeEstimate += sets * reps * weight;
        });

        // Преобразуем date в формат YYYY-MM-DD
        let dateStr = workout.date;
        if (typeof workout.date === "string" && workout.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
          dateStr = workout.date;
        } else if (workout.date instanceof Date) {
          dateStr = workout.date.toISOString().split("T")[0];
        } else if (typeof workout.date === "string") {
          // Пытаемся извлечь дату из ISO строки
          dateStr = workout.date.split("T")[0];
        }

        return {
          date: dateStr,
          muscles: Array.from(musclesSet).sort(),
          totalVolumeEstimate: Math.round(totalVolumeEstimate),
          status: "completed",
        };
      })
    );

    return {
      data: sessions,
      error: null,
    };
  } catch (err) {
    console.error("Error in getUserWorkoutSessions:", err);
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
 * Получение тренировки пользователя на сегодня (по дате) с полной информацией
 * @param {string} userId - UUID пользователя
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function getTodayWorkout(userId) {
  try {
    if (!userId) {
      return {
        data: null,
        error: {
          message: "userId is required",
          code: "VALIDATION_ERROR",
        },
      };
    }

    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    // Берём последнюю созданную тренировку на сегодня (если вдруг их несколько)
    const { data: workout, error: workoutError } = await supabaseAdmin
      .from("workouts")
      .select("id")
      .eq("user_id", userId)
      .eq("date", today)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (workoutError) {
      return {
        data: null,
        error: {
          message: `Failed to load today's workout: ${workoutError.message}`,
          code: "DATABASE_ERROR",
        },
      };
    }

    if (!workout) {
      return { data: null, error: null };
    }

    // Возвращаем в формате AIWorkoutResponse, чтобы фронт видел поле plan
    return await getWorkoutByIdAI(workout.id);
  } catch (err) {
    console.error("Error in getTodayWorkout:", err);
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
  getWorkoutById,
  getWorkoutByIdAI,
  getWorkoutsByUser,
  getWorkoutHistory,
  getUserWorkoutSessions,
  getTodayWorkout,
};

