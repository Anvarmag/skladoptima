# TASK_SYNC_7 — QA, Regression и Observability

> Модуль: `09-sync`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `10h`
- Зависимости:
  - `TASK_SYNC_1` … `TASK_SYNC_6`
- Что нужно сделать:
  - покрыть тестами manual run, scheduled run, retry, partial success, failed, blocked;
  - проверить rate-limit, duplicate external event и conflict scenarios;
  - добавить кейсы `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED` и blocked preflight;
  - проверить, что success items не создают лишнюю item-level трассу в MVP;
  - завести метрики и алерты по run duration, blocked reasons, failure rate, retry spikes.
- Критерий закрытия:
  - регрессии по sync policy и idempotency ловятся автоматически;
  - observability показывает реальную операционную картину sync;
  - QA matrix покрывает ключевые run paths и конфликтные сценарии.

**Что сделано**

### Контекст MVP до задачи

После TASK_SYNC_1..6 у sync-runs модуля **79 unit-тестов** в 4 suites (`sync-runs.service`, `sync-preflight.service`, `sync-diagnostics.service`, `sync-run-worker.service`). Каждый тест проверяет одну операцию изолированно.

Что отсутствовало:
- **Регрессионный spec по §16 test matrix** — формального документа «что покрыто, что нет» не было; reviewer не мог быстро увидеть, что весь scenario set из system-analytics реально проверяется.
- **Тесты на observability invariants** (`SyncRunEventNames` контракт, namespace `sync_*` для grep'абельности, §20 invariant blocked ≠ failed) — не было.
- **Observability runbook** — для marketplace-accounts (TASK_MA_7), inventory (TASK_INVENTORY_7), warehouses (TASK_WAREHOUSES_7) такие документы есть; для sync — отсутствовал.
- **Метрики §19 system-analytics** (`sync_runs_started`, `_failed`, `_blocked`, `partial_success_rate`, `retry_count`, `queue_lag`, `conflicts_open`, `run_duration`) не были замаплены на источники данных, не было SQL-запросов для bulk-аналитики, не было алерт-порогов с severity и actions.

### Что добавлено

**1. Регрессионный spec [sync-runs.regression.spec.ts](apps/api/src/modules/sync-runs/sync-runs.regression.spec.ts)**

23 теста в 13 describe-блоках, мапятся 1:1 на §16 system-analytics test matrix:

| § | Сценарий | Тестов |
|---|---|---|
| §16.1 | Успешный manual sync (admission + worker + reportSyncRun) | 1 |
| §16.2 | Scheduled sync без ошибок | 1 |
| §16.3 | PARTIAL_SUCCESS (item failures, errorCount > 0, partial=true в reportSyncRun) | 1 |
| §16.4 | Retry после TECHNICAL_FAILURE: nextAttemptAt + manual retry chain (origin → attempt 2) | 2 |
| §16.5 | Rate-limit (worker удвоенный backoff + classifyHttpError(429)) | 2 |
| §16.6 | Duplicate external event: idempotencyKey возвращает существующий run; P2002 race resolves | 2 |
| §16.7 | Конфликт inventory mismatch → recordConflict + run PARTIAL_SUCCESS | 1 |
| §16.8 | TRIAL_EXPIRED → BLOCKED run в истории (не 403), startedAt=finishedAt=now | 1 |
| §16.9 | SUSPENDED/CLOSED admission + runtime preflight (3 теста: SUSPENDED admission, CLOSED admission, runtime mid-flight change) | 3 |
| §16.10 | failed preflight → BLOCKED, не FAILED (CREDENTIALS_INVALID) | 1 |
| §16.11 | Success items НЕ создают item-level трассу (§8 invariant + service-level reject SUCCESS) | 2 |
| OBSERVABILITY | каноничные event names + machine codes + helpers + namespace | 4 |
| OBSERVABILITY | §20 invariant: AUTH_FAILURE → FAILED (не BLOCKED), TENANT_SUSPENDED → BLOCKED (не FAILED) | 2 |

Все 23 теста проходят. Это даёт reviewer'у однозначный mapping: «что в §16 — что в коде».

**2. Observability runbook [SYNC_OBSERVABILITY.md](STRUCTURE-DEVELOPMENT/DOCS/TASKS/09-sync/SYNC_OBSERVABILITY.md)**

~290 строк, 9 разделов по образцу [MARKETPLACE_ACCOUNTS_OBSERVABILITY.md](STRUCTURE-DEVELOPMENT/DOCS/TASKS/08-marketplace-accounts/MARKETPLACE_ACCOUNTS_OBSERVABILITY.md):

1. **Каноничные события** — таблица по 16 event names из `SyncRunEventNames` + 5 internal (severity / эмиттер / когда срабатывает).
2. **Машинные коды** — `SyncBlockedReason` (7 кодов с UI hints) и `SyncErrorCode` (6 кодов с retry-eligibility).
3. **Соответствие метрикам §19** — таблица source-of-truth для каждой метрики (`sync_runs_started/failed/blocked`, `partial_success_rate`, `retry_count`, `queue_lag`, `conflicts_open`, `run_duration`).
4. **Алерт-пороги** — 10 алертов с severity P0/P1/P2, условиями, actions:
   - **P0**: Stuck IN_PROGRESS, Mass auth failures per marketplace, Rate-limit storm;
   - **P1**: Run duration spike p95, High blocked_by_credentials, Conflicts backlog, Retry exhausted spike, Queue lag;
   - **P2**: High blocked_by_tenant_state, Race на admission.
5. **Диагностические запросы** — список API endpoints + 5 SQL-запросов для bulk-аналитики (status distribution, blocked taxonomy, stuck IN_PROGRESS, failure taxonomy, p95 duration, conflicts backlog).
6. **Дашборды** — рекомендации для Grafana/OpenSearch (Run Funnel, Failure Taxonomy, Block Topology, Run Duration, Retry Cycle, Conflicts Backlog, Account Sync Health Snapshot).
7. **Регрессионная карта** — explicit mapping §16 sections → test files/describe blocks.
8. **§20 invariants** — список из 5 архитектурных гарантий с указанием тестов (BLOCKED ≠ FAILED, AUTH_FAILURE → FAILED, success-only-aggregates, idempotency, sync health vs credential validity independence).
9. **Когда дополнять** — процесс расширения runbook'а при добавлении новых observable путей.

**3. Структура тестов модуля sync-runs**

| Suite | Тесты | Назначение |
|---|---|---|
| `sync-runs.service.spec.ts` | 23 | createRun + retryRun + list + getById |
| `sync-preflight.service.spec.ts` | 14 | shared policy guard (3 paused states, account/credentials, concurrency, helpers) |
| `sync-diagnostics.service.spec.ts` | 20 | recordItem (FAILED/CONFLICT/BLOCKED), recordConflict, increment*, list/get/resolve |
| `sync-run-worker.service.spec.ts` | 22 | engine lifecycle (race-safe pickup), runtime preflight, outcome routing, retry policy, classifyHttpError |
| `sync-runs.regression.spec.ts` | 23 | §16 test matrix + observability invariants |
| **ИТОГО** | **102 теста в 5 suites** | |

### Соответствие критериям закрытия

- **Регрессии по sync policy и idempotency ловятся автоматически**: §16.6 (idempotencyKey + P2002 race), §16.7 (conflicts), §16.8-10 (TRIAL_EXPIRED/SUSPENDED/CLOSED/CREDENTIALS_INVALID на admission и runtime preflight), §16.11 (success items не пишутся), OBSERVABILITY block (§20 invariants явно). Любая регрессия в любой ветке даст красный CI.
- **Observability показывает реальную операционную картину sync**: 16 канонических events + 13 machine codes сгруппированы по namespace `sync_run_*` / `sync_conflict_*` (тест проверяет namespace formatter). Метрики §19 замаплены на источники в БД и на event log. 10 алерт-правил с severity и actions готовы для интеграции в Prometheus/Grafana.
- **QA matrix покрывает ключевые run paths и конфликтные сценарии**: explicit mapping §16 → testfiles в SYNC_OBSERVABILITY.md разделе 7 + регрессионный spec dispatches каждый сценарий по `describe('§16.x ...')` блоку.

### Проверки

- `npx prisma validate` → `valid`.
- `npx tsc --noEmit` → новых ошибок нет.
- `npx jest src/modules/sync-runs/` → **Tests: 102 passed, 102 total** (5 suites).
- `npx jest src/modules/marketplace-accounts/ src/modules/inventory/ src/modules/warehouses/ src/modules/sync-runs/` → **Tests: 407 passed, 407 total** (20 suites). Полная регрессия чистая.

### Что НЕ делается (намеренно)

- **Реальная интеграция с Prometheus / Grafana / OpenSearch** — runbook документирует contract; конкретная wire-up зависит от инфраструктурной задачи (TASK 18-worker / observability platform), которая выходит за рамки sync-модуля.
- **E2E Playwright тесты для frontend SyncRuns страницы** — отдельная задача в e2e suite, требует поднятого backend + БД + браузера. На данный момент frontend покрыт через TS check + Vite build (TASK_SYNC_6); contract-tests api-уровня покрывают backend invariants.
- **Loadtest для queue dispatcher** — dispatcher (модуль 18-worker) ещё не реализован; loadtest имеет смысл после его готовности.
- **Notifications integration** (toast/push при FAILED run) — отдельный модуль `notifications`.
- **Real production WB/Ozon adapter runners** — engine готов как контракт, runners подключаются bootstrap'ом без изменения тестируемого кода.

### Что осталось вне scope

- Production WB/Ozon adapter runners + queue dispatcher (модуль 18-worker).
- Удаление legacy `OnModuleInit` polling из `marketplace_sync/sync.service.ts` после полного rollout adapters.
- Notifications-интеграция при FAILED/BLOCKED runs.
- E2E Playwright тесты на frontend.
- Wire-up метрик в продакшен Prometheus/Grafana.
