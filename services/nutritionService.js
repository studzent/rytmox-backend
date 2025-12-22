const userProfileService = require("./userProfileService");
const openai = require("../utils/openaiClient");

/**
 * Расчёт возраста из даты рождения
 * @param {string} dateOfBirth - Дата рождения в формате ISO (YYYY-MM-DD)
 * @returns {number} Возраст в годах
 */
function calculateAge(dateOfBirth) {
  if (!dateOfBirth) return null;
  
  const birthDate = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  
  return age;
}

/**
 * Расчёт BMR (Basal Metabolic Rate) по формуле Mifflin-St Jeor
 * @param {number} weightKg - Вес в килограммах
 * @param {number} heightCm - Рост в сантиметрах
 * @param {number} age - Возраст в годах
 * @param {string} gender - Пол: 'male' или 'female'
 * @returns {number} BMR в ккал
 */
function calculateBMR(weightKg, heightCm, age, gender) {
  if (!weightKg || !heightCm || !age || !gender) {
    return null;
  }
  
  // Формула Mifflin-St Jeor: BMR = 10 × вес(кг) + 6.25 × рост(см) - 5 × возраст + коэффициент_пола
  const baseBMR = 10 * weightKg + 6.25 * heightCm - 5 * age;
  
  // Коэффициент пола
  const genderCoefficient = gender === 'male' ? 5 : -161;
  
  return Math.round(baseBMR + genderCoefficient);
}

/**
 * Расчёт TDEE (Total Daily Energy Expenditure) = BMR × коэффициент активности
 * @param {number} bmr - BMR в ккал
 * @param {string} activityLevel - Уровень активности: 'sedentary', 'light', 'moderate', 'high', 'very_high'
 * @returns {number} TDEE в ккал
 */
function calculateTDEE(bmr, activityLevel) {
  if (!bmr || !activityLevel) {
    return null;
  }
  
  const activityMultipliers = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    high: 1.725,
    very_high: 1.9,
  };
  
  const multiplier = activityMultipliers[activityLevel] || 1.2;
  return Math.round(bmr * multiplier);
}

/**
 * Расчёт целевых калорий с учётом целей (дефицит/профицит)
 * @param {number} tdee - TDEE в ккал
 * @param {string[]} goals - Массив целей: ['weight_loss', 'fat_loss', 'muscle_gain', 'health']
 * @returns {number} Целевые калории в ккал
 */
function calculateCalorieGoal(tdee, goals) {
  if (!tdee) {
    return null;
  }
  
  if (!goals || !Array.isArray(goals) || goals.length === 0) {
    return tdee; // Если целей нет, возвращаем TDEE
  }
  
  // Проверяем приоритет целей
  const hasWeightLoss = goals.some(g => g === 'weight_loss' || g === 'fat_loss');
  const hasMuscleGain = goals.some(g => g === 'muscle_gain');
  
  if (hasWeightLoss) {
    // Дефицит -500 ккал для похудения
    return Math.max(Math.round(tdee - 500), 1200); // Минимум 1200 ккал
  } else if (hasMuscleGain) {
    // Профицит +300-500 ккал для набора массы (используем среднее +400)
    return Math.round(tdee + 400);
  } else {
    // Для health и других целей - TDEE без изменений
    return tdee;
  }
}

