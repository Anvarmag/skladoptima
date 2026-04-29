# TASK_CHANNEL_5 — Backend API настроек видимости каналов

> Модуль: `21-channel-controls`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `3h`
- Зависимости:
  - TASK_CHANNEL_1 выполнена (поле `channelVisibilitySettings` в `InventorySettings`)
  - существующий `InventoryService` или `SettingsService` (проверить, где хранится `InventorySettings`)
- Что нужно сделать:
  - добавить в `InventoryService` (или создать отдельный `ChannelVisibilityService`) метод `getChannelVisibility(tenantId)` — возвращает текущий список `visibleMarketplaces`; если запись отсутствует — возвращать все активные типы из `MarketplaceType`;
  - добавить метод `updateChannelVisibility(tenantId, visibleMarketplaces: MarketplaceType[])` с валидацией: список не пустой, значения только из `MarketplaceType` enum;
  - добавить в контроллер (`InventoryController` или новый `ChannelVisibilityController`) эндпоинты:
    - `GET /api/v1/channel-visibility` → текущие настройки;
    - `PATCH /api/v1/channel-visibility` → обновить; доступен только Owner/Admin;
  - добавить DTO `UpdateChannelVisibilityDto { visibleMarketplaces: MarketplaceType[] }`;
  - дефолт при отсутствии настройки: все маркетплейсы видимы.
- Критерий закрытия:
  - `GET /api/v1/channel-visibility` возвращает `{ visibleMarketplaces: ["WB", "OZON"] }` по умолчанию;
  - `PATCH /api/v1/channel-visibility` с `{ visibleMarketplaces: ["WB"] }` сохраняет настройку;
  - следующий `GET` возвращает только `["WB"]`;
  - `PATCH` с пустым массивом `[]` возвращает 422;
  - `PATCH` Manager-ролью возвращает 403.

**Что сделано**

### Реализованные изменения

#### 1. Новый DTO `apps/api/src/modules/inventory/dto/update-channel-visibility.dto.ts`

- `UpdateChannelVisibilityDto` с полем `visibleMarketplaces: MarketplaceType[]`
- Валидация через class-validator: `@IsEnum(MarketplaceType, { each: true })` + `@ArrayMinSize(1)` — при пустом массиве возвращает 422

#### 2. `apps/api/src/modules/inventory/inventory.service.ts`

- Добавлен импорт `MarketplaceType` и `Role` из `@prisma/client`
- Добавлен приватный helper `_parseVisibility(settings)`:
  - Читает JSON-поле `channelVisibilitySettings` из `InventorySettings`
  - Если поле null или пустое — возвращает все значения из `MarketplaceType` (дефолт = все маркетплейсы)
- Добавлен метод `getChannelVisibility(tenantId)`:
  - Вызывает `_getSettings` (lazy-create при первом запросе)
  - Возвращает `{ visibleMarketplaces: [...] }`
- Добавлен метод `updateChannelVisibility(tenantId, actorUserId, visibleMarketplaces)`:
  - Проверяет состояние тенанта через `_assertManualWriteAllowed` (блокировка для SUSPENDED/CLOSED/TRIAL_EXPIRED)
  - Проверяет роль пользователя: только `OWNER` и `ADMIN` — иначе 403 `ROLE_FORBIDDEN`
  - Дополнительная защита от пустого массива: 400 `VISIBLE_MARKETPLACES_CANNOT_BE_EMPTY`
  - Upsert `InventorySettings` с обновлённым JSON `{ visibleMarketplaces }`
  - Логирует событие `channel_visibility_updated`
  - Возвращает `{ visibleMarketplaces }`

#### 3. `apps/api/src/modules/inventory/inventory.controller.ts`

- Добавлен импорт `UpdateChannelVisibilityDto`
- Добавлен `GET /inventory/channel-visibility` → `getChannelVisibility(tenantId)`
- Добавлен `PATCH /inventory/channel-visibility` с `@UseGuards(TenantWriteGuard)` → `updateChannelVisibility(tenantId, userId, dto.visibleMarketplaces)`

### Маршруты API после задачи

| Метод | Путь | Auth | Назначение |
|-------|------|------|------------|
| `GET` | `/api/inventory/channel-visibility` | Любой пользователь тенанта | Текущие настройки видимости |
| `PATCH` | `/api/inventory/channel-visibility` | Owner/Admin (ROLE_FORBIDDEN для Manager) | Обновить видимые маркетплейсы |

### Критерии закрытия — проверено

- `GET` при отсутствии настройки → `{ visibleMarketplaces: ["WB", "OZON"] }` (дефолт)
- `PATCH { visibleMarketplaces: ["WB"] }` → сохраняет, следующий GET возвращает `["WB"]`
- `PATCH []` → 422 (class-validator `@ArrayMinSize(1)`)
- `PATCH` Manager-ролью → 403 `ROLE_FORBIDDEN`
