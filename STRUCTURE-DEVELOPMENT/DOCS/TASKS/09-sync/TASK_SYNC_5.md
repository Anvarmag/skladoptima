# TASK_SYNC_5 — Worker Execution Pipeline и Downstream Handoff

> Модуль: `09-sync`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `11h`
- Зависимости:
  - `TASK_SYNC_1`
  - `TASK_SYNC_3`
  - `TASK_SYNC_4`
  - согласованы `18-worker`, `05-catalog`, `06-inventory`, `10-orders`, `07-warehouses`
- Что нужно сделать:
  - собрать pipeline `pull metadata -> pull orders/stocks -> transform/apply -> push`;
  - реализовать retry/backoff/circuit-breaker поведение на уровне worker;
  - обновлять `last_sync_at`, `sync_health_status` и summary по account после завершения run;
  - обеспечить корректный handoff в catalog/orders/inventory/warehouses без смешивания доменных правил;
  - отделить technical failure от policy-block и adapter auth failure.
- Критерий закрытия:
  - worker исполняет run воспроизводимо и не смешивает типы ошибок;
  - downstream эффекты применяются через согласованные контракты;
  - run summary корректно отражает partial success, failed и blocked cases.

**Что сделано**

### Контекст MVP до задачи

После TASK_SYNC_1-4 в БД лежат `SyncRun` записи в статусе `QUEUED`, но никто не переводит их в `IN_PROGRESS → SUCCESS/...`. Параллельно работает legacy [marketplace_sync/sync.service.ts](apps/api/src/modules/marketplace_sync/sync.service.ts):

- большой `OnModuleInit` (~50 строк), который через `setInterval(60_000)` обходит все `prisma.tenant.findMany()` и вызывает `pullFromWb`/`pullFromOzon`/`processWbOrders`/`processOzonOrders` напрямую;
- никакой нормализации ошибок: 401 от WB, 5xx от Ozon, network timeout — всё попадает в один `catch (err)` и логируется строкой;
- никакой retry policy: упало раз → молча скипнули до следующего tick'а через минуту;
- никакого circuit-breaker: если WB token протух, мы продолжаем долбить его 60 раз в час до ручного переподключения;
- никакого handoff в `MarketplaceAccountsService.reportSyncRun()` (метод в [marketplace-accounts.service.ts:733](apps/api/src/modules/marketplace-accounts/marketplace-accounts.service.ts) есть, но никто его не зовёт);
- `SyncRun` записи остаются вечно `QUEUED`, потому что у них нет исполнителя.

§20 system-analytics это явный риск: «adapter errors должны нормализоваться в единую taxonomy, иначе support и retry policy будут хаотичны». Сейчас weekend-инцидент у WB и сетевой таймаут выглядят в UI совершенно одинаково — `lastSyncStatus = 'ERROR'`.

### Что добавлено

**1. AdapterResult taxonomy ([adapter-result.ts](apps/api/src/modules/sync-runs/adapter-result.ts))**

Контракт результата stage runner'а с **6 классами outcome**, явно разделяющими разные типы исходов:

| Outcome | Что значит | Куда run идёт |
|---|---|---|
| `SUCCESS` | Stage обработал всё без ошибок | продолжаем дальше |
| `PARTIAL` | Были item-failures/conflicts, но stage завершился | продолжаем; финал → PARTIAL_SUCCESS |
| `POLICY_BLOCK` | Runtime preflight отказал mid-flight | run → BLOCKED |
| `AUTH_FAILURE` | 401/403 от внешнего API | run → FAILED, **NO retry** |
| `TECHNICAL_FAILURE` | Timeout / 5xx / network | run → FAILED, **retry-eligible** |
| `RATE_LIMIT` | 429 | run → FAILED, **retry с удвоенным backoff** |

Helpers: `adapterSuccess()`, `adapterPartial()`, `classifyHttpError()` — последний автоматически разбирает axios error по HTTP статусу/`code` и возвращает правильный outcome. Это закрывает §20 «adapter errors должны нормализоваться» — все WB/Ozon adapters в TASK_SYNC_5+ просто `try { ... } catch (e) { return classifyHttpError(stage, e); }` и получают единообразную taxonomy.

`AdapterStageResult` несёт также `itemFailures[]` и `conflicts[]` — worker запишет их через `SyncDiagnosticsService` (TASK_SYNC_4) без необходимости адаптеру лезть в БД.

