-- Миграция: Добавление поля completed_at в таблицу workouts
-- Дата: 2025-01-XX
-- Описание: Добавляем поле для хранения времени проведения/завершения тренировки

-- Добавляем поле completed_at, если его еще нет
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'workouts' AND column_name = 'completed_at') THEN
        ALTER TABLE workouts ADD COLUMN completed_at TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- Создаем индекс для быстрого поиска тренировок по времени завершения
CREATE INDEX IF NOT EXISTS workouts_completed_at_idx ON workouts(completed_at);

