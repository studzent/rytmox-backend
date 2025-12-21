-- Миграция: Добавление полей онбординга в user_profiles
-- Дата: 2025-12-12
-- Описание: Расширяем таблицу user_profiles полями для хранения данных онбординга

-- Создаем таблицу user_profiles, если её еще нет
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    level TEXT,
    goal TEXT,
    training_environment TEXT,
    equipment_items TEXT[] DEFAULT '{}',
    preferred_equipment TEXT[] DEFAULT '{}',
    preferred_muscles TEXT[] DEFAULT '{}',
    weight_kg DECIMAL(10, 2),
    height_cm INTEGER,
    language TEXT,
    restrictions JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Создаем индекс для быстрого поиска профиля по пользователю
CREATE INDEX IF NOT EXISTS user_profiles_user_id_idx ON user_profiles(user_id);

-- Добавляем новые поля онбординга (если таблица уже существует, эти команды просто пропустятся)
DO $$ 
BEGIN
    -- Coach style (личность тренера)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'user_profiles' AND column_name = 'coach_style') THEN
        ALTER TABLE user_profiles ADD COLUMN coach_style TEXT;
    END IF;

    -- Дата рождения
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'user_profiles' AND column_name = 'date_of_birth') THEN
        ALTER TABLE user_profiles ADD COLUMN date_of_birth DATE;
    END IF;

    -- Цели (массив)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'user_profiles' AND column_name = 'goals') THEN
        ALTER TABLE user_profiles ADD COLUMN goals TEXT[] DEFAULT '{}';
    END IF;

    -- Специальные программы
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'user_profiles' AND column_name = 'special_programs') THEN
        ALTER TABLE user_profiles ADD COLUMN special_programs TEXT[] DEFAULT '{}';
    END IF;

    -- Дни тренировок в неделю
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'user_profiles' AND column_name = 'training_days_per_week') THEN
        ALTER TABLE user_profiles ADD COLUMN training_days_per_week INTEGER;
    END IF;

    -- Имя пользователя
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'user_profiles' AND column_name = 'name') THEN
        ALTER TABLE user_profiles ADD COLUMN name TEXT;
    END IF;

    -- Пол
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'user_profiles' AND column_name = 'gender') THEN
        ALTER TABLE user_profiles ADD COLUMN gender TEXT;
    END IF;

    -- Противопоказания (расширяем restrictions или создаем отдельное поле)
    -- Используем существующее поле restrictions JSONB, но можем добавить отдельное поле для удобства
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'user_profiles' AND column_name = 'contraindications') THEN
        ALTER TABLE user_profiles ADD COLUMN contraindications JSONB DEFAULT '{}'::jsonb;
    END IF;

    -- Уведомления включены
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'user_profiles' AND column_name = 'notifications_enabled') THEN
        ALTER TABLE user_profiles ADD COLUMN notifications_enabled BOOLEAN DEFAULT false;
    END IF;

    -- Питание включено
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'user_profiles' AND column_name = 'nutrition_enabled') THEN
        ALTER TABLE user_profiles ADD COLUMN nutrition_enabled BOOLEAN DEFAULT false;
    END IF;

    -- Текущий шаг онбординга
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'user_profiles' AND column_name = 'current_step') THEN
        ALTER TABLE user_profiles ADD COLUMN current_step INTEGER;
    END IF;
END $$;

-- Триггер для автоматического обновления updated_at в user_profiles
CREATE TRIGGER IF NOT EXISTS update_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
