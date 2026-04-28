# TASK_SYNC_1 — Data Model, Run Registry и Queue Orchestration

> Модуль: `09-sync`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - утверждена системная аналитика `09-sync`
  - согласованы `08-marketplace-accounts`, `18-worker`
- Что нужно сделать:
  - завести таблицы `sync_runs`, `sync_run_items`, `sync_conflicts`;
  - зафиксировать статусы `queued / in_progress / success / partial_success / failed / blocked / cancelled`;
  - реализовать `trigger_type`, `trigger_scope`, `origin_run_id`, `blocked_reason`, aggregated counters;
  - подготовить queue contract для worker с `run_id`, `job_key`, retry metadata;
  - закрепить правило, что success path в MVP хранится агрегатами в `sync_runs`, а не полным item-level логом.
- Критерий закрытия:
  - run registry покрывает lifecycle manual, scheduled и retry запусков;
  - модель данных пригодна для диагностики без прямого доступа к БД;
  - orchestration слой не блокирует HTTP и совместим с worker infrastructure.

**Что сделано**

### Контекст MVP до задачи

В текущем коде [marketplace_sync](apps/api/src/modules/marketplace_sync/) sync устроен так:

- [SyncService](apps/api/src/modules/marketplace_sync/sync.service.ts) запускает фоновый poll прямо в `OnModuleInit` через `setInterval(60_000)` и обходит `prisma.tenant.findMany()` с прямыми вызовами `pullFromWb / pullFromOzon / processWbOrders / processOzonOrders`.
- Никакого реестра запусков нет: success/failure фиксируется ровно одной строкой `lastSyncAt / lastSyncStatus String? / lastSyncError String?` в `MarketplaceAccount` (см. метод `updateMarketplaceStatus`), которая перезаписывается при следующем поллинге.
- Конфликтов как сущности нет вообще: если ручная корректировка inventory расходится с marketplace, мы либо тихо перезаписываем, либо логируем `Mismatch` и идём дальше — это §20 system-analytics называет «молчаливые потери/дубли бизнес-эффекта».
- Item-level диагностики тоже нет: ошибки уходят в `logger.error` без структурированной таблицы, искать причину можно только через grep по логам контейнера.
- Polling и manual sync склеены: HTTP endpoint `POST /sync/full-sync` ([sync.controller.ts:73](apps/api/src/modules/marketplace_sync/sync.controller.ts)) вызывает `fullSync(tenantId)`, который делает все внешние API-вызовы синхронно и блокирует HTTP-handler — прямое нарушение DoD §12 «Sync не блокирует HTTP».

То есть инвариант `BLOCKED ≠ FAILED`, retry-цепочка с `origin_run_id`, idempotency через `jobKey` и preflight-guard — отсутствуют как класс. Модуль работает «по факту», без воспроизводимости и без расследования инцидентов без прямого доступа к БД.

### Что добавлено

**1. 6 новых enum в Prisma schema ([schema.prisma](apps/api/prisma/schema.prisma))**

Каждый enum точно соответствует §8 system-analytics:

- `SyncRunStatus` — `QUEUED`, `IN_PROGRESS`, `SUCCESS`, `PARTIAL_SUCCESS`, `FAILED`, `BLOCKED`, `CANCELLED`. Все 7 статусов из задачи. Принципиально, что `BLOCKED` отделён от `FAILED` — это §20 риск: «если blocked runs смешать с failed runs, support и пользователь не смогут отделить интеграционные инциденты от продуктовых policy-ограничений».
- `SyncTriggerType` — `MANUAL`, `SCHEDULED`, `RETRY`. Источник запуска фиксируется на уровне типа.
- `SyncTriggerScope` — `ACCOUNT`, `TENANT_FULL`. `TENANT_FULL` готов в schema, но §10 фиксирует: `POST /sync/full` не входит в MVP runtime surface, поэтому в API он не появится в TASK_SYNC_3.
- `SyncRunItemType` — `STOCK`, `ORDER`, `PRODUCT`, `WAREHOUSE`. Категория элемента, по которой случилась проблема.
- `SyncRunItemStage` — `PREFLIGHT`, `PULL`, `TRANSFORM`, `APPLY`, `PUSH`. Этап pipeline §9.
- `SyncRunItemStatus` — `SUCCESS`, `FAILED`, `SKIPPED`, `CONFLICT`, `BLOCKED`. `SUCCESS` оставлен в enum как future-compatible значение, но MVP-правило §8 явно записано в комментарии модели: item-level записи создаются ТОЛЬКО для проблемных кейсов, success-поток хранится агрегатами в `SyncRun`.

