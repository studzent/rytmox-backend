# Инструкции по деплою и проверке миграции на нормализованные таблицы

## Деплой на дроплет

```bash
cd /path/to/rytmox-backend

# Получить последние изменения
git fetch origin

# Сбросить локальные изменения и перейти на актуальный main
git reset --hard origin/main

# Проверить, что HEAD = последний коммит (должен быть 8e1ced7 или новее)
git log -1 --oneline

# Перезапустить сервер
pm2 restart rytmox-backend
# или
sudo systemctl restart rytmox-backend
```

## Проверка в Supabase SQL

После деплоя и повторного прохождения онбординга (вес + выбор тренажёров + окружение):

### 1. Проверка веса в users_measurements

```sql
-- Общее количество записей
select count(*) as measurements_count
from users_measurements;

-- Записи для конкретного пользователя
select *
from users_measurements
where user_id = 'ff843d11-cce7-45da-9fd1-f66be1b0f229'
order by measured_at desc
limit 5;
```

**Ожидаемый результат**: Должны быть записи с `weight_kg`, `measured_at`, `source='profile'` или `source='metrics'`.

### 2. Проверка тренажёров в users_equipment

```sql
-- Активные тренажёры пользователя
select *
from users_equipment
where user_id = 'ff843d11-cce7-45da-9fd1-f66be1b0f229'
  and active = true
order by added_at desc;
```

**Ожидаемый результат**: Должны быть записи с `equipment_item_slug` (slug-ы выбранных тренажёров), `active=true`, `availability='available'`.

### 3. Проверка окружения в users_training_environment_profiles

```sql
-- Активное окружение пользователя
select 
  utep.*,
  tep.slug as environment_slug,
  tep.name as environment_name
from users_training_environment_profiles utep
join training_environment_profiles tep on tep.id = utep.training_environment_profile_id
where utep.user_id = 'ff843d11-cce7-45da-9fd1-f66be1b0f229'
  and utep.active = true;
```

**Ожидаемый результат**: Должна быть одна запись с `active=true`, `environment_slug` должен быть `'home'`, `'gym'` или `'workout'`.

### 4. Проверка, что в users НЕТ weight_kg/training_environment/equipment_items

```sql
-- Проверка структуры таблицы users (не должно быть этих колонок)
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'users'
  and column_name in ('weight_kg', 'training_environment', 'equipment_items');
```

**Ожидаемый результат**: 0 строк (этих колонок нет в таблице `users`).

## Проверка API

### GET /profile/:userId

```bash
curl -X GET "http://your-backend-url/profile/ff843d11-cce7-45da-9fd1-f66be1b0f229"
```

**Ожидаемый ответ**:
```json
{
  "userId": "ff843d11-cce7-45da-9fd1-f66be1b0f229",
  "level": "beginner",
  "goal": "fat_loss",
  "training_environment": "outdoor",  // или "home"/"gym" (маппинг workout->outdoor для совместимости)
  "equipment_items": ["dumbbells_pair", "pullup_bar", ...],  // slug-ы из users_equipment
  "weight_kg": 75.5,  // latest из users_measurements
  ...
}
```

### PUT /profile/:userId (онбординг)

```bash
curl -X PUT "http://your-backend-url/profile/ff843d11-cce7-45da-9fd1-f66be1b0f229" \
  -H "Content-Type: application/json" \
  -d '{
    "weight_kg": 75.5,
    "equipment_items": ["dumbbells_pair", "pullup_bar"],
    "training_environment": "outdoor"
  }'
```

**Ожидаемое поведение**:
- `weight_kg` → INSERT в `users_measurements`
- `equipment_items` → замена активного набора в `users_equipment`
- `training_environment` → установка активной локации в `users_training_environment_profiles`

## Проверка логов

Если что-то не работает, проверьте логи:

```bash
pm2 logs rytmox-backend --lines 200
```

Ищите предупреждения:
- `Failed to insert users_measurements` - проблема с записью веса
- `Failed to replace users_equipment` - проблема с записью тренажёров
- `Failed to set users_training_environment_profiles` - проблема с записью окружения

## Важные замечания

1. **Группировка тренажёров не изменена** - фронт продолжает получать `equipment_group` из `/equipment` и группировать на клиенте.

2. **Совместимость с фронтом**:
   - Бэк принимает `training_environment='outdoor'` (старый формат) и маппит в `'workout'` в БД
   - В ответе `/profile` отдаёт `'outdoor'` вместо `'workout'` для совместимости

3. **Источник истины**:
   - Вес: `users_measurements` (latest = текущий)
   - Тренажёры: `users_equipment` (active=true)
   - Окружение: `users_training_environment_profiles` → `training_environment_profiles.slug`

