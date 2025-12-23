-- Миграция: Добавление типа приёма пищи 'water' для отслеживания воды
-- Дата: 2025-01-XX
-- Описание: Расширяем constraint meal_type для поддержки записи воды

-- Удаляем старый constraint и создаём новый с добавлением 'water'
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
        
        RAISE NOTICE 'Старый constraint удалён';
    END IF;
    
    -- Создаём новый constraint с добавлением 'water'
    ALTER TABLE nutrition_entries 
    ADD CONSTRAINT nutrition_entries_meal_type_check 
    CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack', 'water'));
    
    RAISE NOTICE 'Новый constraint создан с поддержкой типа "water"';
END $$;

