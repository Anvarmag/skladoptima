# Worker / Background Jobs — Системная аналитика

> Статус: [x] На review
> Последнее обновление: 2026-04-18
> Связанный раздел: `18-worker`

## 1. Назначение модуля

Модуль исполняет фоновые задачи вне HTTP-контекста: sync, notifications, billing reminders, cleanup, scheduled jobs, retry/failure handling.

### Текущее состояние (as-is)

- в проекте уже есть `apps/api/src/worker.ts`, который поднимает application context без HTTP-порта;
- при этом выделенного job domain, queue registry и интерфейса управления задачами в текущем коде нет;
- worker-контур пока существует как техническая заготовка и точка расширения для background processing.

### Целевое состояние (to-be)

- worker должен стать самостоятельной платформой фоновых задач с очередями, retry, dead-letter и scheduler registry;
- каждая длительная операция обязана иметь прозрачный lifecycle и операционные сигналы;
- worker должен обслуживать sync, notifications, finance snapshots, billing reminders и cleanup jobs по единым правилам;
- worker должен уважать domain preflight/policy checks и не превращать `blocked by policy` в ложные технические ошибки.


## 2. Функциональный контур и границы

### Что входит в модуль
- унифицированное выполнение background jobs;
- очереди, приоритеты, retry/backoff;
- scheduled jobs и recovery после рестартов;
- dead-letter и повторный разбор неуспешных job;
- operational diagnostics по job lifecycle;
- стандартизированный job contract: `type`, `idempotency_key`, `correlation_id`, `tenant scope`, `retry class`.

### Что не входит в модуль
- доменные правила sync/billing/notifications как таковые;
- выбор бизнес-смысла задач без явного job contract;
- APM/observability platform как отдельный продукт;
- ручной cron-management вне documented schedules.

### Главный результат работы модуля
- асинхронные задачи системы выполняются надежно, повторяемо и с понятной диагностикой, даже если внешние интеграции или сам процесс временно деградируют.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Доменные сервисы | Публикуют job в очередь | Не должны блокировать HTTP на долгой работе |
| Worker runtime | Исполняет job и пишет результат | Центральный исполнитель |
| Scheduler | Триггерит periodic jobs | Не исполняет бизнес-логику сам |
| Support/Platform | Диагностирует backlog и failed jobs | Не меняет payload бесконтрольно |
| Product UI | Показывает статус конкретной операции | Не становится универсальной консолью очередей |

## 4. Базовые сценарии использования

### Сценарий 1. Async job от HTTP запроса
1. API принимает пользовательское действие.
2. Создает job record и ставит ее в очередь.
3. Возвращает быстрый ack клиенту.
4. Worker позже выполняет тяжелую часть процесса.

### Сценарий 2. Retry временной ошибки
1. Job завершается retryable error.
2. Worker помечает attempt как failed.
3. Планируется следующий retry с backoff.
4. При успехе итоговый status становится success after retry.
5. При исчерпании попыток job уходит в final failed/dead-letter.

### Сценарий 3. Recovery после рестарта
1. Worker процесс перезапускается.
2. Lease/lock механика определяет брошенные in-progress jobs.
3. Допустимые jobs возвращаются в queue или requeued автоматически.
4. Потеря задач не допускается.

### Сценарий 4. Job заблокирована policy
1. Job до исполнения проходит domain preflight check.
2. В момент запуска выясняется, что tenant/account/module policy временно не разрешает операцию.
3. Worker не делает внешний side-effect.
4. Job получает статус `blocked` или `cancelled`, а не `failed`.
5. Диагностика показывает, что причина в бизнес-политике, а не в инфраструктурной ошибке.

## 5. Зависимости и интеграции

- Redis/queue broker
- Sync, Notifications, Billing, Files
- Observability stack (logs, metrics, alerts)
- Tenant access-state policy
- Audit

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/worker/jobs` | SUPPORT_ADMIN | Мониторинг jobs |
| `GET` | `/api/v1/worker/jobs/:jobId` | SUPPORT_ADMIN | Детали job |
| `POST` | `/api/v1/worker/jobs/:jobId/retry` | SUPPORT_ADMIN | Повторить failed job |
| `GET` | `/api/v1/worker/queues/health` | SUPPORT_ADMIN | Health очередей |
| `POST` | `/api/v1/worker/schedules/:name/run` | SUPPORT_ADMIN | Ручной запуск scheduled task |

## 7. Примеры вызова API

```bash
curl -X GET '/api/v1/worker/jobs?status=FAILED&jobType=SYNC&page=1&limit=20' \
  -H "Authorization: Bearer <SUPPORT_ADMIN_JWT>"
