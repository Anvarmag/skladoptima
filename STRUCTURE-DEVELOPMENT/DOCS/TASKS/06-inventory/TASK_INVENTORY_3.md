# TASK_INVENTORY_3 — Reserve, Release, Deduct Contracts с Orders

> Модуль: `06-inventory`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_INVENTORY_1`
  - `TASK_INVENTORY_2`
  - согласован `10-orders`
- Что нужно сделать:
  - реализовать сервисные контракты `reserve`, `release`, `deduct` от orders;
  - требовать стабильный `source_event_id` и scope `tenant/product/warehouse`;
  - обеспечить транзакционное изменение `on_hand/reserved/available`;
  - логировать reserve/cancel/fulfill через movements;
  - не делать auto-restock на return, только `return_logged`.
- Критерий закрытия:
  - order side-effects предсказуемо меняют inventory;
  - reserve/release/deduct не создают повторных side-effects;
  - return flow соответствует утвержденной MVP policy.

**Что сделано**

### Контекст MVP до задачи

В MVP order side-effects живут прямо в [sync.service.ts](apps/api/src/modules/marketplace_sync/sync.service.ts) (`processWbOrders`, `processOzonOrders`):

- списание делается через `prisma.product.update({ data: { total: { decrement: qty } } })` — без movements, без warehouse, без `source_event_id` tracing;
- идемпотентности нет — повторный запрос API маркетплейса по тому же `order_id` нашёл бы уже-сохранённый MarketplaceOrder и пропустил вторую запись (это работает только пока существует MarketplaceOrder; при ошибке между decrement и create заказа будет двойной decrement);
- reserve/release не существует — order сразу списывается (immediate-deduct flow);
- при отмене Ozon делается **auto-restock** через `total: { increment: qty }` — это нарушает MVP-policy §10/§17 «возврат пишется как `return_logged` без автоплюса в `on_hand`»;
- `actorUserId: 'system-wb'/'system-ozon'` записывается в `AuditLog` как строка вместо UUID — это уже существующая нестыковка (FK не выставлен, поле string).

### Что добавлено

**1. Сервисные контракты в `InventoryService` ([inventory.service.ts](apps/api/src/modules/inventory/inventory.service.ts))**

Четыре публичных метода с одинаковой сигнатурой `(tenantId, sourceEventId, items[])`:

- `reserve(tenantId, sourceEventId, items)` → `effectType=ORDER_RESERVE`, `movementType=ORDER_RESERVED`. `reserved += qty`, `onHand` не меняется.
- `release(tenantId, sourceEventId, items)` → `effectType=ORDER_RELEASE`, `movementType=ORDER_RELEASED`. `reserved -= qty`. Защита `RELEASE_EXCEEDS_RESERVED`.
- `deduct(tenantId, sourceEventId, items)` → `effectType=ORDER_DEDUCT`, `movementType=ORDER_DEDUCTED`. `onHand -= qty`, `reserved -= min(qty, reserved)` — поддерживает оба flow: reserve→deduct и immediate-deduct без предшествующего reserve. Bridge: `Product.total = onHandAfter`.
- `logReturn(tenantId, sourceEventId, items, reasonCode?)` → `movementType=RETURN_LOGGED`. **`onHand` и `reserved` НЕ меняются** — соблюдена MVP-policy «no auto-restock». Получает свой `effectType=SYNC_RECONCILE` lock, чтобы повторный return event не плодил дубль RETURN_LOGGED.

Экспортированы типы `InventoryEffectItem`, `InventoryEffectResult` для будущего orders-модуля.

**2. Идемпотентность через `InventoryEffectLock`**

Главный гарант идемпотентности — UNIQUE `(tenantId, effectType, sourceEventId)` из TASK_INVENTORY_1. Алгоритм `_applyOrderEffect`:

1. Pre-check (`_checkLock`) до открытия транзакции — экономит локи на дубликате:
   - `APPLIED` или `IGNORED` → возвращает `{ status: 'IGNORED', idempotent: true, movements: [] }` без работы.
   - `PROCESSING` → 409 `INVENTORY_EFFECT_PROCESSING` (другой воркер прямо сейчас применяет).
   - `FAILED` или отсутствие → продолжаем (FAILED допускает retry).
2. В транзакции `upsert` lock в `PROCESSING`.
3. Для каждого item: `_lockOrCreateBalance` (lazy-bridge baseline из `Product.total`) → `SELECT ... FOR UPDATE` → recalc → защиты → update balance → создание `StockMovement`.
4. `update` lock → `APPLIED`.
5. При исключении в транзакции — `_markLockFailed` (отдельная транзакция, чтобы переход в FAILED пережил rollback) → throw.

Возврат `{ sourceEventId, effectType, status, idempotent, movements[] }` — единый контракт для orders-модуля.

**3. Контрактные требования по аналитике §15**

| Требование §15 | Реализация |
|---|---|
| стабильный `source_event_id` | Обязательный аргумент, валидация ≤128 chars, прокидывается в lock и каждый `StockMovement.sourceEventId` |
| scope `tenant/product/warehouse` | `tenantId` обязателен; `warehouseId` per-item с дефолтом `'default'`; product проверяется в `findFirst`; foreign-product → `PRODUCT_NOT_FOUND` |
| идемпотентность не на HTTP, а на business effect | `InventoryEffectLock` per `(tenantId, effectType, sourceEventId)` + UNIQUE constraint в БД как страховка |
| FBO не должен ломать управляемый контур | `RESERVED_EXCEEDS_ONHAND`/`NEGATIVE_STOCK_NOT_ALLOWED` пропускают `isExternal=true` балансы (FBO информационный) |

**4. Защиты (defense-in-depth)**

Service-layer:
- `SOURCE_EVENT_ID_REQUIRED`, `ITEMS_REQUIRED`, `ITEM_PRODUCT_ID_REQUIRED`, `ITEM_QTY_INVALID` (только positive integer).
- `NEGATIVE_STOCK_NOT_ALLOWED` при `onHandAfter < 0` (deduct).
- `RELEASE_EXCEEDS_RESERVED` при `reservedAfter < 0` (release).
- `RESERVED_EXCEEDS_ONHAND` для управляемого FBS: `reservedAfter > onHandAfter`.

DB-layer (из TASK_INVENTORY_1, страховка от багов в коде):
- `CHECK (onHand >= 0)`, `CHECK (reserved >= 0)`.
- `CHECK (isExternal = true OR reserved <= onHand)` для управляемого контура.
- `UNIQUE(tenantId, effectType, sourceEventId)` блокирует двойной insert lock.

**5. Тесты — [inventory.orders.spec.ts](apps/api/src/modules/inventory/inventory.orders.spec.ts)**

21 тест в 4 describe-блоках:

*reserve (10):* положительный путь с APPLIED lock; идемпотентный replay (APPLIED → IGNORED); 409 для PROCESSING; retry разрешён для FAILED; блок `RESERVED_EXCEEDS_ONHAND` при недостатке onHand; FBO bypass этого CHECK; SOURCE_EVENT_ID_REQUIRED; ITEMS_REQUIRED; ITEM_QTY_INVALID для 0/-1; падение на втором item приводит к lock=FAILED; PRODUCT_NOT_FOUND.

*release (2):* успешное уменьшение reserved + ORDER_RELEASED movement; блок `RELEASE_EXCEEDS_RESERVED`.

*deduct (5):* стандартный flow reserve→deduct (reserved→0, onHand-=qty, Product.total bridge); immediate-deduct без reserve; partial reserve (qty>reserved); блок `NEGATIVE_STOCK_NOT_ALLOWED`; идемпотентный replay не трогает `Product.update`.

*logReturn (3):* RETURN_LOGGED БЕЗ изменения onHand/reserved (главная проверка no-auto-restock); идемпотентный replay; default reasonCode = `RETURN`.

Итог: `Tests: 37 passed, 37 total` (16 adjustments/listings из TASK_INVENTORY_2 + 21 новый).

`tsc --noEmit` — никаких новых ошибок.

### Соответствие критериям закрытия

- **Order side-effects предсказуемо меняют inventory**: каждый эффект = одна транзакция с FOR UPDATE на balance + запись StockMovement, before/after-снимки полностью трассируемы.
- **Reserve/release/deduct не создают повторных side-effects**: `InventoryEffectLock` (APPLIED/PROCESSING/IGNORED) перехватывает повтор до открытия транзакции; UNIQUE-индекс ловит race-condition между параллельными воркерами.
- **Return flow соответствует MVP policy**: `logReturn` пишет только `RETURN_LOGGED` без `+qty` к `onHand`; восстановление остатка остаётся явным решением пользователя через manual-adjustment.

### Что осталось вне scope

- Подключение `processWbOrders`/`processOzonOrders` к новым контрактам (замена `Product.total.decrement` и убирание Ozon-cancel auto-restock) — TASK_INVENTORY_5.
- Реальный orders-модуль с lifecycle (NEW → RESERVED → FULFILLED/CANCELLED) — `10-orders`.
- Conflict-detector для устаревших внешних событий (timestamp-stale events) — TASK_INVENTORY_4.
- Tenant-state pause для marketplace order ingestion в `TRIAL_EXPIRED` — TASK_INVENTORY_5.
