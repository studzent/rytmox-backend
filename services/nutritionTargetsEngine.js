const { supabaseAdmin } = require("../utils/supabaseClient");
const nutritionService = require("./nutritionService");
const crypto = require("crypto");

/**
 * Конфигурация профилей целей (goal profiles)
 */
const GOAL_PROFILES = {
  lose_weight: {
    kcal_modifier: -0.15, // -15%
    protein_g_per_kg: { min: 2.0, max: 2.2 },
    fat_g_per_kg: { min: 0.8, max: 1.0 },
  },
  maintain: {
    kcal_modifier: 0, // 0%
    protein_g_per_kg: { min: 1.6, max: 2.0 },
    fat_g_per_kg: { min: 0.8, max: 1.0 },
  },
  gain_muscle: {
    kcal_modifier: 0.10, // +10%
    protein_g_per_kg: { min: 1.6, max: 2.0 },
    fat_g_per_kg: { min: 0.8, max: 1.0 },
  },
  recomposition: {
    kcal_modifier: 0, // 0%
    protein_g_per_kg: { min: 2.0, max: 2.0 },
    fat_g_per_kg: { min: 0.8, max: 1.0 },
  },
  performance: {
    kcal_modifier: 0.05, // +5%
    protein_g_per_kg: { min: 1.6, max: 1.8 },
    fat_g_per_kg: { min: 0.8, max: 1.0 },
  },
  healthy_habits: {
    kcal_modifier: 0, // 0%
    protein_g_per_kg: { min: 1.4, max: 1.8 },
    fat_g_per_kg: { min: 0.8, max: 1.0 },
  },
};

/**
 * Маппинг целей онбординга на goal_type
 */
function mapOnboardingGoalToGoalType(onboardingGoals) {
  if (!onboardingGoals || !Array.isArray(onboardingGoals) || onboardingGoals.length === 0) {
    return 'healthy_habits'; // По умолчанию
  }

  const primaryGoal = onboardingGoals[0];

  const goalMap = {
    weight_loss: 'lose_weight',
    fat_loss: 'lose_weight',
    muscle_gain: 'gain_muscle',
    strength_training: 'gain_muscle',
    health: 'healthy_habits',
    energy: 'maintain',
    flexibility: 'maintain',
    stress_relief: 'healthy_habits',
    performance: 'performance',
  };

  return goalMap[primaryGoal] || 'healthy_habits';
}

/**
 * Вычисление трендового веса (среднее за последние 7 дней, минимум 3 замера)
 * @param {string} userId - ID пользователя
 * @returns {Promise<{data: number|null, error: object|null}>}
 */
async function computeWeightBase(userId) {
  try {
    if (!userId) {
      return { data: null, error: { message: "userId is required", code: "VALIDATION_ERROR" } };
    }

    // Получаем замеры за последние 7 дней
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: measurements, error } = await supabaseAdmin
      .from("users_measurements")
      .select("weight_kg, measured_at")
      .eq("user_id", userId)
      .gte("measured_at", sevenDaysAgo.toISOString())
      .order("measured_at", { ascending: false });

    if (error) {
      console.error('[computeWeightBase] Error fetching measurements:', error);
      return { data: null, error };
    }

    if (!measurements || measurements.length === 0) {
      // Если нет замеров за 7 дней, берём последний вес
      const { data: latest, error: latestError } = await supabaseAdmin
        .from("users_measurements")
        .select("weight_kg")
        .eq("user_id", userId)
        .order("measured_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestError || !latest) {
        return { data: null, error: latestError || { message: "No weight measurements found", code: "NO_DATA" } };
      }

      return { data: parseFloat(latest.weight_kg), error: null };
    }

    // Если есть >=3 замера за 7 дней, используем среднее
    if (measurements.length >= 3) {
      const weights = measurements.map(m => parseFloat(m.weight_kg)).filter(w => !isNaN(w));
      const sum = weights.reduce((acc, w) => acc + w, 0);
      const avg = sum / weights.length;
      return { data: Math.round(avg * 100) / 100, error: null }; // Округляем до 2 знаков
    }

    // Если меньше 3 замеров, берём последний
    const lastWeight = parseFloat(measurements[0].weight_kg);
    return { data: lastWeight, error: null };
  } catch (err) {
    console.error('[computeWeightBase] Unexpected error:', err);
    return { data: null, error: { message: err.message || "Internal error", code: "INTERNAL_ERROR" } };
  }
}

