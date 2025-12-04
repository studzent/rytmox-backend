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
const userProfileService = require("./userProfileService");
const userMetricsService = require("./userMetricsService");
const workoutService = require("./workoutService");

// Константа для анонимных пользователей в ai_logs
const ANONYMOUS_USER_ID = "00000000-0000-0000-0000-000000000001";

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

    // Используем анонимного пользователя, если userId null
    const logUserId = userId ?? ANONYMOUS_USER_ID;

    const { data, error } = await supabaseAdmin
      .from("ai_logs")
      .insert([
        {
          user_id: logUserId,
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
 * Парсинг reps из строки в INTEGER
 * @param {string|number|null} value - Значение reps (может быть строкой "8-12" или числом)
 * @returns {number|null} - Первое число из строки или число, или null
 */
function parseReps(value) {
  if (!value) return null;
  if (typeof value === "number") return value;

  const match = String(value).match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
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
 * @param {boolean} [params.ignoreHistory] - Игнорировать историю тренировок при генерации (по умолчанию false)
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
  ignoreHistory = false,
}) {
  try {
    // Сохраняем исходные параметры запроса для логирования
    const originalParams = {
      level: level || null,
      equipment: equipment || [],
      targetMuscles: targetMuscles || [],
      goal: goal || null,
      durationMinutes,
      exercisesCount,
      workoutType: workoutType || null,
    };

    // 1. Загрузка профиля пользователя, метрик тела и истории тренировок (если userId передан)
    let userProfile = null;
    let profileSnapshot = null;
    let latestBodyMetric = null;
    let recentSessions = [];

    if (userId) {
      // Загружаем профиль
      const { data: profile, error: profileError } = await userProfileService.getUserProfile(userId);
      if (profileError) {
        // Логируем ошибку, но продолжаем работу без профиля (graceful degradation)
        console.warn(`Failed to load user profile for userId ${userId}:`, profileError.message);
      } else if (profile) {
        userProfile = profile;
        profileSnapshot = {
          level: profile.level,
          goal: profile.goal,
          preferred_equipment: profile.preferred_equipment,
          preferred_muscles: profile.preferred_muscles,
          language: profile.language,
          restrictions: profile.restrictions,
          equipment_items: profile.equipment_items,
          training_environment: profile.training_environment,
          weight_kg: profile.weight_kg,
          height_cm: profile.height_cm,
        };
      }

      // Загружаем последнюю метрику тела
      const { data: metric, error: metricError } = await userMetricsService.getLatestBodyMetric(userId);
      if (metricError) {
        console.warn(`Failed to load body metric for userId ${userId}:`, metricError.message);
      } else if (metric) {
        latestBodyMetric = metric;
      }

      // Загружаем историю тренировок (если не игнорируется)
      if (!ignoreHistory) {
        const { data: sessions, error: sessionsError } = await workoutService.getUserWorkoutSessions(userId, {
          limit: 10,
        });
        if (sessionsError) {
          console.warn(`Failed to load workout sessions for userId ${userId}:`, sessionsError.message);
        } else if (sessions) {
          recentSessions = sessions;
        }
      }
    }

    // 2. Обогащение параметров данными профиля (если они не переданы в запросе)
    // Используем данные профиля только если параметр не передан или пустой
    if (userProfile) {
      if (!level && userProfile.level) {
        level = userProfile.level;
      }
      if ((!equipment || equipment.length === 0) && userProfile.preferred_equipment && userProfile.preferred_equipment.length > 0) {
        equipment = userProfile.preferred_equipment;
      }
      if ((!targetMuscles || targetMuscles.length === 0) && userProfile.preferred_muscles && userProfile.preferred_muscles.length > 0) {
        targetMuscles = userProfile.preferred_muscles;
      }
      if (!goal && userProfile.goal) {
        goal = userProfile.goal;
      }
    }

    // 3. Валидация входных параметров
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
    if (!workoutType) {
      workoutType = "full_body";
    }

    // 4. Загрузка доступных упражнений из Supabase
    let query = supabaseAdmin
      .from("exercises")
      .select("id, slug, name_en, main_muscle, equipment, level, instructions_en, required_equipment_items");

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

    // Фильтрация по целевым мышцам (если указаны и не "Full Body")
    if (targetMuscles && targetMuscles.length > 0) {
      // Если targetMuscles включает "Full Body", не фильтруем по мышцам
      const hasFullBody = targetMuscles.some(
        (muscle) => muscle.toLowerCase().includes("full body") || muscle.toLowerCase() === "full body"
      );
      
      if (!hasFullBody) {
        // Нормализуем названия мышц
        const muscleFilter = targetMuscles.map((muscle) => 
          muscle.toLowerCase().replace(/\s+/g, "_")
        );
        // Фильтруем по main_muscle (точное совпадение)
        query = query.in("main_muscle", muscleFilter);
      }
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

    // Фильтрация упражнений по required_equipment_items из профиля пользователя
    let filteredExercises = exercises;
    if (userProfile && userProfile.equipment_items && Array.isArray(userProfile.equipment_items) && userProfile.equipment_items.length > 0) {
      // Если у пользователя есть equipment_items, фильтруем упражнения
      const userEquipmentItems = new Set(userProfile.equipment_items);
      
      filteredExercises = exercises.filter((exercise) => {
        const requiredItems = exercise.required_equipment_items || [];
        
        // Если required_equipment_items пустой, упражнение доступно (bodyweight)
        if (requiredItems.length === 0) {
          return true;
        }
        
        // Проверяем, что КАЖДЫЙ элемент из required_equipment_items присутствует в profile.equipment_items
        return requiredItems.every((item) => userEquipmentItems.has(item));
      });
    } else if (userProfile && (!userProfile.equipment_items || userProfile.equipment_items.length === 0)) {
      // Если equipment_items пустой, но есть training_environment, можно отдавать bodyweight + базовые упражнения
      // Фильтруем упражнения с пустым required_equipment_items (bodyweight)
      const trainingEnvironment = userProfile.training_environment;
      if (trainingEnvironment && ["home", "gym", "outdoor"].includes(trainingEnvironment)) {
        // Отдаем bodyweight упражнения (required_equipment_items пустой)
        filteredExercises = exercises.filter((exercise) => {
          const requiredItems = exercise.required_equipment_items || [];
          return requiredItems.length === 0;
        });
      }
    }

    if (!filteredExercises || filteredExercises.length === 0) {
      return {
        data: null,
        error: {
          message: "No exercises found matching the equipment criteria",
          code: "NO_EXERCISES_FOUND",
        },
      };
    }

    // Рандомизация массива упражнений
    const shuffledExercises = filteredExercises.sort(() => Math.random() - 0.5);

    // 5. Формирование trainingContext для AI
    const trainingContext = {
      profile: {
        level: userProfile?.level || level,
        goal: userProfile?.goal || goal,
        weightKg: latestBodyMetric?.weight_kg || userProfile?.weight_kg || null,
        heightCm: userProfile?.height_cm || null,
        restrictions: userProfile?.restrictions || null,
      },
      equipment: {
        trainingEnvironment: userProfile?.training_environment || null,
        equipmentItems: userProfile?.equipment_items || [],
      },
      trainingContext: {
        recentSessions: ignoreHistory ? [] : recentSessions,
      },
    };

    // 6. Формирование промпта для OpenAI
    const systemPrompt = `You are an experienced fitness coach. Create a safe and effective workout plan based on provided exercises and user context. 

IMPORTANT INSTRUCTIONS:
- Consider the user's level (beginner/intermediate/advanced) when selecting exercises and setting intensity
- Use the user's current weight (weightKg) for load recommendations and calculations
- Analyze recent training sessions to avoid overloading the same muscle groups consecutively
- Progressively increase difficulty/volume safely based on the user's history
- Strictly respect any restrictions or injuries mentioned
- Rotate muscle groups to allow proper recovery
- If recent sessions show heavy training of certain muscles, focus on different muscle groups or allow recovery

Respond ONLY in valid JSON format.`;

    const availableExercises = shuffledExercises.map((ex) => ({
      slug: ex.slug,
      name_en: ex.name_en,
      main_muscle: ex.main_muscle,
      equipment: ex.equipment,
      level: ex.level,
    }));

    // Формируем информацию об ограничениях из профиля
    let restrictionsInfo = "";
    if (userProfile && userProfile.restrictions && Object.keys(userProfile.restrictions).length > 0) {
      restrictionsInfo = `\nIMPORTANT - User restrictions and injuries (MUST be strictly followed):
${JSON.stringify(userProfile.restrictions, null, 2)}
You MUST avoid exercises that could aggravate these conditions. If any exercise in the available list conflicts with these restrictions, DO NOT include it in the workout plan.`;
    }

    // Формируем информацию о тренировочном окружении и оборудовании
    let environmentInfo = "";
    if (userProfile) {
      if (userProfile.training_environment) {
        environmentInfo += `- Training environment: ${userProfile.training_environment}\n`;
      }
      if (userProfile.equipment_items && Array.isArray(userProfile.equipment_items) && userProfile.equipment_items.length > 0) {
        environmentInfo += `- Available equipment items: ${userProfile.equipment_items.join(", ")}\n`;
      }
    }

    // Формируем информацию о весе и истории тренировок
    let contextInfo = "";
    if (trainingContext.profile.weightKg) {
      contextInfo += `- User current weight: ${trainingContext.profile.weightKg} kg\n`;
    }
    if (trainingContext.profile.heightCm) {
      contextInfo += `- User height: ${trainingContext.profile.heightCm} cm\n`;
    }
    if (trainingContext.trainingContext.recentSessions.length > 0) {
      contextInfo += `\nRecent training sessions (use this to avoid overloading same muscles and plan progression):\n${JSON.stringify(trainingContext.trainingContext.recentSessions, null, 2)}\n`;
    }

    const userPrompt = `Create a workout plan with the following requirements:
- User level: ${level}
- Goal: ${goal}
- Workout type: ${workoutType}
- Duration: ${durationMinutes} minutes
- Number of exercises: ${exercisesCount}
- Available equipment: ${equipment.join(", ")}
- Target muscles: ${targetMuscles.length > 0 ? targetMuscles.join(", ") : "Full Body"}
${environmentInfo}${contextInfo}${userProfile ? `- User profile data: ${JSON.stringify(profileSnapshot)}` : ""}
${restrictionsInfo}

Full training context:
${JSON.stringify(trainingContext, null, 2)}

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

    // 6. Вызов OpenAI API
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

    // 7. Парсинг ответа
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

    // 8. Маппинг slug → реальные упражнения
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

    // 9. Создание записи workouts в Supabase
    const workoutName = meta.title || `AI ${level} ${workoutType}`;
    const workoutDate = new Date().toISOString().split("T")[0]; // Текущая дата в формате YYYY-MM-DD

    // Формируем notes как JSON с goal и description
    const notesData = {};
    if (goal) {
      notesData.goal = goal;
    }
    if (meta.description) {
      notesData.description = meta.description;
    }
    const workoutNotes = Object.keys(notesData).length > 0 ? JSON.stringify(notesData) : null;

    const { data: workout, error: workoutError } = await supabaseAdmin
      .from("workouts")
      .insert([
        {
          user_id: userId,
          name: workoutName,
          date: workoutDate,
          notes: workoutNotes,
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

    // 10. Создание записей workout_exercises
    // Не сохраняем tempo и notes в БД (полей нет в схеме)
    // Парсим reps из строки в INTEGER
    const workoutExercises = mappedPlan.map((item, index) => {
      return {
        workout_id: workoutId,
        exercise_id: item.exercise_id,
        sets: item.sets ? parseInt(item.sets) : null,
        reps: parseReps(item.reps),
        rest_seconds: item.rest_sec ? parseInt(item.rest_sec) : null,
        order_index: index,
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

    // 11. Запись в ai_logs
    // Сохраняем исходные параметры запроса и использованный профиль
    const requestData = {
      // Исходные параметры из запроса (до обогащения профилем)
      original_params: originalParams,
      // Финальные параметры, использованные для генерации (после обогащения)
      final_params: {
        level,
        equipment,
        targetMuscles,
        goal,
        durationMinutes,
        exercisesCount,
        workoutType,
        ignoreHistory,
      },
      // Снимок профиля, если он был использован
      profile_snapshot: profileSnapshot || null,
      // Контекст тренировки, переданный в AI
      training_context: trainingContext,
      // Старое поле для обратной совместимости (deprecated)
      profileData: profileData || null,
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

    // Используем анонимного пользователя, если userId null
    const logUserId = userId ?? ANONYMOUS_USER_ID;
    await logAIRequest(logUserId, "workout", requestData, responseData);

    // 12. Возвращаемое значение
    return {
      data: {
        workoutId,
        workout: {
          id: workoutId,
          title: workoutName,
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
