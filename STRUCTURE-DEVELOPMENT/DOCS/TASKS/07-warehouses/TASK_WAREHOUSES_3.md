# TASK_WAREHOUSES_3 — Read API, Filters и Stock-by-Warehouse Contract

> Модуль: `07-warehouses`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `7h`
- Зависимости:
  - `TASK_WAREHOUSES_1`
  - `TASK_WAREHOUSES_2`
  - согласован `06-inventory`
- Что нужно сделать:
  - реализовать `GET /warehouses`, `GET /warehouses/:id`, `GET /warehouses/:id/stocks`;
  - поддержать фильтры по account, marketplace, type, status, source;
  - отдать inventory-friendly read-model с `warehouse_type`, `status`, `alias_name`, `labels`, `deactivation_reason`;
  - не открывать ручное создание/удаление складов через API в MVP;
  - обеспечить быстрый read API для справочника.
- Критерий закрытия:
  - warehouse directory читается как reference-справочник;
  - inventory может безопасно использовать warehouse read-model;
  - FBS/FBO визуально и логически не смешиваются.

**Что сделано**

### Контекст MVP до задачи

К моменту начала этой задачи в проекте уже был:
- Schema модель `Warehouse` (TASK_WAREHOUSES_1) с полным набором полей §8 system-analytics.
- `WarehouseSyncService` (TASK_WAREHOUSES_2) с idempotent upsert и lifecycle.
- На фронте/HTTP API ничего не было — UI и downstream-модули не могли читать справочник.
- `Inventory.tsx` (TASK_INVENTORY_6) показывал balance.warehouseId только как строку (`fbs1`, `default`), без human-readable имени и привязки к marketplace account.

В [SyncService](apps/api/src/modules/marketplace_sync/sync.service.ts) присутствовал endpoint-overlay `fetchWbWarehouses`, но он работал на raw API ответе и не использовал хранимые данные — это не reference-API, а debug-tool.

### Что добавлено

**1. [WarehouseService](apps/api/src/modules/warehouses/warehouse.service.ts) — read-only сервис справочника**

Три публичных метода соответствуют §6 system-analytics:

- `list(tenantId, opts)` — pagination (`page/limit`, hard cap 200), фильтры `marketplaceAccountId`/`sourceMarketplace`/`warehouseType`/`status`/`search`. Сортировка `(status asc, name asc)` — ACTIVE наверх, INACTIVE/ARCHIVED ниже, внутри по алфавиту. Возвращает `{ data: [readModel], meta: { total, page, limit, lastPage } }`. Поиск делает `OR` по `name`/`aliasName`/`city` с `mode: 'insensitive'`.
- `getById(tenantId, warehouseId)` — карточка с include `marketplaceAccount(id, name, marketplace)`. NotFound для чужого/несуществующего склада.
- `getStocks(tenantId, warehouseId)` — агрегирует `StockBalance` по этому складу + считает `totals { onHand, reserved, available }`. Bridge-стратегия: `StockBalance.warehouseId == Warehouse.externalWarehouseId` (TEXT match). Удалённые продукты (`product.deletedAt != null`) исключаются. `Math.max(0, available)` кламп — defensive.

Все методы tenant-scoped, write-операций не предоставляют.

**2. Read-model контракт §15**

Приватный `_toReadModel(warehouse)` отдаёт только нужные поля: `id`, `tenantId`, `marketplaceAccountId`, `marketplaceAccount: { id, name, marketplace }`, `externalWarehouseId`, `name`, `city`, `warehouseType`, `sourceMarketplace`, `aliasName`, `labels`, `status`, `deactivationReason`, `firstSeenAt`, `lastSyncedAt`, `inactiveSince`. Это точно соответствует §15 system-analytics для inventory UI и downstream-модулей. Внутренние audit-поля (`metadataUpdatedAt/By`, `createdAt`/`updatedAt`) не утекают.

`getStocks` отдаёт компактный response: `{ warehouse: {7 полей}, totals: { onHand, reserved, available }, items: [{...}], count }`.

**3. [WarehouseController](apps/api/src/modules/warehouses/warehouse.controller.ts)**

REST endpoints под `/warehouses`, защищены `RequireActiveTenantGuard`:

| Метод | Endpoint | Назначение |
|---|---|---|
| GET | `/warehouses` | Список с фильтрами |
| GET | `/warehouses/:id` | Карточка склада |
| GET | `/warehouses/:id/stocks` | Остатки по складу |