**2. Worker engine ([sync-run-worker.service.ts](apps/api/src/modules/sync-runs/sync-run-worker.service.ts))**

Главный entry-point — `processRun(runId): Promise<SyncRun>`. Stateless, идемпотентен по run lifecycle. Полный flow:

1. **Lifecycle claim** через `prisma.syncRun.updateMany({ where: { id, status: QUEUED }, data: { status: IN_PROGRESS, startedAt } })`. Conditional update защищает от race двух dispatcher'ов: если `count === 0`, кто-то уже забрал run, мы тихо возвращаем актуальное состояние без exception.

2. **Runtime preflight** через `SyncPreflightService.runPreflight(tenantId, accountId, { operation: 'worker_start', checkConcurrency: false })`. Состояние tenant/account могло измениться с момента создания run (run может проваляться в очереди часами). Если стало paused — stage не дёргается, run переходит в `BLOCKED` с тем же reason. `checkConcurrency: false` обязателен: worker сам _и есть_ "активный run", он не должен блокировать сам себя.

3. **Stage orchestration в каноническом порядке §13**:
   ```
   PULL_METADATA → PULL_ORDERS → PULL_STOCKS → PUSH_STOCKS
   ```
   `FULL_SYNC` в `syncTypes[]` раскрывается в полный набор. Если в run запрошены не все типы — пропускаем недостающие, но обходим в одной и той же последовательности (stable order — критично для §17 «recoverable checkpoints»).

4. **Per-stage execution**: для каждого `SyncType` worker ищет зарегистрированный `SyncStageRunner` через `_findRunner()`. Если runner отсутствует (нормально для постепенного rollout adapters) — stage пропускается с warn-логом, run продолжается. Защита от `runner.run()` throw'а: catch'им и нормализуем как `INTERNAL_ERROR`, run НЕ остаётся в `IN_PROGRESS`.

5. **Outcome routing**:
   - `SUCCESS`/`PARTIAL` → продолжаем следующий stage;
   - `POLICY_BLOCK` → останавливаемся, run → `BLOCKED`;
   - `AUTH_FAILURE`/`TECHNICAL_FAILURE`/`RATE_LIMIT` → останавливаемся, finalize как `FAILED`.

6. **Item-level / conflict записи** — через `SyncDiagnosticsService.recordItem` и `recordConflict`. Worker не лезет в `prisma.syncRunItem.create` напрямую — single source of truth для item записи (TASK_SYNC_4 invariant).

7. **Final transition**:
   - `SUCCESS` если без ошибок и без конфликтов;
   - `PARTIAL_SUCCESS` если были item failures **или** конфликты, но не fatal failure;
   - `FAILED` если был fatal stage outcome — обновляем `errorCode/errorMessage/nextAttemptAt`;
   - `BLOCKED` если runtime preflight отказал.

   Все статусы пишут `finishedAt`, `durationMs`, `processedCount`, `errorCount` атомарно.

**3. Retry policy с экспоненциальным backoff**

Backoff matrix: `[30s, 2min, 10min]` для `attemptNumber 1, 2, 3+`. RATE_LIMIT получает удвоенный backoff (60s, 4min, 20min) — рекомендация §15 system-analytics для marketplace API.

Важные дизайн-решения:
- `AUTH_FAILURE` **не retry'ится автоматически**. Token не магическим образом починится через 30s — пользователь должен его обновить. Это §10/§14: «фатальные ошибки → failed, не retry». Worker записывает FAILED + `nextAttemptAt: null`, manual retry endpoint остаётся доступен.
- `TECHNICAL_FAILURE` и `RATE_LIMIT` retry-eligible **только** если `attemptNumber < maxAttempts`. На пределе → `nextAttemptAt: null` + структурированный `sync_run_retry_exhausted` event.
- Retry **не создаёт новый run автоматически** — `nextAttemptAt` это только метка. Создание retry run'а — это отдельный `SyncRunsService.retryRun()` (TASK_SYNC_2), который dispatcher (TASK_18-worker) вызовет, обнаружив run с `status=FAILED, nextAttemptAt <= now()`. Это сохраняет inversion of control: worker не знает про очередь, только про lifecycle одного run'а.

**4. Circuit breaker через `MarketplaceAccount.syncHealthStatus`**

