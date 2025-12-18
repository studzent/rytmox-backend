/**
 * Сервис маршрутизации сообщений между AI-специалистами
 * Определяет, кто должен отвечать, когда предлагать handoff, и как обрабатывать безопасность
 */

// Константы ролей
const AGENT_ROLES = {
  COORDINATOR: 'team',
  TRAINER: 'trainer',
  PSYCHOLOGIST: 'psychologist',
  DIETITIAN: 'nutritionist',
  DOCTOR: 'doctor',
};

// Отображаемые имена
const AGENT_DISPLAY_NAMES = {
  [AGENT_ROLES.COORDINATOR]: 'Команда',
  [AGENT_ROLES.TRAINER]: 'Тренер',
  [AGENT_ROLES.PSYCHOLOGIST]: 'Психолог',
  [AGENT_ROLES.DIETITIAN]: 'Диетолог',
  [AGENT_ROLES.DOCTOR]: 'Врач',
};

/**
 * Определить safety flags в сообщении
 * @param {string} text - Текст сообщения
 * @returns {string[]} Массив флагов безопасности
 */
function detectSafetyFlags(text) {
  const lowerText = text.toLowerCase();
  const flags = [];

  // Медицинские красные флаги
  const medicalRedFlags = [
    'боль в груди',
    'обморок',
    'обмороки',
    'сильная одышка',
    'онемение',
    'слабость',
    'резкая боль',
    'кровь',
    'кровотечение',
    'температура',
    'высокая температура',
    'лихорадка',
    'головокружение',
    'потеря сознания',
    'сердце болит',
    'сердцебиение',
    'аритмия',
  ];

  if (medicalRedFlags.some((flag) => lowerText.includes(flag))) {
    flags.push('medical_emergency');
  }

  // Риск травмы
  const injuryKeywords = [
    'травма',
    'ушиб',
    'растяжение',
    'вывих',
    'перелом',
    'боль в',
    'болит',
    'болеет',
    'восстановление после',
    'реабилитация',
    'после операции',
    'после травмы',
  ];

  if (injuryKeywords.some((kw) => lowerText.includes(kw))) {
    flags.push('injury_risk');
  }

  // Медицинские вопросы
  const medicalKeywords = [
    'симптом',
    'диагноз',
    'лекарство',
    'лекарства',
    'препарат',
    'таблетки',
    'лечение',
    'болезнь',
    'заболевание',
  ];

  if (medicalKeywords.some((kw) => lowerText.includes(kw))) {
    flags.push('medical_advice');
  }

  return flags;
}

/**
 * Определить, относится ли сообщение к тренировкам
 * @param {string} text - Текст сообщения
 * @returns {number} Confidence score (0-1)
 */
function detectTrainingIntent(text) {
  const lowerText = text.toLowerCase();
  let score = 0;

  const trainingKeywords = [
    'тренировка',
    'тренировки',
    'упражнение',
    'упражнения',
    'план тренировок',
    'программа тренировок',
    'техника',
    'как делать',
    'как выполнять',
    'подходы',
    'повторы',
    'сеты',
    'объем',
    'интенсивность',
    'прогрессия',
    'как качать',
    'как накачать',
    'восстановление после тренировки',
    'разминка',
    'заминка',
    'растяжка',
    'заменить упражнение',
    'альтернатива',
    'жим',
    'присед',
    'становая',
    'подтягивания',
    'отжимания',
  ];

  const matches = trainingKeywords.filter((kw) => lowerText.includes(kw)).length;
  score = Math.min(matches / 3, 1); // Нормализуем до 0-1

  return score;
}

/**
 * Определить, относится ли сообщение к питанию
 * @param {string} text - Текст сообщения
 * @returns {number} Confidence score (0-1)
 */