/**
 * Пересчёт калорий на основе данных профиля
 * @param {string} userId - ID пользователя
 * @param {object} profileData - Данные профиля (частичные, могут быть не все поля)
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function recalculateCalories(userId, profileData = {}) {
  try {
    // Получить текущий профиль для недостающих данных
    const { data: currentProfile, error: profileError } = await userProfileService.getUserProfile(userId);
    
    if (profileError) {
      console.error('[recalculateCalories] Error getting user profile:', profileError);
      return { data: null, error: profileError };
    }
    
    // Извлечь данные для расчёта (приоритет у новых данных из profileData)
    const weight = profileData.weight_kg || currentProfile?.weight_kg;
    const height = profileData.height_cm || currentProfile?.height_cm;
    const dateOfBirth = profileData.date_of_birth || currentProfile?.date_of_birth;
    const gender = profileData.gender || currentProfile?.gender;
    const activityLevel = profileData.activity_level || currentProfile?.activity_level;
    const goals = profileData.goals || currentProfile?.goals;
    
    // Проверка наличия всех необходимых данных
    if (!weight || !height || !dateOfBirth || !gender || !activityLevel) {
      console.log('[recalculateCalories] Missing required data:', {
        hasWeight: !!weight,
        hasHeight: !!height,
        hasDateOfBirth: !!dateOfBirth,
        hasGender: !!gender,
        hasActivityLevel: !!activityLevel,
      });
      return {
        data: null,
        error: {
          message: "Missing required data for calorie calculation",
          code: "INSUFFICIENT_DATA",
        },
      };
    }
    
    // Расчёт возраста из date_of_birth
    const age = calculateAge(dateOfBirth);
    if (!age || age < 14 || age > 100) {
      return {
        data: null,
        error: {
          message: "Invalid age calculated from date of birth",
          code: "INVALID_AGE",
        },
      };
    }
    
    // Расчёт калорий
    const bmr = calculateBMR(weight, height, age, gender);
    if (!bmr) {
      return {
        data: null,
        error: {
          message: "Failed to calculate BMR",
          code: "CALCULATION_ERROR",
        },
      };
    }
    
    const tdee = calculateTDEE(bmr, activityLevel);
    if (!tdee) {
      return {
        data: null,
        error: {
          message: "Failed to calculate TDEE",
          code: "CALCULATION_ERROR",
        },
      };
    }
    
    const calorieGoal = calculateCalorieGoal(tdee, goals);
    
    console.log('[recalculateCalories] Calculated values:', {
      age,
      bmr,
      tdee,
      calorieGoal,
      activityLevel,
      goals,
    });
    
    return {
      data: {
        bmr: Math.round(bmr),
        tdee: Math.round(tdee),
        calorie_goal: calorieGoal,
      },
      error: null,
    };
  } catch (err) {
    console.error('[recalculateCalories] Unexpected error:', err);
    return {
      data: null,
      error: {
        message: err.message || "Failed to recalculate calories",
        code: "INTERNAL_ERROR",
      },
    };
  }
}

/**
 * Анализ еды из текстового описания через OpenAI
 * @param {string} text - Текстовое описание еды
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function analyzeFoodFromText(text) {
  try {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return {
        data: null,
        error: {
          message: "Text description is required",
          code: "VALIDATION_ERROR",
        },
      };
    }

    const prompt = `Ты - профессиональный AI-нутрициолог с экспертизой в анализе пищевых продуктов. Твоя задача - точно определить калорийность и БЖУ на основе описания еды.

ВАЖНО: Возвращай ошибку "error": "not_food" ТОЛЬКО если описание явно не является едой (например: "привет", "как дела", "машина", "книга"). 
Для ЛЮБЫХ продуктов, фруктов, овощей, блюд, напитков - ВСЕГДА возвращай валидный JSON с калориями и БЖУ, даже если описание короткое или неполное.
НЕ возвращай "название блюда" или "неизвестное блюдо" - это недопустимо.

КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:

1. РАЗМЕР ПОРЦИИ (обязательно учитывай):
   - "большая порция" / "большой" / "больше" = умножить стандартные калории на 1.8-2.2
   - "маленькая порция" / "маленький" / "мало" = умножить на 0.5-0.7
   - "средняя порция" = стандартные калории
   - "двойная порция" / "2 порции" = умножить на 2
   - "полпорции" / "половина" = умножить на 0.5

2. ВЕС И КОЛИЧЕСТВО (приоритет над размером порции):
   - Если указан вес (г, кг, мл, л) - рассчитывай пропорционально
   - Пример: "овсянка 300г" при стандарте 100г = умножить на 3
   - Если указано количество (2 яйца, 3 ложки) - учитывай это
   - Стандартные порции: яйцо = 50г, ложка = 15г, стакан = 200-250мл

3. СПОСОБ ПРИГОТОВЛЕНИЯ (влияет на калории):
   - Жареное = +20-30% калорий (масло)
   - Варёное / на пару = стандартные калории
   - Запечённое = +10-15% калорий
   - Сырое = стандартные калории

4. ДОБАВКИ И ИНГРЕДИЕНТЫ:
   - Масло (растительное, сливочное) = +90 ккал на 10г
   - Сахар = +40 ккал на 10г
   - Сметана = +20 ккал на 10г
   - Сыр = +30 ккал на 10г
   - Орехи = +60 ккал на 10г
   - Если упомянуты добавки - обязательно учитывай их калории

5. ОПЕЧАТКИ И НЕПОЛНЫЕ ОПИСАНИЯ:
   - "Овчянка" = "Овсянка" (исправляй опечатки)
   - "Каша" без уточнения = овсянка (самый частый вариант)
   - Если описание неполное - используй наиболее вероятный вариант
   - Короткие названия продуктов (банан, яблоко, курица) - это ВАЛИДНЫЕ описания еды, всегда возвращай калории
   - Для простых продуктов используй стандартные порции: фрукты ~100-150г, мясо ~100г, овощи ~100г

6. ВАЛИДАЦИЯ РАЗУМНЫХ ЗНАЧЕНИЙ:
   - Овсянка: 100-150 ккал на 100г (сухая), 50-80 ккал на 100г (варёная)
   - Яйцо: 70-80 ккал за штуку
   - Хлеб: 250-300 ккал на 100г
   - Если получается нереалистичное значение - пересчитай

7. ФОРМАТ ОТВЕТА:
   - calories: целое число (минимум 0, максимум 5000 для одной порции)
   - carbs, protein, fat: числа с 1-2 знаками после запятой (минимум 0)
   - title: нормализованное название (исправь опечатки, используй правильную форму)

ПРИМЕРЫ ПРАВИЛЬНОГО РАСЧЁТА:
- "Банан" → 90 ккал (1 средний банан ~120г)
- "Яблоко" → 52 ккал (1 среднее яблоко ~100г)
- "Куриная грудка" → 165 ккал (100г)
- "Овсянка" → 150 ккал (стандартная порция 100г сухой)
- "Овсянка большая порция" → 300 ккал (200г)
- "Овсянка маленькая порция" → 75 ккал (50г)
- "Овсянка 300г" → 450 ккал (300г сухой)
- "Овсянка варёная 200г" → 120 ккал (варёная менее калорийна)
- "Овсянка с маслом" → 150 + 90 = 240 ккал
- "2 яйца жареных" → 2 × 80 + 20% = 192 ккал
- "Рис" → 130 ккал (100г варёного риса)
- "Картошка" → 77 ккал (100г варёной)

Верни ТОЛЬКО валидный JSON без дополнительного текста:

{
  "title": "нормализованное название блюда (исправь опечатки)",
  "calories": число (рассчитано с учётом всех факторов),
  "carbs": число (г, с учётом размера порции),
  "protein": число (г, с учётом размера порции),
  "fat": число (г, с учётом размера порции),
  "serving_size": "примерный размер порции в граммах или стандартных единицах"
}

Описание еды: "${text.trim()}"

Верни только JSON объект, никаких комментариев.`;

    // Выбираем модель в зависимости от сложности запроса
    const isComplex = /\d+\s*(г|кг|мл|л)|большая|маленькая|двойная|полпорции/i.test(text);
    const model = isComplex ? "gpt-4o" : "gpt-4o-mini";

    const startTime = Date.now();
    let response;
    try {
      // Вызов OpenAI API с таймаутом через Promise.race
      const apiCall = openai.chat.completions.create({
        model: model,
        messages: [
          {
            role: "system",
            content: `Ты - профессиональный AI-нутрициолог с экспертизой в анализе пищевых продуктов.

Твоя задача - точно определить калорийность и БЖУ на основе описания еды.

КРИТИЧЕСКИ ВАЖНО:
1. Для ЛЮБЫХ продуктов, фруктов, овощей, блюд - ВСЕГДА возвращай валидный JSON, даже для коротких названий (банан, яблоко, курица)
2. Возвращай ошибку "not_food" ТОЛЬКО если описание явно не является едой (например: "привет", "машина")
3. Всегда учитывай размер порции (большая = ×2, маленькая = ×0.5)
4. Приоритет весу и количеству над описанием размера
5. Учитывай способ приготовления (жареное = +20-30% калорий)
6. Учитывай все добавки (масло, сахар, соусы)
7. Исправляй опечатки в названиях
8. Валидируй разумность значений

Возвращай ТОЛЬКО валидный JSON без дополнительного текста.`,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error("OpenAI API request timeout after 60 seconds"));
        }, 60000);
      });

      response = await Promise.race([apiCall, timeoutPromise]);

      const duration = Date.now() - startTime;
      console.log(`[analyzeFoodFromText] ✅ OpenAI API call successful (${duration}ms)`);
    } catch (apiError) {
      console.error(`[analyzeFoodFromText] ❌ OpenAI API error:`, apiError);
      console.error(`[analyzeFoodFromText] Error message:`, apiError.message);
      
      // Обработка различных типов ошибок
      if (apiError.message && apiError.message.includes("timeout")) {
        return {
          data: null,
          error: {
            message: "Запрос к AI превысил время ожидания. Попробуйте еще раз.",
            code: "TIMEOUT_ERROR",
          },
        };
      }
      
      if (apiError.message && apiError.message.includes("rate limit")) {
        return {
          data: null,
          error: {
            message: "Превышен лимит запросов к AI. Попробуйте позже.",
            code: "RATE_LIMIT_ERROR",
          },
        };
      }

      return {
        data: null,
        error: {
          message: `Ошибка AI: ${apiError.message || "Неизвестная ошибка"}`,
          code: "AI_ERROR",
        },
      };
    }

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return {
        data: null,
        error: {
          message: "No response from AI",
          code: "AI_ERROR",
        },
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      console.error('[analyzeFoodFromText] JSON parse error:', parseError, 'Content:', content);
      return {
        data: null,
        error: {
          message: "Failed to parse AI response",
          code: "PARSE_ERROR",
        },
      };
    }
    
    // Проверка на ошибку "не еда" - только если явно указано
    if (parsed.error === "not_food") {
      return {
        data: null,
        error: {
          message: "Описание не является описанием еды",
          code: "NOT_FOOD",
        },
      };
    }
    
    // Если есть другое поле error, это тоже ошибка
    if (parsed.error && parsed.error !== "not_food") {
      return {
        data: null,
        error: {
          message: parsed.error || "Описание не является описанием еды",
          code: "NOT_FOOD",
        },
      };
    }
    
    // Валидация и нормализация данных
    let calories = Math.round(parsed.calories || 0);
    
    // Проверка на невалидные названия
    const invalidTitles = ['название блюда', 'название', 'блюдо', 'неизвестное блюдо', 'unknown'];
    const title = (parsed.title || text.trim()).toLowerCase();
    if (invalidTitles.some(invalid => title.includes(invalid))) {
      return {
        data: null,
        error: {
          message: "Не удалось определить название блюда",
          code: "INVALID_TITLE",
        },
      };
    }
    
    // Валидация разумности значений
    if (calories < 0) {
      calories = 0;
    } else if (calories > 5000) {
      // Если больше 5000 ккал - вероятно ошибка, ограничиваем
      console.warn(`[analyzeFoodFromText] Unrealistic calories value: ${calories}, capping at 5000`);
      calories = 5000;
    }
    
    const result = {
      title: parsed.title || text.trim(),
      calories: calories,
      carbs: parsed.carbs ? Math.max(0, parseFloat(parsed.carbs)) : null,
      protein: parsed.protein ? Math.max(0, parseFloat(parsed.protein)) : null,
      fat: parsed.fat ? Math.max(0, parseFloat(parsed.fat)) : null,
      serving_size: parsed.serving_size || null,
    };

    return {
      data: result,
      error: null,
    };
  } catch (err) {
    console.error('[analyzeFoodFromText] Error:', err);
    return {
      data: null,
      error: {
        message: err.message || "Failed to analyze food from text",
        code: "ANALYSIS_ERROR",
      },
    };
  }
}

/**
 * Анализ еды из фото через OpenAI Vision
 * @param {string} imageBase64 - Base64 строка изображения
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function analyzeFoodFromImage(imageBase64) {
  try {
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return {
        data: null,
        error: {
          message: "Image base64 is required",
          code: "VALIDATION_ERROR",
        },
      };
    }

    // Убираем префикс data:image/...;base64, если есть
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    const prompt = `Проанализируй фото еды. Ты - профессиональный AI-нутрициолог.

КРИТИЧЕСКИ ВАЖНО:
1. Оцени размер порции на фото визуально (большая/средняя/маленькая)
2. Определи способ приготовления (жареное, варёное, сырое)
3. Учти все видимые добавки (масло, соусы, сыр, орехи)
4. Рассчитай калории с учётом размера порции:
   - Большая порция = стандартные калории × 1.8-2.2
   - Средняя порция = стандартные калории
   - Маленькая порция = стандартные калории × 0.5-0.7
5. Валидируй разумность значений

Верни ТОЛЬКО валидный JSON без дополнительного текста:

{
  "title": "название блюда",
  "calories": число (рассчитано с учётом размера порции на фото),
  "carbs": число (г, с учётом размера порции),
  "protein": число (г, с учётом размера порции),
  "fat": число (г, с учётом размера порции),
  "serving_size": "примерный размер порции в граммах или стандартных единицах"
}`;

    const startTime = Date.now();
    let response;
    try {
      const apiCall = openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `Ты - профессиональный AI-нутрициолог с экспертизой в анализе пищевых продуктов по фотографиям.

Твоя задача - точно определить калорийность и БЖУ на основе фото еды.

КРИТИЧЕСКИ ВАЖНО:
1. Визуально оцени размер порции (большая/средняя/маленькая) и учитывай при расчёте калорий
2. Определи способ приготовления (жареное = +20-30% калорий)
3. Учти все видимые добавки (масло, соусы, сыр, орехи)
4. Валидируй разумность значений

Возвращай ТОЛЬКО валидный JSON без дополнительного текста.`,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: prompt,
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64Data}`,
                },
              },
            ],
          },
        ],
        temperature: 0.3,
        max_tokens: 500,
      });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error("OpenAI API request timeout after 60 seconds"));
        }, 60000);
      });

      response = await Promise.race([apiCall, timeoutPromise]);

      const duration = Date.now() - startTime;
      console.log(`[analyzeFoodFromImage] ✅ OpenAI API call successful (${duration}ms)`);
    } catch (apiError) {
      console.error(`[analyzeFoodFromImage] ❌ OpenAI API error:`, apiError);
      console.error(`[analyzeFoodFromImage] Error message:`, apiError.message);
      
      // Обработка различных типов ошибок
      if (apiError.message && apiError.message.includes("timeout")) {
        return {
          data: null,
          error: {
            message: "Запрос к AI превысил время ожидания. Попробуйте еще раз.",
            code: "TIMEOUT_ERROR",
          },
        };
      }
      
      if (apiError.message && apiError.message.includes("rate limit")) {
        return {
          data: null,
          error: {
            message: "Превышен лимит запросов к AI. Попробуйте позже.",
            code: "RATE_LIMIT_ERROR",
          },
        };
      }

      return {
        data: null,
        error: {
          message: `Ошибка AI: ${apiError.message || "Неизвестная ошибка"}`,
          code: "AI_ERROR",
        },
      };
    }

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return {
        data: null,
        error: {
          message: "No response from AI",
          code: "AI_ERROR",
        },
      };
    }

    // Парсим JSON из ответа (может быть обёрнут в markdown код)
    let parsed;
    try {
      // Пытаемся найти JSON в ответе
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = JSON.parse(content);
      }
    } catch (parseErr) {
      console.error('[analyzeFoodFromImage] JSON parse error:', parseErr, 'Content:', content);
      return {
        data: null,
        error: {
          message: "Failed to parse AI response",
          code: "PARSE_ERROR",
        },
      };
    }

    // Валидация и нормализация данных
    let calories = Math.round(parsed.calories || 0);
    
    // Валидация разумности значений
    if (calories < 0) {
      calories = 0;
    } else if (calories > 5000) {
      // Если больше 5000 ккал - вероятно ошибка, ограничиваем
      console.warn(`[analyzeFoodFromImage] Unrealistic calories value: ${calories}, capping at 5000`);
      calories = 5000;
    }
    
    const result = {
      title: parsed.title || "Неизвестное блюдо",
      calories: calories,
      carbs: parsed.carbs ? Math.max(0, parseFloat(parsed.carbs)) : null,
      protein: parsed.protein ? Math.max(0, parseFloat(parsed.protein)) : null,
      fat: parsed.fat ? Math.max(0, parseFloat(parsed.fat)) : null,
      serving_size: parsed.serving_size || null,
    };

    return {
      data: result,
      error: null,
    };
  } catch (err) {
    console.error('[analyzeFoodFromImage] Error:', err);
    return {
      data: null,
      error: {
        message: err.message || "Failed to analyze food from image",
        code: "ANALYSIS_ERROR",
      },
    };
  }
}

module.exports = {
  calculateBMR,
  calculateTDEE,
  calculateCalorieGoal,
  calculateAge,
  recalculateCalories,
  analyzeFoodFromText,
  analyzeFoodFromImage,
};

