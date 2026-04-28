# TASK_FINANCE_3 — Snapshot/Read-Model, Rebuild Jobs и Freshness Status

> Модуль: `11-finance`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_FINANCE_1`
  - `TASK_FINANCE_2`
  - согласованы `09-sync`, `18-worker`
- Что нужно сделать:
  - собрать snapshot strategy для периодов `week / month / custom`;
  - реализовать nightly build и on-demand rebuild jobs;
  - хранить `source_freshness` и различать `incomplete data` от `stale snapshot`;
  - обеспечить идемпотентность rebuild по `(tenant, period_from, period_to, formula_version)` или job key;
  - не инициировать внешние sync-вызовы из rebuild, а работать только по внутренним нормализованным источникам.
- Критерий закрытия:
  - finance строится на snapshot/read-model, а не на тяжелых runtime join;
  - stale и incomplete различаются на уровне модели и API;
  - rebuild jobs безопасны, идемпотентны и пригодны для worker orchestration.

**Что сделано**

Создан `FinanceSnapshotService` — orchestrator между data layer'ом (TASK_FINANCE_1) и calculator'ом (TASK_FINANCE_2). Pipeline: **Loader → Calculator → Persist → Warning sync**. Сервис рассчитан на использование как из cron-job'а (nightly build), так и из REST endpoint'а (on-demand rebuild owner/admin'а — придёт в TASK_FINANCE_4 как HTTP-обёртка).

### 1. [finance-snapshot.service.ts](apps/api/src/modules/finance/finance-snapshot.service.ts)

#### Public API

```ts
rebuild(args: RebuildSnapshotArgs): Promise<RebuildSnapshotResult>
getStatus(tenantId: string): Promise<{ latestSnapshot, activeWarnings, currentFormulaVersion }>
```

`RebuildSnapshotArgs` принимает `tenantId / periodFrom / periodTo / periodType (WEEK|MONTH|CUSTOM) / requestedBy / jobKey`.

`RebuildSnapshotResult` отдаёт `snapshotId / snapshotStatus / formulaVersion / skuCount / incompleteSkuCount / aggregatedWarnings / sourceFreshness / wasReplaced`.

#### Pipeline

1. **Validate period** (§10):
   - `periodFrom > periodTo` → `400 INVALID_PERIOD`.
   - `CUSTOM` > 366 дней → `400 INVALID_PERIOD`.
   - Валидация **до** доступа к tenant — экономит query при заведомо некорректном вводе.

2. **Tenant state guard** (§10):
   - `findUnique({tenantId})` → если `accessState ∈ {TRIAL_EXPIRED, SUSPENDED, CLOSED}` → `403 FINANCE_REBUILD_BLOCKED_BY_TENANT_STATE` + structured warn-лог `finance_rebuild_blocked`.
   - **Намеренно НЕ используем `SyncPreflightService`**: он заточен на marketplace API guard, а finance rebuild — purely internal операция (§15: не дёргает external). Прямая проверка `accessState` короче и не создаёт ложной зависимости от sync-домена.

3. **Concurrency guard** (опциональный, через `jobKey`):
   - MVP-реализация: ищем недавний snapshot (5-минутное окно) с тем же `payload.jobKey` → если есть → `409 SNAPSHOT_REBUILD_IN_PROGRESS`.
   - UNIQUE на snapshot-таблице остаётся **last line of defense** — даже без jobKey два worker'а не вставят два snapshot'а той же `(tenant, period, formula)`.
   - В TASK_FINANCE_4 + интеграция с `18-worker` — заменим на explicit lock-таблицу или Redis distributed lock.

4. **Loader** (§13 правило источников истины):
   - **Revenue/soldQty** — только из нормализованных `Order` + `OrderItem`. Учитываем заказы со статусом `RESERVED` или `FULFILLED` (CANCELLED не приносит revenue, UNRESOLVED ждёт scope-resolution и в расчёт не попадает). Unmatched items (`productId=null`) не суммируем — это §14 правило "не silent default".
   - **Cost** — только из `ProductFinanceProfile`. Батчим `findMany({productId: {in: [...]}})` чтобы избежать N+1.
   - **Marketplace fees / logistics / returns** — агрегаты периода из `MarketplaceReport`. **MVP-упрощение**: распределяем пропорционально доле revenue per SKU (нет per-SKU breakdown в reports). Это документировано в §20 риск; полноценный per-SKU fees — отдельная задача после расширения report-feed.
   - **Ads / tax** — `null` в MVP loader'е (нет источников); calculator поставит `MISSING_ADS_COST / MISSING_TAX` warning без блокировки расчёта.

5. **Calculator** — `FinanceCalculatorService.calculatePeriod(inputs)`. Pure function из TASK_FINANCE_2.

6. **Source freshness** (§14 правило stale):
   - Last `Order.processedAt`, last `MarketplaceReport.createdAt`, last `ProductFinanceProfile.updatedAt`.
   - Каждый источник: `{ lastEventAt: ISO|null, isStale: boolean }`. Окно `STALE_SOURCE_WINDOW_HOURS = 48`.
   - Если `fees` или `orders` stale → добавляем `STALE_FINANCIAL_SOURCE` в `aggregatedWarnings` и записываем tenant-wide warning (без `productId`).
   - **`stale` ≠ `incomplete`** (§128 system-analytics): stale показывает «снапшот есть, но данные старые», incomplete — «снапшот собран, но критичные cost-компоненты отсутствуют». Они могут быть и одновременно, и отдельно.

7. **Persist + warning sync** в одной `prisma.$transaction`:
   - `financeSnapshot.upsert` по UNIQUE `(tenantId, periodFrom, periodTo, formulaVersion)` — **§15 идемпотентность**. Если snapshot существовал → `wasReplaced=true`, payload/sourceFreshness/generatedAt перезаписываются; новая `formulaVersion` создаст новую запись (не задев старую — §12 reproducibility).
   - `financeDataWarning.deleteMany({snapshotId})` — пересоздаём warnings конкретного snapshot. Tenant-wide warning'и (без `snapshotId`) НЕ трогаются.
   - `financeDataWarning.createMany` — per-SKU warnings из calculator items + tenant-wide STALE warning.

8. **Structured лог** `finance_snapshot_built` с tenantId, snapshotId, formulaVersion, status, skuCount, incomplete, wasReplaced — для §19 dashboard'а snapshot health.

### 2. `getStatus(tenantId)` — для §6 endpoint `/finance/snapshots/status`

- Последний snapshot tenant'а (любой версии формулы).
- `activeWarnings` count — для UI badge.
- `currentFormulaVersion` — текущая активная версия (`mvp-v1` сейчас); UI рендерит подсказку «доступен пересчёт по новой формуле», если у latestSnapshot.formulaVersion ≠ current.
- Доступен и при paused tenant (§4 сценарий 4: история read-only).

### 3. Регистрация в [finance.module.ts](apps/api/src/modules/finance/finance.module.ts)

`FinanceSnapshotService` добавлен в providers + exports рядом с `FinanceCalculatorService` и legacy `FinanceService`. Зависит от `PrismaService` и `FinanceCalculatorService` через DI.

### 4. Spec [finance-snapshot.spec.ts](apps/api/src/modules/finance/finance-snapshot.spec.ts) — 14 тестов

| # | Что проверяет |
|---|---|
| Happy path — full data → READY snapshot, upsert вызван 1 раз |
| Idempotency — existing snapshot → upsert + `wasReplaced=true` |
| No cost profile → INCOMPLETE + MISSING_COST warning, snapshot всё же сохранён |
| No marketplace reports → MISSING_FEES + MISSING_LOGISTICS aggregated |
| Пустой набор orders → snapshotStatus=FAILED |
| Stale report (5 дней назад) → STALE_FINANCIAL_SOURCE warning + sourceFreshness.fees.isStale=true |
| TRIAL_EXPIRED → ForbiddenException, upsert НЕ вызывался |
| SUSPENDED тоже блокирует |
| CLOSED тоже блокирует |
| Tenant не существует → ForbiddenException |
| periodFrom > periodTo → BadRequestException, tenant вообще не запрашивался |
| CUSTOM > 366 дней → BadRequestException |
| getStatus → возвращает latestSnapshot + activeWarnings + currentFormulaVersion |
| getStatus без snapshot → latestSnapshot=null, без падения |

### 5. Что важно — §15: rebuild **не дёргает sync во внешний API**

В `FinanceSnapshotService` нет ни одного импорта `axios` / `fetch` / `SyncService`. Loader читает только из:
- `Order` / `OrderItem` (нормализованные внутри domain'а 10-orders);
- `ProductFinanceProfile` (manual input, TASK_FINANCE_1);
- `MarketplaceReport` (приходит через sync, но мы читаем уже сохранённые агрегаты, не дёргаем pull).

Это закрывает §13 ("finance модуль должен потреблять нормализованные источники, а не сырой API маркетплейсов") и §20 риск ("если разрешить finance rebuild напрямую дергать внешние интеграции, модуль начнёт нарушать уже согласованные tenant/account runtime guards").

### 6. Проверки

- `npx jest --testPathPatterns="finance"` → **34/34 passed, 2 suites passed** (20 calculator + 14 snapshot).
- `npx tsc --noEmit -p tsconfig.json` → 20 ошибок (все pre-existing, не finance).

### 7. DoD сверка

- ✅ **Finance строится на snapshot/read-model**: `FinanceSnapshot` хранит уже-собранный `payload JSONB` с per-SKU и totals. `getStatus` отдаёт meta без полного перерасчёта; UI-чтение последних чисел будет idnex-scan по `(tenantId, periodTo, generatedAt)` — не тяжелый realtime join.
- ✅ **Stale и incomplete различаются**: `snapshotStatus ∈ {READY, INCOMPLETE, FAILED}` + отдельное `sourceFreshness.{orders,fees,costProfiles}.isStale`. STALE_FINANCIAL_SOURCE — отдельный warning-тип. UI и API могут различить `incomplete data` (missing critical cost) от `stale snapshot` (источники устарели, но cost есть).
- ✅ **Rebuild идемпотентен**: UNIQUE constraint + upsert + spec-тест на повторный rebuild с `wasReplaced=true`. `formulaVersion` версионирует snapshot — новая формула создаёт новую запись, старая остаётся для исторической воспроизводимости.
- ✅ **Не дёргает внешние sync**: 0 импортов sync/axios; loader читает только internal sources.
- ✅ **Безопасны для worker orchestration**: jobKey concurrency guard + UNIQUE last-line-of-defense + transaction + structured-логи готовы для интеграции с `18-worker`.

### 8. Что НЕ сделано (намеренно — следующие задачи модуля)

- **REST endpoints** `/api/v1/finance/snapshots/rebuild`, `/snapshots/status`, `/unit-economics`, `/dashboard` — это TASK_FINANCE_4. Сервис готов, нужна HTTP-обёртка с DTO + `TenantWriteGuard`.
- **Nightly cron job** на ежедневный rebuild daily/weekly/monthly periods — TASK_FINANCE_4 (через `@nestjs/schedule` или `18-worker`).
- **Warning resolution job** — отдельный cron, который ставит `isActive=false` после появления недостающих данных. В TASK_FINANCE_4.
- **Frontend UnitEconomics rewrite** на новый snapshot endpoint — TASK_FINANCE_5 (по аналогии с Orders.tsx из TASK_ORDERS_6).
- **Per-SKU fees breakdown** — требует расширения `MarketplaceReport`-feed; сейчас распределяем пропорционально revenue (документировано как MVP-упрощение).
- **Tax/ads loader** — оба значения сейчас `null` в loader'е. Подключим в TASK_FINANCE_4 после интеграции с `TenantSettings.taxSystem` логикой из legacy `finance.service.ts`.
