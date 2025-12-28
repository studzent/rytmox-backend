-- Миграция: Удаление несуществующей колонки created_at из user_nutrition_targets
-- Дата: 2025-01-XX
-- Описание: Удаляем колонку created_at, если она существует (она не должна быть в таблице)

-- Удаляем колонку created_at, если она существует
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'user_nutrition_targets' 
        AND column_name = 'created_at'
    ) THEN
        ALTER TABLE user_nutrition_targets DROP COLUMN created_at;
        RAISE NOTICE 'Колонка created_at удалена из user_nutrition_targets';
    ELSE
        RAISE NOTICE 'Колонка created_at не существует в user_nutrition_targets, пропускаем';
    END IF;
END $$;