**2. Новая модель `SyncRun` — реестр запусков**

```
SyncRun
  - id, tenantId (FK CASCADE), marketplaceAccountId (FK SET NULL, nullable)
  - triggerType, triggerScope, syncTypes String[] DEFAULT []
  - status DEFAULT QUEUED
  - originRunId (self-FK SET NULL)        — retry-цепочка
  - jobKey VARCHAR(128), idempotencyKey VARCHAR(128)
  - requestedBy
  - blockedReason VARCHAR(64)              — машинный код, не free-text
  - startedAt, finishedAt, durationMs
  - processedCount, errorCount             — aggregated counters §8
  - errorCode VARCHAR(64), errorMessage    — run-level ошибка
  - attemptNumber, maxAttempts, nextAttemptAt — retry policy metadata
  - createdAt, updatedAt
```

Решения:

- `marketplaceAccountId` **nullable** + `ON DELETE SET NULL`: schema готова к `tenant_full` scope (run без конкретного аккаунта) и не теряет историю при отключении аккаунта. Это закрывает §3 риск «sync должен быть пригоден для разбора без прямого доступа к базе» — даже если аккаунт удалён, run остаётся с `tenantId`/`syncTypes`/`status`/`errorCode`.
- `syncTypes` хранится как **TEXT[]** (а не enum[]): расширение списка типов (`PULL_PROMOTIONS`, `PUSH_PRICES` и т.д.) не должно требовать миграцию БД. Валидация значений вынесена в [sync-run.contract.ts](apps/api/src/modules/marketplace_sync/sync-run.contract.ts) → `SyncTypes` const + `isSyncType()`.
- `originRunId` self-relation с `ON DELETE SET NULL` — retry создаёт **новый** run (а не переоткрывает старый), что сохраняет неизменность исторических записей и позволяет строить дерево попыток.
- **UNIQUE(tenantId, jobKey)** — DB-level idempotency: повторное `enqueue` с тем же `jobKey` физически невозможно. Это §14 «run-level идемпотентность через `Idempotency-Key` или `job_key`», реализованная не на application слое, а на уровне БД.
- `attemptNumber/maxAttempts/nextAttemptAt` — retry metadata прямо в run, чтобы worker мог принимать решение о повторе без отдельной таблицы политик. `maxAttempts DEFAULT 3` соответствует общепринятому baseline'у retry policy (worker сможет переопределить per job в TASK_SYNC_5).
- 3 индекса: `(tenantId, status, createdAt)` — UI «последние run'ы по статусу», `(tenantId, marketplaceAccountId, createdAt)` — история по конкретному account, `(originRunId)` — дерево retry.

**Сознательно НЕ сделанное на уровне БД**: partial unique «один активный run на (account, syncType)». §10 говорит «один активный run на account для одинакового типа sync», но `syncTypes` — массив, и enforcement через GIN-индекс с array intersection слишком сложен для MVP. Concurrency guard — application-level в TASK_SYNC_2: чек `ActiveSyncRunStatuses` (`QUEUED`/`IN_PROGRESS`) перед постановкой в очередь. Это явно задокументировано в [migration.sql](apps/api/prisma/migrations/20260426120000_sync_data_model/migration.sql) и в [sync-run.contract.ts](apps/api/src/modules/marketplace_sync/sync-run.contract.ts).

**3. Новая модель `SyncRunItem` — item-level диагностика**

```
SyncRunItem
  - id, runId (FK CASCADE)
  - itemType, itemKey VARCHAR(128), stage, status
  - externalEventId VARCHAR(128)   — для дедупликации §14
  - payload Json, error Json
  - createdAt
  - 3 индекса: (runId, status), (runId, itemType), (runId, stage)
```

Создаётся **только для FAILED/SKIPPED/CONFLICT/BLOCKED** (правило §8) — комментарий в schema это явно фиксирует. SUCCESS-кейсы остаются агрегатами в `SyncRun.processedCount`. Это §20 риск «если в MVP сохранять полную success item-level трассу, storage и diagnostic noise вырастут быстрее реальной пользы».

`externalEventId` отдельным полем — для §14 «повторная обработка одного и того же external event не должна создавать повторный бизнес-эффект»: id события маркетплейса фиксируется при ошибке, и при следующем pull worker может проверить, что мы уже видели этот event.