/**
 * Вычисление хэша профиля для отслеживания изменений
 * @param {object} profile - Данные профиля
 * @returns {string} Хэш профиля
 */
function computeProfileHash(profile) {
  const keyFields = {
    gender: profile.gender || '',
    age: profile.age || profile.date_of_birth || '',
    height_cm: profile.height_cm || '',
    activity_level: profile.activity_level || '',
    goal_type: profile.goal_type || '',
    goals: Array.isArray(profile.goals) ? profile.goals.sort().join(',') : '',
  };

  const hashString = JSON.stringify(keyFields);
  return crypto.createHash('sha256').update(hashString).digest('hex').substring(0, 16);
}

/**
 * Расчёт целевых значений питания
 * @param {object} profile - Профиль пользователя
 * @param {number} weightBase - Трендовый вес в кг
 * @param {object} trainingStats - Статистика тренировок (опционально)
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function computeTargets(profile, weightBase, trainingStats = {}) {
  try {
    if (!profile || !weightBase || weightBase <= 0) {
      return {
        data: null,
        error: { message: "Invalid profile or weightBase", code: "VALIDATION_ERROR" },
      };
    }

    // Определяем goal_type из целей онбординга
    const goalType = mapOnboardingGoalToGoalType(profile.goals);
    const goalProfile = GOAL_PROFILES[goalType];

    if (!goalProfile) {
      return {
        data: null,
        error: { message: `Unknown goal_type: ${goalType}`, code: "INVALID_GOAL_TYPE" },
      };
    }

    // Вычисляем возраст
    const age = profile.age || nutritionService.calculateAge(profile.date_of_birth);
    if (!age || age < 14 || age > 100) {
      return {
        data: null,
        error: { message: "Invalid age", code: "INVALID_AGE" },
      };
    }

    // Расчёт BMR и TDEE
    const bmr = nutritionService.calculateBMR(
      weightBase,
      profile.height_cm,
      age,
      profile.gender
    );

    if (!bmr) {
      return {
        data: null,
        error: { message: "Failed to calculate BMR", code: "CALCULATION_ERROR" },
      };
    }

    const activityLevel = profile.activity_level || 'sedentary';
    const tdee = nutritionService.calculateTDEE(bmr, activityLevel);

    if (!tdee) {
      return {
        data: null,
        error: { message: "Failed to calculate TDEE", code: "CALCULATION_ERROR" },
      };
    }

    // Расчёт целевых калорий с учётом модификатора цели
    const targetKcal = Math.round(tdee * (1 + goalProfile.kcal_modifier));
    const roundedKcal = Math.round(targetKcal / 10) * 10; // Округляем до ближайших 10

    // Расчёт белка (г/кг веса)
    const proteinPerKg = (goalProfile.protein_g_per_kg.min + goalProfile.protein_g_per_kg.max) / 2;
    const targetProtein = Math.round(weightBase * proteinPerKg);

    // Расчёт жиров (минимум 0.8 г/кг)
    const fatPerKg = (goalProfile.fat_g_per_kg.min + goalProfile.fat_g_per_kg.max) / 2;
    const targetFat = Math.round(weightBase * fatPerKg);

    // Расчёт углеводов (остаток калорий)
    // Белок: 4 ккал/г, Жиры: 9 ккал/г, Углеводы: 4 ккал/г
    const proteinKcal = targetProtein * 4;
    const fatKcal = targetFat * 9;
    const remainingKcal = roundedKcal - proteinKcal - fatKcal;
    const targetCarbs = Math.max(0, Math.round(remainingKcal / 4));

    // Расчёт воды
    let waterBase = weightBase * 35; // 35 мл на кг веса

    // Надбавка при высокой активности
    if (activityLevel === 'high' || activityLevel === 'very_high') {
      waterBase += 500;
    }

    // Надбавка при >=3 тренировок в неделю
    const trainingDaysPerWeek = profile.training_days_per_week || trainingStats.trainingDaysPerWeek || 0;
    if (trainingDaysPerWeek >= 3) {
      waterBase += 300;
    }

    // Ограничения: min 1500, max 4500 мл
    const targetWater = Math.max(1500, Math.min(4500, Math.round(waterBase)));

    return {
      data: {
        target_kcal: roundedKcal,
        target_protein_g: targetProtein,
        target_fat_g: targetFat,
        target_carbs_g: targetCarbs,
        target_water_ml: targetWater,
        computed_from_weight_kg: weightBase,
        goal_type: goalType,
        activity_level: activityLevel,
        bmr: bmr,
        tdee: tdee,
      },
      error: null,
    };
  } catch (err) {
    console.error('[computeTargets] Unexpected error:', err);
    return {
      data: null,
      error: { message: err.message || "Internal error", code: "INTERNAL_ERROR" },
    };
  }
}

/**
 * Проверка необходимости пересчёта при изменении профиля
 * @param {string} oldHash - Старый хэш профиля
 * @param {string} newHash - Новый хэш профиля
 * @returns {boolean}
 */
