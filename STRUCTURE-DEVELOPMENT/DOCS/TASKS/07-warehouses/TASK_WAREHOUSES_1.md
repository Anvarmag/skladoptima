# TASK_WAREHOUSES_1 — Data Model, Normalization и Lifecycle

> Модуль: `07-warehouses`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `7h`
- Зависимости:
  - утверждена системная аналитика `07-warehouses`
- Что нужно сделать:
  - завести таблицу `warehouses` с `tenant_id`, `marketplace_account_id`, `external_warehouse_id`, `warehouse_type`, `status`, `alias_name`, `labels`;
  - закрепить lifecycle `ACTIVE / INACTIVE / ARCHIVED`;
  - зафиксировать immutable external identity в рамках `(tenant, account, external_id)`;
  - предусмотреть `deactivation_reason`, `first_seen_at`, `last_synced_at`, `inactive_since`;
  - подготовить правила нормализации FBS/FBO и source marketplace.
- Критерий закрытия:
  - data model соответствует `07-warehouses`;
  - lifecycle склада формализован и воспроизводим;
  - reference layer не смешивается с inventory business logic.

**Что сделано**

### Контекст MVP до задачи

В текущем коде самостоятельного warehouse-модуля и таблицы складов не существовало. Складские данные присутствовали только косвенно:
- В [MarketplaceAccount](apps/api/prisma/schema.prisma) есть единичное поле `warehouseId String?` — это id внешнего FBS-склада маркетплейса для push-операций, не справочник;
- [SyncService](apps/api/src/modules/marketplace_sync/sync.service.ts) при `pullFromWb` дёргает `https://marketplace-api.wildberries.ru/api/v3/stocks/${settings.wbWarehouseId}` — фактический warehouse_id живёт строкой в settings, без ссылочной целостности и без классификации FBS/FBO;
- [TASK_INVENTORY_1](apps/api/prisma/schema.prisma) добавил `StockBalance.warehouseId TEXT` без FK — намеренно sentinel-подход (`'default'`) до появления warehouse-домена; в `_aggregate` различение FBS/FBO происходит через `isExternal` boolean прямо на StockBalance, без reference layer;
- Каналные счётчики в `Product` (`wbFbs/wbFbo/ozonFbs/ozonFbo`) — единственное место, где FBS/FBO видны на фронте, и они attached к карточке товара, не к складу.

То есть сейчас система не отвечает на вопрос «какие именно склады знает tenant», — только «какой store-level FBS warehouse у каждого аккаунта».

### Что добавлено

**1. Prisma schema ([schema.prisma](apps/api/prisma/schema.prisma))**

Три новых enum, точно соответствующих §8 system-analytics:

- `WarehouseType` — `FBS`, `FBO`. Жёсткая нормализация per analytics §3 invariant — adapter обязан мапить ответ marketplace API в один из двух вариантов.
- `WarehouseStatus` — `ACTIVE`, `INACTIVE`, `ARCHIVED`. Lifecycle §13: первичная синхронизация → `ACTIVE`; склад исчез из API после safe-window → `INACTIVE`; долго не возвращается → `ARCHIVED`.
- `WarehouseSourceMarketplace` — `WB`, `OZON`, `YANDEX_MARKET`. Отдельный enum от существующего `MarketplaceType`/`ChannelMarketplace` потому, что у warehouse domain свой набор поддерживаемых каналов и lifecycle (Yandex Market в MVP может отдавать склады, но не product mappings).

Новая модель `Warehouse` со всеми полями §8:

| Поле | Тип | Назначение |
|---|---|---|
| `id` | UUID PK | |
| `tenantId` | FK Tenant CASCADE | tenant scope |
| `marketplaceAccountId` | FK MarketplaceAccount CASCADE | один и тот же внешний склад из разных аккаунтов = разные связи (§13 invariant) |
| `externalWarehouseId` | VARCHAR(128) | external truth, immutable |
| `name` | VARCHAR(255) | sync-managed |
| `city` | VARCHAR(128)? | sync-managed |
| `warehouseType` | WarehouseType | sync-managed (FBS/FBO) |
| `sourceMarketplace` | WarehouseSourceMarketplace | sync-managed |
| `aliasName` | VARCHAR(255)? | tenant-local; может редактироваться через PATCH /metadata |
| `labels` | TEXT[] DEFAULT [] | tenant-local теги для группировки/поиска |
| `status` | WarehouseStatus DEFAULT ACTIVE | lifecycle |
| `deactivationReason` | VARCHAR(64)? | заполняется при переходе в INACTIVE |
| `firstSeenAt` | DateTime DEFAULT now() | первая успешная синхронизация |
| `lastSyncedAt` | DateTime? | для метрики `freshness_lag` §19 |
| `inactiveSince` | DateTime? | safe-window таймер для перехода ARCHIVED |
| `metadataUpdatedAt` | DateTime? | audit для tenant-local правок |
| `metadataUpdatedBy` | FK User SetNull | actor правки |
| `createdAt`/`updatedAt` | DateTime | |