function detectNutritionIntent(text) {
  const lowerText = text.toLowerCase();
  let score = 0;

  const nutritionKeywords = [
    'питание',
    'еда',
    'калории',
    'калорий',
    'макросы',
    'бжу',
    'белок',
    'белки',
    'углеводы',
    'жиры',
    'диета',
    'рацион',
    'план питания',
    'дефицит',
    'профицит',
    'набрать вес',
    'похудеть',
    'сбросить вес',
    'набрать массу',
    'срывы',
    'сорвался',
    'сорвалась',
    'переедание',
    'голод',
  ];

  const matches = nutritionKeywords.filter((kw) => lowerText.includes(kw)).length;
  score = Math.min(matches / 3, 1);

  return score;
}

/**
 * Определить, относится ли сообщение к психологии/мотивации
 * @param {string} text - Текст сообщения
 * @returns {number} Confidence score (0-1)
 */
function detectPsychologyIntent(text) {
  const lowerText = text.toLowerCase();
  let score = 0;

  const psychologyKeywords = [
    'мотивация',
    'мотивации',
    'нет мотивации',
    'лень',
    'устал',
    'устала',
    'выгорел',
    'выгорела',
    'выгорание',
    'не могу',
    'не могу заставить',
    'не могу начать',
    'стресс',
    'тревога',
    'тревожность',
    'пропустил',
    'пропустила',
    'пропуск',
    'не хочу',
    'сложно',
    'трудно',
    'дисциплина',
    'привычка',
    'привычки',
    'самооценка',
    'стыд',
    'ненавижу себя',
    'самосаботаж',
    'прокрастинация',
    'выгорание',
  ];

  const matches = psychologyKeywords.filter((kw) => lowerText.includes(kw)).length;
  score = Math.min(matches / 3, 1);

  return score;
}

/**
 * Определить признаки РПП или эмоциональных проблем с едой
 * @param {string} text - Текст сообщения
 * @returns {boolean}
 */
function detectEatingDisorderSigns(text) {
  const lowerText = text.toLowerCase();

  const edKeywords = [
    'срывы',
    'сорвался',
    'сорвалась',
    'ненавижу себя',
    'стыд',
    'вина',
    'виноват',
    'виновата',
    'компульсии',
    'компульсивное',
    'запретная еда',
    'запрещенная еда',
    'срываюсь на сладкое',
    'не могу контролировать',
    'обжорство',
    'переедание',
    'рвота',
    'вызываю рвоту',
  ];

  return edKeywords.some((kw) => lowerText.includes(kw));
}

/**
 * Определить, является ли сообщение подтверждением handoff
 * @param {string} text - Текст сообщения
 * @returns {boolean}
 */
function detectHandoffConfirmation(text) {
  const lowerText = text.toLowerCase().trim();

  const confirmPhrases = [
    'да',
    'давай',
    'ок',
    'окей',
    'хорошо',
    'подключай',
    'подключи',
    'подключить',
    'согласен',
    'согласна',
    'угу',
    'ага',
    'да, подключи',
    'да, подключай',
    'да, подключить',
    'подключи тренера',
    'подключи психолога',
    'подключи диетолога',
    'подключи врача',
    'подключить тренера',
    'подключить психолога',
    'подключить диетолога',
    'подключить врача',
    'давай подключи',
    'давай подключай',
    'давай подключить',
  ];

  // Проверяем точное совпадение или начало фразы
  const exactMatch = confirmPhrases.some((phrase) => lowerText === phrase || lowerText.startsWith(phrase + ' '));
  
  // Также проверяем, содержит ли текст "подключ" + любое окончание
  const hasConnectKeyword = lowerText.includes('подключ');
  
  return exactMatch || hasConnectKeyword;
}

/**
 * Определить, является ли сообщение отказом от handoff
 * @param {string} text - Текст сообщения
 * @returns {boolean}
 */
function detectHandoffRejection(text) {
  const lowerText = text.toLowerCase().trim();

  const rejectPhrases = [
    'нет',
    'не надо',
    'не нужно',
    'не хочу',
    'потом',
    'не сейчас',
    'отмена',
    'отменить',
  ];

  return rejectPhrases.some((phrase) => lowerText === phrase || lowerText.startsWith(phrase + ' '));
}

