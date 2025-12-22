-- ═══════════════════════════════════════════════════════════════════════════
-- 🚀 МИГРАЦИИ БД: Система питания
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- 📋 Описание:
--    Применяет миграции для системы питания:
--    1. Добавляет поля для расчёта калорий в таблицу users
--    2. Создаёт таблицы для записей питания и избранных блюд
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
-- ⚡ После выполнения проверьте, что таблицы созданы
-- ═══════════════════════════════════════════════════════════════════════════

-- ============================================================================
-- МИГРАЦИЯ 004: Добавление полей для расчёта калорий
-- ============================================================================

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

-- ============================================================================
-- МИГРАЦИЯ 005: Создание таблиц для системы питания
-- ============================================================================

-- Таблица записей питания
CREATE TABLE IF NOT EXISTS nutrition_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
    title TEXT NOT NULL,
    calories INTEGER NOT NULL,
    carbs DECIMAL(10, 2),
    protein DECIMAL(10, 2),
    fat DECIMAL(10, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Индексы для nutrition_entries
CREATE INDEX IF NOT EXISTS nutrition_entries_user_id_idx ON nutrition_entries(user_id);
CREATE INDEX IF NOT EXISTS nutrition_entries_date_idx ON nutrition_entries(date);
CREATE INDEX IF NOT EXISTS nutrition_entries_user_date_idx ON nutrition_entries(user_id, date);

-- Таблица избранных блюд
CREATE TABLE IF NOT EXISTS favorite_meals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    calories INTEGER NOT NULL,
    carbs DECIMAL(10, 2),
    protein DECIMAL(10, 2),
    fat DECIMAL(10, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Индексы для favorite_meals
CREATE INDEX IF NOT EXISTS favorite_meals_user_id_idx ON favorite_meals(user_id);

-- ============================================================================
-- ✅ МИГРАЦИИ ПРИМЕНЕНЫ
-- ============================================================================
-- Проверьте, что таблицы созданы:
-- SELECT table_name FROM information_schema.tables 
-- WHERE table_schema = 'public' 
-- AND table_name IN ('nutrition_entries', 'favorite_meals');

