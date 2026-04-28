# TASK_INVENTORY_2 — Manual Adjustments, History и Low-Stock Settings

> Модуль: `06-inventory`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_INVENTORY_1`
- Что нужно сделать:
  - реализовать `GET stocks`, `GET movements`, `POST adjustments`, `GET low-stock`, `PATCH threshold`;
  - поддержать adjustment по `delta` или target quantity с обязательным reason/comment;
  - писать movement history в той же транзакции, что и изменение остатка;
  - полностью запретить уход в отрицательный `on_hand`;
  - подготовить low-stock integration контракт для notifications.
- Критерий закрытия:
  - ручные корректировки атомарны и трассируемы;
  - negative stock невозможен;
  - пользователь видит остаток, резерв и причину изменения.

**Что сделано**

### Контекст MVP до задачи

В MVP корректировки остатка делались через `POST /products/:id/stock-adjust` — простой `Product.total += delta` без movements, без warehouse scope, без обязательного `reasonCode`, без идемпотентности и без атомарности (UPDATE без FOR UPDATE). История изменений хранилась только в общей `AuditLog` строкой `STOCK_ADJUSTED` без before/after по reserved и без source tracing. Endpoint'ов inventory как отдельного домена не существовало.

### Что добавлено

**1. Новый модуль `apps/api/src/modules/inventory/`**

- [inventory.module.ts](apps/api/src/modules/inventory/inventory.module.ts) — Nest module с импортом `AuditModule`, экспортирует `InventoryService`.
- [inventory.controller.ts](apps/api/src/modules/inventory/inventory.controller.ts) — REST endpoints под `/inventory`. Все защищены `RequireActiveTenantGuard`; write-операции (`POST adjustments`, `PATCH settings/threshold`) дополнительно проходят `TenantWriteGuard` (block для `TRIAL_EXPIRED/SUSPENDED/CLOSED`).
- [inventory.service.ts](apps/api/src/modules/inventory/inventory.service.ts) — бизнес-логика.
- [dto/create-adjustment.dto.ts](apps/api/src/modules/inventory/dto/create-adjustment.dto.ts) — поддержка двух режимов (`delta` либо `targetQuantity`, ровно одно из них через `ValidateIf`); обязательный `reasonCode` в формате UPPER_SNAKE_CASE; опциональный `idempotencyKey`.
- [dto/update-threshold.dto.ts](apps/api/src/modules/inventory/dto/update-threshold.dto.ts) — DTO для PATCH порога с `Min(0)`.

Module зарегистрирован в [app.module.ts](apps/api/src/app.module.ts).

**2. API контракт (соответствует §6 system-analytics)**

| Метод   | Endpoint                              | Назначение |
|---------|---------------------------------------|------------|
| GET     | `/inventory/stocks`                   | Список товаров с агрегированным балансом, search + pagination |
| GET     | `/inventory/stocks/:productId`        | Детализация по складам/каналам |
| POST    | `/inventory/adjustments`              | Manual-корректировка (delta или targetQuantity) |
| GET     | `/inventory/movements`                | История движений с фильтрами `productId/movementType/from/to` |
| GET     | `/inventory/low-stock`                | Товары с available <= threshold (поддержка query-override) |
| GET     | `/inventory/settings`                 | Текущие inventory settings |
| PATCH   | `/inventory/settings/threshold`       | Обновить low-stock threshold |

**3. Атомарность и трассируемость корректировки (§9, §13)**

`createAdjustment` выполняется в `prisma.$transaction`:
1. Загружает продукт (`tenantId + deletedAt = null`).
2. `upsert` на `StockBalance(tenantId, productId, warehouseId)` — ленивый bridge с MVP: при первой корректировке ряд создаётся с baseline `onHand = product.total`.
3. `SELECT ... FOR UPDATE` через `prisma.$queryRaw` блокирует ряд до конца транзакции — устраняет race-condition между параллельными корректировками.
4. Считает `delta = targetQuantity - onHandBefore`, если режим target.
5. Защита от отрицательного остатка на двух уровнях (defense-in-depth):
   - В коде: `NEGATIVE_STOCK_NOT_ALLOWED` при `onHandBefore + delta < 0`.
   - В БД: `CHECK (onHand >= 0)` из миграции TASK_INVENTORY_1.
6. Защита от рассинхронизации с резервами для управляемого FBS-контура: `RESERVED_EXCEEDS_ONHAND` при `reserved > onHandAfter` (DB CHECK тоже на месте).
7. Запись в `StockBalance.onHand`, создание `StockMovement` с before/after-снимками `onHand` и `reserved`, `movementType = MANUAL_ADD/MANUAL_REMOVE`, `source = USER`, `actorUserId`, `reasonCode`, `comment`, `idempotencyKey`.
8. Bridge: синхронный апдейт `Product.total = onHandAfter` для совместимости с UI/sync, потребляющими legacy-поля. Полная отвязка — TASK_INVENTORY_5.

После транзакции — глобальный `AuditLog` `STOCK_ADJUSTED` с before/after total, structured-лог `inventory_adjustment_applied` для observability.

**4. Идемпотентность (§13, §15)**

- При наличии `idempotencyKey` сервис до транзакции ищет существующий `StockMovement(tenantId, idempotencyKey)`. Если найден — возвращает результат с флагом `replayed: true` без новой записи.
- На уровне БД дополнительно работает partial unique index из TASK_INVENTORY_1 (`UNIQUE(tenantId, idempotencyKey) WHERE idempotencyKey IS NOT NULL`) — защита даже при гонке.

**5. Lazy-bridge с MVP**

Чтобы не ломать существующие данные/UI:
- `listStocks`/`getStockDetail`: если у продукта нет ни одного `StockBalance`, возвращается синтетический баланс с `warehouseId='default'`, `fulfillmentMode=FBS`, `onHand=product.total`, `reserved=product.reserved`. Когда появляется первая корректировка — таблица заполняется, и сервис переключается на StockBalance как источник истины (агрегирует только управляемые `isExternal=false`).
- `listLowStock`: основной источник — `StockBalance` с `available <= threshold` (использует STORED GENERATED колонку из TASK_INVENTORY_1); добавляется фоллбек по продуктам без баланса с пометкой `source: 'product_fallback'`.
- Sentinel `DEFAULT_WAREHOUSE_ID = 'default'` зафиксирован в одном месте сервиса — заменится FK на Warehouse в TASK_INVENTORY_5+.

**6. Low-stock settings**

- `InventorySettings` per-tenant создаётся лениво при первом GET (upsert с дефолтом 5 из миграции).
- `PATCH settings/threshold` — `upsert` с валидацией `Min(0)`; structured-лог `inventory_threshold_updated`.
- `GET low-stock?threshold=N` — query-override без записи (сценарий dashboard-фильтрации).
- Контракт для notifications: endpoint возвращает `{ threshold, count, items[] }` с полями `productId, sku, name, warehouseId, onHand, reserved, available, source` — готов к подписке notifications-модуля без дополнительного API surface.

**7. Тесты**

[inventory.service.spec.ts](apps/api/src/modules/inventory/inventory.service.spec.ts) — 16 тестов в 2 describe-блоках:

*adjustments (10):* положительный delta + audit + bridge update; targetQuantity → delta; блок отрицательного onHand; блок reserved > onHand для управляемого склада; mode required; mode ambiguous; delta=0; targetQuantity == current (no-op); idempotent replay не вызывает $transaction и create; PRODUCT_NOT_FOUND.

*listings (6):* listStocks fallback на Product.total; listStocks агрегирует только управляемые балансы (исключая external FBO); listLowStock объединяет балансы и фоллбек; threshold-override; updateThreshold upsert и валидация THRESHOLD_NEGATIVE; getStockDetail NotFound.

Результат: `Tests: 16 passed, 16 total`.

`npx tsc --noEmit` — никаких новых ошибок типизации; pre-existing failures в `team.service.spec.ts/tenant.service.spec.ts` (DI mocks) и в `import.service` к задаче не относятся.

### Соответствие критериям закрытия

- **Ручные корректировки атомарны и трассируемы**: транзакция с FOR UPDATE на StockBalance + StockMovement в той же транзакции, обязательный `reasonCode`, before/after-снимки, `actorUserId`, `idempotencyKey`.
- **Negative stock невозможен**: проверка в сервисе + CHECK constraint в БД + блок `RESERVED_EXCEEDS_ONHAND` для FBS.
- **Пользователь видит остаток, резерв и причину изменения**: `GET /inventory/stocks/:productId` возвращает balances с onHand/reserved/available по складам; `GET /inventory/movements` показывает `reasonCode`, `comment`, `actorUser.email`, `delta`, before/after.
- **Low-stock контракт для notifications**: structured response с `threshold/count/items`, готов к интеграции уведомлений в TASK_INVENTORY_5+.

### Что осталось вне scope

- Reserve/release/deduct контракты с orders — TASK_INVENTORY_3.
- InventoryEffectLock-driven idempotency для внешних событий — TASK_INVENTORY_4.
- Tenant-state guards для FBS/FBO sync handoff и удаление legacy-полей `Product.total/ozonFbs/wbFbs/...` — TASK_INVENTORY_5.
- Frontend inventory UX и diagnostics — TASK_INVENTORY_6.
- Подписка notifications на low-stock контракт — TASK_INVENTORY_5/7.