/**
 * Основная функция маршрутизации
 * @param {string} text - Текст сообщения пользователя
 * @param {string} chatType - Тип чата: 'team' | 'trainer' | 'doctor' | 'psychologist' | 'nutritionist'
 * @param {string|null} currentRole - Текущая роль, которая отвечает (если есть)
 * @param {object|null} threadMetadata - Метаданные thread (для проверки pending_handoff)
 * @returns {object} routing_result
 */
function routeMessage(text, chatType, currentRole = null, threadMetadata = null) {
  const lowerText = text.toLowerCase();
  const safetyFlags = detectSafetyFlags(text);

  // Проверка на подтверждение/отказ handoff
  if (threadMetadata?.pending_handoff) {
    if (detectHandoffConfirmation(text)) {
      return {
        selected_roles: [threadMetadata.pending_handoff.to],
        mode: 'handoff',
        require_user_confirmation: false,
        reason: 'Подтверждение handoff от пользователя',
        safety_flags: [],
        handoff_suggested_to: null,
        handoff_mode: 'seamless',
        confidence: 1.0,
        execute_handoff: true,
        handoff_to: threadMetadata.pending_handoff.to,
      };
    } else if (detectHandoffRejection(text)) {
      return {
        selected_roles: [currentRole || chatType],
        mode: 'single',
        require_user_confirmation: false,
        reason: 'Отказ от handoff, продолжение текущим специалистом',
        safety_flags: [],
        handoff_suggested_to: null,
        handoff_mode: null,
        confidence: 1.0,
        execute_handoff: false,
        cancel_handoff: true,
      };
    }
  }

  // Правило A: Медицинские вопросы - приоритет DOCTOR
  if (safetyFlags.length > 0 || detectTrainingIntent(text) === 0 && detectNutritionIntent(text) === 0 && detectPsychologyIntent(text) === 0) {
    const hasMedicalFlags = safetyFlags.some((flag) => flag.includes('medical') || flag.includes('injury'));

    if (hasMedicalFlags || lowerText.includes('боль') || lowerText.includes('травма') || lowerText.includes('симптом')) {
      const roles = [AGENT_ROLES.DOCTOR];

      // Если в Team Chat и есть тренировочный контекст, можно добавить TRAINER вторым
      if (chatType === AGENT_ROLES.COORDINATOR && detectTrainingIntent(text) > 0.3) {
        roles.push(AGENT_ROLES.TRAINER);
        return {
          selected_roles: roles,
          mode: 'multi',
          require_user_confirmation: false,
          reason: 'Медицинский вопрос с тренировочным контекстом',
          safety_flags: safetyFlags,
          handoff_suggested_to: null,
          handoff_mode: null,
          confidence: 0.95,
        };
      }

      return {
        selected_roles: roles,
        mode: 'single',
        require_user_confirmation: chatType !== AGENT_ROLES.COORDINATOR && chatType !== AGENT_ROLES.DOCTOR,
        reason: 'Медицинский вопрос или симптомы',
        safety_flags: safetyFlags,
        handoff_suggested_to: null,
        handoff_mode: null,
        confidence: 0.95,
      };
    }
  }

  // Правило B: Тренировки
  const trainingScore = detectTrainingIntent(text);
  if (trainingScore > 0.4) {
    // Если пользователь в 1:1 чате с другим специалистом, предложить handoff
    if (chatType !== AGENT_ROLES.COORDINATOR && chatType !== AGENT_ROLES.TRAINER) {
      return {
        selected_roles: [chatType],
        mode: 'handoff',
        require_user_confirmation: true,
        reason: 'Вопрос про тренировки в чате другого специалиста',
        safety_flags: [],
        handoff_suggested_to: AGENT_ROLES.TRAINER,
        handoff_mode: 'ask_confirm',
        confidence: trainingScore,
      };
    }

    return {
      selected_roles: [AGENT_ROLES.TRAINER],
      mode: 'single',
      require_user_confirmation: false,
      reason: 'Вопрос про тренировки, технику или упражнения',
      safety_flags: safetyFlags,
      handoff_suggested_to: null,
      handoff_mode: null,
      confidence: trainingScore,
    };
  }

  // Правило C: Питание
  const nutritionScore = detectNutritionIntent(text);
  if (nutritionScore > 0.4) {
    const hasEDSigns = detectEatingDisorderSigns(text);
    const roles = [AGENT_ROLES.DIETITIAN];

    // Если есть признаки РПП/эмоциональных проблем, добавить PSYCHOLOGIST
    if (hasEDSigns) {
      if (chatType === AGENT_ROLES.COORDINATOR) {
        roles.push(AGENT_ROLES.PSYCHOLOGIST);
        return {
          selected_roles: roles,
          mode: 'multi',
          require_user_confirmation: false,
          reason: 'Вопрос про питание с признаками эмоциональных проблем',
          safety_flags: [],
          handoff_suggested_to: null,
          handoff_mode: null,
          confidence: nutritionScore,
        };
      } else if (chatType === AGENT_ROLES.DIETITIAN) {
        // В 1:1 с диетологом предложить handoff к психологу
        return {
          selected_roles: [AGENT_ROLES.DIETITIAN],
          mode: 'handoff',
          require_user_confirmation: true,
          reason: 'Признаки эмоциональных проблем с едой',
          safety_flags: [],
          handoff_suggested_to: AGENT_ROLES.PSYCHOLOGIST,
          handoff_mode: 'ask_confirm',
          confidence: nutritionScore,
        };
      }
    }

    // Если пользователь в 1:1 чате с другим специалистом, предложить handoff
    if (chatType !== AGENT_ROLES.COORDINATOR && chatType !== AGENT_ROLES.DIETITIAN) {
      return {
        selected_roles: [chatType],
        mode: 'handoff',
        require_user_confirmation: true,
        reason: 'Вопрос про питание в чате другого специалиста',
        safety_flags: [],
        handoff_suggested_to: AGENT_ROLES.DIETITIAN,
        handoff_mode: 'ask_confirm',
        confidence: nutritionScore,
      };
    }

    return {
      selected_roles: roles,
      mode: 'single',
      require_user_confirmation: false,
      reason: 'Вопрос про питание, калории, БЖУ',
      safety_flags: [],
      handoff_suggested_to: null,
      handoff_mode: null,
      confidence: nutritionScore,
    };
  }

  // Правило D: Психология/мотивация
  const psychologyScore = detectPsychologyIntent(text);
  if (psychologyScore > 0.4) {
    // Если внутри вопроса есть тренировочный контекст, предложить handoff к тренеру
    if (trainingScore > 0.2 && chatType === AGENT_ROLES.PSYCHOLOGIST) {
      return {
        selected_roles: [AGENT_ROLES.PSYCHOLOGIST],
        mode: 'handoff',
        require_user_confirmation: true,
        reason: 'Вопрос про мотивацию с тренировочным контекстом',
        safety_flags: [],
        handoff_suggested_to: AGENT_ROLES.TRAINER,
        handoff_mode: 'ask_confirm',
        confidence: psychologyScore,
      };
    }

    // Если пользователь в 1:1 чате с другим специалистом, предложить handoff
    if (chatType !== AGENT_ROLES.COORDINATOR && chatType !== AGENT_ROLES.PSYCHOLOGIST) {
      return {
        selected_roles: [chatType],
        mode: 'handoff',
        require_user_confirmation: true,
        reason: 'Вопрос про мотивацию/стресс в чате другого специалиста',
        safety_flags: [],
        handoff_suggested_to: AGENT_ROLES.PSYCHOLOGIST,
        handoff_mode: 'ask_confirm',
        confidence: psychologyScore,
      };
    }

    return {
      selected_roles: [AGENT_ROLES.PSYCHOLOGIST],
      mode: 'single',
      require_user_confirmation: false,
      reason: 'Вопрос про мотивацию, стресс, дисциплину',
      safety_flags: [],
      handoff_suggested_to: null,
      handoff_mode: null,
      confidence: psychologyScore,
    };
  }

  // Правило E: Team Chat (COORDINATOR)
  if (chatType === AGENT_ROLES.COORDINATOR) {
    // Координатор анализирует и решает сам или подключает специалиста
    // Если уверенность низкая по всем категориям, координатор отвечает сам
    const maxScore = Math.max(trainingScore, nutritionScore, psychologyScore);
    if (maxScore < 0.3) {
      return {
        selected_roles: [AGENT_ROLES.COORDINATOR],
        mode: 'single',
        require_user_confirmation: false,
        reason: 'Общий вопрос, координатор отвечает',
        safety_flags: safetyFlags,
        handoff_suggested_to: null,
        handoff_mode: null,
        confidence: 0.5,
      };
    }

    // Проверка комбинированных вопросов (тренировки + питание)
    if (trainingScore > 0.3 && nutritionScore > 0.3) {
      // Оба вопроса одновременно - multi-response
      return {
        selected_roles: [AGENT_ROLES.TRAINER, AGENT_ROLES.DIETITIAN],
        mode: 'multi',
        require_user_confirmation: false,
        reason: 'Вопрос про тренировки и питание одновременно',
        safety_flags: safetyFlags,
        handoff_suggested_to: null,
        handoff_mode: null,
        confidence: Math.max(trainingScore, nutritionScore),
      };
    }

    // Проверка тренировки + психология
    if (trainingScore > 0.3 && psychologyScore > 0.3) {
      return {
        selected_roles: [AGENT_ROLES.TRAINER, AGENT_ROLES.PSYCHOLOGIST],
        mode: 'multi',
        require_user_confirmation: false,
        reason: 'Вопрос про тренировки и мотивацию',
        safety_flags: safetyFlags,
        handoff_suggested_to: null,
        handoff_mode: null,
        confidence: Math.max(trainingScore, psychologyScore),
      };
    }

    // Иначе координатор подключает нужного специалиста
    if (trainingScore > nutritionScore && trainingScore > psychologyScore) {
      return {
        selected_roles: [AGENT_ROLES.TRAINER],
        mode: 'single',
        require_user_confirmation: false,
        reason: 'Координатор подключает тренера',
        safety_flags: safetyFlags,
        handoff_suggested_to: null,
        handoff_mode: 'seamless',
        confidence: trainingScore,
      };
    } else if (nutritionScore > psychologyScore) {
      return {
        selected_roles: [AGENT_ROLES.DIETITIAN],
        mode: 'single',
        require_user_confirmation: false,
        reason: 'Координатор подключает диетолога',
        safety_flags: safetyFlags,
        handoff_suggested_to: null,
        handoff_mode: 'seamless',
        confidence: nutritionScore,
      };
    } else {
      return {
        selected_roles: [AGENT_ROLES.PSYCHOLOGIST],
        mode: 'single',
        require_user_confirmation: false,
        reason: 'Координатор подключает психолога',
        safety_flags: safetyFlags,
        handoff_suggested_to: null,
        handoff_mode: 'seamless',
        confidence: psychologyScore,
      };
    }
  }

  // По умолчанию: текущий специалист отвечает
  return {
    selected_roles: [currentRole || chatType],
    mode: 'single',
    require_user_confirmation: false,
    reason: 'Вопрос в рамках компетенции текущего специалиста',
    safety_flags: safetyFlags,
    handoff_suggested_to: null,
    handoff_mode: null,
    confidence: 0.6,
  };
}

module.exports = {
  routeMessage,
  detectHandoffConfirmation,
  detectHandoffRejection,
  detectSafetyFlags,
  AGENT_ROLES,
  AGENT_DISPLAY_NAMES,
};

