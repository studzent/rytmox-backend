-- Миграция: Добавление поля main_tab_module в таблицу users
-- Дата: 2025-01-XX
-- Описание: Добавляем поле для хранения выбранного модуля главной панели (nutrition или body)
--
-- ⚠️ ВАЖНО: После применения миграции подождите 30 секунд для обновления кэша схемы Supabase
-- Затем перезапустите backend сервер

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
        ALTER TABLE users ADD COLUMN main_tab_module TEXT;
        -- Добавляем CHECK constraint отдельно
        ALTER TABLE users ADD CONSTRAINT users_main_tab_module_check 
            CHECK (main_tab_module IS NULL OR main_tab_module IN ('nutrition', 'body'));
        RAISE NOTICE 'Колонка main_tab_module добавлена в таблицу users';
    ELSE
        RAISE NOTICE 'Колонка main_tab_module уже существует в таблице users, пропускаем';
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

