# User Profile · RYTM0X

Профиль пользователя хранит его уровень, цель, предпочтения по оборудованию, целевые мышцы и ограничения. Эти данные используются в AI-генерации тренировок.

## Поля профиля

- **level** — уровень подготовки пользователя (`beginner`, `intermediate`, `advanced`)
- **goal** — основная цель тренировок (`fat_loss`, `muscle_gain`, `health`, `performance`)
- **preferred_equipment** — доступное пользователю оборудование (массив строк, например `["bodyweight", "dumbbells"]`)
- **preferred_muscles** — любимые/целевые группы мышц (массив строк, например `["Glutes", "Legs", "Full Body"]`)
- **language** — предпочитаемый язык интерфейса/подсказок (`"ru"` или `"en"`)
- **restrictions** — ограничения (например, проблемы с коленями, спиной и т.д.) в формате JSON-объекта

## Использование в AI

### Автоматическое обогащение параметров

Если при запросе `POST /ai/workout` передан `userId`:

1. Backend автоматически подгружает профиль пользователя через таблицу `user_profiles`
2. Недостающие параметры берутся из профиля:
   - Если `level` не передан в запросе → используется `profile.level`
   - Если `equipment` пустой или не передан → используется `profile.preferred_equipment`
   - Если `targetMuscles` не передан → используется `profile.preferred_muscles`
   - Если `goal` не передан → используется `profile.goal`
3. **Ограничения (`restrictions`)** добавляются в промпт к AI, чтобы система не предлагала опасные упражнения, которые могут усугубить травмы или проблемы со здоровьем
4. Данные профиля включаются в логирование (`ai_logs.request_data.profile_snapshot`)

### Работа без профиля

Если `userId` не передан или профиль не найден:

- AI использует только параметры, пришедшие в теле запроса
- Система работает в режиме graceful degradation — отсутствие профиля не вызывает ошибок
- Все параметры должны быть явно указаны в запросе

### Обновление профиля

Профиль **не меняется автоматически** при каждом AI-запросе. Он обновляется только через эндпоинт:

- `PUT /profile/:userId` — обновление профиля (частичное обновление разрешено)
- `GET /profile/:userId` — получение текущего профиля

## Примеры использования

### Пример 1: Запрос с userId (профиль используется)

```json
POST /ai/workout
{
  "userId": "123e4567-e89b-12d3-a456-426614174000",
  "durationMinutes": 30,
  "exercisesCount": 8
}
```

В этом случае система:
- Загрузит профиль пользователя
- Использует `level`, `goal`, `equipment`, `targetMuscles` из профиля
- Учтет `restrictions` при генерации тренировки

### Пример 2: Запрос без userId (только параметры запроса)

```json
POST /ai/workout
{
  "level": "beginner",
  "goal": "fat_loss",
  "equipment": ["bodyweight"],
  "targetMuscles": ["Full Body"],
  "durationMinutes": 30,
  "exercisesCount": 8
}
```

В этом случае система использует только переданные параметры.

### Пример 3: Смешанный запрос (часть параметров из профиля)

```json
POST /ai/workout
{
  "userId": "123e4567-e89b-12d3-a456-426614174000",
  "level": "intermediate",
  "durationMinutes": 45
}
```

В этом случае:
- `level` будет взят из запроса (`"intermediate"`)
- `goal`, `equipment`, `targetMuscles` будут взяты из профиля
- `restrictions` из профиля будут учтены в промпте

## API эндпоинты

### GET /profile/:userId

Получение профиля пользователя.

**Ответ:**
```json
{
  "userId": "123e4567-e89b-12d3-a456-426614174000",
  "level": "beginner",
  "goal": "fat_loss",
  "preferred_equipment": ["bodyweight", "dumbbells"],
  "preferred_muscles": ["Glutes", "Legs"],
  "language": "ru",
  "restrictions": {
    "knee_pain": true
  }
}
```

### PUT /profile/:userId

Обновление профиля пользователя (частичное обновление разрешено).

**Тело запроса:**
```json
{
  "level": "intermediate",
  "goal": "muscle_gain",
  "preferred_equipment": ["dumbbells", "barbell"],
  "preferred_muscles": ["Chest", "Back"],
  "language": "en",
  "restrictions": {
    "lower_back_issues": true
  }
}
```

**Ответ:** Обновленный профиль в том же формате, что и GET.

## Связанные документы

- [DB_SCHEMA.md](./DB_SCHEMA.md) — схема базы данных, включая таблицу `user_profiles`
- [RYTM0X_OVERVIEW.md](./RYTM0X_OVERVIEW.md) — общая архитектура проекта

