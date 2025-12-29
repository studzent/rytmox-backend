const { supabaseAdmin } = require("../utils/supabaseClient");
const openai = require("../utils/openaiClient");
const { getSystemPromptRu, buildChatUserPromptRu, getHandoffPhrase } = require("../prompts/chatPromptsRu");
const userProfileService = require("./userProfileService");
const userMetricsService = require("./userMetricsService");
const workoutService = require("./workoutService");
const aiService = require("./aiService");
const chatRouterService = require("./chatRouterService");
const crypto = require("crypto");

/**
 * Найти или создать thread для пользователя и режима
 * @param {string} userId - ID пользователя
 * @param {string} mode - Режим чата: 'team' | 'trainer' | 'doctor' | 'psychologist' | 'nutritionist'
 * @param {string|null} threadId - Опциональный threadId (если передан, проверяем принадлежность)
 * @returns {Promise<{data: string|null, error: object|null}>} threadId
 */
async function resolveThread(userId, mode, threadId = null) {
  try {
    // Если threadId передан, проверяем что он принадлежит userId
    if (threadId) {
      const { data: thread, error } = await supabaseAdmin
        .from("chat_threads")
        .select("id, user_id")
        .eq("id", threadId)
        .single();

      if (error) {
        return {
          data: null,
          error: {
            message: `Thread not found: ${error.message}`,
            code: "THREAD_NOT_FOUND",
          },
        };
      }

      if (thread.user_id !== userId) {
        return {
          data: null,
          error: {
            message: "Thread does not belong to user",
            code: "UNAUTHORIZED",
          },
        };
      }

      return { data: threadId, error: null };
    }

    // Ищем существующий thread по userId и mode
    const { data: existingThread, error: findError } = await supabaseAdmin
      .from("chat_threads")
      .select("id")
      .eq("user_id", userId)
      .eq("mode", mode)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError && findError.code !== "PGRST116") {
      return { data: null, error: findError };
    }

    if (existingThread) {
      return { data: existingThread.id, error: null };
    }

    // Создаём новый thread
    const newThreadId = crypto.randomUUID();
    const { data: newThread, error: createError } = await supabaseAdmin
      .from("chat_threads")
      .insert([
        {
          id: newThreadId,
          user_id: userId,
          mode: mode,
          title: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (createError) {
      return {
        data: null,
        error: {
          message: `Failed to create thread: ${createError.message}`,
          code: "DATABASE_ERROR",
        },
      };
    }

    return { data: newThreadId, error: null };
  } catch (err) {
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
 * Сохранить сообщение пользователя
 * @param {string} threadId - ID thread
 * @param {string} userId - ID пользователя
 * @param {string} content - Текст сообщения
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function saveUserMessage(threadId, userId, content) {
  try {
    const messageId = crypto.randomUUID();
    const { data, error } = await supabaseAdmin
      .from("chat_messages")
      .insert([
        {
          id: messageId,
          thread_id: threadId,
          user_id: userId,
          role: "user",
          content: content,
          metadata: {},
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (error) {
      return {
        data: null,
        error: {
          message: `Failed to save user message: ${error.message}`,
          code: "DATABASE_ERROR",
        },
      };
    }

    // Обновляем updated_at в thread
    await supabaseAdmin
      .from("chat_threads")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", threadId);

    return { data, error: null };
  } catch (err) {
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
 * Сохранить сообщение ассистента
 * @param {string} threadId - ID thread
 * @param {string} userId - ID пользователя
 * @param {string} content - Текст ответа
 * @param {object} metadata - Метаданные (speaker, intent, model, workout_id и т.д.)
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function saveAssistantMessage(threadId, userId, content, metadata) {
  try {
    const messageId = crypto.randomUUID();
    const { data, error } = await supabaseAdmin
      .from("chat_messages")
      .insert([
        {
          id: messageId,
          thread_id: threadId,
          user_id: userId,
          role: "assistant",
          content: content,
          metadata: metadata || {},
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (error) {
      return {
        data: null,
        error: {
          message: `Failed to save assistant message: ${error.message}`,
          code: "DATABASE_ERROR",
        },
      };
    }

    // Обновляем updated_at в thread
    await supabaseAdmin
      .from("chat_threads")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", threadId);

    return { data, error: null };
  } catch (err) {
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
 * Получить историю сообщений thread
 * @param {string} threadId - ID thread
 * @param {number} limit - Лимит сообщений (по умолчанию 50)
 * @returns {Promise<{data: array|null, error: object|null}>}
 */
async function getThreadMessages(threadId, limit = 50) {
  try {
    const { data, error } = await supabaseAdmin
      .from("chat_messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) {
      return {
        data: null,
        error: {
          message: `Failed to load messages: ${error.message}`,
          code: "DATABASE_ERROR",
        },
      };
    }

    return { data: data || [], error: null };
  } catch (err) {
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
 * Собрать контекст пользователя для чата
 * @param {string} userId - ID пользователя
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function buildChatContext(userId) {
  try {
    // Загружаем профиль
    const { data: profile, error: profileError } = await userProfileService.getUserProfile(userId);
    if (profileError) {
      console.warn(`[buildChatContext] Failed to load profile:`, profileError.message);
    }

    // Загружаем последний вес
    const { data: latestWeight, error: weightError } = await userMetricsService.getLatestBodyMetric(userId);
    if (weightError) {
      console.warn(`[buildChatContext] Failed to load weight:`, weightError.message);
    }

    // Загружаем последние тренировки (1-3)
    const { data: recentSessions, error: sessionsError } = await workoutService.getUserWorkoutSessions(userId, {
      limit: 3,
    });
    if (sessionsError) {
      console.warn(`[buildChatContext] Failed to load workouts:`, sessionsError.message);
    }

    // Формируем краткий профиль
    let profileText = "";
    if (profile) {
      const parts = [];
      if (profile.level) parts.push(`Уровень: ${profile.level}`);
      if (profile.goal) parts.push(`Цель: ${profile.goal}`);
      if (profile.training_environment) {
        const env = profile.training_environment === "outdoor" ? "workout" : profile.training_environment;
        parts.push(`Окружение: ${env}`);
      }
      if (profile.equipment_items && profile.equipment_items.length > 0) {
        parts.push(`Оборудование: ${profile.equipment_items.join(", ")}`);
      }
      if (profile.contraindications && Object.keys(profile.contraindications).length > 0) {
        const active = Object.keys(profile.contraindications).filter(
          (k) => profile.contraindications[k] === true
        );
        if (active.length > 0) {
          parts.push(`Противопоказания: ${active.join(", ")}`);
        }
      }
      if (profile.emphasized_muscles && profile.emphasized_muscles.length > 0) {
        parts.push(`Акцентные мышцы: ${profile.emphasized_muscles.join(", ")}`);
      }
      if (profile.training_days_per_week) {
        parts.push(`Тренировок в неделю: ${profile.training_days_per_week}`);
      }
      profileText = parts.join("\n");
    }

    // Формируем информацию о последних тренировках
    let workoutsText = "";
    if (recentSessions && recentSessions.length > 0) {
      const sessions = recentSessions.slice(0, 3).map((s) => {
        const muscles = s.muscles && s.muscles.length > 0 ? s.muscles.join(", ") : "разные группы";
        return `- ${s.date}: ${muscles} (объем ~${s.totalVolumeEstimate} кг)`;
      });
      workoutsText = sessions.join("\n");
    }

    // Добавляем вес
    if (latestWeight && latestWeight.weight_kg) {
      if (profileText) profileText += `\nВес: ${latestWeight.weight_kg} кг`;
      else profileText = `Вес: ${latestWeight.weight_kg} кг`;
    }

    return {
      data: {
        profile: profileText,
        recentWorkouts: workoutsText,
        profileData: profile,
        weightKg: latestWeight?.weight_kg || null,
      },
      error: null,
    };
  } catch (err) {
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
 * Определить speaker для режима team
 * @param {string} text - Текст сообщения пользователя
 * @param {string} mode - Режим чата
 * @returns {string} speaker: 'team' | 'trainer' | 'doctor' | 'psychologist' | 'nutritionist'
 */
function determineSpeaker(text, mode) {
  // Если mode не team, speaker = mode
  if (mode !== "team") {
    return mode;
  }

  const lowerText = text.toLowerCase();

  // Эвристики для определения speaker
  // Медицинские вопросы -> doctor
  const medicalKeywords = [
    "боль",
    "травма",
    "симптом",
    "давление",
    "сердце",
    "голова",
    "онемение",
    "головокружение",
    "одышка",
    "болит",
    "болеет",
  ];
  if (medicalKeywords.some((kw) => lowerText.includes(kw))) {
    return "doctor";
  }

  // Питание -> nutritionist
  const nutritionKeywords = [
    "еда",
    "калории",
    "макросы",
    "бжу",
    "питание",
    "диета",
    "вода",
    "белок",
    "углеводы",
    "жиры",
    "рацион",
  ];
  if (nutritionKeywords.some((kw) => lowerText.includes(kw))) {
    return "nutritionist";
  }

  // Психология/мотивация -> psychologist
  const psychologyKeywords = [
    "мотивация",
    "лень",
    "устал",
    "выгорел",
    "не могу",
    "стресс",
    "пропустил",
    "пропустила",
    "пропуск",
    "лень",
    "не хочу",
    "сложно",
    "трудно",
  ];
  if (psychologyKeywords.some((kw) => lowerText.includes(kw))) {
    return "psychologist";
  }

  // Тренировки -> trainer
  const trainerKeywords = [
    "тренировка",
    "упражнение",
    "упражнения",
    "план",
    "заменить",
    "сеты",
    "повторы",
    "подходы",
    "сгенерируй",
    "сделай",
    "составь",
  ];
  if (trainerKeywords.some((kw) => lowerText.includes(kw))) {
    return "trainer";
  }

  // По умолчанию team
  return "team";
}

/**
 * Определить intent сообщения
 * @param {string} text - Текст сообщения пользователя
 * @returns {string} intent: 'chat' | 'generate_workout' | 'edit_workout'
 */
function determineIntent(text) {
  const lowerText = text.toLowerCase();

  // Генерация новой тренировки
  const generateKeywords = [
    "сгенерируй тренировку",
    "создай тренировку",
    "составь тренировку",
    "сделай тренировку",
    "сгенерируй план",
    "создай план",
    "составь план",
    "новая тренировка",
    "новый план",
  ];
  if (generateKeywords.some((kw) => lowerText.includes(kw))) {
    return "generate_workout";
  }

  // Редактирование тренировки
  const editKeywords = [
    "замени упражнение",
    "замени упражнения",
    "сделай легче",
    "сделай тяжелее",
    "убери нагрузку",
    "изменить тренировку",
    "изменить текущую",
    "изменить план",
    "обнови тренировку",
    "обнови план",
  ];
  if (editKeywords.some((kw) => lowerText.includes(kw))) {
    return "edit_workout";
  }

  return "chat";
}

/**
 * Отправить сообщение в чат и получить ответ от AI
 * @param {string} userId - ID пользователя
 * @param {string} mode - Режим чата: 'team' | 'trainer' | 'doctor' | 'psychologist' | 'nutritionist'
 * @param {string} text - Текст сообщения пользователя
 * @param {string|null} threadId - Опциональный threadId
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function sendChatMessage(userId, mode, text, threadId = null) {
  const functionStartTime = Date.now();
  console.log(`[chatService] 🚀 Starting sendChatMessage for userId: ${userId}, mode: ${mode}`);

  try {
    // Шаг 1: Resolve thread
    const { data: resolvedThreadId, error: threadError } = await resolveThread(userId, mode, threadId);
    if (threadError) {
      return { data: null, error: threadError };
    }

    // Шаг 2: Сохранить user message
    const { data: userMessage, error: userMsgError } = await saveUserMessage(resolvedThreadId, userId, text);
    if (userMsgError) {
      return { data: null, error: userMsgError };
    }

    // Шаг 3: Собрать контекст
    const { data: context, error: contextError } = await buildChatContext(userId);
    if (contextError) {
      console.warn(`[chatService] Failed to build context:`, contextError.message);
    }

    // Шаг 3.5: Получить метаданные thread для проверки pending_handoff
    let threadMetadata = null;
    try {
      const { data: threadData } = await supabaseAdmin
        .from("chat_threads")
        .select("metadata")
        .eq("id", resolvedThreadId)
        .single();
      threadMetadata = threadData?.metadata || null;
    } catch (err) {
      console.warn(`[chatService] Failed to load thread metadata:`, err.message);
    }

    // Шаг 4: Маршрутизация через router
    console.log(`[chatService] Calling router with mode=${mode}, text="${text.substring(0, 50)}"`);
    const routingResult = chatRouterService.routeMessage(text, mode, null, threadMetadata);
    console.log(`[chatService] Routing result:`, {
      selected_roles: routingResult.selected_roles,
      mode: routingResult.mode,
      handoff_suggested_to: routingResult.handoff_suggested_to,
      handoff_mode: routingResult.handoff_mode,
      safety_flags: routingResult.safety_flags,
    });

    // Обработка подтверждения/отказа handoff
    let actualMode = mode;
    if (routingResult.execute_handoff) {
      // Выполняем handoff
      const handoffTo = routingResult.handoff_to;
      const handoffNotice = `Подключился ${chatRouterService.AGENT_DISPLAY_NAMES[handoffTo]}`;

      // Сохраняем системное сообщение о handoff
      await saveAssistantMessage(resolvedThreadId, userId, handoffNotice, {
        message_type: "handoff_notice",
        agent_role: handoffTo,
        agent_display_name: chatRouterService.AGENT_DISPLAY_NAMES[handoffTo],
        handoff_from: mode,
        handoff_to: handoffTo,
      });

      // Очищаем pending_handoff и обновляем mode в thread
      await supabaseAdmin
        .from("chat_threads")
        .update({
          mode: handoffTo,
          metadata: { ...threadMetadata, pending_handoff: null },
        })
        .eq("id", resolvedThreadId);

      // Меняем mode для дальнейшего выполнения
      actualMode = handoffTo;
    } else if (routingResult.cancel_handoff) {
      // Отменяем handoff
      await supabaseAdmin
        .from("chat_threads")
        .update({ metadata: { ...threadMetadata, pending_handoff: null } })
        .eq("id", resolvedThreadId);
    }

    // Проверка handoff ДО вызова OpenAI
    if (routingResult.mode === 'handoff' && routingResult.handoff_suggested_to && routingResult.handoff_mode === 'ask_confirm') {
      // Не вызываем OpenAI, сразу возвращаем handoff_question
      const currentSpeaker = actualMode;
      const handoffPhrase = getHandoffPhrase(currentSpeaker, routingResult.handoff_suggested_to, routingResult.reason);
      
      console.log(`[chatService] Handoff offer triggered: ${currentSpeaker} -> ${routingResult.handoff_suggested_to}`);
      
      // Генерируем handoff_id для отслеживания
      const handoffId = crypto.randomUUID();
      
      // Сохраняем pending_handoff в thread metadata
      await supabaseAdmin
        .from("chat_threads")
        .update({
          metadata: {
            ...threadMetadata,
            pending_handoff: {
              id: handoffId,
              to: routingResult.handoff_suggested_to,
              from: currentSpeaker,
              reason: routingResult.reason,
              status: "pending",
              created_at: new Date().toISOString(),
            },
          },
        })
        .eq("id", resolvedThreadId);

      // Сохраняем handoff_offer сообщение
      const { data: savedMessage } = await saveAssistantMessage(resolvedThreadId, userId, handoffPhrase, {
        message_type: "handoff_offer",
        agent_role: currentSpeaker,
        agent_display_name: chatRouterService.AGENT_DISPLAY_NAMES[currentSpeaker] || currentSpeaker,
        handoff_suggested_to: routingResult.handoff_suggested_to,
        handoff_mode: "ask_confirm",
        handoff_id: handoffId,
        routing_reason: routingResult.reason,
      });

      return {
        data: {
          threadId: resolvedThreadId,
          assistantMessage: {
            id: savedMessage?.id || `handoff-offer-${Date.now()}`,
            content: handoffPhrase,
            metadata: {
              message_type: "handoff_offer",
              agent_role: currentSpeaker,
              agent_display_name: chatRouterService.AGENT_DISPLAY_NAMES[currentSpeaker] || currentSpeaker,
              handoff_suggested_to: routingResult.handoff_suggested_to,
              handoff_mode: "ask_confirm",
              handoff_id: handoffId,
              routing_reason: routingResult.reason,
            },
            created_at: savedMessage?.created_at || new Date().toISOString(),
          },
          routing: routingResult,
          ui_hints: {
            show_typing_as: `${chatRouterService.AGENT_DISPLAY_NAMES[currentSpeaker]} печатает...`,
            active_agent_badge: currentSpeaker,
            active_agent_name: chatRouterService.AGENT_DISPLAY_NAMES[currentSpeaker],
          },
        },
        error: null,
      };
    }

    // Определяем speaker на основе routing
    const selectedRole = routingResult.selected_roles[0];
    const speaker = selectedRole || determineSpeaker(text, actualMode);
    const intent = determineIntent(text);
    console.log(`[chatService] Selected speaker: ${speaker}, intent: ${intent}, actualMode: ${actualMode}`);

    // Шаг 5: Получить последние сообщения для контекста
    const { data: lastMessages, error: messagesError } = await getThreadMessages(resolvedThreadId, 15);
    if (messagesError) {
      console.warn(`[chatService] Failed to load last messages:`, messagesError.message);
    }

    // Формируем историю сообщений для промпта
    let messagesHistory = "";
    if (lastMessages && lastMessages.length > 0) {
      const historyLines = lastMessages
        .slice(-15) // Последние 15 сообщений
        .map((msg) => {
          const role = msg.role === "user" ? "Пользователь" : "Ассистент";
          return `${role}: ${msg.content}`;
        });
      messagesHistory = historyLines.join("\n");
    }

    // Шаг 6: Вызвать OpenAI (single или multi)
    let assistantMessages = [];
    
    // Multi-response: несколько специалистов отвечают одновременно
    if (routingResult.mode === "multi" && routingResult.selected_roles.length > 1) {
      console.log(`[chatService] Multi-response mode: ${routingResult.selected_roles.join(", ")}`);
      
      const userPrompt = buildChatUserPromptRu(
        {
          profile: context?.profile || "",
          recentWorkouts: context?.recentWorkouts || "",
          lastMessages: messagesHistory,
        },
        text
      );

      // Вызываем OpenAI для каждого специалиста параллельно
      const multiPromises = routingResult.selected_roles.map(async (role) => {
        const systemPrompt = getSystemPromptRu(role);
        try {
          const apiCall = openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            temperature: 0.7,
          });

          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
              reject(new Error("OpenAI API request timeout after 60 seconds"));
            }, 60000);
          });

          const completion = await Promise.race([apiCall, timeoutPromise]);
          return {
            role: role,
            text: completion.choices[0].message.content,
            success: true,
          };
        } catch (error) {
          console.error(`[chatService] Error calling OpenAI for ${role}:`, error);
          return {
            role: role,
            text: null,
            success: false,
            error: error.message,
          };
        }
      });

      const multiResults = await Promise.all(multiPromises);
      
      // Создаем handoff_notice для каждого специалиста перед их ответами
      const handoffNotices = [];
      for (const role of routingResult.selected_roles) {
        const handoffNotice = `Подключился ${chatRouterService.AGENT_DISPLAY_NAMES[role]}`;
        const { data: savedNotice } = await saveAssistantMessage(resolvedThreadId, userId, handoffNotice, {
          message_type: "handoff_notice",
          agent_role: role,
          agent_display_name: chatRouterService.AGENT_DISPLAY_NAMES[role],
          routing_reason: routingResult.reason,
        });
        
        if (savedNotice) {
          handoffNotices.push({
            id: savedNotice.id,
            content: savedNotice.content,
            metadata: savedNotice.metadata || {
              message_type: "handoff_notice",
              agent_role: role,
              agent_display_name: chatRouterService.AGENT_DISPLAY_NAMES[role],
            },
            created_at: savedNotice.created_at,
          });
        }
      }
      
      // Сохраняем все сообщения от специалистов
      for (const result of multiResults) {
        if (result.success && result.text) {
          const metadata = {
            mode: mode,
            speaker: result.role,
            intent: intent,
            model: "gpt-4o-mini",
            workout_id: null,
            ts: new Date().toISOString(),
            agent_role: result.role,
            agent_display_name: chatRouterService.AGENT_DISPLAY_NAMES[result.role] || result.role,
            routing_reason: routingResult.reason,
            confidence: routingResult.confidence || 0.8,
            safety_flags: routingResult.safety_flags || [],
            message_type: "response",
          };

          const { data: savedMessage } = await saveAssistantMessage(
            resolvedThreadId,
            userId,
            result.text,
            metadata
          );

          if (savedMessage) {
            assistantMessages.push({
              id: savedMessage.id,
              content: savedMessage.content,
              metadata: savedMessage.metadata || metadata,
              created_at: savedMessage.created_at,
            });
          }
        }
      }

      // Если хотя бы одно сообщение успешно, продолжаем
      if (assistantMessages.length === 0) {
        return {
          data: null,
          error: {
            message: "Failed to get responses from any specialist",
            code: "OPENAI_API_ERROR",
          },
        };
      }

      // Для multi-response возвращаем массив сообщений
      const routing = {
        selected_roles: routingResult.selected_roles,
        mode: routingResult.mode,
        safety_flags: routingResult.safety_flags || [],
        handoff_suggested_to: null,
        handoff_mode: null,
        require_user_confirmation: false,
        reason: routingResult.reason,
      };

      // Формируем список "печатает..." для каждого специалиста
      const typingIndicators = routingResult.selected_roles.map(role => 
        `${chatRouterService.AGENT_DISPLAY_NAMES[role]} печатает...`
      ).join(', ');

      // Объединяем handoff_notice и ответы специалистов в правильном порядке
      // Сначала все handoff_notice, потом все ответы
      const allMessages = [...handoffNotices, ...assistantMessages];
      
      return {
        data: {
          threadId: resolvedThreadId,
          assistantMessages: allMessages, // Массив сообщений (handoff_notice + ответы)
          assistantMessage: allMessages[0], // Первое для обратной совместимости
          workout: null,
          routing: routing,
          ui_hints: {
            show_typing_as: typingIndicators,
            active_agent_badge: routingResult.selected_roles[0],
            active_agent_name: chatRouterService.AGENT_DISPLAY_NAMES[routingResult.selected_roles[0]],
          },
        },
        error: null,
      };
    }

    // Single response: один специалист отвечает
    const systemPrompt = getSystemPromptRu(speaker);
    const userPrompt = buildChatUserPromptRu(
      {
        profile: context?.profile || "",
        recentWorkouts: context?.recentWorkouts || "",
        lastMessages: messagesHistory,
      },
      text
    );

    console.log(`[chatService] Calling OpenAI with model: gpt-4o-mini, speaker: ${speaker}`);
    const startTime = Date.now();

    let completion;
    try {
      const apiCall = openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
      });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error("OpenAI API request timeout after 60 seconds"));
        }, 60000);
      });

      completion = await Promise.race([apiCall, timeoutPromise]);
      const duration = Date.now() - startTime;
      console.log(`[chatService] ✅ OpenAI API call successful (${duration}ms)`);
    } catch (apiError) {
      console.error(`[chatService] ❌ OpenAI API error:`, apiError);
      return {
        data: null,
        error: {
          message: `OpenAI API error: ${apiError.message || "Unknown error"}`,
          code: "OPENAI_API_ERROR",
        },
      };
    }

    let assistantText = completion.choices[0].message.content;
    
    // Ограничение длины ответа AI для экономии токенов (максимум 2000 символов)
    const MAX_RESPONSE_LENGTH = 2000;
    if (assistantText && assistantText.length > MAX_RESPONSE_LENGTH) {
      assistantText = assistantText.substring(0, MAX_RESPONSE_LENGTH) + '...';
      console.log(`[chatService] ⚠️ Response truncated from ${completion.choices[0].message.content.length} to ${MAX_RESPONSE_LENGTH} characters`);
    }
    
    let messageType = "response"; // По умолчанию обычное сообщение

    // Шаг 6.5: Извлечение параметров профиля из сообщения пользователя
    try {
      const profileUpdates = await extractProfileUpdates(userId, text);
      if (profileUpdates && Object.keys(profileUpdates).length > 0) {
        console.log('[chatService] Extracted profile updates:', profileUpdates);
        // Обновляем профиль (автоматически пересчитаются калории)
        await userProfileService.upsertUserProfile(userId, profileUpdates);
        console.log('[chatService] Profile updated with extracted parameters');
      }
    } catch (extractError) {
      console.warn('[chatService] Failed to extract profile updates:', extractError.message);
      // Не прерываем выполнение, если извлечение не удалось
    }

    // Шаг 7: Обработка seamless handoff (handoff_question уже обработан выше)
    if (routingResult.handoff_mode === "seamless" && routingResult.selected_roles[0] !== mode) {
      // Seamless handoff - добавляем системное сообщение
      const handoffTo = routingResult.selected_roles[0];
      const handoffNotice = `Подключился ${chatRouterService.AGENT_DISPLAY_NAMES[handoffTo]}`;

      // Сохраняем системное сообщение о handoff
      await saveAssistantMessage(resolvedThreadId, userId, handoffNotice, {
        message_type: "handoff_notice",
        agent_role: handoffTo,
        agent_display_name: chatRouterService.AGENT_DISPLAY_NAMES[handoffTo],
        handoff_from: mode,
        handoff_to: handoffTo,
        routing_reason: routingResult.reason,
      });
    }

    // Шаг 8: Обработка intent (генерация/редактирование тренировки)
    let workoutId = null;
    if (intent === "generate_workout" || intent === "edit_workout") {
      console.log(`[chatService] Handling workout intent: ${intent}`);
      try {
        const profile = context?.profileData;
        const { data: workoutData, error: workoutError } = await aiService.generateWorkout({
          userId: userId,
          level: profile?.level || "beginner",
          equipment: profile?.equipment_items || [],
          goal: profile?.goal || "health",
          durationMinutes: 30,
          exercisesCount: 8,
          workoutType: "full_body",
          ignoreHistory: intent === "edit_workout", // При редактировании игнорируем историю для разнообразия
        });

        if (workoutError) {
          console.warn(`[chatService] Failed to generate workout:`, workoutError.message);
        } else if (workoutData && workoutData.workoutId) {
          workoutId = workoutData.workoutId;
          console.log(`[chatService] ✅ Generated workout: ${workoutId}`);
        }
      } catch (workoutErr) {
        console.error(`[chatService] Error generating workout:`, workoutErr);
        // Не прерываем выполнение, просто логируем
      }
    }

    // Шаг 9: Сохранить assistant message с расширенными metadata
    const metadata = {
      mode: mode,
      speaker: speaker,
      intent: intent,
      model: "gpt-4o-mini",
      workout_id: workoutId || null,
      ts: new Date().toISOString(),
      // Новые поля для routing
      agent_role: speaker,
      agent_display_name: chatRouterService.AGENT_DISPLAY_NAMES[speaker] || speaker,
      routing_reason: routingResult.reason,
      confidence: routingResult.confidence || 0.8,
      handoff_suggested_to: routingResult.handoff_suggested_to || null,
      handoff_mode: routingResult.handoff_mode || null,
      safety_flags: routingResult.safety_flags || [],
      message_type: messageType,
    };

    const { data: assistantMessage, error: assistantMsgError } = await saveAssistantMessage(
      resolvedThreadId,
      userId,
      assistantText,
      metadata
    );

    if (assistantMsgError) {
      return { data: null, error: assistantMsgError };
    }

    if (!assistantMessage) {
      return {
        data: null,
        error: {
          message: "Failed to save assistant message",
          code: "DATABASE_ERROR",
        },
      };
    }

    // Шаг 9: Логирование в ai_logs
    try {
      await aiService.logAIRequest(
        userId,
        "chat",
        {
          userId,
          mode,
          threadId: resolvedThreadId,
          speaker,
          intent,
          context_meta: {
            counts: {
              equipment: context?.profileData?.equipment_items?.length || 0,
              workouts: context?.recentWorkouts ? 1 : 0,
            },
            env: context?.profileData?.training_environment || null,
            equipmentCount: context?.profileData?.equipment_items?.length || 0,
          },
        },
        {
          assistantText: assistantText.substring(0, 500), // Ограничиваем длину для логов
          workout_id: workoutId,
        }
      );
    } catch (logError) {
      console.error(`[chatService] Failed to log to ai_logs:`, logError);
      // Не прерываем выполнение
    }

    // Шаг 9.5: Проверка на намерение обновить профиль
    let profileUpdateProposal = null;
    try {
      const profileData = context?.profileData || {};
      console.log(`[chatService] 🔍 Checking profile update intent for message: "${text.substring(0, 50)}"`);
      const intentResult = await detectProfileUpdateIntent(text, assistantText, profileData);
      
      if (intentResult) {
        console.log(`[chatService] 📊 Intent detection result:`, {
          changesCount: intentResult.changes?.length || 0,
          confidence: intentResult.confidence,
          source: intentResult.source
        });
      }
      
      if (intentResult && intentResult.changes && intentResult.changes.length > 0) {
        // Фильтруем изменения где toValue !== fromValue
        const validChanges = intentResult.changes.filter(change => {
          if (Array.isArray(change.fromValue) && Array.isArray(change.toValue)) {
            return JSON.stringify(change.fromValue.sort()) !== JSON.stringify(change.toValue.sort());
          }
          return change.fromValue !== change.toValue;
        });

        console.log(`[chatService] ✅ Valid changes after filtering: ${validChanges.length} out of ${intentResult.changes.length}`);

        // Показываем proposal только если confidence >= medium и есть валидные изменения
        if (validChanges.length > 0 && (intentResult.confidence === 'high' || intentResult.confidence === 'medium')) {
          const proposalId = crypto.randomUUID();
          const proposalText = "Сохранить изменения профиля?";
          
          console.log(`[chatService] 💾 Creating profile update proposal with ${validChanges.length} changes`);
          
          // Сохраняем proposal сообщение
          const { data: proposalMessage, error: proposalError } = await saveAssistantMessage(
            resolvedThreadId,
            userId,
            proposalText,
            {
              message_type: 'profile_update_proposal',
              profile_update_changes: validChanges,
              profile_update_proposal_id: proposalId,
              agent_role: speaker,
              agent_display_name: chatRouterService.AGENT_DISPLAY_NAMES[speaker] || speaker,
            }
          );

          if (!proposalError && proposalMessage) {
            profileUpdateProposal = {
              id: proposalMessage.id || proposalId,
              content: proposalText,
              metadata: proposalMessage.metadata || {
                message_type: 'profile_update_proposal',
                profile_update_changes: validChanges,
                profile_update_proposal_id: proposalId,
              },
              created_at: proposalMessage.created_at || new Date().toISOString(),
            };
            console.log(`[chatService] ✅ Created profile update proposal with ${validChanges.length} changes`);
          } else {
            console.error(`[chatService] ❌ Failed to save proposal message:`, proposalError);
          }
        } else {
          console.log(`[chatService] ⚠️ Proposal not created: confidence=${intentResult.confidence}, validChanges=${validChanges.length}`);
        }
      } else {
        console.log(`[chatService] ℹ️ No profile update intent detected`);
      }
    } catch (proposalError) {
      console.error(`[chatService] ❌ Error creating profile update proposal:`, proposalError);
      // Не прерываем выполнение, просто логируем
    }

    const totalDuration = Date.now() - functionStartTime;
    console.log(`[chatService] ✅ sendChatMessage completed successfully in ${totalDuration}ms`);

    // Формируем routing объект для ответа
    const routing = {
      selected_roles: routingResult.selected_roles,
      mode: routingResult.mode,
      safety_flags: routingResult.safety_flags || [],
      handoff_suggested_to: routingResult.handoff_suggested_to || null,
      handoff_mode: routingResult.handoff_mode || null,
      require_user_confirmation: routingResult.require_user_confirmation || false,
      reason: routingResult.reason,
    };

    // Формируем ui_hints
    const activeAgentRole = routingResult.selected_roles[0] || speaker;
    const ui_hints = {
      show_typing_as: `${chatRouterService.AGENT_DISPLAY_NAMES[activeAgentRole]} печатает...`,
      active_agent_badge: activeAgentRole,
      active_agent_name: chatRouterService.AGENT_DISPLAY_NAMES[activeAgentRole] || activeAgentRole,
    };

    // Формируем ответ с основным сообщением и proposal (если есть)
    const assistantMessages = [{
      id: assistantMessage.id || `msg-${Date.now()}`,
      content: assistantMessage.content || assistantText,
      metadata: assistantMessage.metadata || metadata,
      created_at: assistantMessage.created_at || new Date().toISOString(),
    }];

    // Добавляем proposal сообщение если есть
    if (profileUpdateProposal) {
      console.log(`[chatService] 📤 Adding profile update proposal to response`);
      assistantMessages.push(profileUpdateProposal);
    } else {
      console.log(`[chatService] ℹ️ No profile update proposal to add`);
    }

    const responseData = {
      threadId: resolvedThreadId,
      assistantMessage: assistantMessages[0], // Для обратной совместимости
      assistantMessages: assistantMessages.length > 1 ? assistantMessages : undefined, // Для multi-response
      workout: workoutId ? { id: workoutId } : null,
      routing: routing,
      ui_hints: ui_hints,
    };

    console.log(`[chatService] 📦 Response data:`, {
      hasAssistantMessage: !!responseData.assistantMessage,
      assistantMessagesCount: responseData.assistantMessages?.length || 0,
      hasProposal: !!profileUpdateProposal,
    });

    return {
      data: responseData,
      error: null,
    };
  } catch (err) {
    const totalDuration = Date.now() - functionStartTime;
    console.error(`[chatService] ❌ Error in sendChatMessage after ${totalDuration}ms:`, err);
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
 * Получить thread с историей сообщений
 * @param {string} threadId - ID thread
 * @param {number} limit - Лимит сообщений (по умолчанию 50)
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function getThread(threadId, limit = 50) {
  try {
    // Получаем thread
    const { data: thread, error: threadError } = await supabaseAdmin
      .from("chat_threads")
      .select("*")
      .eq("id", threadId)
      .single();

    if (threadError) {
      return {
        data: null,
        error: {
          message: `Thread not found: ${threadError.message}`,
          code: "THREAD_NOT_FOUND",
        },
      };
    }

    // Получаем сообщения
    const { data: messages, error: messagesError } = await getThreadMessages(threadId, limit);
    if (messagesError) {
      return { data: null, error: messagesError };
    }

    return {
      data: {
        thread: {
          id: thread.id,
          mode: thread.mode,
          title: thread.title,
          updated_at: thread.updated_at,
        },
        messages: messages.map((msg) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          metadata: msg.metadata || {},
          created_at: msg.created_at,
        })),
      },
      error: null,
    };
  } catch (err) {
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
 * Принять handoff на тренера
 * @param {string} userId - ID пользователя
 * @param {string} fromThreadId - ID исходного thread (откуда передают)
 * @param {string} fromRole - Роль специалиста, который передает
 * @param {string} lastUserMessage - Последнее сообщение пользователя
 * @param {string} handoffId - ID handoff
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function acceptHandoffToTrainer(userId, fromThreadId, fromRole, lastUserMessage, handoffId) {
  try {
    console.log(`[chatService] Accepting handoff to trainer: userId=${userId}, fromThreadId=${fromThreadId}, handoffId=${handoffId}`);
    
    // Получить/создать чат тренера
    const { data: trainerThreadId, error: threadError } = await resolveThread(userId, 'trainer', null);
    if (threadError) {
      return { data: null, error: threadError };
    }

    // Создать summary для handoff_request
    const fromRoleName = chatRouterService.AGENT_DISPLAY_NAMES[fromRole] || fromRole;
    const summary = `Пользователь спрашивает: "${lastUserMessage}". Передал ${fromRoleName}.`;

    // Сохранить сообщение в чате тренера с типом handoff_request
    const { data: handoffMessage, error: msgError } = await saveAssistantMessage(
      trainerThreadId,
      userId,
      summary,
      {
        message_type: "handoff_request",
        agent_role: "trainer",
        agent_display_name: "Тренер",
        from_role: fromRole,
        from_chat_id: fromThreadId,
        handoff_id: handoffId,
        last_user_message: lastUserMessage,
      }
    );

    if (msgError) {
      return { data: null, error: msgError };
    }

    // Обновить pending_handoff в исходном thread: status = 'accepted'
    let threadMetadata = null;
    try {
      const { data: threadData } = await supabaseAdmin
        .from("chat_threads")
        .select("metadata")
        .eq("id", fromThreadId)
        .single();
      threadMetadata = threadData?.metadata || null;
    } catch (err) {
      console.warn(`[chatService] Failed to load thread metadata:`, err.message);
    }

    if (threadMetadata?.pending_handoff) {
      await supabaseAdmin
        .from("chat_threads")
        .update({
          metadata: {
            ...threadMetadata,
            pending_handoff: {
              ...threadMetadata.pending_handoff,
              status: "accepted",
            },
          },
        })
        .eq("id", fromThreadId);
    }

    // Обновить unread_count в чате тренера
    let trainerThreadMetadata = null;
    try {
      const { data: trainerThreadData } = await supabaseAdmin
        .from("chat_threads")
        .select("metadata")
        .eq("id", trainerThreadId)
        .single();
      trainerThreadMetadata = trainerThreadData?.metadata || null;
    } catch (err) {
      console.warn(`[chatService] Failed to load trainer thread metadata:`, err.message);
    }

    const currentUnread = trainerThreadMetadata?.unread_count || 0;
    await supabaseAdmin
      .from("chat_threads")
      .update({
        metadata: {
          ...trainerThreadMetadata,
          unread_count: currentUnread + 1,
        },
      })
      .eq("id", trainerThreadId);

    console.log(`[chatService] ✅ Handoff accepted: trainerThreadId=${trainerThreadId}, handoffId=${handoffId}`);
    
    return {
      data: {
        ok: true,
        trainer_chat_id: trainerThreadId,
        handoff_id: handoffId,
      },
      error: null,
    };
  } catch (err) {
    console.error(`[chatService] ❌ Error accepting handoff:`, err);
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
 * Отменить handoff
 * @param {string} userId - ID пользователя
 * @param {string} threadId - ID thread
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function cancelHandoff(userId, threadId) {
  try {
    console.log(`[chatService] Canceling handoff: userId=${userId}, threadId=${threadId}`);
    
    // Получить метаданные thread
    let threadMetadata = null;
    try {
      const { data: threadData } = await supabaseAdmin
        .from("chat_threads")
        .select("metadata, user_id")
        .eq("id", threadId)
        .single();
      
      if (threadData.user_id !== userId) {
        return {
          data: null,
          error: {
            message: "Thread does not belong to user",
            code: "UNAUTHORIZED",
          },
        };
      }
      
      threadMetadata = threadData?.metadata || null;
    } catch (err) {
      return {
        data: null,
        error: {
          message: `Thread not found: ${err.message}`,
          code: "THREAD_NOT_FOUND",
        },
      };
    }

    // Обновить pending_handoff: status = 'canceled' или удалить
    if (threadMetadata?.pending_handoff) {
      await supabaseAdmin
        .from("chat_threads")
        .update({
          metadata: {
            ...threadMetadata,
            pending_handoff: {
              ...threadMetadata.pending_handoff,
              status: "canceled",
            },
          },
        })
        .eq("id", threadId);
    }

    console.log(`[chatService] ✅ Handoff canceled: threadId=${threadId}`);
    
    return {
      data: {
        ok: true,
      },
      error: null,
    };
  } catch (err) {
    console.error(`[chatService] ❌ Error canceling handoff:`, err);
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
 * Определение намерения обновить профиль из сообщения пользователя
 * Использует комбинированный подход: rule-based для прямых запросов + AI для контекстных
 * @param {string} userMessage - Текст сообщения пользователя
 * @param {string} aiResponse - Текст ответа AI (опционально)
 * @param {object} userProfile - Текущий профиль пользователя
 * @returns {Promise<{changes: Array, confidence: string, source: string}|null>}
 */
async function detectProfileUpdateIntent(userMessage, aiResponse, userProfile) {
  try {
    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
      return null;
    }

    const lowerText = userMessage.toLowerCase().trim();
    const changes = [];
    let confidence = 'low';
    let source = 'rule-based';

    // ========== ЭТАП 1: Rule-based (быстрая проверка прямых запросов) ==========
    
    // Training days per week - поддерживаем разные варианты:
    // "хочу 5 тренировок", "хочу тренироваться 5 дней", "сделай 5 дней в неделю", "5 тренировок"
    const daysPatterns = [
      /(?:хочу|сделай|поставь|установи|измени|смени|нужно|надо|мне)\s+(\d+)\s+(?:тренировок|тренировки|тренировку)/i, // "хочу 5 тренировок", "мне 5 тренировок"
      /(?:хочу|сделай|поставь|установи|измени|смени)\s*(?:тренироваться|тренировок|тренировки)?\s*(?:на\s*)?(\d+)\s*(?:дн|раз|дня|дней)?\s*(?:в\s*неделю|в\s*неделе)?/i, // "хочу тренироваться 5 дней"
      /(\d+)\s*(?:тренировок|тренировки|тренировку)\s*(?:в\s*неделю|в\s*неделе|на\s*неделю)/i, // "5 тренировок в неделю"
      /(\d+)\s*(?:тренировок|тренировки)/i, // Просто "5 тренировок" (если в контексте запроса)
    ];
    
    console.log(`[detectProfileUpdateIntent] Testing patterns for: "${lowerText}"`);
    for (let i = 0; i < daysPatterns.length; i++) {
      const pattern = daysPatterns[i];
      const daysMatch = lowerText.match(pattern);
      if (daysMatch) {
        console.log(`[detectProfileUpdateIntent] ✅ Pattern ${i + 1} matched:`, daysMatch[1]);
        const days = parseInt(daysMatch[1], 10);
        if (days >= 1 && days <= 7) {
          const currentDays = userProfile?.training_days_per_week || null;
          console.log(`[detectProfileUpdateIntent] Current days: ${currentDays}, New days: ${days}`);
          if (currentDays !== days) {
            changes.push({
              fieldKey: 'training_days_per_week',
              label: 'Дни тренировок в неделю',
              fromValue: currentDays,
              toValue: days,
              reason: `Пользователь хочет тренироваться ${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'} в неделю`
            });
            confidence = 'high';
            console.log(`[detectProfileUpdateIntent] ✅ Added change: ${currentDays} → ${days}`);
            break; // Нашли совпадение, выходим
          } else {
            console.log(`[detectProfileUpdateIntent] ⚠️ Days unchanged: ${currentDays} === ${days}`);
          }
        } else {
          console.log(`[detectProfileUpdateIntent] ⚠️ Invalid days value: ${days} (must be 1-7)`);
        }
      }
    }

    // Experience level
    const experiencePatterns = {
      'never': /(?:никогда|не\s*тренировался|не\s*занимался|начинаю\s*с\s*нуля)/i,
      'beginner': /(?:новичок|начинающий|только\s*начинаю|первый\s*раз)/i,
      'intermediate': /(?:средний|средний\s*уровень|промежуточный)/i,
      'advanced': /(?:продвинутый|опытный|профессионал)/i,
      'returning': /(?:возвращаюсь|после\s*перерыва|восстанавливаю)/i
    };
    for (const [exp, pattern] of Object.entries(experiencePatterns)) {
      if (pattern.test(lowerText)) {
        const levelMap = {
          'never': 'beginner',
          'beginner': 'beginner',
          'intermediate': 'intermediate',
          'advanced': 'advanced',
          'returning': 'intermediate'
        };
        const currentLevel = userProfile?.level || null;
        const newLevel = levelMap[exp];
        if (currentLevel !== newLevel) {
          changes.push({
            fieldKey: 'level',
            label: 'Опыт тренировок',
            fromValue: currentLevel,
            toValue: newLevel,
            reason: `Пользователь указал уровень: ${exp}`
          });
          confidence = 'high';
        }
        break;
      }
    }

    // Body focus zones
    const bodyFocusPatterns = {
      'core_abs': /(?:пресс|кор|живот|абдоминальные)/i,
      'glutes': /(?:ягодицы|попа)/i,
      'legs': /(?:ноги|бедра|квадрицепс)/i,
      'arms': /(?:руки|бицепс|трицепс)/i,
      'back_posture': /(?:спина|осанка|поясница)/i,
      'endurance': /(?:выносливость|кардио)/i
    };
    for (const [focus, pattern] of Object.entries(bodyFocusPatterns)) {
      if (/(?:фокус|хочу|качать|тренировать|работать)\s*(?:на|над)?/.test(lowerText) && pattern.test(lowerText)) {
        const currentFocus = userProfile?.body_focus_zones || [];
        if (!currentFocus.includes(focus)) {
          changes.push({
            fieldKey: 'body_focus_zones',
            label: 'Фокус на теле',
            fromValue: currentFocus,
            toValue: [...currentFocus, focus],
            reason: `Пользователь хочет добавить фокус на ${focus}`
          });
          confidence = confidence === 'low' ? 'medium' : confidence;
        }
        break;
      }
    }

    // Goals
    const goalPatterns = {
      'weight_loss': /(?:похудение|похудеть|сбросить\s*вес|сжигание\s*жира)/i,
      'muscle_gain': /(?:набор\s*массы|набрать\s*массу|нарастить\s*мышцы)/i,
      'strength_training': /(?:силовые|сила|стать\s*сильнее|силовой)/i,
      'energy': /(?:энергия|бодрость)/i,
      'health': /(?:здоровье|здоровый)/i,
      'flexibility': /(?:гибкость|растяжка)/i,
      'stress_relief': /(?:снятие\s*стресса|расслабление)/i
    };
    const foundGoals = [];
    for (const [goal, pattern] of Object.entries(goalPatterns)) {
      if (pattern.test(lowerText)) {
        foundGoals.push(goal);
      }
    }
    if (foundGoals.length > 0) {
      const currentGoals = userProfile?.goals || [];
      const newGoals = [...new Set([...currentGoals, ...foundGoals])];
      if (JSON.stringify(currentGoals.sort()) !== JSON.stringify(newGoals.sort())) {
        changes.push({
          fieldKey: 'goals',
          label: 'Цели тренировок',
          fromValue: currentGoals,
          toValue: newGoals,
          reason: `Пользователь хочет добавить цели: ${foundGoals.join(', ')}`
        });
        confidence = confidence === 'low' ? 'medium' : confidence;
      }
    }

    // Activity level
    const activityPatterns = {
      'sedentary': /(?:сидячий|мало\s*двигаюсь|сидячая\s*работа|сидячий\s*образ\s*жизни)/i,
      'light': /(?:лёгкая|немного\s*активности|1-3\s*тренировки|лёгкая\s*активность)/i,
      'moderate': /(?:умеренная|средняя|3-5\s*тренировок|умеренная\s*активность)/i,
      'high': /(?:высокая|много\s*активности|6-7\s*тренировок|высокая\s*активность)/i,
      'very_high': /(?:очень\s*высокая|очень\s*много|2\s*раза\s*в\s*день|очень\s*высокая\s*активность)/i
    };
    for (const [activity, pattern] of Object.entries(activityPatterns)) {
      if (pattern.test(lowerText)) {
        const currentActivity = userProfile?.activity_level || null;
        if (currentActivity !== activity) {
          changes.push({
            fieldKey: 'activity_level',
            label: 'Уровень активности',
            fromValue: currentActivity,
            toValue: activity,
            reason: `Пользователь указал уровень активности: ${activity}`
          });
          confidence = 'high';
        }
        break;
      }
    }

    // Special programs
    const specialProgramPatterns = {
      'back_relief': /(?:ослабление\s*спины|болит\s*спина|проблемы\s*со\s*спиной|здоровая\s*спина)/i,
      'healthy_joints': /(?:здоровые\s*суставы|суставы|проблемы\s*с\s*суставами)/i,
      'core_tone': /(?:тонус\s*пресса|пресс|кор)/i,
      'rehabilitation': /(?:восстановление\s*после\s*травмы|реабилитация|после\s*травмы)/i,
      'mobility': /(?:мобильность|гибкость|растяжка|подвижность)/i,
      'postpartum': /(?:после\s*беременности|послеродовое|после\s*родов)/i
    };
    const foundPrograms = [];
    for (const [program, pattern] of Object.entries(specialProgramPatterns)) {
      if (pattern.test(lowerText)) {
        foundPrograms.push(program);
      }
    }
    if (foundPrograms.length > 0) {
      const currentPrograms = userProfile?.restrictions?.specialPrograms || [];
      const newPrograms = [...new Set([...currentPrograms, ...foundPrograms])];
      if (JSON.stringify(currentPrograms.sort()) !== JSON.stringify(newPrograms.sort())) {
        changes.push({
          fieldKey: 'special_programs',
          label: 'Специальные программы',
          fromValue: currentPrograms,
          toValue: newPrograms,
          reason: `Пользователь хочет добавить программы: ${foundPrograms.join(', ')}`
        });
        confidence = confidence === 'low' ? 'medium' : confidence;
      }
    }

    // Contraindications
    const contraindicationPatterns = {
      'lower_back': /(?:болит\s*поясница|поясница|боль\s*в\s*пояснице|нижняя\s*спина)/i,
      'neck': /(?:болит\s*шея|шея|боль\s*в\s*шее)/i,
      'knees': /(?:болит\s*колени|колени|боль\s*в\s*коленях|колено)/i,
      'shoulders': /(?:болит\s*плечи|плечи|боль\s*в\s*плечах|плечо)/i,
      'elbows_wrists': /(?:болит\s*локти|локти|запястья|боль\s*в\s*локтях|боль\s*в\s*запястьях)/i,
      'ankles': /(?:болит\s*голеностоп|голеностоп|боль\s*в\s*голеностопе|лодыжки)/i,
      'shortness_of_breath': /(?:задыхаюсь|одышка|быстро\s*задыхаюсь|нехватка\s*воздуха)/i,
      'high_heart_rate': /(?:высокий\s*пульс|пульс|учащённый\s*пульс)/i,
      'dizziness_during_exercise': /(?:головокружение|кружится\s*голова)/i,
      'high_blood_pressure': /(?:высокое\s*давление|давление|гипертония)/i,
      'chronic_fatigue': /(?:хроническая\s*усталость|постоянная\s*усталость)/i,
      'poor_sleep': /(?:плохой\s*сон|недосып|проблемы\s*со\s*сном)/i,
      'high_stress': /(?:высокий\s*стресс|стресс|тревога|напряжение)/i,
      'low_energy': /(?:низкая\s*энергия|нет\s*сил|усталость)/i
    };
    const foundContraindications = [];
    for (const [contraindication, pattern] of Object.entries(contraindicationPatterns)) {
      if (pattern.test(lowerText)) {
        foundContraindications.push(contraindication);
      }
    }
    if (foundContraindications.length > 0) {
      const currentContraindications = Object.keys(userProfile?.contraindications || {}).filter(
        k => userProfile.contraindications[k] === true
      ) || [];
      const newContraindications = [...new Set([...currentContraindications, ...foundContraindications])];
      if (JSON.stringify(currentContraindications.sort()) !== JSON.stringify(newContraindications.sort())) {
        changes.push({
          fieldKey: 'contraindications',
          label: 'Противопоказания',
          fromValue: currentContraindications,
          toValue: newContraindications,
          reason: `Пользователь указал противопоказания: ${foundContraindications.join(', ')}`
        });
        confidence = confidence === 'low' ? 'medium' : confidence;
      }
    }

    // Emphasized muscles (акцентированные мышцы)
    const musclePatterns = {
      'chest': /(?:грудные|грудь|пекторальные)/i,
      'lats': /(?:широчайшие|спина|широчайшие\s*мышцы)/i,
      'traps': /(?:трапеции|трапеция)/i,
      'deltoids_front': /(?:передние\s*дельты|передняя\s*дельтовидная)/i,
      'deltoids_side': /(?:средние\s*дельты|средняя\s*дельтовидная)/i,
      'deltoids_rear': /(?:задние\s*дельты|задняя\s*дельтовидная)/i,
      'biceps': /(?:бицепс|бицепсы)/i,
      'triceps': /(?:трицепс|трицепсы)/i,
      'forearms': /(?:предплечья|предплечье)/i,
      'abs': /(?:прямая\s*мышца\s*живота|пресс)/i,
      'obliques': /(?:косые\s*мышцы|косые)/i,
      'deep_core': /(?:глубокий\s*кор|глубокие\s*мышцы\s*кора)/i,
      'glutes': /(?:ягодичные|ягодицы)/i,
      'quads': /(?:квадрицепсы|квадрицепс|передняя\s*поверхность\s*бедра)/i,
      'hamstrings': /(?:бицепс\s*бедра|задняя\s*поверхность\s*бедра)/i,
      'adductors': /(?:приводящие|внутренняя\s*поверхность\s*бедра)/i,
      'calves': /(?:икры|голень)/i
    };
    const foundMuscles = [];
    for (const [muscle, pattern] of Object.entries(musclePatterns)) {
      if (/(?:акцент|фокус|хочу|качать|тренировать|работать)\s*(?:на|над)?/.test(lowerText) && pattern.test(lowerText)) {
        foundMuscles.push(muscle);
      }
    }
    if (foundMuscles.length > 0) {
      const currentMuscles = userProfile?.emphasized_muscles || [];
      const newMuscles = [...new Set([...currentMuscles, ...foundMuscles])];
      // Ограничиваем до MAX_MUSCLES (4)
      const limitedMuscles = newMuscles.slice(0, 4);
      if (JSON.stringify(currentMuscles.sort()) !== JSON.stringify(limitedMuscles.sort())) {
        changes.push({
          fieldKey: 'emphasized_muscles',
          label: 'Акцентированные мышцы',
          fromValue: currentMuscles,
          toValue: limitedMuscles,
          reason: `Пользователь хочет добавить акцент на мышцы: ${foundMuscles.join(', ')}`
        });
        confidence = confidence === 'low' ? 'medium' : confidence;
      }
    }

    // Если rule-based дал результат с высокой уверенностью, возвращаем
    if (changes.length > 0 && confidence === 'high') {
      return { changes, confidence, source: 'rule-based' };
    }

    // ========== ЭТАП 2: AI-анализ (для контекстных запросов) ==========
    
    // Если rule-based не дал результата или confidence низкий, используем AI
    if (changes.length === 0 || confidence === 'low') {
      try {
        const currentProfile = {
          training_days_per_week: userProfile?.training_days_per_week || null,
          level: userProfile?.level || null,
          goals: userProfile?.goals || [],
          body_focus_zones: userProfile?.body_focus_zones || [],
          emphasized_muscles: userProfile?.emphasized_muscles || [],
          activity_level: userProfile?.activity_level || null,
          special_programs: userProfile?.restrictions?.specialPrograms || [],
          contraindications: Object.keys(userProfile?.contraindications || {}).filter(k => userProfile.contraindications[k] === true) || []
        };

        const prompt = `Ты - AI-ассистент в фитнес-приложении. Проанализируй сообщение пользователя и ответ AI, чтобы определить, хочет ли пользователь изменить настройки своего профиля тренировок.

ТЕКУЩИЕ НАСТРОЙКИ ПРОФИЛЯ:
- Дни тренировок в неделю: ${currentProfile.training_days_per_week || 'не указано'}
- Уровень опыта: ${currentProfile.level || 'не указано'} (beginner/intermediate/advanced)
- Цели: ${currentProfile.goals.join(', ') || 'не указано'} (weight_loss, muscle_gain, strength_training, energy, health, flexibility, stress_relief)
- Фокус на теле: ${currentProfile.body_focus_zones.join(', ') || 'не указано'} (core_abs, glutes, legs, arms, back_posture, endurance)
- Акцентированные мышцы: ${currentProfile.emphasized_muscles.join(', ') || 'не указано'} (chest, lats, traps, deltoids_front/side/rear, biceps, triceps, forearms, abs, obliques, deep_core, glutes, quads, hamstrings, adductors, calves)
- Уровень активности: ${currentProfile.activity_level || 'не указано'} (sedentary, light, moderate, high, very_high)
- Специальные программы: ${currentProfile.special_programs.join(', ') || 'не указано'} (back_relief, healthy_joints, core_tone, rehabilitation, mobility, postpartum)
- Противопоказания: ${currentProfile.contraindications.join(', ') || 'нет'} (lower_back, neck, knees, shoulders, elbows_wrists, ankles, shortness_of_breath, high_heart_rate, dizziness_during_exercise, high_blood_pressure, chronic_fatigue, poor_sleep, high_stress, low_energy)

СООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ: "${userMessage}"
${aiResponse ? `ОТВЕТ AI: "${aiResponse.substring(0, 500)}"` : ''}

Если пользователь хочет изменить настройки, верни ТОЛЬКО валидный JSON:

{
  "changes": [
    {
      "fieldKey": "training_days_per_week|level|goals|body_focus_zones|emphasized_muscles|activity_level|special_programs|contraindications",
      "label": "Человекочитаемое название поля",
      "fromValue": текущее значение,
      "toValue": новое значение,
      "reason": "Почему это изменение предложено"
    }
  ],
  "confidence": "high|medium|low"
}

ПРАВИЛА РАСПОЗНАВАНИЯ:
1. Дни тренировок: "больше тренировок" = увеличить на 1-2, "чаще" = увеличить дни, "меньше" = уменьшить
   - Если сейчас 3 дня и "больше" → 4-5 дней
   - Если сейчас 5 дней и "меньше" → 3-4 дня

2. Уровень опыта: "новичок" → beginner, "средний" → intermediate, "продвинутый" → advanced

3. Цели: "похудеть" → weight_loss, "набрать массу" → muscle_gain, "сила" → strength_training, "энергия" → energy, "здоровье" → health, "гибкость" → flexibility, "снятие стресса" → stress_relief
   - Добавляй к существующим, не заменяй (максимум 2 цели)

4. Фокус на теле: "фокус на пресс" → core_abs, "на руки" → arms, "на ноги" → legs, "на спину" → back_posture, "на ягодицы" → glutes, "выносливость" → endurance
   - Добавляй к существующим (максимум 3)

5. Акцентированные мышцы: "акцент на бицепс" → biceps, "на трицепс" → triceps, "на грудь" → chest, "на плечи" → deltoids_front/side/rear, "на квадрицепс" → quads
   - Добавляй к существующим (максимум 4)

6. Уровень активности: "сидячий" → sedentary, "лёгкая" → light, "умеренная" → moderate, "высокая" → high, "очень высокая" → very_high

7. Специальные программы: "мобильность" → mobility, "гибкость" → mobility, "спина" → back_relief, "суставы" → healthy_joints, "пресс" → core_tone, "реабилитация" → rehabilitation

8. Противопоказания: "болит поясница" → lower_back, "болит колено" → knees, "болит шея" → neck, "одышка" → shortness_of_breath, "высокий пульс" → high_heart_rate, "головокружение" → dizziness_during_exercise

ВАЖНО:
- Понимай относительные изменения ("больше", "чаще", "меньше")
- НЕ предлагай изменения, если новое значение совпадает с текущим
- Для массивов добавляй к существующим, не заменяй (с учетом лимитов)
- Если намерение неясно → верни: {"changes": [], "confidence": "low"}

Верни ТОЛЬКО JSON без дополнительного текста.`;

        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "Ты - AI-ассистент. Анализируешь намерения пользователя об изменении настроек профиля и возвращаешь только валидный JSON."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.3,
          response_format: { type: "json_object" }
        });

        const content = response.choices[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content);
          if (parsed.changes && Array.isArray(parsed.changes) && parsed.changes.length > 0) {
            // Фильтруем изменения где toValue !== fromValue
            const validChanges = parsed.changes.filter(change => {
              if (Array.isArray(change.fromValue) && Array.isArray(change.toValue)) {
                return JSON.stringify(change.fromValue.sort()) !== JSON.stringify(change.toValue.sort());
              }
              return change.fromValue !== change.toValue;
            });

            if (validChanges.length > 0) {
              return {
                changes: validChanges,
                confidence: parsed.confidence || 'medium',
                source: 'ai-analysis'
              };
            }
          }
        }
      } catch (aiError) {
        console.warn('[detectProfileUpdateIntent] AI analysis failed:', aiError.message);
        // Если AI анализ не удался, возвращаем rule-based результат если есть
        if (changes.length > 0) {
          return { changes, confidence: 'medium', source: 'rule-based' };
        }
      }
    }

    // Если есть изменения от rule-based, возвращаем их
    if (changes.length > 0) {
      return { changes, confidence, source: 'rule-based' };
    }

    return null;
  } catch (err) {
    console.error('[detectProfileUpdateIntent] Error:', err);
    return null;
  }
}

/**
 * Извлечение параметров профиля из сообщения пользователя через AI
 * @param {string} userId - ID пользователя
 * @param {string} messageText - Текст сообщения пользователя
 * @returns {Promise<object>} Объект с обновлениями профиля
 */
async function extractProfileUpdates(userId, messageText) {
  try {
    if (!messageText || typeof messageText !== 'string' || messageText.trim().length === 0) {
      return {};
    }

    const prompt = `Ты - AI-ассистент в фитнес-приложении. Если пользователь сообщает о своём весе, возрасте, уровне активности или целях, 
извлеки эти данные из сообщения и верни ТОЛЬКО валидный JSON без дополнительного текста:

{
  "updates": {
    "weight_kg": число (если упомянут вес, например "75 кг", "вешу 75"),
    "date_of_birth": "YYYY-MM-DD" (если упомянут возраст, рассчитай дату рождения на основе текущей даты),
    "activity_level": "sedentary|light|moderate|high|very_high" (если упомянута активность),
    "goals": ["weight_loss"|"muscle_gain"|"health"] (если упомянуты цели)
  }
}

Если данных нет в сообщении, верни: {"updates": {}}

Маппинг активности:
- "сидячий", "мало двигаюсь", "сидячая работа" → "sedentary"
- "лёгкая", "немного активности", "1-3 тренировки" → "light"
- "умеренная", "средняя", "3-5 тренировок" → "moderate"
- "высокая", "много активности", "6-7 тренировок" → "high"
- "очень высокая", "очень много", "2 раза в день" → "very_high"

Маппинг целей:
- "похудеть", "сбросить вес", "похудение" → ["weight_loss"]
- "набрать массу", "набрать вес", "набор массы" → ["muscle_gain"]
- "здоровье", "поддержание" → ["health"]

Сообщение пользователя: "${messageText.trim()}"`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Ты - AI-ассистент. Извлекаешь параметры профиля из сообщений пользователя и возвращаешь только валидный JSON.",
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
      return {};
    }

    const parsed = JSON.parse(content);
    const updates = parsed.updates || {};

    // Валидация и нормализация
    const result = {};
    
    if (updates.weight_kg && typeof updates.weight_kg === 'number' && updates.weight_kg > 0 && updates.weight_kg < 500) {
      result.weight_kg = updates.weight_kg;
    }
    
    if (updates.date_of_birth && typeof updates.date_of_birth === 'string') {
      // Проверяем формат даты
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (dateRegex.test(updates.date_of_birth)) {
        result.date_of_birth = updates.date_of_birth;
      }
    }
    
    const validActivityLevels = ['sedentary', 'light', 'moderate', 'high', 'very_high'];
    if (updates.activity_level && validActivityLevels.includes(updates.activity_level)) {
      result.activity_level = updates.activity_level;
    }
    
    if (updates.goals && Array.isArray(updates.goals) && updates.goals.length > 0) {
      const validGoals = ['weight_loss', 'fat_loss', 'muscle_gain', 'health'];
      const filteredGoals = updates.goals.filter(g => validGoals.includes(g));
      if (filteredGoals.length > 0) {
        result.goals = filteredGoals;
      }
    }

    return result;
  } catch (err) {
    console.error('[extractProfileUpdates] Error:', err);
    return {};
  }
}

module.exports = {
  resolveThread,
  saveUserMessage,
  saveAssistantMessage,
  getThreadMessages,
  buildChatContext,
  determineSpeaker,
  determineIntent,
  sendChatMessage,
  getThread,
  acceptHandoffToTrainer,
  cancelHandoff,
};


