/**
 * ВАЖНО:
 * Видео упражнений живут в таблице exercise_videos и связаны по exercise_id.
 * Основное видео упражнения находится в поле exercises.video_url.
 * AI работает с упражнениями через slug в exercises.
 * Клиентские приложения сами выбирают нужный вариант видео.
 * Структура БД описана в docs/DB_SCHEMA.md и docs/EXERCISE_MEDIA.md.
 */

const { supabaseAdmin } = require("../utils/supabaseClient");
const openai = require("../utils/openaiClient");

/**
 * Логирование AI запроса
 * @param {string} userId - ID пользователя
 * @param {string} requestType - Тип запроса: 'workout', 'nutrition', 'form_check'
 * @param {object} requestData - Данные запроса
 * @param {object} responseData - Данные ответа
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function logAIRequest(userId, requestType, requestData, responseData) {
  try {
    // Валидация типа запроса
    const validTypes = ["workout", "nutrition", "form_check"];
    if (!validTypes.includes(requestType)) {
      return {
        data: null,
        error: {
          message: `Invalid request_type. Must be one of: ${validTypes.join(", ")}`,
          code: "VALIDATION_ERROR",
        },
      };
    }

    const { data, error } = await supabaseAdmin
      .from("ai_logs")
      .insert([
        {
          user_id: userId,
          request_type: requestType,
          request_data: requestData,
          response_data: responseData,
        },
      ])
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: { message: err.message, code: "INTERNAL_ERROR" },
    };
  }
}

/**
 * Получение истории AI запросов пользователя
 * @param {string} userId - ID пользователя
 * @param {string} requestType - Опциональный фильтр по типу запроса
 * @param {number} limit - Лимит записей (по умолчанию 50)
 * @returns {Promise<{data: array|null, error: object|null}>}
 */
async function getAIHistory(userId, requestType = null, limit = 50) {
  try {
    let query = supabaseAdmin
      .from("ai_logs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (requestType) {
      query = query.eq("request_type", requestType);
    }

    const { data, error } = await query;

    if (error) {
      return { data: null, error };
    }

    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: { message: err.message, code: "INTERNAL_ERROR" },
    };
  }
}

