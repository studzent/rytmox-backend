-- Схема базы данных RYTM0X
-- Этот файл является источником истины для структуры БД
-- Все изменения должны быть отражены также в docs/db-schema.md

-- Расширения
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Таблица пользователей
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    profile_data JSONB DEFAULT '{}'::jsonb
);

-- Индекс для email
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users(email);

-- Таблица упражнений
CREATE TABLE IF NOT EXISTS exercises (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    muscle_groups TEXT[] DEFAULT '{}',
    equipment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Таблица тренировок
CREATE TABLE IF NOT EXISTS workouts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    date DATE NOT NULL,
    notes TEXT,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Индекс для быстрого поиска тренировок по пользователю
CREATE INDEX IF NOT EXISTS workouts_user_id_idx ON workouts(user_id);
-- Индекс для поиска тренировок по времени завершения
CREATE INDEX IF NOT EXISTS workouts_completed_at_idx ON workouts(completed_at);

-- Таблица связей тренировок и упражнений
CREATE TABLE IF NOT EXISTS workout_exercises (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workout_id UUID NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    sets INTEGER,
    reps INTEGER,
    weight DECIMAL(10, 2),
    rest_seconds INTEGER,
    order_index INTEGER DEFAULT 0,
    CONSTRAINT workout_exercises_workout_exercise_unique UNIQUE (workout_id, exercise_id, order_index)
);

-- Индексы для workout_exercises
CREATE INDEX IF NOT EXISTS workout_exercises_workout_id_idx ON workout_exercises(workout_id);
CREATE INDEX IF NOT EXISTS workout_exercises_exercise_id_idx ON workout_exercises(exercise_id);

-- Таблица логов AI запросов
CREATE TABLE IF NOT EXISTS ai_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_type TEXT NOT NULL CHECK (request_type IN ('workout', 'nutrition', 'form_check')),
    request_data JSONB DEFAULT '{}'::jsonb,
    response_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Индекс для быстрого поиска логов по пользователю
CREATE INDEX IF NOT EXISTS ai_logs_user_id_idx ON ai_logs(user_id);
-- Индекс для поиска по типу запроса
CREATE INDEX IF NOT EXISTS ai_logs_request_type_idx ON ai_logs(request_type);

-- Функция для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Триггер для автоматического обновления updated_at в таблице users
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

