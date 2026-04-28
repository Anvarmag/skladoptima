# TASK_WAREHOUSES_2 — Sync и Import Справочника Складов

> Модуль: `07-warehouses`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_WAREHOUSES_1`
  - согласованы `08-marketplace-accounts` и `09-sync`
- Что нужно сделать:
  - реализовать sync use-case получения складов из marketplace account API;
  - нормализовать внешние ответы в канонический warehouse DTO;
  - делать upsert по `(tenant, account, external_id)` без дублей;
  - переводить пропавшие склады сначала в `INACTIVE`, затем в `ARCHIVED` по safe-window policy;
  - учитывать lifecycle marketplace account: если account перестал быть operational source, warehouse reference не удаляется, а корректно уходит в неактуальное состояние по policy;
  - не удалять исторические reference links при исчезновении склада из API.
- Критерий закрытия:
  - первичная загрузка и повторный sync работают идемпотентно;
  - disappeared warehouses проходят согласованный lifecycle;
  - внешний source-of-truth сохраняется без ручных искажений;
  - account state не приводит к silent loss warehouse references.

**Что сделано**

### Контекст MVP до задачи

В [SyncService](apps/api/src/modules/marketplace_sync/sync.service.ts) был только метод `fetchWbWarehouses` (тонкий прокси к WB `/api/v3/warehouses` без сохранения) и `testOzonConnection` (тыкающий `/v1/warehouse/list` для проверки credentials). Никакой нормализации, upsert'а в новую таблицу `Warehouse` (TASK_WAREHOUSES_1) и lifecycle policy не было. Tenant-state pause тоже не учитывался — `fetchWbWarehouses` дёргал WB API даже для TRIAL_EXPIRED tenant'ов.

Stock pull через `pullFromWb` использовал `settings.wbWarehouseId` — единственный warehouse_id, который продавец вручную задаёт в Settings, а не из справочника. Если у продавца было несколько FBS-складов, MVP видел только один.

### Что добавлено

**1. Новый модуль `apps/api/src/modules/warehouses/`**

- [warehouses.module.ts](apps/api/src/modules/warehouses/warehouses.module.ts) — Nest module, экспортирует `WarehouseSyncService`. Зарегистрирован в [app.module.ts](apps/api/src/app.module.ts).
- [warehouse-snapshot.ts](apps/api/src/modules/warehouses/warehouse-snapshot.ts) — канонический DTO `WarehouseSnapshot { externalWarehouseId, name, city?, warehouseType, sourceMarketplace }`. К нему приводятся ответы всех marketplace API.
- [normalizers/wb.normalizer.ts](apps/api/src/modules/warehouses/normalizers/wb.normalizer.ts) — чистая функция нормализации WB ответа: `id → externalWarehouseId` (string-coerced + 128-clip), `name` (trim + 255-clip), `address` → первая часть до запятой как `city` (128-clip), warehouseType=`FBS` (FBO склады WB не приходят в этот endpoint), sourceMarketplace=`WB`. Дедупликация в `normalizeWbWarehouseList` по `externalWarehouseId` — на случай, если API вернёт дубль.
- [normalizers/ozon.normalizer.ts](apps/api/src/modules/warehouses/normalizers/ozon.normalizer.ts) — Ozon `/v1/warehouse/list`: `warehouse_id+name → snapshot`; `is_rfbs` обрабатывается, но в обоих случаях warehouseType=`FBS` (rFBS — это тоже склад продавца, FBO Ozon не отдаёт через этот endpoint, см. §14 system-analytics).
- [warehouse-sync.service.ts](apps/api/src/modules/warehouses/warehouse-sync.service.ts) — основной service.

**2. Use-case `syncForAccount(accountId)`**

Алгоритм:

1. `findUnique(MarketplaceAccount)` — иначе `MARKETPLACE_ACCOUNT_NOT_FOUND`.
2. Резолвится `WarehouseFetcher` под marketplace (WB или OZON). Эти fetchers — приватные методы сервиса, дёргающие реальный axios; `axios` в тестах мокается через `jest.mock('axios')`, что даёт чисто unit-тестируемый sync без реальных HTTP.
3. **Failed API path**: если fetcher вернул `error` (нет credentials, network, 4xx/5xx) — НИЧЕГО не пишется в Warehouse, lifecycle НЕ применяется, `marketplaceAccount.lastSyncStatus` НЕ помечается ok. Это закрывает требование «account state не приводит к silent loss» из DoD: один сбой не зануляет справочник.
4. **Successful path**:
   - Нормализация ответа в массив `WarehouseSnapshot[]`.
   - Для каждого snapshot — `_upsertSnapshot`:
     - `findUnique` по UNIQUE `(tenantId, marketplaceAccountId, externalWarehouseId)` из TASK_WAREHOUSES_1;
     - если не существует — `create` с `firstSeenAt=now`, `lastSyncedAt=now`, `status=ACTIVE`;
     - если существует — `update` сync-managed полей (`name/city/warehouseType/sourceMarketplace/lastSyncedAt`); если был `INACTIVE/ARCHIVED`, обнуляются `inactiveSince/deactivationReason` и status переводится в `ACTIVE` (reactivation);
     - **`aliasName` и `labels` НЕВОЗМОЖНО перезаписать sync-логикой** — они не упоминаются в `update.data` (защита tenant-local полей §8/§13 invariant).
     - При смене `warehouseType`/`sourceMarketplace` логируется `warehouse_classification_changed` (warn) — это §19 алертная метрика.
   - **Disappeared lifecycle (§13/§14)**: `_markDisappeared` собирает все `ACTIVE` записи (tenantId+accountId), которых не оказалось в seen-set, и через `updateMany` переводит в `INACTIVE` с `inactiveSince=now`, `deactivationReason='NOT_RETURNED_BY_API'`. Удаление НЕ выполняется — историческая ссылка остаётся.
   - **Safe-window archive (§14)**: `_archiveStale` берёт `INACTIVE` записи с `inactiveSince <= now - 30 days` и через `updateMany` переводит в `ARCHIVED`. Константа `ARCHIVE_AFTER_DAYS = 30` зафиксирована в коде.
5. После всех операций — `marketplaceAccount.update({ lastSyncAt, lastSyncStatus: 'ok', lastSyncError: null })`.
6. `WarehouseSyncResult { fetched, created, updated, deactivated, archived, reactivated }` — счётчики для UI/observability.

**3. Use-case `syncAllForTenant(tenantId)` с tenant-state pause**

По §16 task'а и аналогии с TASK_INVENTORY_5: TRIAL_EXPIRED/SUSPENDED/CLOSED → возвращается `{ paused: true, results: [] }` без единого HTTP-запроса (`marketplaceAccount.findMany` тоже не дёргается). Логируется warn `warehouse_sync_paused_by_tenant_state`. Возврат tenant'а в активное состояние снимает паузу автоматически на следующем вызове.

В активном tenant метод итерирует все аккаунты и вызывает `syncForAccount(account.id)` для каждого. Ошибка одного аккаунта не валит остальные — exception ловится и пишется в `results[].error`.

**4. Lifecycle invariants (§13)**

| От | К | Условие |
|---|---|---|
| `(none)` | `ACTIVE` | первый успешный sync создаёт запись с `firstSeenAt=now` |
| `ACTIVE` | `INACTIVE` | API вернул успех, но конкретного склада нет в ответе |
| `INACTIVE` | `ARCHIVED` | `inactiveSince <= now - 30d` (safe-window) |
| `INACTIVE`/`ARCHIVED` | `ACTIVE` | склад вернулся в API → reactivation, `inactiveSince=null`, `deactivationReason=null` |
| `*` | `*` | failed API → НИКАКИЕ переходы не применяются |

**5. Observability (§19)**

10 канонических event-имён в `WarehouseSyncEvents` константе:
- `warehouse_sync_started`, `warehouse_sync_completed`, `warehouse_sync_failed`, `warehouse_sync_paused_by_tenant_state`;
- `warehouse_upsert_created`, `warehouse_upsert_updated`;
- `warehouse_lifecycle_inactive`, `warehouse_lifecycle_archived`, `warehouse_lifecycle_reactivated`;
- `warehouse_classification_changed` (тревожный — §20 риск).

Метрики из system-analytics §19 (`warehouses_synced`, `warehouse_upserts`, `inactive_warehouses`, `classification_changes`, `freshness_lag`) теперь имеют точные источники (event'ы + `lastSyncedAt` поле).

**6. Тесты — [warehouse-sync.service.spec.ts](apps/api/src/modules/warehouses/warehouse-sync.service.spec.ts)**

16 тестов в 3 describe-блоках:

*WB normalization (8):* первичная загрузка → `created`; повторный sync с защитой `aliasName`/`labels` (проверяется `expect.not.objectContaining`); disappeared склад → INACTIVE с reason+inactiveSince; reactivation INACTIVE → ACTIVE с null lifecycle полями; safe-window архивация (двойной `findMany` для disappeared + archive candidates); failed API не пишет ничего и не помечает `lastSyncStatus=ok`; missing API key без HTTP; classification change → `warehouse_classification_changed` warn.

*Ozon normalization (2):* `/v1/warehouse/list` нормализуется в OZON+FBS snapshot; missing credentials → `OZON_CREDENTIALS_MISSING` без HTTP.

*tenant-state pause (4):* `it.each` на TRIAL_EXPIRED/SUSPENDED/CLOSED → `paused: true`, `marketplaceAccount.findMany` не вызывается, axios не дёргается, warn-event эмитится; ACTIVE_PAID → итерация accounts; TENANT_NOT_FOUND для несуществующего tenant; MARKETPLACE_ACCOUNT_NOT_FOUND для отсутствующего account.

Совокупный suite — `Tests: 16 passed, 16 total` (warehouse module). Регрессия inventory: `Tests: 113 passed, 113 total` (97 inventory + 16 warehouses, 6 suites).

`tsc --noEmit` — никаких ошибок.

### Соответствие критериям закрытия

- **Первичная загрузка и повторный sync работают идемпотентно**: upsert по UNIQUE `(tenantId, accountId, externalWarehouseId)` (TASK_1), нормализатор-дедуп защищает от дублей в одном ответе, повторный вызов с тем же payload возвращает `created: 0, updated: N` без побочных эффектов на tenant-local поля.
- **Disappeared warehouses проходят согласованный lifecycle**: ACTIVE → INACTIVE (с reason и timer) → ARCHIVED (после 30 дней) → ACTIVE (при возврате); удаление физически невозможно через sync.
- **Внешний source-of-truth сохраняется без ручных искажений**: `name/city/warehouseType/sourceMarketplace` управляются sync-логикой, `aliasName/labels` — отдельные tenant-local поля, не перезаписываются sync-кодом (защищено `expect.not.objectContaining` тестом).
- **Account state не приводит к silent loss**: failed API не применяет lifecycle и не помечает `lastSyncStatus=ok`, paused tenant полностью пропускает sync без HTTP-вызовов.

### Что осталось вне scope

- HTTP API `GET /api/v1/warehouses`, `GET /:id`, `GET /:id/stocks` — TASK_WAREHOUSES_3.
- `POST /api/v1/warehouses/sync` (manual refresh с TenantWriteGuard) — TASK_WAREHOUSES_3 или 5.
- `PATCH /:id/metadata` для `aliasName`/`labels` с валидацией VARCHAR-length — TASK_WAREHOUSES_4.
- Frontend warehouse picker и FBS/FBO splitting в inventory UI — TASK_WAREHOUSES_6.
- Bridge `StockBalance.warehouseId TEXT → Warehouse.id FK` — отдельная задача после первичного sync для всех tenant'ов.
- Yandex Market integration — `WarehouseSourceMarketplace.YANDEX_MARKET` подготовлен в TASK_1, но фетчер не реализован (out of MVP scope, отдельная интеграционная задача).
- Periodic background scheduler для `syncAllForTenant` — пока вызывается только программно (orders/sync поля). Регулярный poll будет в `09-sync` или через `apps/worker`.
