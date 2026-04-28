# TASK_INVENTORY_1 — Data Model, Balances, Movements и Settings

> Модуль: `06-inventory`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - утверждена системная аналитика `06-inventory`
  - согласован `05-catalog`
- Что нужно сделать:
  - завести `stock_balances`, `stock_movements`, `inventory_effect_locks`, `inventory_settings`;
  - закрепить расчет `available = on_hand - reserved` как вычисляемое поле;
  - предусмотреть `movement_type`, `source_event_id`, `idempotency_key`, `reason_code`, actor/source tracing;
  - заложить warehouse scope и FBS/FBO границы в модель учета;
  - подготовить constraints и индексы для корректности остатков и idempotency.
- Критерий закрытия:
  - data model соответствует `06-inventory`;
  - balances и movements воспроизводимы для расследований;
  - schema готова к reserve/release/deduct без серых зон.

**Что сделано**

### Контекст MVP до задачи

В текущей реализации остатки лежали прямо в `Product.total` и `Product.reserved`, а каналные счётчики (`ozonFbs`, `ozonFbo`, `wbFbs`, `wbFbo`) были отдельными колонками в карточке. Корректировка остатка делалась простым `UPDATE Product SET total = ...` через `ProductService.adjustStock` без movements, без warehouse scope, без идемпотентности и без защиты от устаревших внешних событий. Outsourced inventory-домена в проекте не существовало.

### Что добавлено в этой задаче

**1. Prisma schema (`apps/api/prisma/schema.prisma`)**

Новые enums:
- `StockMovementType` — `MANUAL_ADD`, `MANUAL_REMOVE`, `ORDER_RESERVED`, `ORDER_RELEASED`, `ORDER_DEDUCTED`, `INVENTORY_ADJUSTMENT`, `RETURN_LOGGED`, `CONFLICT_DETECTED`.
- `StockMovementSource` — `USER`, `SYSTEM`, `MARKETPLACE`.
- `InventoryFulfillmentMode` — `FBS`, `FBO`.
- `InventoryEffectType` — `ORDER_RESERVE`, `ORDER_RELEASE`, `ORDER_DEDUCT`, `SYNC_RECONCILE`.
- `InventoryEffectStatus` — `PROCESSING`, `APPLIED`, `IGNORED`, `FAILED`.

Новые модели:
- `StockBalance` — агрегированный баланс по `(tenantId, productId, warehouseId)`. Поля: `onHand`, `reserved`, `available` (как `STORED GENERATED` в БД, в Prisma помечено `@default(dbgenerated())`), `fulfillmentMode`, `isExternal`. Уникальный ключ `(tenantId, productId, warehouseId)`, индексы по `(tenantId, productId)` и `(tenantId, fulfillmentMode)`.
- `StockMovement` — append-only лог. Поля: `movementType`, `delta`, `onHandBefore/After`, `reservedBefore/After`, `reasonCode`, `comment`, `source`, `sourceEventId`, `idempotencyKey`, `actorUserId`. Индексы для типичных запросов: `(tenantId, productId, createdAt)`, `(tenantId, sourceEventId)`, `(tenantId, movementType, createdAt)`. Связь с `User` через `actorUserId` с `onDelete: SetNull`.
- `InventoryEffectLock` — точка идемпотентности для reserve/release/deduct и sync-reconciliation. Уникальный ключ `(tenantId, effectType, sourceEventId)`.
- `InventorySettings` — настройки per-tenant с `lowStockThreshold` (default 5).

Inverse-relations добавлены в `Tenant`, `Product`, `User`.

**2. Миграция (`apps/api/prisma/migrations/20260426090000_inventory_data_model/migration.sql`)**

Hand-crafted SQL:
- 5 новых enum-типов.
- 4 новые таблицы со всеми FK (CASCADE на tenant/product, SET NULL на actor).
- `StockBalance.available` как `INTEGER GENERATED ALWAYS AS ("onHand" - "reserved") STORED` — расчёт available закреплён на уровне БД, бизнес-логика не сможет рассинхронизировать его с `onHand/reserved`.
- CHECK constraints: `onHand >= 0`, `reserved >= 0`, и для управляемого FBS-контура (`isExternal = false`) дополнительно `reserved <= onHand` — структурный запрет отрицательных остатков из решений §23 system-analytics.
- Partial unique index на `StockMovement(tenantId, idempotencyKey) WHERE idempotencyKey IS NOT NULL` — manual movements могут идти без ключа, а внешние события идемпотентно дедуплицируются.
- Главный idempotency-замок: `UNIQUE(tenantId, effectType, sourceEventId)` на `InventoryEffectLock`.

**3. Решения по моделированию**

- `warehouseId` оставлен `TEXT` без FK, потому что справочник складов в system-analytics §2 определён как «внешний reference layer» вне inventory-модуля. В MVP можно использовать строковый идентификатор (например, `default`/`fbs_main`); FK добавится отдельной задачей, когда появится Warehouse-домен.
- FBS/FBO граница из §14 закреплена двумя полями: `fulfillmentMode` (enum) и `isExternal` (boolean). Это даёт возможность хранить FBO-балансы в той же таблице с признаком, но не смешивать их с управляемым контуром при push в каналы (CHECK не применяется к `isExternal=true`).
- `Product.total` и каналные `ozonFbs/ozonFbo/wbFbs/wbFbo` пока не удаляются — миграция данных и переключение `ProductService.adjustStock` на новый домен закроется в TASK_INVENTORY_2/3, чтобы не ломать существующие endpoints одной задачей.

**4. Проверки**

- `npx prisma validate` — schema валидна.
- `npx prisma generate` — Prisma client сгенерирован, новые модели доступны как `prisma.stockBalance`, `prisma.stockMovement`, `prisma.inventoryEffectLock`, `prisma.inventorySettings`.
- `npx tsc --noEmit` — никаких новых ошибок типизации; pre-existing ошибки в `import.service`, `team-scheduler.service` и тестовых скриптах не связаны с задачей.

### Соответствие критериям закрытия

- Data model соответствует §8 и §13 system-analytics: balances/movements/effect_locks/settings; available — вычисляемое поле; movement_type, source_event_id, idempotency_key, reason_code и actor tracing — на месте; warehouse scope и FBS/FBO границы заложены.
- Movements воспроизводимы: append-only лог с before/after снимками для onHand и reserved.
- Schema готова к reserve/release/deduct: уникальный замок `InventoryEffectLock` плюс partial unique по `idempotencyKey` гарантируют ровно одно применение каждого события.

### Что осталось вне scope (для следующих задач)

- Сервисный слой reserve/release/deduct с `SELECT ... FOR UPDATE` — TASK_INVENTORY_3.
- Manual adjustments API + history endpoint — TASK_INVENTORY_2.
- Перенос `Product.total/reserved` и каналных счётчиков в `StockBalance` — TASK_INVENTORY_2/5.
- Tenant-state guards для inventory write-paths — TASK_INVENTORY_5.
