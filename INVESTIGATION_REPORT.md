# Отчет об исследовании проблемы с отображением оборудования в Plan → Edit

## Проблема
При открытии экрана редактирования оборудования (Plan → вкладка → "Изменить") не отображаются галочки на оборудовании, выбранном пользователем во время онбординга. Показывается "выбрано 0" вместо правильного количества.

## Анализ потока данных

### 1. Сохранение оборудования в онбординге
- **Файл**: `app/src/context/OnboardingContext.tsx` (строка 386)
- **Файл**: `app/src/utils/onboardingSubmitAndGenerate.ts` (строка 155)
- Оборудование сохраняется в `userProfile.equipment_items` через API `updateProfile`
- Данные корректно передаются в payload: `equipment_items: onboardingData.equipment || []`

### 2. Создание локации из онбординга
- **Файл**: `app/src/screens/Plan/PlanScreen.tsx` (строки 233-415)
- При первом открытии Plan экрана, если профилей нет, создается профиль из данных онбординга
- **Ключевой код** (строки 307-335):
  ```typescript
  const equipmentSlugs: string[] = effectiveEquipment 
    ? effectiveEquipment.filter((slug): slug is string => typeof slug === 'string' && slug.length > 0)
    : [];
  
  const newProfile = await createLocation(
    {
      name: profileName,
      slug: slug,
      equipment_slugs: equipmentSlugs,  // ✅ Оборудование передается
    },
    auth.userId
  );
  ```

### 3. Бэкенд: сохранение оборудования
- **Файл**: `rytmox-backend/services/trainingEnvironmentService.js` (строки 181-387)
- Функция `createProfile` принимает `equipmentSlugs` и сохраняет их в таблицу `training_environment_profile_equipment`
- **Код сохранения** (строки 325-357):
  ```javascript
  if (equipmentSlugs && Array.isArray(equipmentSlugs) && equipmentSlugs.length > 0) {
    const equipmentRows = equipmentSlugs.map((slug) => ({
      training_environment_profile_id: customProfile.id,
      equipment_item_slug: slug,
    }));
    
    const { data: insertedEquipment, error: equipErr } = await supabaseAdmin
      .from("training_environment_profile_equipment")
      .insert(equipmentRows)
      .select();
  }
  ```

### 4. Бэкенд: загрузка локаций
- **Файл**: `rytmox-backend/services/trainingEnvironmentService.js` (строки 21-133)
- Функция `listUserProfiles` загружает оборудование из БД и возвращает в `equipment_slugs`
- **Код загрузки** (строки 63-106):
  ```javascript
  const { data: equipment, error: equipErr } = await supabaseAdmin
    .from("training_environment_profile_equipment")
    .select("equipment_item_slug")
    .eq("training_environment_profile_id", profile.id);
  
  const equipmentSlugs = (equipment || []).map((e) => e.equipment_item_slug).filter(Boolean);
  
  const result = {
    id: profile.id,
    name: profile.name,
    slug: baseSlug,
    active: up.active,
    equipment_count: equipmentSlugs.length,
    equipment_slugs: equipmentSlugs,  // ✅ Возвращается в ответе
  };
  ```

### 5. Фронтенд: маппинг данных
- **Файл**: `app/src/screens/Plan/PlanScreen.tsx` (строки 130-186)
- Функция `mapLocationProfileToUserLocation` корректно маппит `equipment_slugs` в `equipment`
- **Код маппинга** (строки 135-150):
  ```typescript
  let equipment: string[] = [];
  if (profile.equipment_slugs !== undefined && profile.equipment_slugs !== null) {
    if (Array.isArray(profile.equipment_slugs)) {
      equipment = profile.equipment_slugs.filter((slug): slug is string => typeof slug === 'string' && slug.length > 0);
    }
  }
  ```