function shouldRecalcByProfileChange(oldHash, newHash) {
  return oldHash !== newHash;
}

/**
 * Проверка необходимости пересчёта по расписанию (каждые 30 дней)
 * @param {object} targets - Текущие цели
 * @param {Date} now - Текущая дата
 * @returns {boolean}
 */
function shouldRecalcBySchedule(targets, now) {
  if (!targets || !targets.last_auto_recalc_at) {
    return true; // Если никогда не пересчитывали, нужно пересчитать
  }

  const lastRecalc = new Date(targets.last_auto_recalc_at);
  const daysSinceRecalc = (now - lastRecalc) / (1000 * 60 * 60 * 24);

  return daysSinceRecalc >= 30;
}

/**
 * Проверка необходимости пересчёта при изменении веса (>=5% и кулдаун 21 день)
 * @param {object} targets - Текущие цели
 * @param {number} weightBase - Текущий трендовый вес
 * @param {Date} now - Текущая дата
 * @returns {boolean}
 */
function shouldRecalcByWeightChange(targets, weightBase, now) {
  if (!targets || !targets.computed_from_weight_kg) {
    return true; // Если нет базового веса, нужно пересчитать
  }

  // Проверяем кулдаун (21 день)
  if (targets.last_auto_recalc_at) {
    const lastRecalc = new Date(targets.last_auto_recalc_at);
    const daysSinceRecalc = (now - lastRecalc) / (1000 * 60 * 60 * 24);
    if (daysSinceRecalc < 21) {
      return false; // Ещё не прошло 21 день
    }
  }

  // Проверяем изменение веса >=5%
  const weightChange = Math.abs(weightBase - targets.computed_from_weight_kg);
  const weightChangePercent = weightChange / targets.computed_from_weight_kg;

  return weightChangePercent >= 0.05; // >=5%
}

