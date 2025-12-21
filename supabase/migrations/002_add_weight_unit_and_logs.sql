-- Миграция: Добавление weight_unit в users и расширение ai_logs для onboarding
-- Дата: 2025-01-XX
-- Описание: Добавляем колонку weight_unit в users и расширяем CHECK constraint в ai_logs

-- Добавляем weight_unit в users
ALTER TABLE users ADD COLUMN IF NOT EXISTS weight_unit TEXT DEFAULT 'kg';

-- Обновляем CHECK constraint в ai_logs для поддержки новых типов запросов
ALTER TABLE ai_logs DROP CONSTRAINT IF EXISTS ai_logs_request_type_check;
ALTER TABLE ai_logs ADD CONSTRAINT ai_logs_request_type_check 
  CHECK (request_type IN ('workout', 'nutrition', 'form_check', 'onboarding_submit', 'onboarding_validation'));