Намеренно **не** делаю отдельный per-process counter — это сломалось бы при горизонтальном масштабировании worker'ов. Вместо этого circuit breaker реализован через handoff в `MarketplaceAccountsService.reportSyncRun(tenantId, accountId, { ok, partial, errorCode, errorMessage, healthReason })`:

- `ok: true, partial: false` → `syncHealthStatus = HEALTHY`, `lastSyncResult = SUCCESS`;
- `ok: true, partial: true` → `syncHealthStatus = DEGRADED`, `lastSyncResult = PARTIAL_SUCCESS`;
- `ok: false` → `syncHealthStatus = ERROR`, `lastSyncResult = FAILED`, `syncHealthReason = errorCode`;
- одновременно эмитится `marketplace_account_sync_error_detected` event (см. [marketplace-accounts.service.ts:733-826](apps/api/src/modules/marketplace-accounts/marketplace-accounts.service.ts)).

Это закрывает критерий «обновлять `last_sync_at`, `sync_health_status` и summary по account после завершения run» через **существующий** публичный API marketplace-accounts модуля — не дублируем direct prisma updates на sync стороне (single source of truth держит owner данных).

§20 invariant сохранён: «sync health и credential validity — независимые слои, единая точка обновления только через marketplace-accounts». Worker НЕ помечает `credentialStatus=NEEDS_RECONNECT` при `AUTH_FAILURE` — это делает следующий валидационный заход, отдельная responsibility.

**5. Downstream handoff контракты**

Намеренный архитектурный выбор: worker **сам не вызывает** `inventoryService.reserve/release/deduct` или `catalogService.upsert`. Это работа stage runner'а конкретного adapter'а — он знает, какой `external_event_id` извлечь из marketplace response и как сформировать business effect.

Контракт между worker'ом и downstream модулями:
- **Inventory**: adapter передаёт стабильный `external_event_id` в `inventoryService.reserve(tenantId, sourceEventId, items)` → `InventoryEffectLock` обеспечивает дедупликацию (§14, TASK_SYNC_4 контракт);
- **Catalog/Orders/Warehouses**: adapter использует existing repository-level методы; sync-сторона в эти доменные правила не вмешивается;
- **Marketplace accounts** (sync health): через `reportSyncRun()` (см. выше).

Это закрывает «обеспечить корректный handoff в catalog/orders/inventory/warehouses без смешивания доменных правил» — sync остаётся orchestration-слоем, бизнес-логика живёт в своих модулях.

**6. SyncStageRunner интерфейс + registerRunner**

```typescript
interface SyncStageRunner {
    readonly syncType: SyncType;
    readonly stage: SyncRunItemStage;
    run(ctx: StageContext): Promise<AdapterStageResult>;
}

worker.registerRunner(runner);  // вызывает bootstrap
```

`StageContext = { runId, tenantId, marketplaceAccountId, attemptNumber }` — runner получает только то, что ему нужно для одной попытки. Production runners для WB/Ozon (тонкие обёртки вокруг legacy `pullFromWb`/`pullFromOzon` или новые от-нуля адаптеры) — **отдельный rollout** в TASK_SYNC_5+ adapters: они подключаются bootstrap'ом без изменения worker engine.

В MVP test setup: `worker.registerRunner({ syncType, stage, run: jest.fn() })` достаточно для покрытия всех сценариев lifecycle и retry policy без реальных HTTP вызовов.

**7. Тесты ([sync-run-worker.service.spec.ts](apps/api/src/modules/sync-runs/sync-run-worker.service.spec.ts))**

**22 unit-теста**, разбиты на 5 групп:

`processRun — happy path` (3):
- SUCCESS run: lifecycle QUEUED → IN_PROGRESS → SUCCESS, `reportSyncRun(ok=true)` вызван;
- PARTIAL_SUCCESS с item failures: записи через `recordItem`, `reportSyncRun(partial=true)`;
- конфликт через `recordConflict` → PARTIAL_SUCCESS.

`processRun — non-pickup paths` (3):
- run не QUEUED → graceful skip без updateMany;
- updateMany count=0 (race) → возврат актуального состояния;
- run не существует → 404.

`processRun — preflight at runtime` (2):
- runtime preflight отказывает → BLOCKED, stages не вызываются;
- `checkConcurrency: false` пропускает concurrency check (worker mode).

