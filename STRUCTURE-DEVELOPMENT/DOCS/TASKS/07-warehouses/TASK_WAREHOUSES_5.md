# TASK_WAREHOUSES_5 — Tenant-State Guards, Refresh Policy и External Truth Rules

> Модуль: `07-warehouses`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `7h`
- Зависимости:
  - `TASK_WAREHOUSES_2`
  - `TASK_WAREHOUSES_3`
  - `TASK_WAREHOUSES_4`
  - согласованы `02-tenant`, `08-marketplace-accounts`
- Что нужно сделать:
  - запретить ручной refresh через UI при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`;
  - оставить справочник read-only доступным в `TRIAL_EXPIRED`;
  - при `SUSPENDED/CLOSED` показывать только read-only state без внешних API действий;
  - закрепить правило, что warehouses остаются reference-only модулем, а не вторым inventory;
  - не допускать ручного обхода sync source-of-truth.
- Критерий закрытия:
  - warehouse модуль согласован с tenant commercial policy;
  - manual refresh не обходит pause/block rules;
  - external truth rules одинаково соблюдаются в backend и UI.

**Что сделано**

### Контекст MVP до задачи

К моменту начала задачи в warehouse-модуле уже были:
- `WarehouseSyncService.syncAllForTenant` (TASK_WAREHOUSES_2) с верхнеуровневой проверкой `_isTenantPaused` — TRIAL_EXPIRED/SUSPENDED/CLOSED → `paused: true` без HTTP-вызовов;
- `WarehouseService.list/getById/getStocks` (TASK_WAREHOUSES_3) — read-only API без проверки accessState (правильно: справочник остаётся видимым в paused state по §16/17 task);
- `PATCH /warehouses/:id/metadata` (TASK_WAREHOUSES_4) с `TenantWriteGuard` на HTTP-слое;
- `MarketplaceAccount.lastSyncAt/lastSyncStatus/lastSyncError` поля.

Чего НЕ было:
- Manual refresh endpoint'а `POST /warehouses/sync` — пользователь не мог принудительно перезапросить справочник из UI.
- Endpoint'a per-account refresh для случаев, когда нужно обновить только один аккаунт.
- Service-level pause guard на единичный `syncForAccount(accountId)` — прямой вызов из jobs/orchestration кода (не через `syncAllForTenant`) обошёл бы tenant pause. HTTP `TenantWriteGuard` ловил бы только REST-путь.

### Что добавлено

**1. Manual refresh endpoint'ы ([warehouse.controller.ts](apps/api/src/modules/warehouses/warehouse.controller.ts))**

```
POST /warehouses/sync                          → syncAllForTenant
POST /warehouses/sync/account/:accountId       → syncForAccount
```

Оба защищены `RequireActiveTenantGuard + TenantWriteGuard`. Это **первый барьер**: при `TRIAL_EXPIRED/SUSPENDED/CLOSED` HTTP-слой возвращает 403 `TENANT_WRITE_BLOCKED` ещё до того, как запрос достигнет сервиса.

**2. Service-level pause guard в `syncForAccount`** ([warehouse-sync.service.ts](apps/api/src/modules/warehouses/warehouse-sync.service.ts))

Это **второй барьер** (defense-in-depth): даже если кто-то вызвал `WarehouseSyncService.syncForAccount(accountId)` напрямую (например, из background-job, scheduler или orchestration кода), сервис делает свою проверку:

1. `findUnique(MarketplaceAccount)` → если нет, `MARKETPLACE_ACCOUNT_NOT_FOUND`.
2. `findUnique(Tenant, account.tenantId)` → если нет, `TENANT_NOT_FOUND`.
3. Если `accessState ∈ { TRIAL_EXPIRED, SUSPENDED, CLOSED }`:
   - `WarehouseSyncEvents.SYNC_PAUSED_BY_TENANT` warn-event с полями `accountId, tenantId, accessState`;
   - возврат `{ paused: true, fetched: 0, created: 0, updated: 0, deactivated: 0, archived: 0, reactivated: 0 }`;
   - НИ единого HTTP-вызова к marketplace API, НИ одной записи в `Warehouse`/`MarketplaceAccount` — тестами явно проверено.
4. В активном состоянии — обычный flow (existing fetcher + normalizer + upsert + lifecycle).

Причина дублирования: HTTP-слой ловит только REST-путь. Service-level guard покрывает все остальные пути входа в sync (jobs, scheduler, manual REPL, тесты других модулей). Это соответствует тому же паттерну, что был использован в `InventoryService._assertManualWriteAllowed` (TASK_INVENTORY_5).

**3. External truth rules — что НЕ добавляется/меняется**

По §10/§13 system-analytics и DoD task'а 5:
- Никакого `POST /warehouses` для ручного создания.
- Никакого `DELETE /warehouses/:id` (даже для archived).
- Никакого PATCH полей `externalWarehouseId/name/city/warehouseType/sourceMarketplace` — TASK_WAREHOUSES_4 уже закрыл это paranoid-проверкой `WAREHOUSE_METADATA_FIELD_NOT_ALLOWED`.
- Никакого endpoint'a `POST /warehouses/:id/status` для ручного перевода lifecycle — `INACTIVE/ARCHIVED` ставятся ТОЛЬКО `WarehouseSyncService` на основе ответа API.

Это закрепляет инвариант «warehouses = reference-only, не второй inventory» — единственные write-пути это: (a) sync-driven upsert/lifecycle и (b) PATCH alias/labels.

**4. Read API остаётся доступным в paused state**

`WarehouseService.list/getById/getStocks` НЕ проверяют `tenant.accessState`. Это намеренно: справочник нужен пользователю в TRIAL_EXPIRED, чтобы он видел что у него есть, прежде чем оплачивать. Тесты явно проверяют, что `prisma.tenant.findUnique` НЕ вызывается в read-path.

**5. Тесты — [warehouse-tenant-state.spec.ts](apps/api/src/modules/warehouses/warehouse-tenant-state.spec.ts)**

15 новых тестов в 3 describe-блоках:

*service-level pause в syncForAccount (5):*
- `it.each` на TRIAL_EXPIRED/SUSPENDED/CLOSED → `paused: true`, axios не дёргается, БД не изменяется (ни `warehouse.create/update/updateMany`, ни `marketplaceAccount.update`), warn-event эмитится;
- `it.each` на 4 активных состояния (ACTIVE_PAID/TRIAL_ACTIVE/EARLY_ACCESS/GRACE_PERIOD) → `paused` undefined, sync доходит до API (с предсказуемой ошибкой `WB_API_KEY_MISSING` от mock-аккаунта без credentials);
- TENANT_NOT_FOUND для несуществующего tenant'а аккаунта.

*read API в paused state (5):*
- `it.each` на 3 paused-состояния → `list` работает, возвращает `[]`/`total: 0`, `tenant.findUnique` НЕ вызывается;
- `getById` не зависит от accessState;
- `getStocks` не зависит от accessState.

*syncAllForTenant верхнеуровневая защита (2):*
- paused → не дёргает `marketplaceAccount.findMany` вообще (короткий circuit);
- активный tenant + один account → flow доходит до `syncForAccount`, при отсутствии API key ловится `WB_API_KEY_MISSING`.

Совокупно warehouses suite — `Tests: 66 passed, 66 total` (16 sync + 11 read + 24 metadata + 15 tenant-state). Глобально (inventory + warehouses): `Tests: 163 passed, 163 total` в 9 suites. `tsc --noEmit` чисто.

### Соответствие критериям закрытия

- **Warehouse модуль согласован с tenant commercial policy**: и в HTTP-слое, и в service-level выполняются одинаковые правила pause; read-only видимость справочника в TRIAL_EXPIRED обеспечена; SUSPENDED/CLOSED → даже read остаётся доступным (но другие модули типа Inventory/UI могут блокировать routing на верхнем уровне — это вне scope warehouses).
- **Manual refresh не обходит pause/block rules**: HTTP `TenantWriteGuard` блокирует REST-путь (403); service-level pause check блокирует все остальные пути входа (jobs/scheduler/REPL); regression-тестами проверено, что в paused state ни axios, ни Prisma write не вызываются.
- **External truth rules одинаково соблюдаются в backend и UI**: все sync-managed поля защищены `WAREHOUSE_METADATA_FIELD_NOT_ALLOWED` (TASK_4), нет API для ручного create/delete/status-set, sync — единственный путь изменения identity-полей; lifecycle ARCHIVED/INACTIVE ставятся только syncForAccount на основании ответа API.

### Что осталось вне scope

- Frontend warehouse picker и UX блокировки manual refresh кнопки в paused state — TASK_WAREHOUSES_6.
- QA + observability runbook для warehouse module — TASK_WAREHOUSES_7.
- Periodic background scheduler для `syncAllForTenant` (cron-based refresh) — отдельный таск в `09-sync` или `apps/worker`. Manual REST endpoint достаточен для MVP.
- Bridge `StockBalance.warehouseId TEXT → FK Warehouse.id` с миграцией данных — отдельная задача после полноценного adoption справочника всеми tenant'ами.