`ON DELETE CASCADE` с run — item-level трасса не имеет смысла без run'а.

**4. Новая модель `SyncConflict` — реестр конфликтов**

```
SyncConflict
  - id, tenantId (FK CASCADE), runId (FK CASCADE)
  - entityType VARCHAR(64), entityId VARCHAR(128)
  - conflictType VARCHAR(64), payload Json
  - resolvedAt, createdAt
  - 3 индекса: (tenantId, resolvedAt, createdAt), (tenantId, entityType, entityId), (runId)
```

Реализует §9 сценарий 3 «Конфликт синхронизации»: run **не падает** (продолжает обработку других items), помечается `PARTIAL_SUCCESS`, конфликт виден в diagnostics. `resolvedAt` заполняется только когда support/пользователь явно закрыл конфликт — это даст возможность в TASK_SYNC_3/6 показать «открытые конфликты» в UI.

`(tenantId, resolvedAt, createdAt)` индекс — для основного UI запроса «последние открытые конфликты».
`(tenantId, entityType, entityId)` — для диагностики «все конфликты по конкретному SKU/order».

**5. Миграция SQL ([20260426120000_sync_data_model/migration.sql](apps/api/prisma/migrations/20260426120000_sync_data_model/migration.sql))**

Hand-crafted, по образцу TASK_MARKETPLACE_ACCOUNTS_1:

- 6 `CREATE TYPE` для enums.
- `CREATE TABLE "SyncRun"` с 3 FK (tenant CASCADE, marketplaceAccount SET NULL, self SET NULL), UNIQUE на `jobKey`, 3 индекса.
- `CREATE TABLE "SyncRunItem"` с CASCADE FK и 3 индексами.
- `CREATE TABLE "SyncConflict"` с двумя CASCADE FK и 3 индексами.
- Все типовые поля `TEXT[]` инициализируются как `ARRAY[]::TEXT[]`, `TIMESTAMP(3)` совместим с Prisma DateTime.
- Каждый блок снабжён комментарием «зачем» и какие задачи продолжат работу.

**6. Queue contract для worker ([sync-run.contract.ts](apps/api/src/modules/marketplace_sync/sync-run.contract.ts))**

Новый файл — single source of truth для коммуникации API/scheduler ↔ worker:

- `SyncTypes` const + `isSyncType()` — runtime-валидация значений `syncTypes[]`. Заменяет «магические строки».
- `SyncBlockedReason` const с 7 машинными кодами (`TENANT_TRIAL_EXPIRED`, `TENANT_SUSPENDED`, `TENANT_CLOSED`, `ACCOUNT_INACTIVE`, `CREDENTIALS_INVALID`, `CREDENTIALS_NEEDS_RECONNECT`, `CONCURRENCY_GUARD`) — §10/§20 «policy-driven блокировка sync должна быть детерминированной: одинаковый tenant/account state всегда приводит к одинаковому blocked outcome».
- `SyncErrorCode` const с 6 кодами run-level ошибок — отделено от blocked reasons, потому что error — это сбой обработки, blocked — продуктовая политика.
- `SyncRunJob` interface — payload, который worker получает из очереди. `runId` — это id уже существующей записи `SyncRun` (создаётся API/scheduler **до** постановки в очередь, что даёт пользователю немедленный feedback "queued" и оставляет диагностический след даже если worker упал до старта).
- `BuildSyncRunJob` interface — параметры для построения нового run + job из API-запроса/scheduler.
- `TerminalSyncRunStatuses` / `ActiveSyncRunStatuses` + `isTerminalSyncRunStatus()` / `isActiveSyncRunStatus()` — для concurrency guard и retry-логики, не дублируется в каждом потребителе.

**7. Observability event names ([sync-run.events.ts](apps/api/src/modules/marketplace_sync/sync-run.events.ts))**

По образцу [marketplace-account.events.ts](apps/api/src/modules/marketplace-accounts/marketplace-account.events.ts) — single source of truth для structured-логов и метрик §19. 14 имён событий, сгруппированных по lifecycle / blocked / retry / stage / external / conflict. Это защищает алерты и dashboards (`sync_runs_started`, `sync_runs_failed`, `sync_runs_blocked`, `partial_success_rate`, `retry_count`, `queue_lag`, `conflicts_open`) от опечаток в строковых литералах.

**8. Inverse relations**

