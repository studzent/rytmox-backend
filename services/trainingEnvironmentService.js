const { supabaseAdmin } = require("../utils/supabaseClient");
const crypto = require("crypto");

function dbEnvFromApi(env) {
  if (!env) return null;
  if (env === "outdoor") return "workout";
  return env;
}

function apiEnvFromDb(env) {
  if (!env) return null;
  if (env === "workout") return "outdoor";
  return env;
}

/**
 * Получить список всех профилей пользователя с количеством тренажеров
 * @param {string} userId - ID пользователя
 * @returns {Promise<{data: array|null, error: object|null}>}
 */
async function listUserProfiles(userId) {
  try {
    if (!userId) {
      return {
        data: null,
        error: {
          message: "userId is required",
          code: "VALIDATION_ERROR",
        },
      };
    }

    // Получаем все связи пользователя с профилями
    const { data: userProfiles, error: userProfilesErr } = await supabaseAdmin
      .from("users_training_environment_profiles")
      .select(
        `
        training_environment_profile_id,
        active,
        added_at,
        training_environment_profiles (
          id,
          slug,
          name
        )
      `
      )
      .eq("user_id", userId)
      .order("added_at", { ascending: false });

    if (userProfilesErr) {
      return { data: null, error: userProfilesErr };
    }

    // Для каждого профиля получаем количество тренажеров
    const profilesWithEquipment = await Promise.all(
      (userProfiles || []).map(async (up) => {
        const profile = up.training_environment_profiles;
        if (!profile) return null;

        // Получаем тренажеры для этого профиля
        console.log(`[listUserProfiles] Loading equipment for profile ${profile.id} (${profile.name})`);
        const { data: equipment, error: equipErr } = await supabaseAdmin
          .from("training_environment_profile_equipment")
          .select("equipment_item_slug")
          .eq("training_environment_profile_id", profile.id);

        if (equipErr) {
          console.error(
            `[listUserProfiles] ❌ Failed to load equipment for profile ${profile.id}:`,
            {
              error: equipErr.message,
              code: equipErr.code,
              details: equipErr.details,
              hint: equipErr.hint,
              profileId: profile.id,
              profileName: profile.name,
            }
          );
        } else {
          const equipmentSlugs = (equipment || []).map((e) => e.equipment_item_slug).filter(Boolean);
          console.log(`[listUserProfiles] ✅ Loaded equipment for profile ${profile.id}:`, {
            profileId: profile.id,
            profileName: profile.name,
            profileSlug: profile.slug,
            rawEquipmentCount: equipment?.length || 0,
            equipmentSlugsCount: equipmentSlugs.length,
            equipmentSlugs: equipmentSlugs.slice(0, 10),
            equipmentSlugs_full: equipmentSlugs.length <= 20 ? equipmentSlugs : equipmentSlugs.slice(0, 20),
          });
        }

        // Маппим уникальный slug обратно в базовый slug для API
        // Если slug содержит подчеркивание (например, "gym_abc123"), извлекаем базовую часть
        const baseSlug = profile.slug.includes('_') 
          ? profile.slug.split('_')[0] 
          : profile.slug;
        
        const equipmentSlugs = (equipment || []).map((e) => e.equipment_item_slug).filter(Boolean);
        const result = {
          id: profile.id,
          name: profile.name,
          slug: baseSlug, // Возвращаем базовый slug для совместимости с API
          active: up.active,
          equipment_count: equipmentSlugs.length,
          equipment_slugs: equipmentSlugs,
        };
        
        console.log(`[listUserProfiles] 📦 Returning profile data:`, {
          id: result.id,
          name: result.name,
          slug: result.slug,
          active: result.active,
          equipment_count: result.equipment_count,
          equipment_slugs_count: result.equipment_slugs.length,
          equipment_slugs_sample: result.equipment_slugs.slice(0, 10),
        });
        
        return result;
      })
    );

    return {
      data: profilesWithEquipment.filter(Boolean),
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error: { message: err.message, code: "INTERNAL_ERROR" },
    };
  }
}

