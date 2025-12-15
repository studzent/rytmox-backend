const { supabaseAdmin } = require("../utils/supabaseClient");
const crypto = require("crypto");

/**
 * Получить список всех профилей пользователя
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

    // Загружаем связи пользователя с профилями
    const { data: userProfiles, error: linkErr } = await supabaseAdmin
      .from("users_training_environment_profiles")
      .select("training_environment_profile_id, active, added_at")
      .eq("user_id", userId)
      .order("added_at", { ascending: false });

    if (linkErr) {
      console.error("[listUserProfiles] Error loading user profiles:", linkErr);
      return { data: null, error: linkErr };
    }

    if (!userProfiles || userProfiles.length === 0) {
      return { data: [], error: null };
    }

    // Загружаем сами профили
    const profileIds = userProfiles.map((up) => up.training_environment_profile_id);
    const { data: profiles, error: profilesErr } = await supabaseAdmin
      .from("training_environment_profiles")
      .select("id, name, slug")
      .in("id", profileIds);

    if (profilesErr) {
      console.error("[listUserProfiles] Error loading profiles:", profilesErr);
      return { data: null, error: profilesErr };
    }

    // Создаем мапу для быстрого доступа
    const profileMap = new Map(profiles.map((p) => [p.id, p]));
    const userProfileMap = new Map(
      userProfiles.map((up) => [up.training_environment_profile_id, up])
    );

    // Загружаем оборудование для всех профилей
    const { data: equipment, error: equipErr } = await supabaseAdmin
      .from("training_environment_profile_equipment")
      .select("training_environment_profile_id, equipment_item_slug")
      .in("training_environment_profile_id", profileIds);

    if (equipErr) {
      console.warn("[listUserProfiles] Error loading equipment:", equipErr);
      // Не прерываем выполнение, просто логируем
    }

    // Группируем оборудование по профилям
    const equipmentMap = new Map();
    if (equipment) {
      equipment.forEach((e) => {
        if (!equipmentMap.has(e.training_environment_profile_id)) {
          equipmentMap.set(e.training_environment_profile_id, []);
        }
        equipmentMap.get(e.training_environment_profile_id).push(e.equipment_item_slug);
      });
    }

    // Формируем результат
    const results = [];
    for (const up of userProfiles) {
      const profile = profileMap.get(up.training_environment_profile_id);
      if (!profile) continue;

      const equipmentSlugs = equipmentMap.get(profile.id) || [];
      const baseSlug = profile.slug;

      results.push({
        id: profile.id,
        name: profile.name,
        slug: baseSlug,
        active: up.active,
        equipment_count: equipmentSlugs.length,
        equipment_slugs: equipmentSlugs,
      });
    }

    console.log(`[listUserProfiles] ✅ Loaded ${results.length} profiles for userId: ${userId}`);
    return { data: results, error: null };
  } catch (err) {
    console.error("[listUserProfiles] Unexpected error:", err);
    return {
      data: null,
      error: {
        message: err.message,
        code: "INTERNAL_ERROR",
      },
    };
  }
}

/**
 * Создать новый профиль места тренировки
 * @param {string} userId - ID пользователя
 * @param {string} name - Название профиля
 * @param {string} slug - Slug окружения (home, gym, workout, outdoor)
 * @param {string[]} equipmentSlugs - Массив slug-ов оборудования
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
async function createProfile(userId, name, slug, equipmentSlugs = []) {
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

    if (!name || !name.trim()) {
      return {
        data: null,
        error: {
          message: "name is required",
          code: "VALIDATION_ERROR",
        },
      };
    }

    if (!slug || !["home", "gym", "workout", "outdoor"].includes(slug)) {
      return {
        data: null,
        error: {
          message: "slug must be one of: home, gym, workout, outdoor",
          code: "VALIDATION_ERROR",
        },
      };
    }

    // Нормализуем slug (outdoor -> workout)
    const normalizedSlug = slug === "outdoor" ? "workout" : slug;

    // Проверяем, существует ли уже профиль с таким slug
    const { data: existingProfiles, error: checkErr } = await supabaseAdmin
      .from("training_environment_profiles")
      .select("id, name, slug")
      .eq("slug", normalizedSlug)
      .limit(1);

    if (checkErr) {
      console.error("[createProfile] Error checking existing profile:", checkErr);
      return { data: null, error: checkErr };
    }

    let profile;
    let profileId;

    // Если профиль с таким slug уже существует, используем его
    if (existingProfiles && existingProfiles.length > 0) {
      profile = existingProfiles[0];
      profileId = profile.id;
      console.log(`[createProfile] Using existing profile with slug ${normalizedSlug}: ${profileId}`);
    } else {
      // Создаем новый профиль только если его нет
      profileId = crypto.randomUUID();
      const { data: newProfile, error: profileErr } = await supabaseAdmin
        .from("training_environment_profiles")
        .insert([
          {
            id: profileId,
            name: name.trim(),
            slug: normalizedSlug,
          },
        ])
        .select()
        .single();

      if (profileErr) {
        console.error("[createProfile] Error creating profile:", profileErr);
        return { data: null, error: profileErr };
      }
      profile = newProfile;
      console.log(`[createProfile] Created new profile with slug ${normalizedSlug}: ${profileId}`);
    }

    // Проверяем, есть ли уже связь пользователя с этим профилем
    const { data: existingLink, error: linkCheckErr } = await supabaseAdmin
      .from("users_training_environment_profiles")
      .select("user_id, training_environment_profile_id")
      .eq("user_id", userId)
      .eq("training_environment_profile_id", profileId)
      .limit(1);

    if (linkCheckErr) {
      console.error("[createProfile] Error checking existing user profile link:", linkCheckErr);
      return { data: null, error: linkCheckErr };
    }

    // Создаем связь пользователя с профилем только если её еще нет
    if (!existingLink || existingLink.length === 0) {
      const { error: linkErr } = await supabaseAdmin
        .from("users_training_environment_profiles")
        .insert([
          {
            user_id: userId,
            training_environment_profile_id: profileId,
            active: false,
            added_at: new Date().toISOString(),
          },
        ]);

      if (linkErr) {
        console.error("[createProfile] Error creating user profile link:", linkErr);
        return { data: null, error: linkErr };
      }
      console.log(`[createProfile] Created user profile link for userId: ${userId}, profileId: ${profileId}`);
    } else {
      console.log(`[createProfile] User profile link already exists for userId: ${userId}, profileId: ${profileId}`);
    }

    // Сохраняем оборудование только если профиль был только что создан
    // Если профиль уже существовал, не перезаписываем его оборудование
    if (equipmentSlugs && Array.isArray(equipmentSlugs) && equipmentSlugs.length > 0) {
      // Проверяем, есть ли уже оборудование у этого профиля
      const { data: existingEquipment, error: equipCheckErr } = await supabaseAdmin
        .from("training_environment_profile_equipment")
        .select("equipment_item_slug")
        .eq("training_environment_profile_id", profileId)
        .limit(1);

      if (equipCheckErr) {
        console.warn("[createProfile] Warning: Could not check existing equipment:", equipCheckErr);
      }

      // Добавляем оборудование только если его еще нет
      if (!existingEquipment || existingEquipment.length === 0) {
        const equipmentRows = equipmentSlugs
          .filter(Boolean)
          .map((slug) => ({
            training_environment_profile_id: profileId,
            equipment_item_slug: slug,
          }));

        const { error: equipErr } = await supabaseAdmin
          .from("training_environment_profile_equipment")
          .insert(equipmentRows);

        if (equipErr) {
          console.error("[createProfile] Error saving equipment:", equipErr);
          // Не прерываем выполнение, но логируем ошибку
        } else {
          console.log(`[createProfile] Saved ${equipmentRows.length} equipment items for profile ${profileId}`);
        }
      } else {
        console.log(`[createProfile] Profile ${profileId} already has equipment, skipping equipment update`);
      }
    }

    const equipmentSlugsArray = Array.isArray(equipmentSlugs) ? equipmentSlugs : [];
    const result = {
      id: profile.id,
      name: profile.name,
      slug: profile.slug,
      active: false,
      equipment_count: equipmentSlugsArray.length,
      equipment_slugs: equipmentSlugsArray,
    };

    console.log(`[createProfile] ✅ Created profile: ${result.id} for userId: ${userId}`);
    return { data: result, error: null };
  } catch (err) {
    console.error("[createProfile] Unexpected error:", err);
    return {
      data: null,
      error: {
        message: err.message,
        code: "INTERNAL_ERROR",
      },
    };
  }
}

/**
 * Обновить профиль (название и/или оборудование)
 * @param {string} userId - ID пользователя
 * @param {string} profileId - ID профиля
 * @param {object} updates - Объект с полями для обновления {name?, equipment_slugs?}
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
          message: "Profile not found or does not belong to user",
          code: "NOT_FOUND",
        },
      };
    }

    // Обновляем название профиля, если указано
    if (updates.name !== undefined) {
      const { error: nameErr } = await supabaseAdmin
        .from("training_environment_profiles")
        .update({ name: updates.name.trim() })
        .eq("id", profileId);

      if (nameErr) {
        console.error("[updateProfile] Error updating name:", nameErr);
        return { data: null, error: nameErr };
      }
    }

    // Обновляем оборудование, если указано
    if (updates.equipment_slugs !== undefined) {
      // ВАЖНО: Проверяем активность профиля ДО обновления оборудования
      // чтобы знать, нужно ли синхронизировать в users_equipment
      const { data: userProfileLinkBefore, error: linkErrBefore } = await supabaseAdmin
        .from("users_training_environment_profiles")
        .select("active")
        .eq("user_id", userId)
        .eq("training_environment_profile_id", profileId)
        .single();
      
      const isActive = userProfileLinkBefore?.active || false;
      
      // Удаляем старое оборудование
      const { error: deleteErr } = await supabaseAdmin
        .from("training_environment_profile_equipment")
        .delete()
        .eq("training_environment_profile_id", profileId);

      if (deleteErr) {
        console.error("[updateProfile] Error deleting old equipment:", deleteErr);
        return { data: null, error: deleteErr };
      }

      // Добавляем новое оборудование
      if (Array.isArray(updates.equipment_slugs) && updates.equipment_slugs.length > 0) {
        const equipmentRows = updates.equipment_slugs
          .filter(Boolean)
          .map((slug) => ({
            training_environment_profile_id: profileId,
            equipment_item_slug: slug,
          }));

        const { error: insertErr } = await supabaseAdmin
          .from("training_environment_profile_equipment")
          .insert(equipmentRows);

        if (insertErr) {
          console.error("[updateProfile] Error inserting new equipment:", insertErr);
          return { data: null, error: insertErr };
        }
      }
      
      // ВАЖНО: Если профиль активен, синхронизируем оборудование в users_equipment
      if (isActive) {
        const equipmentSlugsToSync = Array.isArray(updates.equipment_slugs) 
          ? updates.equipment_slugs.filter(Boolean) 
          : [];
        
        console.log(`[updateProfile] Profile is active, syncing equipment to users_equipment:`, equipmentSlugsToSync.length, 'items');
        
        const userProfileService = require("./userProfileService");
        const { error: syncErr } = await userProfileService.replaceUserEquipment(userId, equipmentSlugsToSync);
        
        if (syncErr) {
          console.error("[updateProfile] Failed to sync equipment to users_equipment:", syncErr);
          // Не прерываем обновление профиля, но логируем ошибку
        } else {
          console.log(`[updateProfile] ✅ Successfully synced ${equipmentSlugsToSync.length} equipment items to users_equipment`);
        }
      }
    }

    // Загружаем обновленный профиль
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("training_environment_profiles")
      .select("id, name, slug")
      .eq("id", profileId)
      .single();

    if (profileErr) {
      return { data: null, error: profileErr };
    }

    // Загружаем активность профиля
    const { data: userProfileLink, error: linkErr } = await supabaseAdmin
      .from("users_training_environment_profiles")
      .select("active")
      .eq("user_id", userId)
      .eq("training_environment_profile_id", profileId)
      .single();

    if (linkErr) {
      return { data: null, error: linkErr };
    }

    // Загружаем оборудование
    const { data: equipment, error: equipErr } = await supabaseAdmin
      .from("training_environment_profile_equipment")
      .select("equipment_item_slug")
      .eq("training_environment_profile_id", profileId);

    const equipmentSlugs = (equipment || []).map((e) => e.equipment_item_slug).filter(Boolean);

    const result = {
      id: profile.id,
      name: profile.name,
      slug: profile.slug,
      active: userProfileLink?.active || false,
      equipment_count: equipmentSlugs.length,
      equipment_slugs: equipmentSlugs,
    };

    console.log(`[updateProfile] ✅ Updated profile: ${profileId} for userId: ${userId}`);
    return { data: result, error: null };
  } catch (err) {
    console.error("[updateProfile] Unexpected error:", err);
    return {
      data: null,
      error: {
        message: err.message,
        code: "INTERNAL_ERROR",
      },
    };
  }
}

/**
 * Активировать профиль (деактивирует остальные и синхронизирует оборудование)
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

    // Проверяем, что профиль существует и принадлежит пользователю
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
          message: "Profile not found or does not belong to user",
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
      console.error("[activateProfile] Error deactivating profiles:", deactErr);
      return { data: null, error: deactErr };
    }

    // Активируем выбранный профиль
    const { error: actErr } = await supabaseAdmin
      .from("users_training_environment_profiles")
      .update({ active: true })
      .eq("user_id", userId)
      .eq("training_environment_profile_id", profileId);

    if (actErr) {
      console.error("[activateProfile] Error activating profile:", actErr);
      return { data: null, error: actErr };
    }

    // ВАЖНО: Синхронизируем оборудование из профиля в users_equipment
    const { data: profileEquipment, error: equipErr } = await supabaseAdmin
      .from("training_environment_profile_equipment")
      .select("equipment_item_slug")
      .eq("training_environment_profile_id", profileId);

    if (!equipErr && profileEquipment) {
      const equipmentSlugs = profileEquipment
        .map((e) => e.equipment_item_slug)
        .filter(Boolean);

      console.log(
        `[activateProfile] Syncing equipment from profile ${profileId}:`,
        equipmentSlugs.length,
        "items"
      );

      // Синхронизируем в users_equipment через replaceUserEquipment
      const userProfileService = require("./userProfileService");
      const { error: syncErr } = await userProfileService.replaceUserEquipment(
        userId,
        equipmentSlugs
      );

      if (syncErr) {
        console.error("[activateProfile] Failed to sync equipment:", syncErr);
        // Не прерываем активацию, но логируем ошибку
      } else {
        console.log(
          `[activateProfile] ✅ Successfully synced ${equipmentSlugs.length} equipment items to users_equipment`
        );
      }
    } else if (equipErr) {
      console.warn("[activateProfile] Error loading profile equipment:", equipErr);
      // Не прерываем активацию, но логируем предупреждение
    } else {
      // Профиль без оборудования - синхронизируем пустой массив
      console.log(`[activateProfile] Profile ${profileId} has no equipment, syncing empty array`);
      const userProfileService = require("./userProfileService");
      const { error: syncErr } = await userProfileService.replaceUserEquipment(userId, []);

      if (syncErr) {
        console.error("[activateProfile] Failed to sync empty equipment:", syncErr);
      }
    }

    // Загружаем активированный профиль для ответа
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("training_environment_profiles")
      .select("id, name, slug")
      .eq("id", profileId)
      .single();

    if (profileErr) {
      return { data: null, error: profileErr };
    }

    // Загружаем оборудование
    const { data: equipment, error: finalEquipErr } = await supabaseAdmin
      .from("training_environment_profile_equipment")
      .select("equipment_item_slug")
      .eq("training_environment_profile_id", profileId);

    const equipmentSlugs = (equipment || []).map((e) => e.equipment_item_slug).filter(Boolean);

    const result = {
      id: profile.id,
      name: profile.name,
      slug: profile.slug,
      active: true,
      equipment_count: equipmentSlugs.length,
      equipment_slugs: equipmentSlugs,
    };

    console.log(`[activateProfile] ✅ Activated profile: ${profileId} for userId: ${userId}`);
    return { data: result, error: null };
  } catch (err) {
    console.error("[activateProfile] Unexpected error:", err);
    return {
      data: null,
      error: {
        message: err.message,
        code: "INTERNAL_ERROR",
      },
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
          message: "Profile not found or does not belong to user",
          code: "NOT_FOUND",
        },
      };
    }

    // Удаляем связь пользователя с профилем
    const { error: linkErr } = await supabaseAdmin
      .from("users_training_environment_profiles")
      .delete()
      .eq("user_id", userId)
      .eq("training_environment_profile_id", profileId);

    if (linkErr) {
      console.error("[deleteProfile] Error deleting user profile link:", linkErr);
      return { data: null, error: linkErr };
    }

    // Удаляем оборудование профиля
    const { error: equipErr } = await supabaseAdmin
      .from("training_environment_profile_equipment")
      .delete()
      .eq("training_environment_profile_id", profileId);

    if (equipErr) {
      console.warn("[deleteProfile] Error deleting equipment:", equipErr);
      // Не прерываем выполнение, но логируем
    }

    // Удаляем сам профиль
    const { error: profileErr } = await supabaseAdmin
      .from("training_environment_profiles")
      .delete()
      .eq("id", profileId);

    if (profileErr) {
      console.error("[deleteProfile] Error deleting profile:", profileErr);
      return { data: null, error: profileErr };
    }

    console.log(`[deleteProfile] ✅ Deleted profile: ${profileId} for userId: ${userId}`);
    return { data: { success: true }, error: null };
  } catch (err) {
    console.error("[deleteProfile] Unexpected error:", err);
    return {
      data: null,
      error: {
        message: err.message,
        code: "INTERNAL_ERROR",
      },
    };
  }
}

module.exports = {
  listUserProfiles,
  createProfile,
  updateProfile,
  activateProfile,
  deleteProfile,
};

