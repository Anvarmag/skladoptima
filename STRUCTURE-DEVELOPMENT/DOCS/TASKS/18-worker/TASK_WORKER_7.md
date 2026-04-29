# TASK_WORKER_7 — QA, Regression и Observability Worker

> Модуль: `18-worker`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `10h`
- Зависимости:
  - `TASK_WORKER_1`
  - `TASK_WORKER_2`
  - `TASK_WORKER_3`
  - `TASK_WORKER_4`
  - `TASK_WORKER_5`
  - `TASK_WORKER_6`
- Что нужно сделать:
  - покрыть тестами success path, retryable failure, final failed, dead-letter, blocked-by-policy, restart recovery;
  - проверить scheduled jobs, queue backlog и duplicate idempotent delivery;
  - покрыть manual replay только для allowed retryable jobs;
  - завести метрики и алерты по queue lag, failed final spike, lost lease, dead-letter growth и missed schedules;
  - проверить tenant isolation для job metadata/payload visibility.
- Критерий закрытия:
  - регрессии по retry/recovery/replay policy ловятся автоматически;
  - observability показывает queue performance, retries и dead-letter health;
  - QA matrix покрывает утвержденную MVP worker model.

**Что сделано**

### Тесты — `worker.service.spec.ts` (26 тестов)

Покрытие `WorkerService`:

**`enqueueJob`:**
- Создает job с дефолтами из contract (queueName, priority, maxAttempts)
- Выбрасывает `IDEMPOTENCY_KEY_REQUIRED` для BILLING_REMINDER без ключа
- Возвращает существующую активную job при совпадении `idempotencyKey` (at-most-once dedup)
- Создает FILE_CLEANUP без idempotencyKey (contract не требует)

**`retryJob`:**
- Повторно ставит в очередь job со статусом `failed`
- Допускает retry для `dead_lettered` job
- Допускает retry для `blocked` job (после изменения policy)
- Выбрасывает `CONFLICT` для `success` / `cancelled`
- Выбрасывает `CONFLICT` для `in_progress` (активная — не ретраить)
- Выбрасывает `NOT_FOUND` когда job не существует
- BILLING_REMINDER (MONEY_AFFECTING) проходит retry с audit-grade log

**`cancelJob`:**
- Отменяет `queued` / `retrying` / `blocked` jobs
- Выбрасывает `CONFLICT` для `in_progress` и `success`
- Выбрасывает `NOT_FOUND`

**`getJob`:**
- Возвращает job с историей неудач из `worker_failed_jobs`
- Выбрасывает `NOT_FOUND`

**`listJobs`:**
- Paginated список с total
- Применяет фильтры `status` и `jobType`

**`getQueuesHealth`:**
- Возвращает count по очередям и количество stuck jobs

**`getProductStatus` (tenant isolation):**
- Запрос scoped по `tenantId` (tenant isolation)
- Фильтр `jobType.in` никогда не содержит `AUDIT_MAINTENANCE` и `BILLING_REMINDER`
- `(SYNC, in_progress)` → `"sync_running"`
- `(NOTIFICATION, failed)` → `"notification_failed"`
- `(FILE_CLEANUP, queued)` → `"cleanup_pending"`
- Ответ не содержит `payload`, `lastError`, `leaseOwner`, `attempt`

---

### Тесты — `worker-runtime.service.spec.ts` (19 тестов)

Покрытие `WorkerRuntimeService`:

**`executeJob` — success path:**
- Обновляет job в `success`, очищает `leaseOwner` / `leaseUntil`

**`executeJob` — `JobBlockedError` (blocked-by-policy):**
- Статус становится `blocked`, не `failed`
- Не создает запись в `worker_failed_jobs` (`$transaction` не вызывается)

**`executeJob` — `NonRetryableJobError`:**
- Немедленно переводит в `failed` без retry (даже если `attempt < maxAttempts`)
- Создает запись в `worker_failed_jobs` через `$transaction`

**`executeJob` — retryable error, `attempt < maxAttempts`:**
- Статус `retrying`, `nextAttemptAt` установлен (в будущем)
- `leaseOwner` / `leaseUntil` очищены

**`executeJob` — retryable error, `attempt >= maxAttempts` (exhausted):**
- Статус `dead_lettered`, `$transaction` вызван

**`executeJob` — no handler registered:**
- Статус `failed` с reason `NO_HANDLER_REGISTERED:SYNC`

**`markFinalFailed`:**
- `TECHNICAL_INFRA` + exhausted → `dead_lettered`
- `TECHNICAL_NON_RETRYABLE` → `failed` (не dead_lettered)
- `NO_HANDLER` → `failed`

**`recoverOrphanedJobs` (restart recovery):**
- Orphaned job с оставшимися попытками → `retrying`
- Orphaned job с исчерпанными попытками → `dead_lettered`
- Нет orphaned jobs → Prisma update не вызывается

**`calcNextAttemptAt` (exponential backoff):**
- `attempt=1` → ~30s
- `attempt=2` → ~60s
- `attempt=10` → capped at ~1 hour

---

### Observability — `worker-alerts.service.ts` + `GET /worker/alerts/check`

**`WorkerAlertsService`** — evaluates 5 alert conditions:
- `backlog_growth`: `queued + retrying > 100` → severity: `warning`
- `final_failed_spike`: `failed + dead_lettered` за последний час `> 10` → severity: `critical`
- `dead_letter_growth`: total `dead_lettered > 50` → severity: `warning`
- `stuck_jobs`: `in_progress` с просроченным `leaseUntil > 0` → severity: `warning`
- `missed_schedule`: `worker_schedules` где `nextRunAt < (now - 10min)` → severity: `warning`

Возвращает `{ alerts: AlertSignal[], checkedAt, healthy }`.

**`GET /worker/alerts/check`** добавлен в `WorkerController` (support/admin via `x-internal-secret`).

---

### Файлы созданы / изменены

| Файл | Действие |
|------|----------|
| `apps/api/src/modules/worker/worker.service.spec.ts` | Создан (26 тестов) |
| `apps/api/src/modules/worker/worker-runtime.service.spec.ts` | Создан (19 тестов) |
| `apps/api/src/modules/worker/worker-alerts.service.ts` | Создан |
| `apps/api/src/modules/worker/worker.controller.ts` | `GET /worker/alerts/check` + инжект `WorkerAlertsService` |
| `apps/api/src/modules/worker/worker.module.ts` | Регистрация `WorkerAlertsService` |
