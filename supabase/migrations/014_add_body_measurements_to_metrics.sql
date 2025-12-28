-- Миграция: Добавление полей замеров тела в users_measurements
-- Дата: 2025-01-XX
-- Описание: Добавляем поля для хранения замеров тела (шея, талия, бёдра, грудь, бицепс, бедро) для точного расчёта состава тела
-- 
-- ВАЖНО: Таблица users_measurements уже существует и используется для хранения веса.
-- Эта миграция добавляет дополнительные поля для замеров тела.

-- Добавляем поля замеров тела (все опциональные)
DO $$ 
BEGIN
    -- Шея (обязательна для Navy Formula)
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'users_measurements' 
        AND column_name = 'neck_cm'
    ) THEN
        ALTER TABLE users_measurements ADD COLUMN neck_cm DECIMAL(5, 2);
        RAISE NOTICE 'Колонка neck_cm добавлена в users_measurements';
    END IF;

    -- Талия (обязательна для Navy Formula)
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'users_measurements' 
        AND column_name = 'waist_cm'
    ) THEN
        ALTER TABLE users_measurements ADD COLUMN waist_cm DECIMAL(5, 2);
        RAISE NOTICE 'Колонка waist_cm добавлена в users_measurements';
    END IF;

    -- Бёдра (обязательны для женщин в Navy Formula)
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'users_measurements' 
        AND column_name = 'hips_cm'
    ) THEN
        ALTER TABLE users_measurements ADD COLUMN hips_cm DECIMAL(5, 2);
        RAISE NOTICE 'Колонка hips_cm добавлена в users_measurements';
    END IF;

    -- Грудь (дополнительная метрика)
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'users_measurements' 
        AND column_name = 'chest_cm'
    ) THEN
        ALTER TABLE users_measurements ADD COLUMN chest_cm DECIMAL(5, 2);
        RAISE NOTICE 'Колонка chest_cm добавлена в users_measurements';
    END IF;

    -- Бицепс (дополнительная метрика)
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'users_measurements' 
        AND column_name = 'bicep_cm'
    ) THEN
        ALTER TABLE users_measurements ADD COLUMN bicep_cm DECIMAL(5, 2);
        RAISE NOTICE 'Колонка bicep_cm добавлена в users_measurements';
    END IF;

    -- Бедро (дополнительная метрика)
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'users_measurements' 
        AND column_name = 'thigh_cm'
    ) THEN
        ALTER TABLE users_measurements ADD COLUMN thigh_cm DECIMAL(5, 2);
        RAISE NOTICE 'Колонка thigh_cm добавлена в users_measurements';
    END IF;
END $$;

