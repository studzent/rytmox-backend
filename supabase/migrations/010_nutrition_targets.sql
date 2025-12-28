-- Миграция: Добавление таблиц для системы целей питания
-- Дата: 2025-01-XX
-- Описание: Создаём таблицы для хранения целей питания (калории, БЖУ, вода) и истории их изменений

-- Исправление constraint для meal_type: добавляем 'water' если его ещё нет
DO $$ 
BEGIN
    -- Проверяем, существует ли constraint
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'nutrition_entries_meal_type_check'
    ) THEN
        -- Удаляем старый constraint
        ALTER TABLE nutrition_entries 
        DROP CONSTRAINT nutrition_entries_meal_type_check;
        
        RAISE NOTICE 'Старый constraint meal_type удалён';
    END IF;
    
    -- Создаём новый constraint с добавлением 'water'
    ALTER TABLE nutrition_entries 
    ADD CONSTRAINT nutrition_entries_meal_type_check 
    CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack', 'water'));
    
    RAISE NOTICE 'Новый constraint meal_type создан с поддержкой типа "water"';
END $$;

-- Функция для автоматического обновления updated_at (если ещё не существует)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Таблица целей питания пользователя
CREATE TABLE IF NOT EXISTS user_nutrition_targets (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    target_kcal INTEGER,
    target_protein_g INTEGER,
    target_fat_g INTEGER,
    target_carbs_g INTEGER,
    target_water_ml INTEGER,
    computed_from_weight_kg DECIMAL(10, 2),
    goal_type TEXT CHECK (goal_type IN ('lose_weight', 'maintain', 'gain_muscle', 'recomposition', 'performance', 'healthy_habits')),
    activity_level TEXT CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'high', 'very_high')),
    auto_update_enabled BOOLEAN DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_auto_recalc_at TIMESTAMP WITH TIME ZONE,
    last_profile_hash TEXT
);

-- Индексы для user_nutrition_targets
CREATE INDEX IF NOT EXISTS user_nutrition_targets_user_id_idx ON user_nutrition_targets(user_id);
CREATE INDEX IF NOT EXISTS user_nutrition_targets_updated_at_idx ON user_nutrition_targets(updated_at);

-- Таблица истории изменений целей питания
CREATE TABLE IF NOT EXISTS user_nutrition_target_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    event_type TEXT NOT NULL CHECK (event_type IN ('init', 'profile_change', 'scheduled_recalc', 'weight_change_recalc')),
    old_targets JSONB,
    new_targets JSONB,
    reason TEXT
);

-- Индексы для user_nutrition_target_events
CREATE INDEX IF NOT EXISTS user_nutrition_target_events_user_id_idx ON user_nutrition_target_events(user_id);
CREATE INDEX IF NOT EXISTS user_nutrition_target_events_created_at_idx ON user_nutrition_target_events(created_at);
CREATE INDEX IF NOT EXISTS user_nutrition_target_events_event_type_idx ON user_nutrition_target_events(event_type);

-- Триггер для автоматического обновления updated_at в user_nutrition_targets
CREATE TRIGGER update_user_nutrition_targets_updated_at
    BEFORE UPDATE ON user_nutrition_targets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