/**
 * Получение текущих целей питания
 * @param {string} userId - ID пользователя
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function getNutritionTargets(userId) {
  try {
    if (!userId) {
      return { data: null, error: { message: "userId is required", code: "VALIDATION_ERROR" } };
    }

    const { data, error } = await supabaseAdmin
      .from("user_nutrition_targets")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (error.code === 'PGRST116') {
        // Запись не найдена
        return { data: null, error: null };
      }
      return { data: null, error };
    }

    return { data, error: null };
  } catch (err) {
    console.error('[getNutritionTargets] Unexpected error:', err);
    return { data: null, error: { message: err.message || "Internal error", code: "INTERNAL_ERROR" } };
  }
}

/**
 * Пересчёт и сохранение целей питания
 * @param {string} userId - ID пользователя
 * @param {string} eventType - Тип события (init, profile_change, scheduled_recalc, weight_change_recalc)
 * @param {string} reason - Причина пересчёта
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function recalcAndPersist(userId, eventType, reason) {
  try {
    if (!userId) {
      return { data: null, error: { message: "userId is required", code: "VALIDATION_ERROR" } };
    }

    // Получаем профиль пользователя
    const userProfileService = require("./userProfileService");
    const { data: profile, error: profileError } = await userProfileService.getUserProfile(userId);

    if (profileError || !profile) {
      return {
        data: null,
        error: profileError || { message: "Profile not found", code: "PROFILE_NOT_FOUND" },
      };
    }

    // Вычисляем трендовый вес
    const { data: weightBase, error: weightError } = await computeWeightBase(userId);
    if (weightError || !weightBase) {
      return {
        data: null,
        error: weightError || { message: "Failed to compute weight base", code: "WEIGHT_ERROR" },
      };
    }

    // Вычисляем цели
    const { data: targets, error: targetsError } = await computeTargets(profile, weightBase);
    if (targetsError || !targets) {
      return {
        data: null,
        error: targetsError || { message: "Failed to compute targets", code: "CALCULATION_ERROR" },
      };
    }

    // Получаем текущие цели для сравнения
    const { data: currentTargets } = await getNutritionTargets(userId);

    // Проверяем порог изменения (минимум 80 ккал)
    if (currentTargets && currentTargets.target_kcal) {
      const kcalChange = Math.abs(targets.target_kcal - currentTargets.target_kcal);
      if (kcalChange < 80) {
        // Изменение слишком мало, не обновляем, но логируем событие
        console.log(`[recalcAndPersist] Change too small (${kcalChange} kcal), skipping update`);
        
        // Всё равно создаём событие для истории
        await supabaseAdmin.from("user_nutrition_target_events").insert({
          user_id: userId,
          event_type: eventType,
          old_targets: currentTargets,
          new_targets: targets,
          reason: `${reason} (change too small: ${kcalChange} kcal, not updated)`,
        });

        return {
          data: currentTargets,
          error: null,
        };
      }
    }

    // Вычисляем хэш профиля
    const profileHash = computeProfileHash({
      ...profile,
      goal_type: targets.goal_type,
    });

    // Сохраняем цели
    const now = new Date();
    const targetsData = {
      user_id: userId,
      target_kcal: targets.target_kcal,
      target_protein_g: targets.target_protein_g,
      target_fat_g: targets.target_fat_g,
      target_carbs_g: targets.target_carbs_g,
      target_water_ml: targets.target_water_ml,
      computed_from_weight_kg: targets.computed_from_weight_kg,
      goal_type: targets.goal_type,
      activity_level: targets.activity_level,
      updated_at: now.toISOString(),
      last_auto_recalc_at: eventType !== 'profile_change' ? now.toISOString() : currentTargets?.last_auto_recalc_at || now.toISOString(),
      last_profile_hash: profileHash,
    };

    // Если есть текущие цели, обновляем, иначе создаём
    let result;
    if (currentTargets) {
      // Обновляем все записи для пользователя (на случай дубликатов)
      const updateResult = await supabaseAdmin
        .from("user_nutrition_targets")
        .update(targetsData)
        .eq("user_id", userId)
        .select()
        .order("created_at", { ascending: false })
        .limit(1);
      
      if (updateResult.error) {
        result = updateResult;
      } else if (updateResult.data && updateResult.data.length > 0) {
        // Возвращаем последнюю обновлённую запись
        result = { data: updateResult.data[0], error: null };
      } else {
        result = { data: null, error: { message: "No records updated", code: "UPDATE_ERROR" } };
      }
    } else {
      result = await supabaseAdmin
        .from("user_nutrition_targets")
        .insert([{ ...targetsData, auto_update_enabled: true }])
        .select()
        .maybeSingle();
    }

    if (result.error) {
      return { data: null, error: result.error };
    }

    // Сохраняем событие в историю
    await supabaseAdmin.from("user_nutrition_target_events").insert({
      user_id: userId,
      event_type: eventType,
      old_targets: currentTargets || null,
      new_targets: result.data,
      reason: reason,
    });

    return { data: result.data, error: null };
  } catch (err) {
    console.error('[recalcAndPersist] Unexpected error:', err);
    return { data: null, error: { message: err.message || "Internal error", code: "INTERNAL_ERROR" } };
  }
}

/**
 * Проверка всех триггеров и пересчёт при необходимости
 * @param {string} userId - ID пользователя
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function maybeRecalcTargets(userId) {
  try {
    if (!userId) {
      return { data: null, error: { message: "userId is required", code: "VALIDATION_ERROR" } };
    }

    // Получаем текущие цели
    const { data: currentTargets, error: targetsError } = await getNutritionTargets(userId);
    if (targetsError) {
      return { data: null, error: targetsError };
    }

    // Если целей нет, создаём их
    if (!currentTargets) {
      console.log('[maybeRecalcTargets] No targets found, creating initial targets');
      return await recalcAndPersist(userId, 'init', 'Initial target calculation');
    }

    // Проверяем автообновление
    if (currentTargets.auto_update_enabled === false) {
      console.log('[maybeRecalcTargets] Auto-update disabled, skipping');
      return { data: currentTargets, error: null };
    }

    // Получаем профиль для проверки изменений
    const userProfileService = require("./userProfileService");
    const { data: profile, error: profileError } = await userProfileService.getUserProfile(userId);
    if (profileError || !profile) {
      return { data: currentTargets, error: null }; // Возвращаем текущие цели
    }

    const now = new Date();
    const profileHash = computeProfileHash({
      ...profile,
      goal_type: currentTargets.goal_type,
    });

    // Проверка 1: Изменение профиля
    if (shouldRecalcByProfileChange(currentTargets.last_profile_hash, profileHash)) {
      console.log('[maybeRecalcTargets] Profile changed, recalculating');
      const changedFields = [];
      if (profile.gender !== currentTargets.gender) changedFields.push('gender');
      if (profile.activity_level !== currentTargets.activity_level) changedFields.push('activity_level');
      // Можно добавить другие поля
      return await recalcAndPersist(
        userId,
        'profile_change',
        `Изменён профиль: ${changedFields.join(', ')}`
      );
    }

    // Проверка 2: Периодический пересчёт (30 дней)
    if (shouldRecalcBySchedule(currentTargets, now)) {
      console.log('[maybeRecalcTargets] Scheduled recalc (30 days), recalculating');
      return await recalcAndPersist(userId, 'scheduled_recalc', 'Периодический пересчёт (30 дней)');
    }

    // Проверка 3: Изменение веса >=5%
    const { data: weightBase } = await computeWeightBase(userId);
    if (weightBase && shouldRecalcByWeightChange(currentTargets, weightBase, now)) {
      console.log('[maybeRecalcTargets] Weight changed >=5%, recalculating');
      const weightChange = ((weightBase - currentTargets.computed_from_weight_kg) / currentTargets.computed_from_weight_kg * 100).toFixed(1);
      return await recalcAndPersist(
        userId,
        'weight_change_recalc',
        `Изменение веса ${weightChange > 0 ? '+' : ''}${weightChange}%`
      );
    }

    // Ничего не нужно пересчитывать
    return { data: currentTargets, error: null };
  } catch (err) {
    console.error('[maybeRecalcTargets] Unexpected error:', err);
    return { data: null, error: { message: err.message || "Internal error", code: "INTERNAL_ERROR" } };
  }
}

/**
 * Обновление настроек автообновления
 * @param {string} userId - ID пользователя
 * @param {boolean} enabled - Включить/выключить автообновление
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function setAutoUpdateEnabled(userId, enabled) {
  try {
    if (!userId) {
      return { data: null, error: { message: "userId is required", code: "VALIDATION_ERROR" } };
    }

    // Проверяем, есть ли цели
    const { data: currentTargets } = await getNutritionTargets(userId);
    if (!currentTargets) {
      return {
        data: null,
        error: { message: "Nutrition targets not found. Please calculate targets first.", code: "TARGETS_NOT_FOUND" },
      };
    }

    // Обновляем все записи для пользователя (на случай дубликатов)
    const updateResult = await supabaseAdmin
      .from("user_nutrition_targets")
      .update({ auto_update_enabled: enabled })
      .eq("user_id", userId)
      .select()
      .order("created_at", { ascending: false })
      .limit(1);

    if (updateResult.error) {
      return { data: null, error: updateResult.error };
    }

    if (updateResult.data && updateResult.data.length > 0) {
      // Возвращаем последнюю обновлённую запись
      return { data: updateResult.data[0], error: null };
    }

    return { data: null, error: { message: "No records updated", code: "UPDATE_ERROR" } };
  } catch (err) {
    console.error('[setAutoUpdateEnabled] Unexpected error:', err);
    return { data: null, error: { message: err.message || "Internal error", code: "INTERNAL_ERROR" } };
  }
}

/**
 * Получение истории изменений целей
 * @param {string} userId - ID пользователя
 * @param {number} limit - Лимит записей (по умолчанию 20)
 * @returns {Promise<{data: array|null, error: object|null}>}
 */
async function getTargetHistory(userId, limit = 20) {
  try {
    if (!userId) {
      return { data: null, error: { message: "userId is required", code: "VALIDATION_ERROR" } };
    }

    const { data, error } = await supabaseAdmin
      .from("user_nutrition_target_events")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return { data: null, error };
    }

    return { data: data || [], error: null };
  } catch (err) {
    console.error('[getTargetHistory] Unexpected error:', err);
    return { data: null, error: { message: err.message || "Internal error", code: "INTERNAL_ERROR" } };
  }
}

module.exports = {
  computeWeightBase,
  computeProfileHash,
  computeTargets,
  shouldRecalcByProfileChange,
  shouldRecalcBySchedule,
  shouldRecalcByWeightChange,
  recalcAndPersist,
  getNutritionTargets,
  maybeRecalcTargets,
  setAutoUpdateEnabled,
  getTargetHistory,
  mapOnboardingGoalToGoalType,
  GOAL_PROFILES,
};

