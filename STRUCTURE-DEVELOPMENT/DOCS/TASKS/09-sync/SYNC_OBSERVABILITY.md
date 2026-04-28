# Sync — Observability Runbook

> Раздел: `09-sync`
> Последнее обновление: 2026-04-26 (TASK_SYNC_7)
> Связанные документы: `system-analytics.md` §19/§20, `sync-run.events.ts`, `sync-run.contract.ts`

Операционный справочник для модуля sync: какие события эмитятся, каким
метрикам §19 они соответствуют, какие пороги алертов и какие
диагностические запросы запускать при инциденте.

## 1. Каноничные события

Все имена — константы в [`apps/api/src/modules/marketplace_sync/sync-run.events.ts`](apps/api/src/modules/marketplace_sync/sync-run.events.ts).
Эмитятся через структурированные `Logger.log/warn/error` с JSON-payload:
`{ event, tenantId, runId, ...data, ts }`.

| Событие | Severity | Эмиттер | Когда срабатывает |
|---|---|---|---|
| `sync_run_queued` | info | `SyncRunsService.createRun` | Manual run создан в QUEUED |
| `sync_run_started` | info | `SyncRunWorker.processRun` | Worker забрал run в IN_PROGRESS |
| `sync_run_finished` | info | `SyncRunWorker._finalizeOk` | SUCCESS / PARTIAL_SUCCESS finalize |
| `sync_run_cancelled` | info | (зарезервировано) | Manual cancel — пока не используется |
| `sync_run_blocked_by_tenant_state` | warn | preflight | TRIAL_EXPIRED / SUSPENDED / CLOSED |
| `sync_run_blocked_by_account_state` | warn | preflight | account INACTIVE или not found |
| `sync_run_blocked_by_concurrency` | warn | admission | уже есть QUEUED/IN_PROGRESS run на (tenant, account) |
| `sync_run_blocked_by_credentials` | warn | preflight | INVALID / NEEDS_RECONNECT credentials |
| `sync_run_retry_scheduled` | info | `SyncRunsService.retryRun` или worker `_finalizeFailedFromStage` | Создан новый retry run или установлен `nextAttemptAt` |
| `sync_run_retry_exhausted` | warn | retry endpoint / worker | `attemptNumber >= maxAttempts` — нет автоповтора |
| `sync_run_stage_started` | info | worker | Стадия pipeline началась |
| `sync_run_stage_finished` | info | worker | Стадия завершилась с outcome |
| `sync_run_external_rate_limit` | error | worker | RATE_LIMIT outcome (429) |
| `sync_run_external_error` | error | worker | AUTH_FAILURE / TECHNICAL_FAILURE |
| `sync_run_conflict_detected` | warn | `SyncDiagnosticsService.recordConflict` | Конфликт зафиксирован, run → PARTIAL_SUCCESS |
| `sync_run_item_recorded` | warn | `SyncDiagnosticsService.recordItem` | Item-level FAILED / CONFLICT / BLOCKED |
| `sync_conflict_resolved` | info | `SyncDiagnosticsService.resolveConflict` | Конфликт закрыт пользователем |

Дополнительные события (внутренние, не для алертов):
| Событие | Когда |
|---|---|
| `sync_run_pickup_skipped` | worker нашёл run в нон-QUEUED статусе |
| `sync_run_runner_missing` | для syncType нет зарегистрированного runner'а |
| `sync_run_stage_threw` | runner кинул exception (нормализуется в INTERNAL_ERROR) |
| `sync_run_worker_threw` | defensive catch на верхнем уровне worker'а |
| `sync_run_health_report_failed` | `MarketplaceAccountsService.reportSyncRun` упал |

## 2. Машинные коды

Все коды задокументированы в [`sync-run.contract.ts`](apps/api/src/modules/marketplace_sync/sync-run.contract.ts) — single source of truth.

### `SyncBlockedReason` (для `SyncRun.blockedReason`, статус BLOCKED)

| Код | Источник | UI hint |
|---|---|---|
| `TENANT_TRIAL_EXPIRED` | tenant.accessState=TRIAL_EXPIRED | Оформите подписку |
| `TENANT_SUSPENDED` | tenant.accessState=SUSPENDED | Обратитесь в поддержку |
| `TENANT_CLOSED` | tenant.accessState=CLOSED или tenant не найден | Доступ недоступен |
| `ACCOUNT_INACTIVE` | account.lifecycleStatus=INACTIVE или not found | Активируйте подключение |
| `CREDENTIALS_INVALID` | account.credentialStatus=INVALID | Обновите ключи |
| `CREDENTIALS_NEEDS_RECONNECT` | account.credentialStatus=NEEDS_RECONNECT | Перевыпустите токен |
| `CONCURRENCY_GUARD` | уже есть активный run | Дождитесь завершения |

