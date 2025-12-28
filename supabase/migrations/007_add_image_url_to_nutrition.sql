-- Миграция: Добавление поля для URL изображения блюда
-- Дата: 2025-01-XX
-- Описание: Добавляем поле image_url в таблицу nutrition_entries для хранения URL фотографий блюд

-- Добавляем поле image_url в таблицу nutrition_entries (если его еще нет)
DO $$ 
BEGIN
    -- URL изображения блюда (хранится в Supabase Storage)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'nutrition_entries' AND column_name = 'image_url') THEN
        ALTER TABLE nutrition_entries ADD COLUMN image_url TEXT;
    END IF;
END $$;




