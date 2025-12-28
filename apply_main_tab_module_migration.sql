-- ═══════════════════════════════════════════════════════════════════════════
-- 🚀 МИГРАЦИЯ: Добавление поля main_tab_module в таблицу users
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- 📋 Описание:
--    Добавляет поле main_tab_module для управления видимостью вкладок
--    в главной панели навигации (nutrition или body)
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
--    5. ⚠️ ПОДОЖДИТЕ 30 СЕКУНД для обновления кэша схемы
--    6. Перезапустите backend сервер
--
-- ⚡ После выполнения проверьте, что колонка добавлена
-- ═══════════════════════════════════════════════════════════════════════════

-- Добавляем колонку main_tab_module, если она не существует
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'users' 
        AND column_name = 'main_tab_module'
        AND table_schema = 'public'
    ) THEN
        -- Добавляем колонку
        ALTER TABLE users ADD COLUMN main_tab_module TEXT;
        
        -- Добавляем CHECK constraint отдельно (если его еще нет)
        IF NOT EXISTS (
            SELECT 1 
            FROM pg_constraint 
            WHERE conname = 'users_main_tab_module_check'
        ) THEN
            ALTER TABLE users ADD CONSTRAINT users_main_tab_module_check 
                CHECK (main_tab_module IS NULL OR main_tab_module IN ('nutrition', 'body'));
        END IF;
        
        RAISE NOTICE '✅ Колонка main_tab_module успешно добавлена в таблицу users';
    ELSE
        RAISE NOTICE 'ℹ️ Колонка main_tab_module уже существует в таблице users';
    END IF;
END $$;

-- Проверка: выводим информацию о колонке
SELECT 
    column_name, 
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'users' 
    AND table_schema = 'public'
    AND column_name = 'main_tab_module';

-- Проверка: выводим информацию о constraint
SELECT 
    conname as constraint_name,
    contype as constraint_type
FROM pg_constraint
WHERE conrelid = 'users'::regclass
    AND conname = 'users_main_tab_module_check';

