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
      
      console.log(`[chatService] Handoff question triggered: ${currentSpeaker} -> ${routingResult.handoff_suggested_to}`);
      
      // Сохраняем pending_handoff в thread metadata
      await supabaseAdmin
        .from("chat_threads")
        .update({
          metadata: {
            ...threadMetadata,
            pending_handoff: {
              to: routingResult.handoff_suggested_to,
              from: currentSpeaker,
              reason: routingResult.reason,
            },
          },
        })
        .eq("id", resolvedThreadId);

      // Сохраняем handoff_question сообщение
      const { data: savedMessage } = await saveAssistantMessage(resolvedThreadId, userId, handoffPhrase, {
        message_type: "handoff_question",
        agent_role: currentSpeaker,
        agent_display_name: chatRouterService.AGENT_DISPLAY_NAMES[currentSpeaker] || currentSpeaker,
        handoff_suggested_to: routingResult.handoff_suggested_to,
        handoff_mode: "ask_confirm",
        routing_reason: routingResult.reason,
      });

      return {
        data: {
          threadId: resolvedThreadId,
          assistantMessage: {
            id: savedMessage?.id || `handoff-q-${Date.now()}`,
            content: handoffPhrase,
            metadata: {
              message_type: "handoff_question",
              agent_role: currentSpeaker,
              agent_display_name: chatRouterService.AGENT_DISPLAY_NAMES[currentSpeaker] || currentSpeaker,
              handoff_suggested_to: routingResult.handoff_suggested_to,
              handoff_mode: "ask_confirm",
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
      
      // Сохраняем все сообщения
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

      return {
        data: {
          threadId: resolvedThreadId,
          assistantMessages: assistantMessages, // Массив сообщений
          assistantMessage: assistantMessages[0], // Первое для обратной совместимости
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
    let messageType = "response"; // По умолчанию обычное сообщение

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
      finalAssistantText,
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

    return {
      data: {
        threadId: resolvedThreadId,
        assistantMessage: {
          id: assistantMessage.id || `msg-${Date.now()}`,
          content: assistantMessage.content || finalAssistantText,
          metadata: assistantMessage.metadata || metadata,
          created_at: assistantMessage.created_at || new Date().toISOString(),
        },
        workout: workoutId ? { id: workoutId } : null,
        routing: routing,
        ui_hints: ui_hints,
      },
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
};


