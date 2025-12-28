-- Быстрое исправление: добавление 'water' в constraint meal_type
-- Выполните этот скрипт, если миграция 010 уже была применена без исправления constraint

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
        
        RAISE NOTICE 'Старый constraint meal_type удалён';
    END IF;
    
    -- Создаём новый constraint с добавлением 'water'
    ALTER TABLE nutrition_entries 
    ADD CONSTRAINT nutrition_entries_meal_type_check 
    CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack', 'water'));
    
    RAISE NOTICE 'Новый constraint meal_type создан с поддержкой типа "water"';
END $$;