### `SyncErrorCode` (для `SyncRun.errorCode`, статус FAILED)

| Код | HTTP/маркер | Retry-eligible? |
|---|---|---|
| `EXTERNAL_RATE_LIMIT` | 429 | да, удвоенный backoff |
| `EXTERNAL_AUTH_FAILED` | 401/403 | **нет** (нужно обновить credentials) |
| `EXTERNAL_TIMEOUT` | ECONNABORTED/ETIMEDOUT | да |
| `EXTERNAL_5XX` | 5xx | да |
| `SYNC_STAGE_FAILED` | adapter-specific | зависит от outcome |
| `INTERNAL_ERROR` | необработанное исключение | да (но проверить root cause) |

§20 invariant: `BLOCKED ≠ FAILED`. Эти словари не пересекаются. Алерт-правила различают их.

## 3. Соответствие метрикам §19 system-analytics

| Метрика §19 | Источник | Где брать |
|---|---|---|
| `sync_runs_started` | `sync_run_started` event count | per (tenantId, accountId) interval |
| `sync_runs_failed` | `count(SyncRun WHERE status=FAILED)` | + filter по errorCode для taxonomy |
| `sync_runs_blocked` | `count(SyncRun WHERE status=BLOCKED)` | per blockedReason |
| `partial_success_rate` | `count(status=PARTIAL_SUCCESS) / count(status IN (SUCCESS, PARTIAL_SUCCESS, FAILED))` | окно 24h |
| `retry_count` | `count(SyncRun WHERE triggerType=RETRY)` или sum(attemptNumber-1) | per (tenant, account) |
| `queue_lag` | `now() - createdAt` для QUEUED runs | p95 < 60s целевой §18 |
| `conflicts_open` | `count(SyncConflict WHERE resolvedAt IS NULL)` | per tenant |
| `run_duration` | `durationMs` per (status, syncTypes) | distribution для SLA |

Дополнительно:

| Метрика | Источник | Применение |
|---|---|---|
| `stuck_in_progress` | `status=IN_PROGRESS AND now() - startedAt > 30 min` | worker завис между stages |
| `auto_retry_rate` | events `sync_run_retry_scheduled` без manual triggerType | оценка эффективности retry policy |
| `auth_failure_streak` | rolling window по `errorCode=EXTERNAL_AUTH_FAILED` per account | indicator на NEEDS_RECONNECT |

## 4. Алерт-пороги (P0/P1/P2)

Спецификация для будущей интеграции с Prometheus/Grafana.

| Алерт | Условие | Severity | Что делать |
|---|---|---|---|
| **Stuck IN_PROGRESS** | `status=IN_PROGRESS AND now() - startedAt > 30 min` | P0 | Worker завис между stages. Проверить логи `sync_run_stage_*` для конкретного runId. Может потребоваться ручной reset через update в БД. |
| **Mass auth failures per marketplace** | `EXTERNAL_AUTH_FAILED rate > 10/час` для одного marketplace | P0 | Marketplace отозвал ключи или API изменил auth схему. Сообщить пользователям через notifications. |
| **Run duration spike p95** | `p95(durationMs) > 5min` за окно 1 час | P1 | Marketplace API replies медленно или адаптер делает лишние запросы. Проверить stage timings в `sync_run_stage_finished` events. |
| **High blocked_by_credentials rate** | `BLOCKED_BY_CREDENTIALS rate > 5/час` per tenant | P1 | Пользователь не реагирует на NEEDS_RECONNECT. Эскалация в notifications. |
| **High blocked_by_tenant_state** | `BLOCKED_BY_TENANT_STATE rate > 50/час` per tenant | P2 | Scheduler продолжает создавать runs на paused tenant — UX bug или scheduler не уважает tenant state. |
| **Conflicts backlog** | `conflicts_open > 50` per tenant | P1 | Накопились нерешённые конфликты. Эскалация support'у; может означать data drift между нашим inventory и marketplace. |
| **Rate-limit storm** | `EXTERNAL_RATE_LIMIT rate > 20/час` per marketplace | P0 | Слишком частый polling. Уменьшить частоту scheduled poll или ввести adaptive backoff. |
| **Retry exhausted spike** | `sync_run_retry_exhausted rate > 5/час` | P1 | Что-то системно не работает — retry не помогает. Проверить root cause через `errorCode` distribution. |
| **Queue lag** | `p95(queue_lag) > 60s` | P1 | Dispatcher отстаёт. Проверить worker capacity. |
| **Race на admission** | `P2002` rate > 1/час из createRun | P2 | UI/scheduler параллельно создают runs. Проверить idempotency на стороне caller. |