Inverse relations:
- `Tenant.warehouses Warehouse[]` (CASCADE на удалении tenant);
- `MarketplaceAccount.warehouses Warehouse[]` (CASCADE — если аккаунт удалён, его склады тоже физически удаляются, исторические inventory-ссылки на `warehouseId` остаются TEXT и не ломаются);
- `User.warehouseMetadataUpdates Warehouse[] @relation("WarehouseMetadataUpdatedBy")` (SetNull — удаление пользователя не ломает справочник).

**2. Миграция ([20260426100000_warehouses_data_model/migration.sql](apps/api/prisma/migrations/20260426100000_warehouses_data_model/migration.sql))**

Hand-crafted SQL:

- 3 enum типа.
- Таблица `Warehouse` с правильными VARCHAR length'ами и `TEXT[] DEFAULT ARRAY[]::TEXT[]` для `labels` (Postgres-specific, Prisma `String[] @default([])`).
- **Главный гарант external identity**: `UNIQUE INDEX (tenantId, marketplaceAccountId, externalWarehouseId)` — защита от двойной upsert'и при гонке worker'ов и закрепление инварианта «один внешний склад в рамках account = одна запись».
- Три дополнительных индекса под типичные запросы из §15 (read-model для inventory):
  - `(tenantId, status)` — base листинг по tenant с фильтром активности (UI default ACTIVE);
  - `(tenantId, sourceMarketplace, warehouseType)` — фильтр FBS/FBO по каналу для inventory drill-in;
  - `(marketplaceAccountId, status)` — sync job по конкретному аккаунту.
- FK с осмысленным `ON DELETE`: tenant CASCADE, account CASCADE, user SET NULL.

**3. Что НЕ делает эта миграция (намеренно)**

- НЕ вводит FK `StockBalance.warehouseId → Warehouse.id`. В TASK_INVENTORY_5 зафиксирован sentinel `DEFAULT_WAREHOUSE_ID = 'default'` для tenants, у которых ещё нет ни одного склада. Bridge между inventory и warehouses появится только после первичного sync use case (TASK_WAREHOUSES_2) и миграции данных — это закроется отдельной задачей, чтобы не ломать работающий inventory модуль одной миграцией.
- НЕ добавляет sync use-case (TASK_WAREHOUSES_2).
- НЕ добавляет API/UI (TASK_WAREHOUSES_3+).
- НЕ убирает `MarketplaceAccount.warehouseId` (legacy single-warehouse hint для push) — он останется до полной миграции push-логики.

### Соответствие критериям закрытия

- **Data model соответствует §8 system-analytics**: все поля §8 присутствуют 1-в-1 (id, tenantId, marketplaceAccountId, externalWarehouseId, name, city, warehouseType, sourceMarketplace, aliasName, labels, status, deactivationReason, lastSyncedAt, firstSeenAt, inactiveSince, metadataUpdatedAt, metadataUpdatedBy + UNIQUE).
- **Lifecycle склада формализован и воспроизводим**: enum `WarehouseStatus` с тремя состояниями (`ACTIVE/INACTIVE/ARCHIVED`); `firstSeenAt` фиксирует точку входа; `inactiveSince` хранит safe-window timer; `deactivationReason` объясняет переход; `lastSyncedAt` даёт метрику свежести. Sync-логика TASK_WAREHOUSES_2 будет применять переходы детерминированно поверх этих полей.
- **Reference layer не смешивается с inventory business logic**: ни одного поля остатка/резерва/movement не добавлено в Warehouse; нет колонок `onHand`/`reserved`/`available`. Класс отвечает только за справочник; FK на StockBalance оставлен на отдельную задачу, чтобы не подмешать inventory транзакционность.

### Проверки

- `npx prisma validate` — `The schema at prisma\schema.prisma is valid`.
- `npx prisma generate` — Prisma Client сгенерирован, `prisma.warehouse` доступен.
- `npx tsc --noEmit` — никаких ошибок.
- `npx jest src/modules/inventory/` — `Tests: 97 passed, 97 total`, регрессия inventory чистая.

### Что осталось вне scope

- Sync use-case (`refresh warehouses` + нормализация WB/Ozon API responses) — TASK_WAREHOUSES_2.
- Read API `/warehouses` + `/warehouses/:id/stocks` — TASK_WAREHOUSES_3.
- PATCH `/warehouses/:id/metadata` для alias/labels с валидацией max-length — TASK_WAREHOUSES_4.
- Tenant-state guards для manual refresh (TRIAL_EXPIRED/SUSPENDED/CLOSED) — TASK_WAREHOUSES_5.
- Frontend warehouse picker и FBS/FBO splitting в inventory UI — TASK_WAREHOUSES_6.
- QA + observability (`warehouses_synced`, `warehouse_upserts`, `inactive_warehouses`, `freshness_lag`) — TASK_WAREHOUSES_7.
- Миграция `StockBalance.warehouseId` на FK — отдельная задача в `08-inventory-warehouse-bridge` (или внутри 07/06 рефакторинга, после первичной синхронизации справочника).