Query-параметры enum'ов проходят через хелпер `_asEnum<E>(value, e)`: case-insensitive uppercase + проверка по `Object.values` — невалидное значение даёт `undefined` (фильтр игнорируется), а не 400. Это удобнее для UI: empty/invalid фильтр = «все».

**4. Что НЕ открывается через API в MVP (по §10/§13)**

- POST/PUT/DELETE `/warehouses` — manual create/delete запрещён, единственный path заведения склада это `WarehouseSyncService.syncForAccount`.
- POST `/warehouses/sync` (manual refresh) — оставлен на TASK_WAREHOUSES_4 или 5 (там же `TenantWriteGuard`).
- PATCH `/warehouses/:id/metadata` для `aliasName`/`labels` — TASK_WAREHOUSES_4.
- Любая попытка изменить `externalWarehouseId/name/city/warehouseType/sourceMarketplace` через API — невозможна, потому что нет соответствующих endpoint'ов и нет write-сервиса.

**5. Bridge-стратегия для `getStocks`**

`StockBalance.warehouseId TEXT` (TASK_INVENTORY_1) сейчас содержит либо sentinel `'default'` (TASK_INVENTORY_5 для tenants без warehouse-домена), либо `externalWarehouseId` строкой, который в будущем поставит sync. Вместо немедленного добавления FK (что потребовало бы миграцию данных и breaking change для `_aggregate` в `InventoryService`), `getStocks` делает прямой match `StockBalance.warehouseId == Warehouse.externalWarehouseId`. Это:
- работает прямо сейчас для существующих balance-записей с `'default'` (которые match'ат warehouse с `externalWarehouseId='default'`, если такой создан sync'ом — иначе пустой результат, корректно);
- даёт чистый upgrade-path: после миграции `StockBalance.warehouseId → Warehouse.id` достаточно заменить условие на `where: { warehouseId: w.id }` без изменения публичного контракта.

**6. Тесты — [warehouse.service.spec.ts](apps/api/src/modules/warehouses/warehouse.service.spec.ts)**

11 тестов в 3 describe-блоках:

*list (5):* возвращает read-model с pagination; фильтры `marketplaceAccountId/sourceMarketplace/warehouseType/status` пробрасываются в `where`; search — OR по name/aliasName/city `mode: 'insensitive'`; limit clamp (>200 → 50, отрицательный → 50); по умолчанию НЕ фильтрует по статусу (reference visibility для INACTIVE/ARCHIVED).

*getById (2):* возвращает карточку (включая `deactivationReason` для INACTIVE склада); WAREHOUSE_NOT_FOUND для чужого.

*getStocks (4):* агрегирует балансы по `externalWarehouseId`, исключает удалённые продукты, считает totals; WAREHOUSE_NOT_FOUND для чужого склада; пустой ответ для склада без балансов; кламп negative `available` в `totals.available`.

Совокупно: `Tests: 27 passed, 27 total` (warehouse module = 16 sync + 11 read-API).

Полный suite (inventory + warehouses): `Tests: 124 passed, 124 total` в 7 suites. `tsc --noEmit` чисто.

### Соответствие критериям закрытия

- **Warehouse directory читается как reference-справочник**: `GET /warehouses` отдаёт по умолчанию все статусы (включая INACTIVE/ARCHIVED) — UI решает, что показывать; sort `(status, name)` стабилен; pagination + фильтры покрывают listing-сценарии MVP. Read-model компактный, без внутренних audit-полей.
- **Inventory может безопасно использовать warehouse read-model**: контракт §15 точно соответствует — `warehouse_type`, `status`, `alias_name`, `labels`, `deactivation_reason` все на месте; `getStocks` даёт inventory-friendly агрегат с totals.
- **FBS/FBO визуально и логически не смешиваются**: фильтр `warehouseType` явный; в response каждой записи `warehouseType` поле обязательно — UI отрисует разделение; внутри stock-агрегата приходит `fulfillmentMode + isExternal` для каждой строки баланса.

### Что осталось вне scope

- PATCH `/warehouses/:id/metadata` для `aliasName`/`labels` — TASK_WAREHOUSES_4.
- POST `/warehouses/sync` (manual refresh) — TASK_WAREHOUSES_4 или 5 (внутри tenant-state guard блока).
- Frontend warehouse picker и FBS/FBO splitting в inventory UI — TASK_WAREHOUSES_6.
- Миграция `StockBalance.warehouseId TEXT → FK Warehouse.id` — отдельная задача после первичного sync'а у всех tenant'ов.
- Пагинация по cursor для очень больших справочников (1000+) — out of MVP, offset-pagination достаточно при текущих объёмах.