```

### Frontend поведение

- Текущее состояние: отдельного UI для worker jobs и scheduler состояния в web-приложении нет.
- Целевое состояние: пользовательские и support-интерфейсы должны получать read-модель статусов там, где это влияет на продуктовые процессы.
- UX-правило: фоновая работа должна объясняться пользователю через статус операции, а не через ожидание без обратной связи.
- В MVP отдельная полная консоль очередей нужна только support/admin контуру.
- Tenant-facing UI в первой версии показывает только статус конкретной операции модуля (`sync running`, `cleanup pending`, `notification delivery failed`), но не общий job registry.

## 8. Модель данных (PostgreSQL)

### `worker_jobs`
- `id UUID PK`, `tenant_id UUID NULL`
- `job_type VARCHAR(64)`
- `queue_name VARCHAR(32)`, `priority ENUM(critical, default, bulk)`
- `idempotency_key VARCHAR(128) NULL`
- `correlation_id UUID NULL`
- `created_by_actor_type ENUM(user, system, support, scheduler) NOT NULL`
- `created_by_actor_id UUID NULL`
- `payload JSONB`
- `status ENUM(queued, in_progress, retrying, success, failed, blocked, dead_lettered, cancelled)`
- `attempt INT`, `max_attempts INT`
- `lease_owner VARCHAR(128) NULL`, `lease_until TIMESTAMPTZ NULL`
- `queued_at`, `started_at`, `finished_at`, `next_attempt_at TIMESTAMPTZ NULL`
- `last_error TEXT NULL`
- `result_summary JSONB NULL`

### `worker_failed_jobs`
- `id UUID PK`, `job_id UUID`, `failure_reason TEXT`, `payload_snapshot JSONB`, `created_at`

### `worker_schedules`
- `id UUID PK`, `name VARCHAR(64) UNIQUE`
- `cron_expr VARCHAR(64)`
- `is_active BOOLEAN`, `last_run_at`, `next_run_at`

## 9. Сценарии и алгоритмы (step-by-step)

1. Producer создает job и запись `worker_jobs` с `job_type`, `queue_name`, `idempotency_key`, `correlation_id`.
2. Worker-consumer берет job через lease/lock и меняет статус на `in_progress`.
3. Перед исполнением вызывается domain preflight check, если он требуется контрактом job.
4. При `blocked by policy` job переводится в `blocked` без внешнего side-effect.
5. При временной ошибке -> `retrying` с exponential backoff.
6. После `max_attempts` job уходит в `failed` или `dead_lettered` + запись в `worker_failed_jobs`.
7. Scheduler запускает cron-jobs по `worker_schedules`.

## 10. Валидации и ошибки

- Повторный retry для `success` jobs запрещен.
- Для idempotent jobs обязательный `idempotency_key`.
- Retry/replay для `blocked` jobs допускается только после изменения policy-state или вручную support/admin по контракту.
- Нельзя вручную ретраить non-retryable money/stock/access affecting job без явной idempotency policy.
- Ошибки:
  - `CONFLICT: JOB_RETRY_NOT_ALLOWED`
  - `NOT_FOUND: JOB_NOT_FOUND`
  - `CONFLICT: JOB_BLOCKED_BY_POLICY`
  - `FORBIDDEN: JOB_REPLAY_REQUIRES_SUPPORT_SCOPE`

## 11. Чеклист реализации

- [x] Таблицы мониторинга jobs (`worker_jobs`, `worker_failed_jobs`, `worker_schedules`) — TASK_WORKER_1.
- [x] Scheduled jobs registry (`WorkerSchedule` model + `runSchedule`) — TASK_WORKER_1.
- [x] Очереди + worker runtime (consumer/polling loop critical/default/bulk) — TASK_WORKER_2.
- [x] Retry/backoff policy (exponential backoff, dead_letter, recovery) — TASK_WORKER_2.
- [x] Retryable/non-retryable classification (`NonRetryableJobError`, `classifyError?`) — TASK_WORKER_3.
- [x] `WorkerFailureClass` enum + `failureClass` в failure snapshots — TASK_WORKER_3.
- [x] `blocked by policy` диагностируется отдельно (`failureClass: DOMAIN_POLICY` в логах) — TASK_WORKER_3.
- [x] `cancelJob()` + `POST /worker/jobs/:jobId/cancel` — TASK_WORKER_3.
- [x] `blocked` добавлен в retryable statuses (support replay after policy change) — TASK_WORKER_3.
- [x] DB-driven scheduler (`WorkerSchedulerService`): polling, missed-run anomaly, cron nextRunAt — TASK_WORKER_4.
- [x] Seed documented schedules (billing-reminders, analytics-rebuild, file-cleanup, audit-maintenance) — TASK_WORKER_4.
- [x] `GET /worker/schedules/:name` для диагностики отдельного расписания — TASK_WORKER_4.
- [x] `JOB_CONTRACTS` реестр (SpecialHandlingClass, ReplayPolicy, defaults, idempotency requirements) — TASK_WORKER_5.
- [x] `enqueueJob()`: contract defaults, idempotency enforcement, at-most-once dedup — TASK_WORKER_5.
- [x] `retryJob()`: replay policy guard + audit log для MONEY/STOCK/ACCESS affecting replays — TASK_WORKER_5.
- [x] Tenant-facing `GET /worker/status` (JWT-auth, product-only labels, no raw internals) — TASK_WORKER_6.
- [x] `toProductStatus()` mapping: SYNC/NOTIFICATION/FILE_CLEANUP → user-friendly labels — TASK_WORKER_6.
- [x] Visibility model: AUDIT_MAINTENANCE скрыт от tenant-facing UI — TASK_WORKER_6.
- [x] Auth split: support/admin = x-internal-secret, tenant = JWT + activeTenantId — TASK_WORKER_6.
- [x] `WorkerAlertsService`: 5 alert conditions (backlog, failed spike, dead-letter, stuck, missed schedule) — TASK_WORKER_7.
- [x] `GET /worker/alerts/check` endpoint (support/admin) — TASK_WORKER_7.
- [x] `worker.service.spec.ts`: 26 тестов (enqueueJob dedup, retryJob policy, cancelJob, getProductStatus tenant isolation) — TASK_WORKER_7.
- [x] `worker-runtime.service.spec.ts`: 19 тестов (success, blocked, non-retryable, dead-letter, recovery, backoff) — TASK_WORKER_7.

## 12. Критерии готовности (DoD)

- Фоновые задачи не блокируют API.
- Failed jobs наблюдаемы и воспроизводимы.
- Поведение worker устойчиво к рестартам.
- `blocked by policy` диагностируется отдельно от инфраструктурных failures.
- Для критичных job есть idempotency trace и correlation linkage с доменным модулем.

## 13. Классы jobs

- `SYNC`
- `NOTIFICATION`
- `BILLING_REMINDER`
- `FILE_CLEANUP`
- `ANALYTICS_REBUILD`
- `AUDIT_MAINTENANCE`

### Special handling classes
- `MONEY_AFFECTING`
- `STOCK_AFFECTING`
- `ACCESS_AFFECTING`

## 14. Очереди и приоритеты

### Рекомендуемое разделение очередей
- `critical`
- `default`
- `bulk`

### Что идет в `critical`
- billing reminders
- critical sync alerts
- verification/reset emails

### Что идет в `default`
- обычные sync jobs
- notification dispatch
- analytics rebuild

### Что идет в `bulk`
- cleanup
- backfill/reconciliation
- large low-priority maintenance jobs

## 15. Job contracts и ownership

- `SYNC`: создается sync-модулем, требует domain preflight, обычно tenant-scoped.
- `NOTIFICATION`: создается notification service, может быть tenant-scoped или global/system.
- `FILE_CLEANUP`: создается files module/worker scheduler, всегда безопасен к повтору.
- `BILLING_REMINDER`: scheduler-driven, требует строгой dedup policy.
- `ANALYTICS_REBUILD`: создается analytics/finance, не должен обходить tenant access/billing policy.
- `AUDIT_MAINTENANCE`: internal-only, не показывается в tenant-facing UI.

## 16. Graceful shutdown и recovery

- worker должен завершать активную job корректно или возвращать ее в очередь со статусом recovery-needed
- stuck jobs должны обнаруживаться heartbeat-механизмом
- после рестарта orphaned `in_progress` jobs переводятся в `retrying` или `failed`, по policy

## 17. Тестовая матрица

- Success path queued->success.
- Retry после временной ошибки.
- Final failed после исчерпания attempts.
- Scheduled job run.
- Restart worker во время `in_progress` job.
- Большой backlog очереди.
- Blocked-by-policy job не считается technical failure.
- Manual replay support-only для retryable failed job.
- Idempotent duplicate delivery не создает повторный side-effect.

## 18. Фазы внедрения

1. Queue infra и job persistence.
2. Generic worker runtime.
3. Retry/backoff/failure handling.
4. Scheduled jobs registry.
5. Monitoring + support/admin visibility.

## 19. Нефункциональные требования и SLA

- Worker runtime не должен терять job при рестарте, redeploy или временной недоступности внешних систем.
- Queue latency для critical jobs должна иметь отдельный SLA; целевой `p95 < 60 сек` на старте выполнения.
- Retry policy должна быть параметризуемой по классу job.
- Dead-letter и retry tracing обязательны для money/stock/access affecting tasks.
- Поддержка очередей не должна нарушать tenant isolation: job metadata и payload доступны только в допустимом scope.

## 20. Observability, логи и алерты

- Метрики: `jobs_queued`, `jobs_running`, `jobs_failed_final`, `retry_scheduled`, `dead_letter_count`, `queue_lag_p95`.
- Логи: job lifecycle с `job_id`, `type`, `attempt`, `tenant_id`, `correlation_id`, `error class`.
- Алерты: backlog growth, final-failed spike, missing scheduled run, lost lease/recovery anomalies.
- Dashboards: queue performance, retry efficiency, dead-letter board, scheduler adherence.

## 21. Риски реализации и архитектурные замечания

- Нельзя скрывать доменную идемпотентность за общей очередью: job могут быть повторно доставлены всегда.
- Lease/lock model должна быть формализована до имплементации recovery.
- Общая очередь без приоритетов быстро приведет к starvation критичных задач.
- Слишком “умный” worker без стандарта job contracts превратится в неуправляемый runtime.
- Если tenant-facing UI получит полный worker registry, продукт быстро утонет в технических статусах вместо понятных продуктовых состояний.

## 22. Открытые вопросы к продукту и архитектуре

- Для MVP открытых product/blocking questions не осталось.

## 23. Подтвержденные решения

- MVP operational visibility подтверждено как `support/admin worker console + product-specific status surfaces`, без общего tenant-facing job center.
- В MVP подтверждено трехуровневое разделение очередей `critical / default / bulk`.
- Manual replay разрешен только для `failed / dead_lettered` retryable jobs.
- Manual replay доступен только support/admin контуру.

## 24. Чеклист готовности раздела

- [x] Текущее и целевое состояние раздела зафиксированы.
- [x] Backend API, frontend поведение и модель данных согласованы между собой.
- [x] Async-процессы, observability и тестовая матрица описаны.
- [x] Риски, ограничения и rollout-порядок зафиксированы.

## 25. История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-04-18 | Документ приведен к единой глубине system analytics | Codex |
| 2026-04-18 | Добавлены job contracts, policy-blocked semantics, queue tiers и открытые решения по MVP visibility/replay model | Codex |
| 2026-04-18 | Зафиксированы confirmed decisions по worker visibility, queue tiers и replay policy | Codex |
| 2026-04-28 | TASK_WORKER_1 выполнена: data model (worker_jobs/failed_jobs/schedules), миграция, WorkerModule (service+controller) | Claude |
| 2026-04-29 | TASK_WORKER_2 выполнена: WorkerRuntimeService (polling, lease, recovery, graceful shutdown), JobHandlerRegistry, JobBlockedError | Claude |
| 2026-04-29 | TASK_WORKER_3 выполнена: NonRetryableJobError, WorkerFailureClass enum, failureClass в worker_failed_jobs, cancelJob(), blocked → retryable | Claude |
| 2026-04-29 | TASK_WORKER_4 выполнена: WorkerSchedulerService (DB-driven cron, missed-run detection, schedule seeds, getSchedule endpoint) | Claude |
| 2026-04-29 | TASK_WORKER_5 выполнена: JOB_CONTRACTS реестр, SpecialHandlingClass, ReplayPolicy, idempotency enforcement, at-most-once dedup, high-risk replay audit log | Claude |
| 2026-04-29 | TASK_WORKER_6 выполнена: tenant-facing GET /worker/status (JWT, product labels), toProductStatus() mapping, AUDIT_MAINTENANCE скрыт, auth split зафиксирован | Claude |
| 2026-04-29 | TASK_WORKER_7 выполнена: 45 тестов (26+19), WorkerAlertsService (5 условий), GET /worker/alerts/check | Claude |