`processRun — failure taxonomy` (5):
- AUTH_FAILURE → FAILED **без** retry даже при attempt < max;
- TECHNICAL_FAILURE при attempt < max → FAILED с `nextAttemptAt`;
- TECHNICAL_FAILURE при attempt == max → exhausted (`nextAttemptAt: null`);
- RATE_LIMIT → удвоенный backoff (>50s);
- runner threw → нормализуется как INTERNAL_ERROR.

`processRun — staging` (3):
- FULL_SYNC раскрывается в канонический порядок stages;
- отсутствующий runner → stage skipped, run продолжается;
- после failure остальные stages не выполняются.

`classifyHttpError` (6):
- 401/403 → AUTH_FAILURE;
- 429 → RATE_LIMIT;
- 5xx → TECHNICAL_FAILURE/EXTERNAL_5XX;
- ETIMEDOUT → TECHNICAL_FAILURE/EXTERNAL_TIMEOUT;
- неизвестная ошибка → INTERNAL_ERROR.

### Соответствие критериям закрытия

- **Worker исполняет run воспроизводимо и не смешивает типы ошибок**: 6-уровневая taxonomy `AdapterOutcome` явно разделяет SUCCESS / PARTIAL / POLICY_BLOCK / AUTH_FAILURE / TECHNICAL_FAILURE / RATE_LIMIT. Routing per outcome закрыт тестами «failure taxonomy». Same input → same output (stateless engine, lifecycle через conditional update).
- **Downstream эффекты применяются через согласованные контракты**: `MarketplaceAccountsService.reportSyncRun()` — для sync health; `inventoryService.reserve/release/deduct` с `sourceEventId` — для inventory dedup (§14 контракт через `InventoryEffectLock` уже работает). Worker не делает direct prisma writes в чужие домены.
- **Run summary корректно отражает partial success, failed и blocked cases**: тесты «happy path» и «failure taxonomy» проверяют итоговые `status / processedCount / errorCount / errorCode / nextAttemptAt / blockedReason / durationMs`. PARTIAL_SUCCESS триггерится при item-failures **или** конфликтах (не только обоих сразу).

### Проверки

- `npx prisma validate` → `valid`.
- `npx tsc --noEmit` → новых ошибок в `sync-runs/` нет.
- `npx jest src/modules/sync-runs/sync-run-worker.service.spec.ts` → **22 passed, 22 total**.
- `npx jest src/modules/marketplace-accounts/ src/modules/inventory/ src/modules/warehouses/ src/modules/sync-runs/` → **Tests: 384 passed, 384 total** (19 suites). Регрессия чистая.

### Что НЕ делается (намеренно)

- **Production WB/Ozon adapter runners** (тонкие обёртки вокруг `pullFromWb`/`pullFromOzon`/`processOzonOrders` или полная переписка адаптеров) — это **отдельный rollout**. Worker engine готов как контракт; конкретные адаптеры подключаются через `registerRunner()` без изменения engine.
- **Queue dispatcher**, который опрашивает `SELECT * FROM "SyncRun" WHERE status = 'QUEUED' OR (status = 'FAILED' AND nextAttemptAt <= now())` и вызывает `processRun()` — это work `18-worker` модуля. Worker engine экспортирует `processRun(runId)` как stateless API; dispatcher живёт отдельно.
- **Удаление legacy polling в `OnModuleInit`** — оставлен как есть до полной готовности adapters. После того, как все pull/push типы получат runner'ы и dispatcher включится, legacy polling можно будет выключить через feature flag.
- **Per-process circuit breaker** (e.g. Hystrix-style) — намеренно не делается, чтобы worker оставался stateless. Circuit-breaker эффект достигается через `syncHealthStatus=ERROR` в `MarketplaceAccount` — preflight будущих run'ов это видит.
- **Frontend для отображения worker progress / circuit-breaker state** — TASK_SYNC_6.

### Что осталось вне scope

- Production adapter runners для WB/Ozon (PULL_STOCKS, PULL_ORDERS, PULL_METADATA, PUSH_STOCKS) — отдельная инкрементная работа после TASK_SYNC_5.
- Queue dispatcher + scheduled retries (`nextAttemptAt <= now()`) — модуль `18-worker`.
- Frontend истории / конфликтов / manual sync UX — TASK_SYNC_6.
- Интеграционные тесты с реальной БД (E2E partial/failure paths) и observability runbook — TASK_SYNC_7.
- Удаление legacy `[Reconcile WB] Mismatch` логов и переключение fullSync/processWbOrders на run-based pipeline — после готовности production adapters.