## 5. Диагностические запросы

Все требуют tenant-scoped доступ через `RequireActiveTenantGuard`.

### 5.1 Список запусков с фильтрами

```
GET /api/sync/runs?status=FAILED
GET /api/sync/runs?status=BLOCKED
GET /api/sync/runs?status=PARTIAL_SUCCESS
GET /api/sync/runs?accountId=<uuid>
GET /api/sync/runs?triggerType=RETRY
```

### 5.2 Карточка запуска (включая items + conflicts)

```
GET /api/sync/runs/<id>
```

Возвращает:
- aggregated counters (`processedCount`, `errorCount`, `durationMs`);
- `status` + `errorCode` / `blockedReason` (взаимоисключающие);
- `items[]` — только проблемные кейсы (FAILED/CONFLICT/BLOCKED) per §8 invariant;
- `conflicts[]`;
- `originRun` если retry.

**Главный артефакт инцидент-расследования.** Поделившись response с support'ом, вы даёте им полную безопасную картину run'а.

### 5.3 Конфликты

```
GET /api/sync/conflicts?status=open
GET /api/sync/conflicts?status=resolved
GET /api/sync/conflicts/<id>
POST /api/sync/conflicts/<id>/resolve
```

### 5.4 Manual sync now / retry

```
POST /api/sync/runs                  body: { accountId, syncTypes[], idempotencyKey? }
POST /api/sync/runs/<id>/retry       body: {}
```

Idempotency-Key поддержан HTTP header'ом или body field. Mismatch → 400.

### 5.5 SQL для bulk-аналитики

Распределение run'ов по статусу за последние 24h:
```sql
SELECT "status", COUNT(*)
FROM "SyncRun"
WHERE "tenantId" = $1
  AND "createdAt" > NOW() - INTERVAL '24 hours'
GROUP BY "status";
```

Topology blocked reasons за неделю:
```sql
SELECT "blockedReason", COUNT(*)
FROM "SyncRun"
WHERE "tenantId" = $1
  AND "status" = 'BLOCKED'
  AND "createdAt" > NOW() - INTERVAL '7 days'
GROUP BY "blockedReason"
ORDER BY 2 DESC;
```

Stuck IN_PROGRESS > 30 минут:
```sql
SELECT "id", "tenantId", "marketplaceAccountId", "syncTypes", "startedAt"
FROM "SyncRun"
WHERE "status" = 'IN_PROGRESS'
  AND NOW() - "startedAt" > INTERVAL '30 minutes';
```

Failure taxonomy:
```sql
SELECT "errorCode", COUNT(*)
FROM "SyncRun"
WHERE "tenantId" = $1
  AND "status" = 'FAILED'
  AND "createdAt" > NOW() - INTERVAL '24 hours'
GROUP BY "errorCode"
ORDER BY 2 DESC;
```

Длинные runs (95-й перцентиль):
```sql
SELECT
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "durationMs") AS p95_ms,
  AVG("durationMs") AS avg_ms,
  COUNT(*) AS runs
FROM "SyncRun"
WHERE "tenantId" = $1
  AND "status" IN ('SUCCESS', 'PARTIAL_SUCCESS', 'FAILED')
  AND "createdAt" > NOW() - INTERVAL '24 hours';
```

Open конфликты per entityType:
```sql
SELECT "entityType", "conflictType", COUNT(*)
FROM "SyncConflict"
WHERE "tenantId" = $1
  AND "resolvedAt" IS NULL
GROUP BY "entityType", "conflictType"
ORDER BY 3 DESC;
```

### 5.6 Поиск конкретного event-типа в structured logs

```
{ event = "sync_run_blocked_by_credentials", tenantId = "<id>" }
{ event = "sync_run_external_error", errorCode = "EXTERNAL_AUTH_FAILED" }
{ event = "sync_run_retry_exhausted" }
```

Все события имеют префикс `sync_run_` или `sync_conflict_` — grep'абельный namespace (тест в `sync-runs.regression.spec.ts § OBSERVABILITY`).

## 6. Дашборды (рекомендованный набор)

Когда будет интеграция с Grafana / OpenSearch:

