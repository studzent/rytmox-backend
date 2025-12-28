-- ═══════════════════════════════════════════════════════════════════════════
-- 🚀 МИГРАЦИИ БД: Дополнительные поля для системы питания
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- 📋 Описание:
--    Применяет миграции для расширения таблицы nutrition_entries:
--    1. Добавляет поле weight_grams (вес порции в граммах)
--    2. Добавляет поле ingredients (список ингредиентов)
--    3. Добавляет поле image_url (URL фотографии блюда)
--
-- ✅ Безопасность:
--    • Использует IF NOT EXISTS - безопасно для повторного выполнения
--    • Не удаляет и не изменяет существующие данные
--
-- 📝 Инструкция по применению:
--    1. Откройте Supabase Dashboard → SQL Editor
--    2. Скопируйте весь этот файл (Ctrl+A / Cmd+A)
--    3. Вставьте в SQL Editor (Ctrl+V / Cmd+V)
--    4. Нажмите Run (или Ctrl+Enter / Cmd+Enter)
--
-- ⚡ После выполнения проверьте, что поля добавлены
-- ═══════════════════════════════════════════════════════════════════════════

-- ============================================================================
-- МИГРАЦИЯ 006: Добавление полей для детальной информации о блюде
-- ============================================================================

-- Добавляем поля в таблицу nutrition_entries (если их еще нет)
DO $$ 
BEGIN
    -- Вес порции в граммах
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'nutrition_entries' AND column_name = 'weight_grams') THEN
        ALTER TABLE nutrition_entries ADD COLUMN weight_grams INTEGER;
        RAISE NOTICE 'Добавлено поле weight_grams';
    ELSE
        RAISE NOTICE 'Поле weight_grams уже существует';
    END IF;

    -- Ингредиенты (список через запятую)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'nutrition_entries' AND column_name = 'ingredients') THEN
        ALTER TABLE nutrition_entries ADD COLUMN ingredients TEXT;
        RAISE NOTICE 'Добавлено поле ingredients';
    ELSE
        RAISE NOTICE 'Поле ingredients уже существует';
    END IF;
END $$;

-- ============================================================================
-- МИГРАЦИЯ 007: Добавление поля для URL изображения блюда
-- ============================================================================

-- Добавляем поле image_url в таблицу nutrition_entries (если его еще нет)
DO $$ 
BEGIN
    -- URL изображения блюда (хранится в Supabase Storage)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'nutrition_entries' AND column_name = 'image_url') THEN
        ALTER TABLE nutrition_entries ADD COLUMN image_url TEXT;
        RAISE NOTICE 'Добавлено поле image_url';
    ELSE
        RAISE NOTICE 'Поле image_url уже существует';
    END IF;
END $$;

-- ============================================================================
-- ✅ ПРОВЕРКА: Выводим список всех полей таблицы nutrition_entries
-- ============================================================================
SELECT 
    column_name, 
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'nutrition_entries'
    AND table_schema = 'public'
ORDER BY ordinal_position;

-- ============================================================================
-- ✅ МИГРАЦИИ ПРИМЕНЕНЫ
-- ============================================================================
-- Проверьте, что следующие поля присутствуют в таблице:
-- - weight_grams (INTEGER)
-- - ingredients (TEXT)
-- - image_url (TEXT)




