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
  date = null, // Дата тренировки в формате YYYY-MM-DD (опционально, по умолчанию сегодня)
}) {
  const functionStartTime = Date.now();
  console.log(`[aiService] 🚀 Starting generateWorkout for userId: ${userId || 'anonymous'}`);
  console.log(`[aiService] Parameters:`, {
    level,
    equipment: equipment?.length || 0,
    targetMuscles: targetMuscles?.length || 0,
    goal,
    durationMinutes,
    exercisesCount,
    workoutType,
    date,
  });

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
      // ВАЖНО: Используем equipment_items (slug-ы), а не preferred_equipment
      // equipment_items - это то, что пользователь выбрал в онбординге
      if ((!equipment || equipment.length === 0) && userProfile.equipment_items && userProfile.equipment_items.length > 0) {
        equipment = userProfile.equipment_items;
        console.log(`[aiService] Using equipment_items from profile:`, equipment);
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

    // Если equipment пустой (0 тренажеров), не устанавливаем по умолчанию
    // В этом случае будем искать любые упражнения с учетом уровня и целей
    // Если equipment не пустой, используем ТОЛЬКО выбранные тренажеры

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
    console.log(`[aiService] Loading exercises with filters:`, {
      level,
      equipment: equipment || [],
      equipmentLength: equipment ? equipment.length : 0,
      targetMuscles: targetMuscles || [],
    });

    let query = supabaseAdmin
      .from("exercises")
      .select("id, slug, name_en, name_ru, main_muscle, equipment, level, instructions_en, required_equipment_items, thumbnail_url");

    // Фильтрация по уровню (exact match или более легкие для высокого уровня)
    const levelOrder = { beginner: 1, intermediate: 2, advanced: 3 };
    const userLevel = levelOrder[level];
    
    if (userLevel >= 2) {
      // Для intermediate и advanced разрешаем упражнения текущего уровня и ниже
      query = query.in("level", ["beginner", level === "advanced" ? "intermediate" : level]);
    } else {
      query = query.eq("level", level);
    }

    // Фильтрация по оборудованию
    // ВАЖНО: Пользователь выбирает equipment_items (slug-ы), которые сохраняются в users.equipment_items
    // В таблице exercises есть поле required_equipment_items (массив slug-ов)
    // Мы НЕ фильтруем на уровне SQL, так как фильтрация массивов сложна
    // Вместо этого загружаем все упражнения и фильтруем в JavaScript
    // Если equipment не пустой - используем ТОЛЬКО выбранные тренажеры
    // Если equipment пустой (0 тренажеров) - не фильтруем по оборудованию
    
    if (equipment && equipment.length > 0) {
      console.log(`[aiService] Will filter by equipment_items (slugs) after query:`, equipment);
      // Не фильтруем на уровне SQL, сделаем это после загрузки
    } else {
      console.log(`[aiService] No equipment filter (0 тренажеров), will use any exercises`);
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
    const { data: exercisesData, error: exercisesError } = await query
      .limit(50)
      .order("created_at", { ascending: false });

    if (exercisesError) {
      console.error(`[aiService] Database error loading exercises:`, exercisesError);
      return {
        data: null,
        error: {
          message: `Failed to load exercises: ${exercisesError.message}`,
          code: "DATABASE_ERROR",
        },
      };
    }

    // Используем let, так как будем переназначать переменную при фильтрации
    let exercises = exercisesData;
    console.log(`[aiService] Found ${exercises ? exercises.length : 0} exercises after initial query`);

    // Фильтрация по required_equipment_items (если equipment не пустой)
    if (equipment && equipment.length > 0 && exercises && exercises.length > 0) {
      const userEquipmentItems = new Set(equipment);
      
      // Фильтруем упражнения: подходят те, у которых:
      // 1. required_equipment_items пустой (bodyweight) - доступно всем
      // 2. required_equipment_items содержит элементы, которые ВСЕ есть в equipment пользователя
      exercises = exercises.filter((exercise) => {
        const requiredItems = exercise.required_equipment_items || [];
        
        // Если required_equipment_items пустой, упражнение доступно (bodyweight)
        if (requiredItems.length === 0) {
          return true;
        }
        
        // Проверяем, что КАЖДЫЙ элемент из required_equipment_items присутствует в equipment пользователя
        // Это означает, что у пользователя есть все необходимое оборудование
        return requiredItems.every((item) => userEquipmentItems.has(item));
      });
      
      console.log(`[aiService] After filtering by required_equipment_items: ${exercises.length} exercises`);
    }

    // Fallback логика: только если equipment был пустой (0 тренажеров)
    // Если пользователь выбрал тренажеры, но упражнений не найдено - возвращаем ошибку
    if (!exercises || exercises.length === 0) {
      // Если equipment был пустой - пробуем найти любые упражнения для уровня
      if (!equipment || equipment.length === 0) {
        console.log(`[aiService] No equipment selected, trying any exercises for level: ${level}`);
        
        let anyLevelQuery = supabaseAdmin
          .from("exercises")
          .select("id, slug, name_en, name_ru, main_muscle, equipment, level, instructions_en, required_equipment_items, thumbnail_url");
        
        const levelOrder = { beginner: 1, intermediate: 2, advanced: 3 };
        const userLevel = levelOrder[level];
        if (userLevel >= 2) {
          anyLevelQuery = anyLevelQuery.in("level", ["beginner", level === "advanced" ? "intermediate" : level]);
        } else {
          anyLevelQuery = anyLevelQuery.eq("level", level);
        }
        
        const { data: anyExercises, error: anyError } = await anyLevelQuery
          .limit(50)
          .order("created_at", { ascending: false });
        
        if (!anyError && anyExercises && anyExercises.length > 0) {
          console.log(`[aiService] Found ${anyExercises.length} exercises for level (no equipment filter)`);
          exercises = anyExercises;
        } else {
          return {
            data: null,
            error: {
              message: "No exercises found for your level. Please contact support.",
              code: "NO_EXERCISES_FOUND",
            },
          };
        }
      } else {
        // Если пользователь выбрал тренажеры, но упражнений не найдено - ошибка
        return {
          data: null,
          error: {
            message: `No exercises found for selected equipment: ${equipment.join(', ')}. Please check your equipment selection or contact support.`,
            code: "NO_EXERCISES_FOUND",
          },
        };
      }
    }

    // exercises уже отфильтрованы по required_equipment_items выше (если equipment не пустой)
    // Используем их как filteredExercises
    let filteredExercises = exercises;
    
    // Если после фильтрации ничего не осталось и equipment был не пустой - ошибка
    if (!filteredExercises || filteredExercises.length === 0) {
      if (equipment && equipment.length > 0) {
        // Если пользователь выбрал тренажеры, но упражнений не найдено - ошибка
        return {
          data: null,
          error: {
            message: `No exercises found matching the selected equipment criteria. Please check your equipment selection or contact support.`,
            code: "NO_EXERCISES_FOUND",
          },
        };
      } else {
        // Если equipment был пустой, но упражнений все равно нет - ошибка
        return {
          data: null,
          error: {
            message: "No exercises found for your level. Please contact support.",
            code: "NO_EXERCISES_FOUND",
          },
        };
      }
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

    // Ограничиваем количество упражнений в промпте для ускорения генерации
    // Берем максимум 40 упражнений (достаточно для выбора 8)
    const exercisesForPrompt = shuffledExercises.slice(0, 40);
    
    const availableExercises = exercisesForPrompt.map((ex) => ({
      slug: ex.slug,
      name_en: ex.name_en,
      main_muscle: ex.main_muscle,
      equipment: ex.equipment,
      level: ex.level,
    }));
    
    console.log(`[aiService] Using ${availableExercises.length} exercises in prompt (from ${shuffledExercises.length} total)`);

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
    // Используем gpt-4o-mini (быстрая и дешевая модель)
    const model = "gpt-4o-mini";
    
    console.log(`[aiService] Calling OpenAI API with model: ${model}`);
    console.log(`[aiService] Prompt length: system=${systemPrompt.length}, user=${userPrompt.length}`);
    console.log(`[aiService] Available exercises count: ${availableExercises.length}`);

    let completion;
    const startTime = Date.now();
    try {
      // Вызов OpenAI API с таймаутом через Promise.race
      const apiCall = openai.chat.completions.create({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error("OpenAI API request timeout after 60 seconds"));
        }, 60000);
      });

      completion = await Promise.race([apiCall, timeoutPromise]);

      const duration = Date.now() - startTime;
      console.log(`[aiService] ✅ OpenAI API call successful (${duration}ms)`);
    } catch (apiError) {
      console.error(`[aiService] ❌ OpenAI API error:`, apiError);
      console.error(`[aiService] Error message:`, apiError.message);
      console.error(`[aiService] Error code:`, apiError.code);
      console.error(`[aiService] Error stack:`, apiError.stack);
      
      // Обработка различных типов ошибок
      if (apiError.message && apiError.message.includes("timeout")) {
        return {
          data: null,
          error: {
            message: "OpenAI API request timed out. Please try again.",
            code: "TIMEOUT_ERROR",
          },
        };
      }
      
      if (apiError.message && apiError.message.includes("rate limit")) {
        return {
          data: null,
          error: {
            message: "OpenAI API rate limit exceeded. Please try again later.",
            code: "RATE_LIMIT_ERROR",
          },
        };
      }

      return {
        data: null,
        error: {
          message: `OpenAI API error: ${apiError.message || "Unknown error"}`,
          code: "OPENAI_API_ERROR",
        },
      };
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
        name_ru: exercise.name_ru || null,
        main_muscle: exercise.main_muscle,
        equipment: exercise.equipment,
        thumbnail_url: exercise.thumbnail_url || null,
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
    // Используем переданную дату или текущую дату
    const workoutDate = date || new Date().toISOString().split("T")[0]; // Дата в формате YYYY-MM-DD

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
    const totalDuration = Date.now() - functionStartTime;
    console.log(`[aiService] ✅ generateWorkout completed successfully in ${totalDuration}ms`);
    console.log(`[aiService] Created workout ID: ${workoutId}, exercises: ${mappedPlan.length}`);
    
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
    const totalDuration = Date.now() - functionStartTime;
    console.error(`[aiService] ❌ Error in generateWorkout after ${totalDuration}ms:`, err);
    console.error(`[aiService] Error message:`, err.message);
    console.error(`[aiService] Error stack:`, err.stack);
    
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
