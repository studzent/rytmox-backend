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

    const prompt = `Ты - AI-нутрициолог. Проанализируй описание еды и верни ТОЛЬКО валидный JSON без дополнительного текста:

{
  "title": "название блюда",
  "calories": число,
  "carbs": число (г),
  "protein": число (г),
  "fat": число (г),
  "serving_size": "примерный размер порции"
}

Описание еды: "${text.trim()}"

Верни только JSON объект.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Ты - AI-нутрициолог. Анализируешь описание еды и возвращаешь только валидный JSON с калориями и БЖУ.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

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

    const parsed = JSON.parse(content);
    
    // Валидация и нормализация данных
    const result = {
      title: parsed.title || text.trim(),
      calories: Math.round(parsed.calories || 0),
      carbs: parsed.carbs ? parseFloat(parsed.carbs) : null,
      protein: parsed.protein ? parseFloat(parsed.protein) : null,
      fat: parsed.fat ? parseFloat(parsed.fat) : null,
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

    const prompt = `Проанализируй фото еды. Определи блюдо, примерный размер порции и рассчитай калории и БЖУ. Верни ТОЛЬКО валидный JSON без дополнительного текста:

{
  "title": "название блюда",
  "calories": число,
  "carbs": число (г),
  "protein": число (г),
  "fat": число (г),
  "serving_size": "примерный размер порции"
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "Ты - AI-нутрициолог. Анализируешь фото еды и возвращаешь только валидный JSON с калориями и БЖУ.",
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
    const result = {
      title: parsed.title || "Неизвестное блюдо",
      calories: Math.round(parsed.calories || 0),
      carbs: parsed.carbs ? parseFloat(parsed.carbs) : null,
      protein: parsed.protein ? parseFloat(parsed.protein) : null,
      fat: parsed.fat ? parseFloat(parsed.fat) : null,
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