/**
 * Получение статистики AI запросов пользователя
 * @param {string} userId - ID пользователя
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function getAIStats(userId) {
  try {
    const { data, error } = await supabaseAdmin
      .from("ai_logs")
      .select("request_type, created_at")
      .eq("user_id", userId);

    if (error) {
      return { data: null, error };
    }

    // Подсчет статистики
    const stats = {
      total: data.length,
      by_type: {
        workout: 0,
        nutrition: 0,
        form_check: 0,
      },
      last_request: data.length > 0 ? data[0].created_at : null,
    };

    data.forEach((log) => {
      if (stats.by_type[log.request_type] !== undefined) {
        stats.by_type[log.request_type]++;
      }
    });

    return { data: stats, error: null };
  } catch (err) {
    return {
      data: null,
      error: { message: err.message, code: "INTERNAL_ERROR" },
    };
  }
}

/**
 * Генерация тренировки через OpenAI
 * @param {object} params - Параметры генерации тренировки
 * @param {string|null} params.userId - ID пользователя (опционально)
 * @param {string} params.level - Уровень: 'beginner' | 'intermediate' | 'advanced'
 * @param {string[]} params.equipment - Массив доступного оборудования
 * @param {string[]} params.targetMuscles - Массив целевых групп мышц
 * @param {string} params.goal - Цель: 'fat_loss' | 'muscle_gain' | 'health' | 'performance'
 * @param {number} params.durationMinutes - Длительность тренировки в минутах
 * @param {number} params.exercisesCount - Количество упражнений
 * @param {string} params.workoutType - Тип тренировки: 'strength' | 'hiit' | 'mobility' | 'full_body'
 * @param {object|null} params.profileData - Данные профиля пользователя
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function generateWorkout({
  userId = null,
  level,
  equipment = [],
  targetMuscles = [],
  goal,
  durationMinutes = 30,
  exercisesCount = 8,
  workoutType,
  profileData = null,
}) {
  try {
    // 1. Валидация входных параметров
    if (!level || !["beginner", "intermediate", "advanced"].includes(level)) {
      return {
        data: null,
        error: {
          message: "level is required and must be one of: beginner, intermediate, advanced",
          code: "VALIDATION_ERROR",
        },
      };
    }

    // Если equipment пустой, используем bodyweight по умолчанию
    if (!equipment || equipment.length === 0) {
      equipment = ["bodyweight"];
    }

    // Дефолтные значения
    if (!durationMinutes || durationMinutes < 10) {
      durationMinutes = 30;
    }
    if (!exercisesCount || exercisesCount < 1) {
      exercisesCount = 8;
    }

    // 2. Загрузка доступных упражнений из Supabase
    let query = supabaseAdmin
      .from("exercises")
      .select("id, slug, name_en, main_muscle, equipment, level, instructions_en");

    // Фильтрация по уровню (exact match или более легкие для высокого уровня)
    const levelOrder = { beginner: 1, intermediate: 2, advanced: 3 };
    const userLevel = levelOrder[level];
    
    if (userLevel >= 2) {
      // Для intermediate и advanced разрешаем упражнения текущего уровня и ниже
      query = query.in("level", ["beginner", level === "advanced" ? "intermediate" : level]);
    } else {
      query = query.eq("level", level);
    }

    // Фильтрация по оборудованию (equipment IN массив или bodyweight)
    if (equipment.length > 0) {
      query = query.in("equipment", equipment);
    }

    // Фильтрация по целевым мышцам (если указаны)
    if (targetMuscles && targetMuscles.length > 0) {
      // Нормализуем названия мышц
      const muscleFilter = targetMuscles.map((muscle) => 
        muscle.toLowerCase().replace(/\s+/g, "_")
      );
      // Фильтруем по main_muscle (точное совпадение)
      query = query.in("main_muscle", muscleFilter);
    }

    // Ограничение количества и рандомизация
    const { data: exercises, error: exercisesError } = await query
      .limit(50)
      .order("created_at", { ascending: false });

    if (exercisesError) {
      return {
        data: null,
        error: {
          message: `Failed to load exercises: ${exercisesError.message}`,
          code: "DATABASE_ERROR",
        },
      };
    }

    if (!exercises || exercises.length === 0) {
      return {
        data: null,
        error: {
          message: "No exercises found matching the criteria",
          code: "NO_EXERCISES_FOUND",
        },
      };
    }

    // Рандомизация массива упражнений
    const shuffledExercises = exercises.sort(() => Math.random() - 0.5);

    // 3. Формирование промпта для OpenAI
    const systemPrompt = `You are an experienced fitness coach. Create a safe and effective workout plan based on provided exercises and user context. Respond ONLY in valid JSON format.`;

    const availableExercises = shuffledExercises.map((ex) => ({
      slug: ex.slug,
      name_en: ex.name_en,
      main_muscle: ex.main_muscle,
      equipment: ex.equipment,
      level: ex.level,
    }));

    const userPrompt = `Create a workout plan with the following requirements:
- User level: ${level}
- Goal: ${goal}
- Workout type: ${workoutType}
- Duration: ${durationMinutes} minutes
- Number of exercises: ${exercisesCount}
- Available equipment: ${equipment.join(", ")}
- Target muscles: ${targetMuscles.length > 0 ? targetMuscles.join(", ") : "Full Body"}
${profileData ? `- User profile: ${JSON.stringify(profileData)}` : ""}

Available exercises:
${JSON.stringify(availableExercises, null, 2)}

Return a JSON object with this exact structure:
{
  "plan": [
    {
      "exercise_slug": "push_up",
      "sets": 4,
      "reps": "8-12",
      "rest_sec": 60,
      "tempo": "2-0-2",
      "notes": "Keep your core tight."
    }
  ],
  "meta": {
    "title": "Full Body Beginner Workout",
    "description": "30-minute full body routine for a beginner with bodyweight and dumbbells."
  }
}

Return ONLY valid JSON, no markdown, no code blocks.`;

    // 4. Вызов OpenAI API
    // Используем gpt-5.1 если доступен, иначе gpt-4o-mini
    let model = "gpt-5.1";
    // Fallback на gpt-4o-mini если gpt-5.1 недоступен (будет обработано в catch)

    let completion;
    try {
      completion = await openai.chat.completions.create({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      });
    } catch (modelError) {
      // Если gpt-5.1 недоступен, используем gpt-4o-mini
      if (modelError.message && modelError.message.includes("gpt-5.1")) {
        model = "gpt-4o-mini";
        completion = await openai.chat.completions.create({
          model: model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.7,
        });
      } else {
        throw modelError;
      }
    }

    const responseContent = completion.choices[0].message.content;

    // 5. Парсинг ответа
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(responseContent);
    } catch (parseError) {
      return {
        data: null,
        error: {
          message: `Failed to parse OpenAI response: ${parseError.message}`,
          code: "PARSE_ERROR",
        },
      };
    }

    // Обработка структуры ответа (может быть объект с plan и meta, или просто массив)
    let plan = [];
    let meta = {};

    if (Array.isArray(parsedResponse)) {
      plan = parsedResponse;
    } else if (parsedResponse.plan && Array.isArray(parsedResponse.plan)) {
      plan = parsedResponse.plan;
      meta = parsedResponse.meta || {};
    } else {
      // Попытка найти массив в ответе
      const keys = Object.keys(parsedResponse);
      if (keys.length > 0 && Array.isArray(parsedResponse[keys[0]])) {
        plan = parsedResponse[keys[0]];
        meta = parsedResponse.meta || parsedResponse;
      } else {
        return {
          data: null,
          error: {
            message: "Invalid response format from OpenAI",
            code: "INVALID_RESPONSE",
          },
        };
      }
    }

    // 6. Маппинг slug → реальные упражнения
    const exerciseMap = new Map();
    shuffledExercises.forEach((ex) => {
      exerciseMap.set(ex.slug, ex);
    });

    const mappedPlan = [];
    const missingSlugs = [];

    for (const item of plan) {
      const exercise = exerciseMap.get(item.exercise_slug);
      if (!exercise) {
        missingSlugs.push(item.exercise_slug);
        continue;
      }

      mappedPlan.push({
        exercise_id: exercise.id,
        exercise_slug: item.exercise_slug,
        name_en: exercise.name_en,
        main_muscle: exercise.main_muscle,
        equipment: exercise.equipment,
        sets: item.sets || null,
        reps: item.reps || null,
        rest_sec: item.rest_sec || null,
        tempo: item.tempo || null,
        notes: item.notes || null,
      });
    }

    if (missingSlugs.length > 0) {
      console.warn(`Missing exercises for slugs: ${missingSlugs.join(", ")}`);
    }

    if (mappedPlan.length === 0) {
      return {
        data: null,
        error: {
          message: "No valid exercises found in AI response",
          code: "NO_VALID_EXERCISES",
        },
      };
    }

    // 7. Создание записи workouts в Supabase
    const workoutTitle = meta.title || `AI ${level} ${workoutType}`;
    const workoutDate = new Date().toISOString().split("T")[0]; // Текущая дата в формате YYYY-MM-DD

    const { data: workout, error: workoutError } = await supabaseAdmin
      .from("workouts")
      .insert([
        {
          user_id: userId,
          title: workoutTitle,
          goal: goal,
          date: workoutDate,
          notes: meta.description || null,
        },
      ])
      .select()
      .single();

    if (workoutError) {
      return {
        data: null,
        error: {
          message: `Failed to create workout: ${workoutError.message}`,
          code: "DATABASE_ERROR",
        },
      };
    }

    const workoutId = workout.id;

    // 8. Создание записей workout_exercises
    // reps может быть строкой (например "8-12"), сохраняем как есть
    // Если reps - число, конвертируем в строку для единообразия
    const workoutExercises = mappedPlan.map((item, index) => {
      let repsValue = item.reps;
      if (repsValue && typeof repsValue === "number") {
        repsValue = repsValue.toString();
      }
      
      return {
        workout_id: workoutId,
        exercise_id: item.exercise_id,
        sets: item.sets ? parseInt(item.sets) : null,
        reps: repsValue || null,
        rest_sec: item.rest_sec ? parseInt(item.rest_sec) : null,
        tempo: item.tempo || null,
        order_index: index,
        notes: item.notes || null,
      };
    });

    const { error: exercisesInsertError } = await supabaseAdmin
      .from("workout_exercises")
      .insert(workoutExercises);

    if (exercisesInsertError) {
      // Удаляем созданный workout при ошибке
      await supabaseAdmin.from("workouts").delete().eq("id", workoutId);
      return {
        data: null,
        error: {
          message: `Failed to create workout exercises: ${exercisesInsertError.message}`,
          code: "DATABASE_ERROR",
        },
      };
    }

    // 9. Запись в ai_logs
    const requestData = {
      level,
      equipment,
      targetMuscles,
      goal,
      durationMinutes,
      exercisesCount,
      workoutType,
      profileData,
    };

    const responseData = {
      workout_id: workoutId,
      plan: plan.map((item) => ({
        exercise_slug: item.exercise_slug,
        sets: item.sets,
        reps: item.reps,
        rest_sec: item.rest_sec,
        tempo: item.tempo,
        notes: item.notes,
      })),
      meta,
    };

    await logAIRequest(userId, "workout", requestData, responseData);

    // 10. Возвращаемое значение
    return {
      data: {
        workoutId,
        workout: {
          id: workoutId,
          title: workoutTitle,
          goal: goal,
          userId: userId,
        },
        plan: mappedPlan,
        meta,
      },
      error: null,
    };
  } catch (err) {
    console.error("Error in generateWorkout:", err);
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
  logAIRequest,
  getAIHistory,
  getAIStats,
  generateWorkout,
};
