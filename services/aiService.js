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
    const validTypes = ["workout", "nutrition", "form_check", "onboarding_submit", "onboarding_validation", "chat"];
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
          body_focus_zones: profile.body_focus_zones,
          emphasized_muscles: profile.emphasized_muscles,
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
      // If emphasized_muscles exist, prioritize them over preferred_muscles
      if (userProfile.emphasized_muscles && userProfile.emphasized_muscles.length > 0) {
        targetMuscles = userProfile.emphasized_muscles;
        console.log(`[aiService] Using emphasized_muscles from profile:`, targetMuscles);
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
    // ВАЖНО: Пользователь выбирает equipment_items (slug-ы), которые сохраняются в users_equipment
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
    
    // Scoring system for emphasized_muscles and body_focus_zones
    if (userProfile && (userProfile.emphasized_muscles || userProfile.body_focus_zones)) {
      const emphasizedMuscles = (userProfile.emphasized_muscles || []).map(m => m.toLowerCase());
      const bodyFocusZones = (userProfile.body_focus_zones || []).map(z => z.toLowerCase());
      
      // Mapping body_focus_zones to muscle groups
      const bodyFocusToMuscleMap = {
        'core_abs': ['abs', 'core', 'obliques', 'deep_core'],
        'glutes': ['glutes', 'glute'],
        'legs': ['quads', 'hamstrings', 'calves', 'adductors', 'legs'],
        'arms': ['biceps', 'triceps', 'forearms', 'arms'],
        'back_posture': ['lats', 'traps', 'back', 'rear_deltoids', 'deltoids_rear'],
        'endurance': [], // Endurance is more about exercise type, not muscle
      };
      
      // Score each exercise
      filteredExercises = filteredExercises.map(exercise => {
        let score = 0;
        const mainMuscle = (exercise.main_muscle || '').toLowerCase();
        const secondaryMuscles = (exercise.secondary_muscles || []).map(m => m.toLowerCase());
        
        // +3 if main_muscle in emphasized_muscles
        if (emphasizedMuscles.length > 0 && emphasizedMuscles.includes(mainMuscle)) {
          score += 3;
        }
        
        // +1 for each secondary muscle match in emphasized_muscles
        if (emphasizedMuscles.length > 0) {
          secondaryMuscles.forEach(muscle => {
            if (emphasizedMuscles.includes(muscle)) {
              score += 1;
            }
          });
        }
        
        // +1 if main_muscle maps to body_focus_zones
        if (bodyFocusZones.length > 0) {
          bodyFocusZones.forEach(zone => {
            const muscleGroups = bodyFocusToMuscleMap[zone] || [];
            if (muscleGroups.some(mg => mainMuscle.includes(mg) || mg.includes(mainMuscle))) {
              score += 1;
            }
          });
        }
        
        return { ...exercise, emphasisScore: score };
      });
      
      // Sort by score descending, then shuffle within same score groups
      filteredExercises.sort((a, b) => {
        if (b.emphasisScore !== a.emphasisScore) {
          return b.emphasisScore - a.emphasisScore;
        }
        return Math.random() - 0.5; // Randomize within same score
      });
      
      const scoredCount = filteredExercises.filter(ex => ex.emphasisScore > 0).length;
      console.log(`[aiService] Exercise scoring: ${scoredCount} exercises have emphasis score > 0 (out of ${filteredExercises.length} total)`);
    } else {
      // Add score property even if no emphasis, for consistency
      filteredExercises = filteredExercises.map(ex => ({ ...ex, emphasisScore: 0 }));
    }
    
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

    // Фильтрация по противопоказаниям (программная фильтрация)
    if (userProfile && userProfile.contraindications && Object.keys(userProfile.contraindications).length > 0) {
      const contraindications = Object.keys(userProfile.contraindications).filter(
        key => userProfile.contraindications[key] === true
      );
      
      if (contraindications.length > 0) {
        // Маппинг противопоказаний к группам мышц и типам упражнений, которые нужно исключить
        const contraindicationFilters = {
          lower_back: {
            muscleGroups: ['back', 'lower_back'],
            exerciseSlugs: ['deadlift', 'good_morning', 'hyperextension', 'romanian_deadlift'],
            keywords: ['deadlift', 'back extension', 'hyperextension']
          },
          neck: {
            muscleGroups: ['neck', 'traps'],
            exerciseSlugs: ['shrug', 'neck_extension'],
            keywords: ['neck', 'shrug']
          },
          knees: {
            muscleGroups: ['quads', 'knees'],
            exerciseSlugs: ['squat', 'lunge', 'jump', 'leg_press', 'hack_squat'],
            keywords: ['squat', 'lunge', 'jump', 'leg press']
          },
          shoulders: {
            muscleGroups: ['shoulders', 'deltoids'],
            exerciseSlugs: ['overhead_press', 'handstand_pushup', 'shoulder_press'],
            keywords: ['overhead', 'shoulder press', 'handstand']
          },
          elbows_wrists: {
            muscleGroups: ['forearms', 'biceps', 'triceps'],
            exerciseSlugs: ['wrist_curl', 'reverse_curl'],
            keywords: ['wrist', 'elbow']
          },
          ankles: {
            exerciseSlugs: ['jump', 'sprint', 'plyometric'],
            keywords: ['jump', 'sprint', 'plyometric', 'bounding']
          },
          high_blood_pressure: {
            exerciseSlugs: ['heavy_deadlift', 'heavy_squat'],
            keywords: ['heavy', 'max']
          },
          shortness_of_breath: {
            exerciseSlugs: ['sprint', 'hiit', 'burpee'],
            keywords: ['sprint', 'hiit', 'burpee', 'cardio']
          },
          dizziness_during_exercise: {
            exerciseSlugs: ['handstand', 'inversion'],
            keywords: ['handstand', 'inversion', 'upside down']
          },
          high_heart_rate: {
            exerciseSlugs: ['sprint', 'hiit', 'burpee'],
            keywords: ['sprint', 'hiit', 'burpee', 'cardio']
          }
        };
        
        // Сохраняем количество до фильтрации для логирования
        const beforeContraindicationCount = filteredExercises.length;
        
        // Фильтруем упражнения
        filteredExercises = filteredExercises.filter(exercise => {
          const exerciseSlug = (exercise.slug || '').toLowerCase();
          const exerciseName = ((exercise.name_en || '') + ' ' + (exercise.name_ru || '')).toLowerCase();
          const mainMuscle = (exercise.main_muscle || '').toLowerCase();
          
          // Проверяем каждое противопоказание
          for (const contraindication of contraindications) {
            const filter = contraindicationFilters[contraindication];
            if (!filter) continue;
            
            // Проверка по slug
            if (filter.exerciseSlugs) {
              for (const slugPattern of filter.exerciseSlugs) {
                if (exerciseSlug.includes(slugPattern.toLowerCase())) {
                  console.log(`[aiService] Filtered out exercise ${exercise.slug} due to contraindication: ${contraindication}`);
                  return false;
                }
              }
            }
            
            // Проверка по группам мышц
            if (filter.muscleGroups && mainMuscle) {
              for (const muscleGroup of filter.muscleGroups) {
                if (mainMuscle.includes(muscleGroup.toLowerCase())) {
                  // Для некоторых противопоказаний исключаем только определенные типы упражнений
                  // Например, для lower_back исключаем только упражнения с осевой нагрузкой
                  if (contraindication === 'lower_back') {
                    // Исключаем только упражнения с высокой нагрузкой на спину
                    if (exerciseSlug.includes('deadlift') || exerciseSlug.includes('squat') || 
                        exerciseSlug.includes('good_morning') || exerciseSlug.includes('hyperextension')) {
                      console.log(`[aiService] Filtered out exercise ${exercise.slug} due to contraindication: ${contraindication}`);
                      return false;
                    }
                  } else {
                    console.log(`[aiService] Filtered out exercise ${exercise.slug} due to contraindication: ${contraindication} (muscle group: ${mainMuscle})`);
                    return false;
                  }
                }
              }
            }
            
            // Проверка по ключевым словам в названии
            if (filter.keywords) {
              for (const keyword of filter.keywords) {
                if (exerciseName.includes(keyword.toLowerCase()) || exerciseSlug.includes(keyword.toLowerCase())) {
                  console.log(`[aiService] Filtered out exercise ${exercise.slug} due to contraindication: ${contraindication} (keyword: ${keyword})`);
                  return false;
                }
              }
            }
          }
          
          return true;
        });
        
        const afterCount = filteredExercises.length;
        const removedCount = beforeContraindicationCount - afterCount;
        console.log(`[aiService] After contraindication filtering: ${afterCount} exercises remaining (removed ${removedCount})`);
        
        // Log contraindication filtering statistics
        if (removedCount > 0) {
          try {
            await logAIRequest(
              userId || null,
              "onboarding_validation",
              {
                type: "contraindication_filtering",
                contraindications: contraindications,
                exercises_before: beforeContraindicationCount,
                exercises_after: afterCount,
                removed_count: removedCount,
              },
              {
                action: "filtered_exercises_by_contraindications",
                success: true,
              }
            );
          } catch (logError) {
            console.error(`[aiService] Failed to log contraindication filtering:`, logError);
          }
        }
      }
    }
    
    // 5. Формирование trainingContext для AI
    // Извлекаем equipment_weights из restrictions, если они там есть
    const equipmentWeights = userProfile?.restrictions?.equipment_weights || null;
    
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
        equipmentWeights: equipmentWeights, // Веса оборудования для рекомендации весов в упражнениях
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
- If equipment weights are provided, use them as reference points for weight recommendations in exercises
- Analyze recent training sessions to avoid overloading the same muscle groups consecutively
- Progressively increase difficulty/volume safely based on the user's history
- Strictly respect any restrictions or injuries mentioned
- Rotate muscle groups to allow proper recovery
- If recent sessions show heavy training of certain muscles, focus on different muscle groups or allow recovery
- CRITICAL: Always create VARIED workouts - avoid repeating the same exercises or exercise combinations from recent sessions
- When selecting exercises, prioritize DIVERSITY - choose different exercises even if they target similar muscle groups
- Vary the order of exercises, rep ranges, and rest periods to create unique workout experiences
- If generating multiple workouts, ensure each one is distinctly different from previous ones

Respond ONLY in valid JSON format.`;

    // Ограничиваем количество упражнений в промпте для ускорения генерации
    // Берем top 80-150 упражнений (приоритизируем по emphasis score)
    // Если есть scoring, берем top scored exercises; иначе берем первые 100
    const topN = userProfile && (userProfile.emphasized_muscles || userProfile.body_focus_zones) ? 150 : 100;
    // Рандомизация массива упражнений (shuffle within score groups was already done during scoring)
    const shuffledExercises = filteredExercises.sort(() => Math.random() - 0.5);
    const exercisesForPrompt = shuffledExercises.slice(0, topN);
    
    const availableExercises = exercisesForPrompt.map((ex) => ({
      slug: ex.slug,
      name_en: ex.name_en,
      main_muscle: ex.main_muscle,
      equipment: ex.equipment,
      level: ex.level,
    }));
    
    console.log(`[aiService] Using ${availableExercises.length} exercises in prompt (from ${shuffledExercises.length} total)`);

    // Формируем информацию об ограничениях из профиля
    // ПРИМЕЧАНИЕ: Упражнения уже отфильтрованы программно выше, но добавляем информацию в промпт для дополнительной безопасности
    let restrictionsInfo = "";
    if (userProfile && userProfile.restrictions && Object.keys(userProfile.restrictions).length > 0) {
      restrictionsInfo = `\nIMPORTANT - User restrictions and injuries (MUST be strictly followed):
${JSON.stringify(userProfile.restrictions, null, 2)}
Note: Exercises have been pre-filtered to avoid these conditions, but you MUST double-check and avoid any exercises that could aggravate these conditions.`;
    }
    
    // Добавляем информацию о противопоказаниях, если они есть
    if (userProfile && userProfile.contraindications && Object.keys(userProfile.contraindications).length > 0) {
      const activeContraindications = Object.keys(userProfile.contraindications).filter(
        key => userProfile.contraindications[key] === true
      );
      if (activeContraindications.length > 0) {
        restrictionsInfo += `\n\nUser contraindications (exercises have been pre-filtered, but verify):
${activeContraindications.join(", ")}`;
      }
    }

    // Формируем информацию о body focus zones и emphasized muscles
    let muscleFocusInfo = "";
    if (userProfile) {
      if (userProfile.body_focus_zones && Array.isArray(userProfile.body_focus_zones) && userProfile.body_focus_zones.length > 0) {
        muscleFocusInfo += `\nBody Focus Zones (add emphasis to these areas, but maintain full-body balance): ${userProfile.body_focus_zones.join(", ")}\n`;
      }
      if (userProfile.emphasized_muscles && Array.isArray(userProfile.emphasized_muscles) && userProfile.emphasized_muscles.length > 0) {
        muscleFocusInfo += `\nEmphasized Muscles (increase volume and priority for these muscles, but maintain full-body balance and recovery logic): ${userProfile.emphasized_muscles.join(", ")}\n`;
        muscleFocusInfo += `IMPORTANT: When emphasizing specific muscles, you MUST:\n`;
        muscleFocusInfo += `- Increase sets/reps for exercises targeting these muscles\n`;
        muscleFocusInfo += `- Prioritize these muscles in exercise selection\n`;
        muscleFocusInfo += `- BUT always maintain full-body balance (don't ignore other muscle groups)\n`;
        muscleFocusInfo += `- Ensure proper recovery time between sessions targeting the same muscles\n`;
      }
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
      // Добавляем информацию о весах оборудования для рекомендации весов в упражнениях
      if (equipmentWeights && Object.keys(equipmentWeights).length > 0) {
        environmentInfo += `- Equipment weights (use these for weight recommendations in exercises):\n`;
        for (const [equipmentSlug, weight] of Object.entries(equipmentWeights)) {
          environmentInfo += `  * ${equipmentSlug}: ${weight} kg\n`;
        }
        environmentInfo += `IMPORTANT: When recommending weights for exercises using this equipment, use the weights specified above as reference points. Adjust based on exercise difficulty and user level.\n`;
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

    // Добавляем инструкцию о вариативности, если история игнорируется
    const varietyInstruction = ignoreHistory 
      ? `\nIMPORTANT: This is a regeneration request. Create a COMPLETELY DIFFERENT workout from any previous ones. Use different exercises, different rep ranges, and different exercise order. Prioritize variety and novelty.`
      : ``;

    const userPrompt = `Create a workout plan with the following requirements:
- User level: ${level}
- Goal: ${goal}
- Workout type: ${workoutType}
- Duration: ${durationMinutes} minutes
- Number of exercises: ${exercisesCount}
- Available equipment: ${equipment.join(", ")}
- Target muscles: ${targetMuscles.length > 0 ? targetMuscles.join(", ") : "Full Body"}
${environmentInfo}${contextInfo}${muscleFocusInfo}${userProfile ? `- User profile data: ${JSON.stringify(profileSnapshot)}` : ""}
${restrictionsInfo}${varietyInstruction}

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
    const correctedSlugs = [];

    for (const item of plan) {
      let exercise = exerciseMap.get(item.exercise_slug);
      
      // If slug not found, try to find a similar exercise from candidates
      if (!exercise) {
        missingSlugs.push(item.exercise_slug);
        
        // Try to find a replacement: look for exercises with similar main_muscle
        // or just pick a random one from candidates as fallback
        if (shuffledExercises.length > 0) {
          // Try to find by main_muscle match first
          const mainMuscle = item.exercise_slug.toLowerCase();
          const replacement = shuffledExercises.find(ex => 
            ex.main_muscle?.toLowerCase().includes(mainMuscle) || 
            mainMuscle.includes(ex.main_muscle?.toLowerCase() || '')
          ) || shuffledExercises[0]; // Fallback to first candidate
          
          exercise = replacement;
          correctedSlugs.push({
            original: item.exercise_slug,
            corrected: replacement.slug,
          });
          console.warn(`[aiService] LLM returned unknown slug: ${item.exercise_slug}, replacing with: ${replacement.slug}`);
        } else {
          continue; // Skip if no candidates available
        }
      }

      mappedPlan.push({
        exercise_id: exercise.id,
        exercise_slug: exercise.slug, // Use actual exercise slug, not LLM's
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

    // Загружаем видео для всех упражнений одним запросом
    const exerciseIds = mappedPlan.map(ex => ex.exercise_id);
    let videoMap = new Map();
    
    if (exerciseIds.length > 0) {
      const { data: videos, error: videosError } = await supabaseAdmin
        .from("exercise_videos")
        .select("exercise_id, video_url, thumbnail_url, variant, language")
        .in("exercise_id", exerciseIds);

      if (!videosError && videos && videos.length > 0) {
        // Группируем видео по exercise_id
        const videosByExercise = new Map();
        videos.forEach(video => {
          if (!videosByExercise.has(video.exercise_id)) {
            videosByExercise.set(video.exercise_id, []);
          }
          videosByExercise.get(video.exercise_id).push(video);
        });

        // Для каждого упражнения выбираем предпочтительное видео
        videosByExercise.forEach((exerciseVideos, exerciseId) => {
          // Ищем предпочтительно default/en, затем default, затем любое
          const preferredVideo =
            exerciseVideos.find((v) => v.variant === "default" && v.language === "en") ||
            exerciseVideos.find((v) => v.variant === "default") ||
            exerciseVideos[0];

          if (preferredVideo && preferredVideo.thumbnail_url) {
            videoMap.set(exerciseId, preferredVideo.thumbnail_url);
          }
        });
      }
    }

    // Добавляем video_thumbnail_url к каждому упражнению
    mappedPlan = mappedPlan.map(ex => ({
      ...ex,
      video_thumbnail_url: videoMap.get(ex.exercise_id) || null,
    }));

    if (missingSlugs.length > 0) {
      console.warn(`[aiService] Missing exercises for slugs: ${missingSlugs.join(", ")}`);
    }
    
    if (correctedSlugs.length > 0) {
      console.warn(`[aiService] Corrected ${correctedSlugs.length} invalid exercise slugs from LLM response`);
      // Log corrections to ai_logs
      try {
        await logAIRequest(
          userId || null,
          "onboarding_validation",
          {
            type: "llm_exercise_validation",
            invalid_slugs: missingSlugs,
            corrections: correctedSlugs,
            total_plan_items: plan.length,
            valid_items: mappedPlan.length,
          },
          {
            action: "validated_and_corrected_llm_exercise_slugs",
            success: true,
          }
        );
      } catch (logError) {
        console.error(`[aiService] Failed to log LLM validation:`, logError);
      }
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

    // 9. Проверяем существование пользователя перед созданием тренировки
    console.log(`[aiService] Creating workout for userId: ${userId}`);
    if (userId) {
      console.log(`[aiService] Validating user existence for userId: ${userId}`);
      const { data: user, error: userError } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("id", userId)
        .single();

      if (userError || !user) {
        console.warn(`[aiService] User ${userId} not found in users table, returning plan without saving`);
        // Возвращаем план без сохранения в БД
        return {
          data: {
            plan: mappedPlan,
            meta: meta,
            workoutId: null,
          },
          error: null,
        };
      } else {
        console.log(`[aiService] User ${userId} validated, proceeding with workout creation`);
      }
    } else {
      console.warn(`[aiService] No userId provided, returning plan without saving`);
      // Возвращаем план без сохранения в БД, если userId не передан
      return {
        data: {
          plan: mappedPlan,
          meta: meta,
          workoutId: null,
        },
        error: null,
      };
    }

    // 10. Проверка на первую тренировку пользователя и формирование названия
    let workoutName = meta.title || `AI ${level} ${workoutType}`;
    
    // Проверяем, есть ли у пользователя уже тренировки
    if (userId) {
      const { data: existingWorkouts, error: workoutsCheckError } = await supabaseAdmin
        .from("workouts")
        .select("id")
        .eq("user_id", userId)
        .limit(1);
      
      if (!workoutsCheckError && existingWorkouts) {
        if (existingWorkouts.length === 0) {
          // Это первая тренировка пользователя
          workoutName = "Ваша первая тренировка";
          console.log(`[aiService] First workout for user ${userId}, setting name: "${workoutName}"`);
        } else {
          // Это не первая тренировка
          workoutName = "Следующая тренировка";
          console.log(`[aiService] Subsequent workout for user ${userId}, setting name: "${workoutName}"`);
        }
      }
    }
    
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

    // Теперь безопасно создаем тренировку
    const { data: workout, error: workoutError } = await supabaseAdmin
      .from("workouts")
      .insert([
        {
          user_id: userId,
          name: workoutName,
          date: workoutDate,
          notes: workoutNotes,
          duration_minutes: durationMinutes, // Сохраняем запланированную длительность
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

    // 13. Возвращаемое значение
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
        durationMinutes, // Возвращаем запланированную длительность
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
