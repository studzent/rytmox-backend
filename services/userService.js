/**
 * ВАЖНО:
 * Видео упражнений живут в таблице exercise_videos и связаны по exercise_id.
 * Основное видео упражнения находится в поле exercises.video_url.
 * AI работает с упражнениями через slug в exercises.
 * Клиентские приложения сами выбирают нужный вариант видео.
 * Структура БД описана в docs/DB_SCHEMA.md и docs/EXERCISE_MEDIA.md.
 */

const { supabase, supabaseAdmin } = require("../utils/supabaseClient");

/**
 * Создание нового пользователя
 * @param {string} email - Email пользователя
 * @param {string} passwordHash - Хеш пароля
 * @param {object} profileData - Дополнительные данные профиля
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function createUser(email, passwordHash, profileData = {}) {
  try {
    const { data, error } = await supabaseAdmin
      .from("users")
      .insert([
        {
          email,
          password_hash: passwordHash,
          profile_data: profileData,
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
 * Поиск пользователя по email
 * @param {string} email - Email пользователя
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function getUserByEmail(email) {
  try {
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("email", email)
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
 * Получение пользователя по ID
 * @param {string} userId - ID пользователя
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function getUserById(userId) {
  try {
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", userId)
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
 * Обновление данных пользователя
 * @param {string} userId - ID пользователя
 * @param {object} updates - Объект с полями для обновления
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function updateUser(userId, updates) {
  try {
    const { data, error } = await supabaseAdmin
      .from("users")
      .update(updates)
      .eq("id", userId)
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
 * Получение тренировок пользователя
 * @param {string} userId - ID пользователя
 * @returns {Promise<{data: array|null, error: object|null}>}
 */
async function getUserWorkouts(userId) {
  try {
    const { data, error } = await supabase
      .from("workouts")
      .select("*")
      .eq("user_id", userId)
      .order("date", { ascending: false });

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

module.exports = {
  createUser,
  getUserByEmail,
  getUserById,
  updateUser,
  getUserWorkouts,
};
