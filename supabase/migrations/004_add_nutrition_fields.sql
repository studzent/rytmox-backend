-- Миграция: Добавление полей для расчёта калорий и питания
-- Дата: 2025-01-XX
-- Описание: Добавляем поля для хранения уровня активности, расчётных калорий (BMR, TDEE, целевые калории)

-- Добавляем поля в таблицу users (если их еще нет)
DO $$ 
BEGIN
    -- Уровень активности
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'activity_level') THEN
        ALTER TABLE users ADD COLUMN activity_level TEXT;
    END IF;

    -- BMR (Basal Metabolic Rate)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'bmr') THEN
        ALTER TABLE users ADD COLUMN bmr DECIMAL(10, 2);
    END IF;

    -- TDEE (Total Daily Energy Expenditure)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'tdee') THEN
        ALTER TABLE users ADD COLUMN tdee DECIMAL(10, 2);
    END IF;

    -- Целевые калории
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'users' AND column_name = 'calorie_goal') THEN
        ALTER TABLE users ADD COLUMN calorie_goal INTEGER;
    END IF;
END $$;

-- Добавляем CHECK constraint для activity_level отдельно (для совместимости)
DO $$
BEGIN
    -- Проверяем, существует ли уже constraint
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'users_activity_level_check'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_activity_level_check 
            CHECK (activity_level IS NULL OR activity_level IN ('sedentary', 'light', 'moderate', 'high', 'very_high'));
    END IF;
END $$;
