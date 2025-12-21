-- ═══════════════════════════════════════════════════════════════════════════
-- 🚀 МИГРАЦИЯ БД: Расширение таблицы users полями онбординга
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- 📋 Описание:
--    Добавляет все необходимые поля для хранения данных онбординга
--    пользователей прямо в таблицу users
--
-- ✅ Безопасность:
--    • Использует IF NOT EXISTS - безопасно для повторного выполнения
--    • Не удаляет и не изменяет существующие данные
--    • Добавляет только отсутствующие поля
--
-- 📝 Инструкция по применению:
--    1. Откройте Supabase Dashboard → SQL Editor
--    2. Скопируйте весь этот файл (Ctrl+A / Cmd+A)
--    3. Вставьте в SQL Editor (Ctrl+V / Cmd+V)
--    4. Нажмите Run (или Ctrl+Enter / Cmd+Enter)
--
-- ⚡ После выполнения в конце будет показан список добавленных колонок
-- ═══════════════════════════════════════════════════════════════════════════

-- Добавляем поля онбординга в таблицу users
-- Все поля добавляются только если их еще нет (безопасно для повторного выполнения)

DO $$ 
BEGIN
    -- Тип авторизации (для анонимных пользователей)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'auth_type') THEN
        ALTER TABLE users ADD COLUMN auth_type TEXT DEFAULT 'anonymous';
    END IF;

    -- Флаг активности пользователя
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'is_active') THEN
        ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT true;
    END IF;

    -- Coach style (личность тренера)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'coach_style') THEN
        ALTER TABLE users ADD COLUMN coach_style TEXT;
    END IF;

    -- Дата рождения
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'date_of_birth') THEN
        ALTER TABLE users ADD COLUMN date_of_birth DATE;
    END IF;

    -- Имя пользователя
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'name') THEN
        ALTER TABLE users ADD COLUMN name TEXT;
    END IF;

    -- Пол
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'gender') THEN
        ALTER TABLE users ADD COLUMN gender TEXT;
    END IF;

    -- Уровень подготовки
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'level') THEN
        ALTER TABLE users ADD COLUMN level TEXT;
    END IF;

    -- Цели (массив)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'goals') THEN
        ALTER TABLE users ADD COLUMN goals TEXT[] DEFAULT '{}';
    END IF;

    -- Основная цель (для обратной совместимости)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'goal') THEN
        ALTER TABLE users ADD COLUMN goal TEXT;
    END IF;

    -- Специальные программы
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'special_programs') THEN
        ALTER TABLE users ADD COLUMN special_programs TEXT[] DEFAULT '{}';
    END IF;

    -- Дни тренировок в неделю
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'training_days_per_week') THEN
        ALTER TABLE users ADD COLUMN training_days_per_week INTEGER;
    END IF;

    -- Тренировочное окружение
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'training_environment') THEN
        ALTER TABLE users ADD COLUMN training_environment TEXT;
    END IF;

    -- Оборудование (массив slug-ов)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'equipment_items') THEN
        ALTER TABLE users ADD COLUMN equipment_items TEXT[] DEFAULT '{}';
    END IF;

    -- Предпочитаемое оборудование
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'preferred_equipment') THEN
        ALTER TABLE users ADD COLUMN preferred_equipment TEXT[] DEFAULT '{}';
    END IF;

    -- Предпочитаемые группы мышц
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'preferred_muscles') THEN
        ALTER TABLE users ADD COLUMN preferred_muscles TEXT[] DEFAULT '{}';
    END IF;

    -- Рост в см
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'height_cm') THEN
        ALTER TABLE users ADD COLUMN height_cm INTEGER;
    END IF;

    -- Вес в кг
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'weight_kg') THEN
        ALTER TABLE users ADD COLUMN weight_kg DECIMAL(10, 2);
    END IF;

    -- Язык
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'language') THEN
        ALTER TABLE users ADD COLUMN language TEXT;
    END IF;

    -- Ограничения (JSONB)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'restrictions') THEN
        ALTER TABLE users ADD COLUMN restrictions JSONB DEFAULT '{}'::jsonb;
    END IF;

    -- Противопоказания (JSONB)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'contraindications') THEN
        ALTER TABLE users ADD COLUMN contraindications JSONB DEFAULT '{}'::jsonb;
    END IF;

    -- Уведомления включены
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'notifications_enabled') THEN
        ALTER TABLE users ADD COLUMN notifications_enabled BOOLEAN DEFAULT false;
    END IF;

    -- Питание включено
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'nutrition_enabled') THEN
        ALTER TABLE users ADD COLUMN nutrition_enabled BOOLEAN DEFAULT false;
    END IF;

    -- Текущий шаг онбординга
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'current_step') THEN
        ALTER TABLE users ADD COLUMN current_step INTEGER;
    END IF;
END $$;

-- Проверка: выводим список добавленных колонок
SELECT 
    column_name, 
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'users'
    AND column_name IN (
        'auth_type', 'is_active', 'coach_style', 'date_of_birth', 'name', 'gender', 'level', 'goal',
        'goals', 'special_programs', 'training_days_per_week', 'training_environment',
        'equipment_items', 'preferred_equipment', 'preferred_muscles',
        'height_cm', 'weight_kg', 'language', 'restrictions', 'contraindications',
        'notifications_enabled', 'nutrition_enabled', 'current_step'
    )
ORDER BY column_name;
