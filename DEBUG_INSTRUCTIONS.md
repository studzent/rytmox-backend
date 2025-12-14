# Инструкция по проверке логов

## Где смотреть логи

Логи выводятся в **терминале**, где запущен Expo (`npx expo start -c`).

## Пошаговая проверка

### Шаг 1: Откройте экран редактирования оборудования

1. Зайдите в приложение
2. Откройте вкладку **"План"**
3. Нажмите на выбранную локацию (вверху)
4. Нажмите **"Изменить"**

### Шаг 2: Найдите в логах следующие записи

#### 1. Лог при нажатии "Изменить" (из PlanScreen):
```
[PlanScreen] Found fresh profile from API:
```
**Что проверить:**
- `equipment_slugs_count` - должно быть > 0, если оборудование было выбрано
- `equipment_slugs` - массив slug-ов оборудования

#### 2. Лог маппинга данных (из PlanScreen):
```
[PlanScreen] 📍 Mapped fresh location for edit:
```
**Что проверить:**
- `equipmentCount` - должно совпадать с `equipment_slugs_count` из предыдущего лога
- `equipmentSlugs` - массив должен быть не пустым

#### 3. Лог при открытии экрана редактирования (из EditLocationEquipmentScreen):
```
[EditLocationEquipmentScreen] 🚀 Component mounted with location:
```
**Что проверить:**
- `locationEquipmentLength` - должно быть > 0
- `locationEquipmentSlugs` - массив slug-ов оборудования
- `initialSelectedCount` - должно быть > 0
- `initialSelectedSlugs` - массив должен совпадать с `locationEquipmentSlugs`

#### 4. Лог маппинга оборудования (из mapLocationProfileToUserLocation):
```
[mapLocationProfileToUserLocation] Mapping equipment:
```
**Что проверить:**
- `equipmentSlugsCount` - должно быть > 0
- `mappedEquipmentCount` - должно совпадать с `equipmentSlugsCount`
- Если `mappedEquipmentCount === 0`, но `equipmentSlugsCount > 0` - это проблема маппинга!

## Возможные проблемы и их признаки

### Проблема 1: Оборудование не загружается из API
**Признак:** В логе `[PlanScreen] Found fresh profile from API:` видно:
- `equipment_slugs_count: 0`
- `equipment_slugs: []`

**Решение:** Проблема на бэкенде - оборудование не сохранилось или не загружается из БД

### Проблема 2: Проблема с маппингом
**Признак:** В логе `[mapLocationProfileToUserLocation] Mapping equipment:` видно:
- `equipmentSlugsCount > 0`, но `mappedEquipmentCount === 0`
- Или есть предупреждение: `⚠️ WARNING: equipment_slugs exist but mapped equipment is empty!`

**Решение:** Проблема в функции `mapLocationProfileToUserLocation` - неправильная фильтрация или маппинг

### Проблема 3: Оборудование не передается в EditLocationEquipmentScreen
**Признак:** В логе `[EditLocationEquipmentScreen] 🚀 Component mounted with location:` видно:
- `locationEquipmentLength: 0` или `'N/A'`
- `initialSelectedCount: 0`
- Но в предыдущих логах было `equipmentCount > 0`

**Решение:** Проблема в передаче данных через navigation params

### Проблема 4: Race condition при синхронизации
**Признак:** В логе `[EditLocationEquipmentScreen]` видно:
- `locationEquipmentLength > 0` при монтировании
- Но затем `selectedEquipment` становится пустым после загрузки `availableEquipment`

**Решение:** Проблема в логике синхронизации в `EditLocationEquipmentScreen` (строки 119-386)

## Что скопировать для отчета

Если нашли проблему, скопируйте следующие логи:
1. `[PlanScreen] Found fresh profile from API:`
2. `[PlanScreen] 📍 Mapped fresh location for edit:`
3. `[EditLocationEquipmentScreen] 🚀 Component mounted with location:`
4. `[mapLocationProfileToUserLocation] Mapping equipment:` (если есть)

Или любые логи с префиксами:
- `[PlanScreen]`
- `[EditLocationEquipmentScreen]`
- `[mapLocationProfileToUserLocation]`