Добавлены в `Tenant` (`syncRuns SyncRun[]`, `syncConflicts SyncConflict[]`) и `MarketplaceAccount` (`syncRuns SyncRun[]`). Это даёт типобезопасные joins из tenant/account view в TASK_SYNC_3 без `findMany({ where: { tenantId } })` boilerplate.

### Что НЕ делается (намеренно)

- **Sync.service не переписан.** Существующие endpoints `/sync/full-sync`, `/sync/pull/wb`, `/sync/orders/poll`, `OnModuleInit` polling loop продолжают работать на legacy `MarketplaceAccount.lastSyncStatus String?`. Переключение sync.service на запись в `SyncRun` и вынос polling в worker queue — TASK_SYNC_2 (Queue Worker) и TASK_SYNC_3 (Endpoints + replace OnModuleInit). Делать это сейчас — означало бы смешать data model задачу с поведенческой и сломать live MVP до готовности worker'а.
- **Никаких API endpoints `/api/v1/sync/runs`** — это TASK_SYNC_3 с DTO/валидацией.
- **Никакого preflight tenant/account state guard** — это TASK_SYNC_5 (он использует уже готовые `SyncBlockedReason` коды отсюда).
- **Никакого DB-level partial unique «один активный run per (account, syncType)»** — обоснование выше (раздел «SyncRun», подпункт про сознательное упущение).

### Соответствие критериям закрытия

- **Run registry покрывает lifecycle manual / scheduled / retry**: `triggerType` enum × `status` enum × `originRunId` self-FK покрывают все три источника, включая retry-цепочки. `attemptNumber/maxAttempts/nextAttemptAt` фиксируют состояние retry policy непосредственно в run.
- **Модель данных пригодна для диагностики без прямого доступа к БД**: aggregated counters + `errorCode/errorMessage` (run-level) + `SyncRunItem.payload/error` (item-level) + `SyncConflict.payload` (конфликты) — этого достаточно, чтобы TASK_SYNC_3 endpoints `/sync/runs/:id`, `/sync/conflicts` отдали полную картину run в одном запросе.
- **Orchestration слой не блокирует HTTP и совместим с worker infrastructure**: queue contract в [sync-run.contract.ts](apps/api/src/modules/marketplace_sync/sync-run.contract.ts) (`SyncRunJob` / `BuildSyncRunJob`) подразумевает, что API создаёт `SyncRun` + кладёт `SyncRunJob` в очередь и сразу возвращает `runId/status: QUEUED`. Тяжёлая обработка в worker через TASK_SYNC_2. Контракт совместим с любой реализацией очереди (BullMQ, Postgres LISTEN/NOTIFY, in-memory dev queue) — мы не привязываемся к конкретной библиотеке.

### Проверки

- `npx prisma validate` → `valid` (после всех изменений).
- `npx prisma generate` → ok, новые типы доступны (`prisma.syncRun`, `prisma.syncRunItem`, `prisma.syncConflict`, enum `SyncRunStatus` и т.д.).
- `npx tsc --noEmit` → новых ошибок нет; сохраняются те же pre-existing TS-ошибки в `fix-ozon-dates.ts` (throwaway-скрипт) и `import.service[.spec].ts`, что были до задачи.
- `npx jest src/modules/marketplace-accounts/` → `Tests: 119 passed, 119 total` (5 suites). Регрессия marketplace-accounts чистая.
- `npx jest src/modules/inventory/ src/modules/warehouses/` → `Tests: 186 passed, 186 total` (10 suites). Регрессия inventory + warehouses чистая.

### Что осталось вне scope

- Queue worker и retry/backoff orchestration (`SyncRunJob` → реальная очередь) — TASK_SYNC_2.
- API endpoints `/api/v1/sync/runs`, `/sync/conflicts`, `/sync/accounts/:id/status` — TASK_SYNC_3.
- Pull/Push adapters per marketplace (рефакторинг `pullFromWb/pullFromOzon` под run-based pipeline) — TASK_SYNC_3/4.
- Preflight-guards `tenant AccessState` + `MarketplaceAccount lifecycleStatus/credentialStatus` — TASK_SYNC_5.
- Frontend для истории/конфликтов/manual sync — TASK_SYNC_6.
- Интеграционные тесты partial/failure paths и observability runbook — TASK_SYNC_7.
- Миграция legacy `lastSyncStatus String?` → `lastSyncResult` enum + удаление polling из `OnModuleInit` — после TASK_SYNC_2/3.
