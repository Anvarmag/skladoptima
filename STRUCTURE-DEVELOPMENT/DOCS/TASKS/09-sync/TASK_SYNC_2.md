# TASK_SYNC_2 — Manual Run API, Retry Flow и Lifecycle Statuses

> Модуль: `09-sync`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_SYNC_1`
- Что нужно сделать:
  - реализовать `POST /api/v1/sync/runs`, `GET /api/v1/sync/runs`, `GET /api/v1/sync/runs/:runId`;
  - реализовать `POST /api/v1/sync/runs/:runId/retry`;
  - ограничить MVP manual actions до `sync now` по account и `retry failed run`;
  - не выводить и не поддерживать `tenant full sync` в runtime surface MVP;
  - различать в API/response `failed` и `blocked by policy`.
- Критерий закрытия:
  - manual sync контур соответствует утвержденной MVP-модели;
  - retry создает новый run с `trigger_type=retry` и ссылкой на origin run;
  - lifecycle run прозрачен для UI и support.

**Что сделано**

### Контекст MVP до задачи

После TASK_SYNC_1 в БД есть таблицы `SyncRun`/`SyncRunItem`/`SyncConflict` и queue contract в [sync-run.contract.ts](apps/api/src/modules/marketplace_sync/sync-run.contract.ts), но никто их не использует. В [marketplace_sync/sync.controller.ts](apps/api/src/modules/marketplace_sync/sync.controller.ts) живут legacy endpoints `/sync/full-sync`, `/sync/pull/wb`, `/sync/orders/poll`, `/sync/metadata` — все они дёргают `SyncService` напрямую и блокируют HTTP до завершения внешних API-вызовов (нарушение DoD §12 "Sync не блокирует HTTP").

Никакого manual sync API под §6 system-analytics в репозитории нет:
- нет `POST /sync/runs` — фронт не может попросить "sync now" по конкретному account и получить `runId` для отслеживания;
- нет `GET /sync/runs/:id` — нельзя посмотреть результат запуска без прямого SQL-доступа;
- нет `POST /sync/runs/:id/retry` — после failed sync единственный путь "повторить" — это снова дёрнуть legacy endpoint, который потеряет связь с предыдущей попыткой;
- невозможно отделить `failed` от `blocked by policy` — legacy `lastSyncStatus` хранит просто `'ERROR'` строкой, а tenant-state guard в [sync.service.ts](apps/api/src/modules/marketplace_sync/sync.service.ts) `_isTenantPaused` тихо возвращает `{ success: false, paused: true }` без записи в историю.

### Что добавлено

**1. Новый модуль [sync-runs/](apps/api/src/modules/sync-runs/)**

Создан рядом с legacy `marketplace_sync` (а не внутри него), чтобы:
- не смешивать API-слой с adapter'ами WB/Ozon, которые в TASK_SYNC_3+ переедут под worker;
- безопасно жить параллельно с polling loop — TASK_SYNC_2 не выключает legacy sync, он добавляет новый параллельный путь.

Структура:
```
sync-runs/
├── dto/
│   ├── create-sync-run.dto.ts    — POST /sync/runs payload
│   └── list-sync-runs.dto.ts     — GET query параметры
├── sync-runs.controller.ts
├── sync-runs.service.ts
├── sync-runs.service.spec.ts     — 23 unit-теста
└── sync-runs.module.ts
```

Подключён к [app.module.ts](apps/api/src/app.module.ts) как `SyncRunsModule`.

**2. REST endpoints под global prefix `/api`**

- `POST /api/sync/runs` — создать manual run по account.
- `GET /api/sync/runs` — paginated list (page/limit/accountId/status/triggerType filters).
- `GET /api/sync/runs/:id` — карточка run'а с включёнными `items`, `conflicts` и ссылкой на `originRun`.
- `POST /api/sync/runs/:id/retry` — создать retry run.

**API-prefix nuance:** system-analytics §6 описывает endpoints как `/api/v1/sync/...`. В текущем репо global prefix — `app.setGlobalPrefix('api')` ([main.ts:28](apps/api/src/main.ts#L28)), без `/v1`. Версионирование API — отдельная общая работа (затронет все контроллеры). Контроллер `@Controller('sync/runs')` совместим с обоими вариантами: переход на `/v1` потребует изменения только `setGlobalPrefix`.

**3. Создание manual run ([sync-runs.service.ts](apps/api/src/modules/sync-runs/sync-runs.service.ts) → `createRun`)**

Поток:
1. Найти аккаунт `(id, tenantId)` с включённым `tenant.accessState`. Чужого tenant'а — `404 MARKETPLACE_ACCOUNT_NOT_FOUND`.
2. Построить детерминированный `jobKey` (формат `manual:<accountId>:<sortedTypes>:<idempotencyKey|UUID>`, ≤128 символов).
3. **Idempotency через DB UNIQUE**: `prisma.syncRun.findUnique({ tenantId_jobKey })` — если запись уже есть, возвращаем её без побочных эффектов. Это §14 «run-level идемпотентность через `Idempotency-Key` или `job_key`».
4. **Preflight** в строгом порядке (первый сработавший побеждает):
   - tenant access state ∈ {`TRIAL_EXPIRED` / `SUSPENDED` / `CLOSED`} → `BLOCKED` с реason `TENANT_TRIAL_EXPIRED` / `_SUSPENDED` / `_CLOSED`;
   - account `lifecycleStatus !== ACTIVE` → `BLOCKED` с `ACCOUNT_INACTIVE`;
   - account `credentialStatus === INVALID` → `BLOCKED` с `CREDENTIALS_INVALID`;
   - account `credentialStatus === NEEDS_RECONNECT` → `BLOCKED` с `CREDENTIALS_NEEDS_RECONNECT`;
   - есть активный run (`QUEUED`/`IN_PROGRESS`) на тот же account → `BLOCKED` с `CONCURRENCY_GUARD` + `conflictingRunId` в structured-логе.

   `UNKNOWN`/`VALIDATING` credentials НЕ блокируют сразу: worker (TASK_SYNC_3+) сам выполнит fresh validate перед external call. Это сознательный дизайн §10: blocked — это _продуктовая_ политика, а не подмена fresh validation.
5. Happy path → `prisma.syncRun.create({ status: QUEUED, triggerType: MANUAL, triggerScope: ACCOUNT, ... })`. Worker подхватит через TASK_SYNC_3.
6. **Race window между `findUnique` и `create`**: если Postgres вернул `P2002` (UNIQUE conflict на `(tenantId, jobKey)`), повторно читаем по jobKey и возвращаем гонщика. Тест `P2002 на create — возвращает уже созданный run` это покрывает.

**Ключевой архитектурный выбор: blocked-by-policy материализуется как run, а не как 403.**

Это §10/§20 system-analytics: _«если blocked runs смешать с failed runs, support и пользователь не смогут отделить интеграционные инциденты от продуктовых policy-ограничений»_. Если бы guard на уровне HTTP отдавал 403 «TENANT_WRITE_BLOCKED», в истории run'ов записи бы не было, и пользователь видел бы только всплывающую ошибку без следа. Вместо этого мы создаём полноценную запись `status=BLOCKED, blockedReason=TENANT_TRIAL_EXPIRED, startedAt=finishedAt=now(), durationMs=0` — она появится в `GET /sync/runs` и в UI истории на одном уровне с `SUCCESS`/`FAILED`. Поэтому контроллер использует только `RequireActiveTenantGuard` и НЕ использует `TenantWriteGuard` (намеренно — задокументировано в [sync-runs.controller.ts](apps/api/src/modules/sync-runs/sync-runs.controller.ts)).

**4. Retry flow (`retryRun`)**

§9 сценарий 2:
- retry создаёт **новый** run (origin не «возрождается») с `triggerType=RETRY`, `originRunId=parent.id`, `attemptNumber=parent.attemptNumber+1`, `maxAttempts` копируется;
- jobKey строится как `retry:<originRunId>:<attemptNumber>` — детерминированный, повторный POST на тот же origin даст `P2002`-conflict (что корректно: повторный retry той же попытки бессмысленен).

Запреты:
- `SUCCESS` → `400 SYNC_RUN_RETRY_NOT_APPLICABLE` (нечего повторять);
- `BLOCKED` → `400` с reason _«fix the root cause instead of retrying»_. Это критично: blocked-предка retry'ить нельзя, потому что blocked — политическое решение (tenant в `TRIAL_EXPIRED` и т.д.), а не технический сбой. Retry просто получит тот же blocked. Пользователь должен сначала сменить состояние tenant/account;
- `CANCELLED` → `400` (нельзя возрождать отменённое);
- `QUEUED`/`IN_PROGRESS` → `409 SYNC_RUN_NOT_TERMINAL` (origin ещё активен);
- `attemptNumber >= maxAttempts` → `400 SYNC_RUN_RETRY_EXHAUSTED` (потолок попыток исчерпан, эмитим event `RETRY_EXHAUSTED`);
- активный run на том же account → `409 SYNC_RUN_CONCURRENCY_CONFLICT` с `conflictingRunId`;
- run чужого tenant → `404 SYNC_RUN_NOT_FOUND`.

**5. List + GetById**

`list` — paginated (page=1, limit=20 default; max limit=100 через DTO `@Max(100)`). Фильтры: `accountId`, `status`, `triggerType`. Сортировка `createdAt DESC` — UI всегда показывает последние сверху.

`getById` — карточка с includes:
- `items` отсортированы `createdAt ASC` — порядок появления проблем в pipeline;
- `conflicts` — `createdAt DESC`;
- `originRun: { id, status, attemptNumber }` — компактная ссылка для UI «эта попытка #2 после failed run X».

§12 DoD: «по каждому run есть диагностическая история» — этого payload'а достаточно для разбора без прямого SQL-доступа.

§8 правило «success path хранится агрегатами»: для SUCCESS run массив `items` будет пустым — это _не_ баг, а сознательный дизайн (§20 риск).

**6. Tenant full sync — намеренно НЕ реализован**

§10/§13/§17 явно исключают `tenant_full` из MVP runtime surface. В DTO `CreateSyncRunDto` нет поля `triggerScope` — service всегда подставляет `ACCOUNT`. В retry мы копируем `triggerScope` от origin, но manual create не может создать `TENANT_FULL`. Schema готова к расширению (enum `SyncTriggerScope.TENANT_FULL` существует в TASK_SYNC_1), API — нет.

**7. Observability**

Каждое решение логируется через [sync-run.events.ts](apps/api/src/modules/marketplace_sync/sync-run.events.ts) канонические имена:
- `sync_run_queued` (включая idempotent повторы) — `logger.log`;
- `sync_run_blocked_by_tenant_state`, `_account_state`, `_concurrency`, `_credentials` — `logger.warn` с `blockedReason` в payload;
- `sync_run_retry_scheduled` (новый retry создан), `sync_run_retry_exhausted` (отказали).

JSON-формат: `{ event, ...data, ts: ISO }`. Это совместимо с существующим стилем `marketplace-accounts.service.ts` и готово к §19 metrics: `sync_runs_started`, `_failed`, `_blocked`, `retry_count` агрегируются grep'ом по `event` field в логе.

**8. Тесты ([sync-runs.service.spec.ts](apps/api/src/modules/sync-runs/sync-runs.service.spec.ts))**

23 unit-теста, разбиты на 3 describe блока:

`createRun` (10):
- happy path → QUEUED;
- TRIAL_EXPIRED / SUSPENDED → BLOCKED с правильным reason;
- account INACTIVE → BLOCKED;
- credentials INVALID / NEEDS_RECONNECT → BLOCKED;
- concurrency guard → BLOCKED;
- account другого tenant → 404;
- idempotencyKey возвращает существующий run без второго create;
- P2002 race → возврат уже созданного.

`retryRun` (9):
- FAILED → новый RETRY с origin link и attempt+1;
- PARTIAL_SUCCESS → допустим;
- SUCCESS / BLOCKED / CANCELLED → 400;
- QUEUED → 409;
- attemptNumber >= maxAttempts → 400 EXHAUSTED;
- concurrency conflict → 409;
- чужой tenant → 404.

`list / getById` (4):
- paginated payload;
- defaults page=1 limit=20;
- includes items/conflicts/originRun;
- 404 для чужого tenant.

### Соответствие критериям закрытия

- **Manual sync контур соответствует утверждённой MVP-модели**: только `POST /sync/runs` + `POST /sync/runs/:id/retry`. Никаких `tenant full sync`, `pull/wb`, `metadata`, `orders/poll` под новым контуром — legacy остаётся, но новый MVP-surface строго ограничен §10.
- **Retry создаёт новый run с `trigger_type=retry` и ссылкой на origin run**: тест `из FAILED создаёт новый run с triggerType=RETRY и originRunId` это явно проверяет; service пишет `triggerType: RETRY`, `originRunId: parent.id`, `attemptNumber: parent.attemptNumber + 1`.
- **Lifecycle run прозрачен для UI и support**: `GET /sync/runs/:id` возвращает run + items + conflicts + originRun одним запросом; status enum явно различает 7 состояний; blocked-by-policy материализуется в истории, а не теряется в HTTP-ошибке.

### Проверки

- `npx prisma validate` → `valid`.
- `npx tsc --noEmit` → новых ошибок в `sync-runs/` или `sync-run.contract.ts` нет; pre-existing errors в `fix-ozon-dates.ts/import.service*.ts` к задаче не относятся.
- `npx jest src/modules/sync-runs/` → `Tests: 23 passed, 23 total`.
- `npx jest src/modules/marketplace-accounts/ src/modules/inventory/ src/modules/warehouses/` → `Tests: 305 passed, 305 total` (15 suites). Регрессия чистая — никаких изменений к legacy `sync.service.ts` или `marketplace-accounts.service.ts`.

### Что НЕ делается (намеренно)

- **Реальная обработка run'ов** (PULL_STOCKS / PUSH_STOCKS / PULL_ORDERS / PULL_METADATA против WB/Ozon) — `QUEUED` run остаётся в БД; worker, который его подхватит, появится в TASK_SYNC_3 (и адаптеры в TASK_SYNC_4). Это аккуратно: добавление сразу и API, и обработки в одной задаче превратило бы её в 25h работу и смешало бы две независимых границы.
- **Polling loop в `OnModuleInit`** [sync.service.ts:24-51](apps/api/src/modules/marketplace_sync/sync.service.ts#L24) — оставлен. Он работает на legacy `MarketplaceAccount.lastSyncStatus` и НЕ создаёт `SyncRun` записи. Переключение polling на `SyncRun` registry — TASK_SYNC_3.
- **Legacy `/sync/full-sync`, `/sync/pull/wb`, `/sync/orders/poll`** — работают как раньше. Удаление — после полной миграции в TASK_SYNC_3+.
- **Frontend для history / details / retry** — TASK_SYNC_6 (на этом же API).
- **Conflict resolution UI / endpoint `/sync/conflicts`** — TASK_SYNC_5 (preflight + conflicts).
- **Метрики `sync_runs_started/failed/blocked` в Prometheus** — TASK_SYNC_7 (observability runbook). Сейчас они доступны через grep по structured logs.

### Что осталось вне scope

- Worker / queue runtime для перевода `QUEUED → IN_PROGRESS → SUCCESS/FAILED/PARTIAL_SUCCESS` — TASK_SYNC_3.
- Pull/Push adapters per marketplace — TASK_SYNC_4.
- Conflict diagnostics endpoint + preflight на _runtime_ уровне (worker) — TASK_SYNC_5.
- Frontend истории / конфликтов / manual sync UX — TASK_SYNC_6.
- Интеграционные тесты с реальной БД и observability runbook — TASK_SYNC_7.
