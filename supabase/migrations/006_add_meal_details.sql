-- Миграция: Добавление полей для детальной информации о блюде
-- Дата: 2025-01-XX
-- Описание: Добавляем поля для веса порции и ингредиентов в таблицу nutrition_entries

-- Добавляем поля в таблицу nutrition_entries (если их еще нет)
DO $$ 
BEGIN
    -- Вес порции в граммах
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'nutrition_entries' AND column_name = 'weight_grams') THEN
        ALTER TABLE nutrition_entries ADD COLUMN weight_grams INTEGER;
    END IF;

    -- Ингредиенты (список через запятую)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'nutrition_entries' AND column_name = 'ingredients') THEN
        ALTER TABLE nutrition_entries ADD COLUMN ingredients TEXT;
    END IF;
END $$;