/**
 * Получить оборудование для профиля
 * @param {string} profileId - ID профиля
 * @returns {Promise<{data: array|null, error: object|null}>}
 */
async function getProfileEquipment(profileId) {
  try {
    if (!profileId) {
      return {
        data: null,
        error: {
          message: "profileId is required",
          code: "VALIDATION_ERROR",
        },
      };
    }

    const { data, error } = await supabaseAdmin
      .from("training_environment_profile_equipment")
      .select("equipment_item_slug")
      .eq("training_environment_profile_id", profileId);

    if (error) {
      return { data: null, error };
    }

    return {
      data: (data || []).map((e) => e.equipment_item_slug),
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error: { message: err.message, code: "INTERNAL_ERROR" },
    };
  }
}

/**
 * Создать новый профиль для пользователя
 * @param {string} userId - ID пользователя
 * @param {string} name - Название профиля
 * @param {string} slug - Slug окружения (home, gym, workout)
 * @param {string[]} equipmentSlugs - Массив slug-ов тренажеров
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function createProfile(userId, name, slug, equipmentSlugs) {
  try {
    console.log(`[createProfile] Creating profile:`, {
      userId,
      name,
      slug,
      equipmentSlugsCount: Array.isArray(equipmentSlugs) ? equipmentSlugs.length : 0,
      equipmentSlugs: Array.isArray(equipmentSlugs) ? equipmentSlugs.slice(0, 10) : equipmentSlugs,
    });

    if (!userId) {
      return {
        data: null,
        error: {
          message: "userId is required",
          code: "VALIDATION_ERROR",
        },
      };
    }

    if (!name || !name.trim()) {
      return {
        data: null,
        error: {
          message: "name is required",
          code: "VALIDATION_ERROR",
        },
      };
    }

    const envSlug = dbEnvFromApi(slug);
    if (!envSlug || !["home", "gym", "workout"].includes(envSlug)) {
      return {
        data: null,
        error: {
          message: "slug must be one of: home, gym, workout",
          code: "VALIDATION_ERROR",
        },
      };
    }

    // Проверяем, существует ли базовый профиль, если нет - создаем
    let { data: baseProfile, error: baseErr } = await supabaseAdmin
      .from("training_environment_profiles")
      .select("id")
      .eq("slug", envSlug)
      .limit(1)
      .maybeSingle();

    // Если базового профиля нет, создаем его
    if (baseErr || !baseProfile) {
      const baseNameMap = {
        home: "Дом",
        gym: "Тренажерный зал",
        workout: "Воркаут",
      };
      const baseName = baseNameMap[envSlug] || envSlug;

      const { data: newBaseProfile, error: createBaseErr } = await supabaseAdmin
        .from("training_environment_profiles")
        .insert([
          {
            id: crypto.randomUUID(),
            slug: envSlug,
            name: baseName,
          },
        ])
        .select()
        .single();

      if (createBaseErr || !newBaseProfile) {
        return {
          data: null,
          error: {
            message: `Failed to create base profile with slug '${envSlug}': ${createBaseErr?.message || "Unknown error"}`,
            code: "DATABASE_ERROR",
          },
        };
      }
      baseProfile = newBaseProfile;
    }

    // Создаем кастомный профиль с уникальным slug
    // Проблема: slug должен быть уникальным, но пользователь может создать несколько мест одного типа
    // Решение: создаем профиль с уникальным slug, добавляя UUID к базовому slug
    // Но для отображения используем базовый slug для группировки
    
    // Генерируем уникальный slug: базовый_slug + UUID (первые 8 символов)
    const uniqueSlug = `${envSlug}_${crypto.randomUUID().substring(0, 8)}`;

    const { data: customProfile, error: customErr } = await supabaseAdmin
      .from("training_environment_profiles")
      .insert([
        {
          id: crypto.randomUUID(),
          slug: uniqueSlug, // Используем уникальный slug
          name: name.trim(),
        },
      ])
      .select()
      .single();

    if (customErr) {
      return {
        data: null,
        error: {
          message: customErr.message || "Failed to create profile",
          code: customErr.code || "DATABASE_ERROR",
          details: customErr.details || null,
          hint: customErr.hint || null,
        },
      };
    }

    // Связываем пользователя с профилем
    const { error: linkErr } = await supabaseAdmin
      .from("users_training_environment_profiles")
      .insert([
        {
          user_id: userId,
          training_environment_profile_id: customProfile.id,
          active: false, // Новый профиль не активен по умолчанию
          added_at: new Date().toISOString(),
        },
      ]);

    if (linkErr) {
      // Откатываем создание профиля
      await supabaseAdmin
        .from("training_environment_profiles")
        .delete()
        .eq("id", customProfile.id);

      return {
        data: null,
        error: {
          message: linkErr.message || "Failed to link profile to user",
          code: linkErr.code || "DATABASE_ERROR",
        },
      };
    }

    // Добавляем тренажеры к профилю
    let savedEquipmentCount = 0;
    if (equipmentSlugs && Array.isArray(equipmentSlugs) && equipmentSlugs.length > 0) {
      console.log(`[createProfile] Adding ${equipmentSlugs.length} equipment items to profile ${customProfile.id}`);
      const equipmentRows = equipmentSlugs.map((slug) => ({
        training_environment_profile_id: customProfile.id,
        equipment_item_slug: slug,
      }));

      const { data: insertedEquipment, error: equipErr } = await supabaseAdmin
        .from("training_environment_profile_equipment")
        .insert(equipmentRows)
        .select();

      if (equipErr) {
        console.error(
          `[createProfile] ❌ Failed to add equipment to profile ${customProfile.id}:`,
          {
            error: equipErr.message,
            code: equipErr.code,
            details: equipErr.details,
            hint: equipErr.hint,
            equipmentCount: equipmentSlugs.length,
            equipmentSlugs: equipmentSlugs.slice(0, 10),
          }
        );
        // Не откатываем создание профиля, просто логируем
        savedEquipmentCount = 0;
      } else {
        savedEquipmentCount = insertedEquipment?.length || 0;
        console.log(`[createProfile] ✅ Successfully added ${savedEquipmentCount} equipment items to profile ${customProfile.id}`);
      }
    } else {
      console.log(`[createProfile] No equipment to add (equipmentSlugs: ${equipmentSlugs}, isArray: ${Array.isArray(equipmentSlugs)}, length: ${Array.isArray(equipmentSlugs) ? equipmentSlugs.length : 'N/A'})`);
    }

    const result = {
      id: customProfile.id,
      name: customProfile.name,
      slug: envSlug, // Возвращаем базовый slug для API (для совместимости)
      active: false,
      equipment_count: savedEquipmentCount || (equipmentSlugs?.length || 0),
      equipment_slugs: equipmentSlugs || [],
    };

    console.log(`[createProfile] ✅ Profile created successfully:`, {
      id: result.id,
      name: result.name,
      slug: result.slug,
      equipment_count: result.equipment_count,
      equipment_slugs_count: result.equipment_slugs.length,
      equipment_slugs: result.equipment_slugs.slice(0, 10),
    });

    return {
      data: result,
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error: { message: err.message, code: "INTERNAL_ERROR" },
    };
  }
}

/**
 * Обновить профиль (название и/или тренажеры)
 * @param {string} userId - ID пользователя
 * @param {string} profileId - ID профиля
 * @param {object} updates - Обновления {name?: string, equipment_slugs?: string[]}
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function updateProfile(userId, profileId, updates) {
  try {
    if (!userId || !profileId) {
      return {
        data: null,
        error: {
          message: "userId and profileId are required",
          code: "VALIDATION_ERROR",
        },
      };
    }

    // Проверяем, что профиль принадлежит пользователю
    const { data: userProfile, error: checkErr } = await supabaseAdmin
      .from("users_training_environment_profiles")
      .select("training_environment_profile_id")
      .eq("user_id", userId)
      .eq("training_environment_profile_id", profileId)
      .single();

    if (checkErr || !userProfile) {
      return {
        data: null,
        error: {
          message: "Profile not found or access denied",
          code: "NOT_FOUND",
        },
      };
    }

    // Обновляем название, если указано
    if (updates.name !== undefined && updates.name.trim()) {
      const { error: nameErr } = await supabaseAdmin
        .from("training_environment_profiles")
        .update({ name: updates.name.trim() })
        .eq("id", profileId);

      if (nameErr) {
        return {
          data: null,
          error: {
            message: nameErr.message || "Failed to update profile name",
            code: nameErr.code || "DATABASE_ERROR",
          },
        };
      }
    }

    // Обновляем тренажеры, если указано
    if (updates.equipment_slugs !== undefined) {
      // Удаляем старые тренажеры
      const { error: deleteErr } = await supabaseAdmin
        .from("training_environment_profile_equipment")
        .delete()
        .eq("training_environment_profile_id", profileId);

      if (deleteErr) {
        console.warn(
          `[trainingEnvironmentService] Failed to delete old equipment:`,
          deleteErr.message
        );
      }

      // Добавляем новые тренажеры
      if (Array.isArray(updates.equipment_slugs) && updates.equipment_slugs.length > 0) {
        const equipmentRows = updates.equipment_slugs.map((slug) => ({
          training_environment_profile_id: profileId,
          equipment_item_slug: slug,
        }));

        const { error: insertErr } = await supabaseAdmin
          .from("training_environment_profile_equipment")
          .insert(equipmentRows);

        if (insertErr) {
          return {
            data: null,
            error: {
              message: insertErr.message || "Failed to update equipment",
              code: insertErr.code || "DATABASE_ERROR",
            },
          };
        }
      }
    }

    // Получаем обновленный профиль
    const { data: updatedProfile, error: fetchErr } = await supabaseAdmin
      .from("training_environment_profiles")
      .select("id, name, slug")
      .eq("id", profileId)
      .single();

    if (fetchErr) {
      return { data: null, error: fetchErr };
    }

    // Получаем тренажеры
    const equipmentRes = await getProfileEquipment(profileId);
    const equipmentSlugs = equipmentRes.data || [];

    // Получаем active статус
    const { data: userLink } = await supabaseAdmin
      .from("users_training_environment_profiles")
      .select("active")
      .eq("user_id", userId)
      .eq("training_environment_profile_id", profileId)
      .single();

    return {
      data: {
        id: updatedProfile.id,
        name: updatedProfile.name,
        slug: updatedProfile.slug,
        active: userLink?.active || false,
        equipment_count: equipmentSlugs.length,
        equipment_slugs: equipmentSlugs,
      },
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error: { message: err.message, code: "INTERNAL_ERROR" },
    };
  }
}

/**
 * Активировать профиль (деактивирует остальные)
 * @param {string} userId - ID пользователя
 * @param {string} profileId - ID профиля для активации
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function activateProfile(userId, profileId) {
  try {
    if (!userId || !profileId) {
      return {
        data: null,
        error: {
          message: "userId and profileId are required",
          code: "VALIDATION_ERROR",
        },
      };
    }

    // Проверяем, что профиль принадлежит пользователю
    const { data: userProfile, error: checkErr } = await supabaseAdmin
      .from("users_training_environment_profiles")
      .select("training_environment_profile_id")
      .eq("user_id", userId)
      .eq("training_environment_profile_id", profileId)
      .single();

    if (checkErr || !userProfile) {
      return {
        data: null,
        error: {
          message: "Profile not found or access denied",
          code: "NOT_FOUND",
        },
      };
    }

    // Деактивируем все профили пользователя
    const { error: deactErr } = await supabaseAdmin
      .from("users_training_environment_profiles")
      .update({ active: false })
      .eq("user_id", userId);

    if (deactErr) {
      return {
        data: null,
        error: {
          message: deactErr.message || "Failed to deactivate other profiles",
          code: deactErr.code || "DATABASE_ERROR",
        },
      };
    }

    // Активируем выбранный профиль
    const { error: actErr } = await supabaseAdmin
      .from("users_training_environment_profiles")
      .update({ active: true })
      .eq("user_id", userId)
      .eq("training_environment_profile_id", profileId);

    if (actErr) {
      return {
        data: null,
        error: {
          message: actErr.message || "Failed to activate profile",
          code: actErr.code || "DATABASE_ERROR",
        },
      };
    }

    // Получаем обновленный профиль
    const listRes = await listUserProfiles(userId);
    const activatedProfile = listRes.data?.find((p) => p.id === profileId);

    return {
      data: activatedProfile || null,
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error: { message: err.message, code: "INTERNAL_ERROR" },
    };
  }
}

/**
 * Удалить профиль
 * @param {string} userId - ID пользователя
 * @param {string} profileId - ID профиля для удаления
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function deleteProfile(userId, profileId) {
  try {
    if (!userId || !profileId) {
      return {
        data: null,
        error: {
          message: "userId and profileId are required",
          code: "VALIDATION_ERROR",
        },
      };
    }

    // Проверяем, что профиль принадлежит пользователю
    const { data: userProfile, error: checkErr } = await supabaseAdmin
      .from("users_training_environment_profiles")
      .select("training_environment_profile_id")
      .eq("user_id", userId)
      .eq("training_environment_profile_id", profileId)
      .single();

    if (checkErr || !userProfile) {
      return {
        data: null,
        error: {
          message: "Profile not found or access denied",
          code: "NOT_FOUND",
        },
      };
    }

    // Удаляем связь пользователя с профилем (CASCADE удалит equipment)
    const { error: deleteErr } = await supabaseAdmin
      .from("users_training_environment_profiles")
      .delete()
      .eq("user_id", userId)
      .eq("training_environment_profile_id", profileId);

    if (deleteErr) {
      return {
        data: null,
        error: {
          message: deleteErr.message || "Failed to delete profile",
          code: deleteErr.code || "DATABASE_ERROR",
        },
      };
    }

    // Удаляем тренажеры профиля
    await supabaseAdmin
      .from("training_environment_profile_equipment")
      .delete()
      .eq("training_environment_profile_id", profileId);

    // Удаляем сам профиль (если это кастомный, не базовый)
    // Базовые профили (home, gym, workout) не удаляем
    const { data: profile } = await supabaseAdmin
      .from("training_environment_profiles")
      .select("slug")
      .eq("id", profileId)
      .single();

    // Удаляем только если это не базовый профиль
    // (базовые имеют стандартные названия, кастомные - пользовательские)
    if (profile) {
      // Проверяем, есть ли другие пользователи с этим профилем
      const { data: otherUsers } = await supabaseAdmin
        .from("users_training_environment_profiles")
        .select("user_id")
        .eq("training_environment_profile_id", profileId)
        .limit(1);

      // Если никто больше не использует этот профиль, удаляем его
      if (!otherUsers || otherUsers.length === 0) {
        await supabaseAdmin
          .from("training_environment_profiles")
          .delete()
          .eq("id", profileId);
      }
    }

    return {
      data: { success: true },
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error: { message: err.message, code: "INTERNAL_ERROR" },
    };
  }
}

module.exports = {
  listUserProfiles,
  getProfileEquipment,
  createProfile,
  updateProfile,
  activateProfile,
  deleteProfile,
};

