-- Добавляем поле duration_minutes в таблицу workouts
-- Это поле хранит запланированную длительность тренировки в минутах

ALTER TABLE workouts 
ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;

-- Добавляем комментарий к полю
COMMENT ON COLUMN workouts.duration_minutes IS 'Запланированная длительность тренировки в минутах';