### 6. Открытие экрана редактирования
- **Файл**: `app/src/screens/Plan/PlanScreen.tsx` (строки 796-870)
- При нажатии "Изменить" загружаются свежие данные из API через `getLocations`
- Данные маппятся через `mapLocationProfileToUserLocation` и передаются в `EditLocationEquipmentScreen`

### 7. Экран редактирования оборудования
- **Файл**: `app/src/screens/Plan/EditLocationEquipmentScreen.tsx` (строки 33-505)
- Инициализирует `selectedEquipment` из `location.equipment` (строки 40-48)
- Есть сложная логика синхронизации с `availableEquipment` (строки 119-386)

## Возможные причины проблемы

### Причина 1: Оборудование не сохраняется при создании локации
**Вероятность**: Средняя
- Если `effectiveEquipment` пустой или undefined при создании локации
- Проверка: логи в `PlanScreen.tsx` строки 313-325 должны показать `equipmentSlugs_count`

### Причина 2: Оборудование не возвращается из API
**Вероятность**: Низкая
- Бэкенд код выглядит корректно, но может быть проблема с запросом к БД
- Проверка: логи в `trainingEnvironmentService.js` строки 82-90 должны показать загруженное оборудование

### Причина 3: Проблема с маппингом данных
**Вероятность**: Низкая
- Код маппинга выглядит корректно, но может быть edge case
- Проверка: логи в `PlanScreen.tsx` строки 162-183 должны показать маппинг

### Причина 4: Проблема с синхронизацией в EditLocationEquipmentScreen
**Вероятность**: Высокая
- Сложная логика синхронизации `selectedEquipment` с `availableEquipment`
- Может быть race condition: `availableEquipment` загружается асинхронно, а `selectedEquipment` инициализируется раньше
- Проверка: логи в `EditLocationEquipmentScreen.tsx` строки 58-85, 127-275

## Рекомендации по исправлению

### 1. Добавить дополнительное логирование
Добавить логи в ключевых точках для отслеживания потока данных:
- При создании локации из онбординга (уже есть, строки 313-325)
- При загрузке локаций из API (уже есть, строки 806-813)
- При инициализации `EditLocationEquipmentScreen` (уже есть, строки 58-85)

### 2. Проверить race condition в EditLocationEquipmentScreen
Проблема может быть в том, что `selectedEquipment` инициализируется из `location.equipment` до того, как `availableEquipment` загрузится. Затем синхронизация (строки 119-276) может не сработать правильно.

**Решение**: Убедиться, что синхронизация происходит после загрузки `availableEquipment`, и что `location.equipment` правильно передается.

### 3. Проверить, что equipment_slugs передается в createLocation API
Нужно убедиться, что фронтенд API функция `createLocation` правильно передает `equipment_slugs` в запрос к бэкенду.

### 4. Проверить ответ API при создании локации
После создания локации нужно проверить, что `newProfile.equipment_slugs` содержит правильные данные (логи уже есть, строки 337-348).

## Следующие шаги

1. ✅ Проверить логи при создании локации из онбординга - должны показать `equipmentSlugs_count > 0`
2. ✅ Проверить логи при загрузке локаций - должны показать `equipment_slugs_count > 0`
3. ✅ Проверить логи в `EditLocationEquipmentScreen` - должны показать `locationEquipmentCount > 0`
4. ⚠️ Если логи показывают, что данные есть, но не отображаются - проблема в синхронизации `selectedEquipment` с `availableEquipment`
5. ⚠️ Если логи показывают, что данных нет - проблема в сохранении или загрузке из БД

## Выводы

Код выглядит корректно на всех уровнях. Наиболее вероятная причина - это проблема с синхронизацией `selectedEquipment` в `EditLocationEquipmentScreen` или race condition между инициализацией и загрузкой `availableEquipment`.

Рекомендуется:
1. Проверить логи в реальном сценарии
2. Если данные есть в логах, но не отображаются - исправить синхронизацию в `EditLocationEquipmentScreen`
3. Если данных нет в логах - проверить сохранение/загрузку в БД
