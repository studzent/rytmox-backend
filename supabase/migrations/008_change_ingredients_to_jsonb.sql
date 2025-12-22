-- Миграция: Изменение типа поля ingredients с TEXT на JSONB
-- Дата: 2025-01-XX
-- Описание: Изменяем тип поля ingredients для хранения массива объектов ингредиентов с калориями, граммами и БЖУ

-- Изменяем тип поля ingredients с TEXT на JSONB
DO $$ 
BEGIN
    -- Проверяем, существует ли колонка
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'nutrition_entries' AND column_name = 'ingredients') THEN
        
        -- Конвертируем существующие данные из TEXT в JSONB
        -- Если ingredients - это строка через запятую, преобразуем в массив объектов
        -- Если пусто или NULL, оставляем NULL
        UPDATE nutrition_entries
        SET ingredients = CASE
            WHEN ingredients IS NULL OR ingredients = '' THEN NULL
            WHEN ingredients::text ~ '^\[.*\]$' THEN ingredients::jsonb -- Уже JSON
            ELSE (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'name', trim(ingredient_name),
                        'calories', 0,
                        'grams', 0
                    )
                )
                FROM unnest(string_to_array(ingredients, ',')) AS ingredient_name
                WHERE trim(ingredient_name) != ''
            )
        END
        WHERE ingredients IS NOT NULL AND ingredients != '';
        
        -- Изменяем тип колонки на JSONB
        ALTER TABLE nutrition_entries 
        ALTER COLUMN ingredients TYPE JSONB USING ingredients::jsonb;
        
        RAISE NOTICE 'Поле ingredients успешно преобразовано в JSONB';
    ELSE
        RAISE NOTICE 'Поле ingredients не существует, создаем новое';
        ALTER TABLE nutrition_entries ADD COLUMN ingredients JSONB;
    END IF;
END $$;

-- Создаем индекс для быстрого поиска по ингредиентам (опционально)
CREATE INDEX IF NOT EXISTS nutrition_entries_ingredients_gin_idx 
ON nutrition_entries USING GIN (ingredients);