- **Run Funnel (24h)** — QUEUED → IN_PROGRESS → SUCCESS / PARTIAL / FAILED / BLOCKED. Drop-off показывает, где runs застревают.
- **Failure Taxonomy** — bar chart по `errorCode` distribution среди FAILED runs.
- **Block Topology** — bar chart по `blockedReason` среди BLOCKED runs. Pie между TENANT_* / ACCOUNT_* / CREDENTIALS_* / CONCURRENCY.
- **Run Duration p50/p95/p99** — line chart по часам, overlaid с total volume.
- **Retry Cycle** — sankey: ORIGIN_FAILED → RETRY_QUEUED → RETRY_SUCCESS / RETRY_FAILED / RETRY_EXHAUSTED.
- **Conflicts Backlog** — список `resolvedAt IS NULL` с age и conflictType, sorted by age desc.
- **Account Sync Health Snapshot** — таблица по `MarketplaceAccount.syncHealthStatus` distribution (cross-link с `08-marketplace-accounts` runbook).

## 7. Регрессионная карта (тесты)

Покрытие §16 system-analytics test matrix:

| Сценарий §16 | Файл / describe |
|---|---|
| Успешный manual sync | `sync-runs.regression.spec.ts §16.1` |
| Scheduled sync без ошибок | `sync-runs.regression.spec.ts §16.2` |
| Частичный sync с PARTIAL_SUCCESS | `sync-runs.regression.spec.ts §16.3` |
| Retry после временной ошибки | `sync-runs.regression.spec.ts §16.4` (2 теста) |
| Rate-limit сценарий | `sync-runs.regression.spec.ts §16.5` (2 теста) |
| Duplicate external event / idempotency | `sync-runs.regression.spec.ts §16.6` (2 теста) |
| Конфликт inventory mismatch | `sync-runs.regression.spec.ts §16.7` |
| TRIAL_EXPIRED → BLOCKED, история сохранена | `sync-runs.regression.spec.ts §16.8` |
| SUSPENDED/CLOSED → BLOCKED | `sync-runs.regression.spec.ts §16.9` (3 теста) |
| failed preflight → BLOCKED, не FAILED | `sync-runs.regression.spec.ts §16.10` |
| Success items не создают item-level трассу | `sync-runs.regression.spec.ts §16.11` (2 теста) |
| **OBSERVABILITY**: каноничные event names + machine codes | `sync-runs.regression.spec.ts OBSERVABILITY` (4 теста) |
| **OBSERVABILITY**: §20 invariant blocked ≠ failed | `sync-runs.regression.spec.ts OBSERVABILITY` (2 теста) |

Дополнительно (unit-spec'ы per-сервис):
- `sync-runs.service.spec.ts` — createRun + retryRun + list + getById (23);
- `sync-preflight.service.spec.ts` — все блокировки + helpers (14);
- `sync-diagnostics.service.spec.ts` — recordItem/Conflict + counters + conflicts CRUD (20);
- `sync-run-worker.service.spec.ts` — engine lifecycle + outcome routing + retry policy (22);
- `sync-runs.regression.spec.ts` — §16 + observability invariants (23).

Совокупно: **102 теста в 5 suites** (sync-runs модуль).
Глобально (marketplace-accounts + inventory + warehouses + sync-runs): **407 passed, 20 suites**.

## 8. §20 invariants (явно покрыты тестами)

1. **`BLOCKED ≠ FAILED`** — preflight отказы материализуются как `status=BLOCKED, blockedReason=<machine code>`, а не `status=FAILED`. Тесты §16.10 + OBSERVABILITY block.
2. **AUTH_FAILURE → FAILED, не BLOCKED** — adapter auth ошибка это интеграционный сбой, не политика. Тест OBSERVABILITY block.
3. **Success items не пишутся в `SyncRunItem`** — `recordItem` отвергает `SUCCESS`/`SKIPPED` на service-level, success path хранится только агрегатами (§8). Тест §16.11.
4. **Idempotency через DB UNIQUE** — повторный POST с тем же `idempotencyKey` возвращает существующий run без побочек. P2002 race нормализуется. Тесты §16.6.
5. **Sync health и credential validity — независимые слои** — worker не помечает `credentialStatus=NEEDS_RECONNECT` при AUTH_FAILURE; это responsibility validate-action на marketplace-accounts. Worker → `reportSyncRun()` обновляет ТОЛЬКО `lastSyncResult`/`syncHealthStatus`, не credentials.

## 9. Когда дополнять

Каждый раз, когда добавляется новый observable путь:
1. Новая константа в `sync-run.events.ts` (если новое event имя) или `sync-run.contract.ts` (если новый machine code).
2. Раздел в этом документе (соответствие метрике, severity, что делать).
3. Тест в `sync-runs.regression.spec.ts` (OBSERVABILITY block).
