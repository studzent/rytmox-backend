-- Миграция: Добавление таблиц для системы питания
-- Дата: 2025-01-XX
-- Описание: Создаём таблицы для записей питания и избранных блюд

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

