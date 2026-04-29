# TASK_WORKER_1 — Queue Infra, Job Persistence и Core Data Model

> Модуль: `18-worker`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - утверждена системная аналитика `18-worker`
  - согласованы `09-sync`, `15-notifications`, `17-files-s3`
- Что нужно сделать:
  - завести `worker_jobs`, `worker_failed_jobs`, `worker_schedules`;
  - закрепить job fields: `job_type`, `queue_name`, `priority`, `idempotency_key`, `correlation_id`, `tenant_id`, `status`, `attempt`, `max_attempts`, `result_summary`;
  - реализовать трехуровневое разделение очередей `critical / default / bulk`;
  - согласовать queue broker и persistence model;
  - подготовить job metadata scope так, чтобы не нарушать tenant isolation.
- Критерий закрытия:
  - data model покрывает job lifecycle, failures и schedules;
  - очереди и приоритеты выражены явно;
  - worker persistence пригодна для мониторинга и recovery.

**Что сделано**

### Модель данных (schema.prisma)

Добавлены 4 новых enum'а:
- `WorkerJobStatus` — полный lifecycle job: `queued / in_progress / retrying / success / failed / blocked / dead_lettered / cancelled`
- `WorkerJobPriority` — трёхуровневые очереди: `critical / default / bulk`
- `WorkerActorType` — актор-создатель job: `user / system / support / scheduler`
- `WorkerJobType` — реестр классов задач: `SYNC / NOTIFICATION / BILLING_REMINDER / FILE_CLEANUP / ANALYTICS_REBUILD / AUDIT_MAINTENANCE`

Добавлены 3 новых Prisma-модели:
- `WorkerJob` (`@@map("worker_jobs")`) — основная запись job с полями: `jobType`, `queueName`, `priority`, `idempotencyKey`, `correlationId`, `createdByActorType`, `payload`, `status`, `attempt`, `maxAttempts`, `leaseOwner`, `leaseUntil`, `queuedAt`, `startedAt`, `finishedAt`, `nextAttemptAt`, `lastError`, `resultSummary`. Индексы на consumer polling, tenant-scoped monitoring, jobType+status, idempotencyKey, correlationId.
- `WorkerFailedJob` (`@@map("worker_failed_jobs")`) — immutable снапшот ошибки при final-failed переходе. Insert-only, только для диагностики.
- `WorkerSchedule` (`@@map("worker_schedules")`) — реестр cron-расписаний с `name (UNIQUE)`, `cronExpr`, `jobType`, `queueName`, `priority`, `isActive`, `lastRunAt`, `nextRunAt`.

Добавлен `workerJobs WorkerJob[]` в модель `Tenant` (nullable tenant_id — system jobs не имеют tenant scope).

### Миграция

Создан файл `apps/api/prisma/migrations/20260428290000_worker_data_model/migration.sql` с:
- DDL для 4 enum'ов
- DDL для `worker_jobs`, `worker_failed_jobs`, `worker_schedules`
- FK `worker_jobs.tenantId → Tenant.id ON DELETE SET NULL`
- FK `worker_failed_jobs.jobId → worker_jobs.id ON DELETE CASCADE`
- Все индексы по spec из system-analytics

### WorkerModule (`apps/api/src/modules/worker/`)

**`worker-job.types.ts`** — интерфейс `EnqueueJobDto` + константы `QUEUE` и `QUEUE_PRIORITY`.

**`worker.service.ts`** — `WorkerService`:
- `enqueueJob(dto)` — создание job-записи (публичный метод для доменных сервисов)
- `listJobs(filter)` — paginated список с фильтрацией по status/jobType/tenantId
- `getJob(jobId)` — детали job включая последние 10 failed snapshots
- `retryJob(jobId)` — reset failed/dead_lettered job обратно в queued; запрещает retry для success/cancelled
- `getQueuesHealth()` — aggregate stats по queue+status + подсчёт stuck in_progress jobs (leaseUntil < now)
- `listSchedules()` — список всех расписаний
- `runSchedule(name)` — ручной запуск schedule → создаёт job + обновляет lastRunAt

**`worker.controller.ts`** — `WorkerController` (`/worker`):
- `GET /worker/jobs` — список jobs (фильтры: status, jobType, tenantId, page, limit)
- `GET /worker/jobs/:jobId` — детали job
- `POST /worker/jobs/:jobId/retry` — retry failed/dead_lettered job
- `GET /worker/queues/health` — health очередей
- `GET /worker/schedules` — список расписаний
- `POST /worker/schedules/:name/run` — ручной запуск schedule

Все endpoints защищены `x-internal-secret` header (support/admin scope). `@Public()` — JWT guard пропускается, auth через INTERNAL_API_SECRET.

**`worker.module.ts`** — NestJS модуль, зарегистрирован в `AppModule`.

### Критерии закрытия

- [x] Data model покрывает job lifecycle, failures и schedules
- [x] Очереди и приоритеты (critical/default/bulk) выражены явно в enum и моделях
- [x] Worker persistence пригодна для мониторинга (listJobs, getJob, getQueuesHealth) и recovery (lease механика в схеме)
- [x] Tenant isolation: tenantId nullable, все индексы учитывают tenant scope
- [x] Idempotency key и correlation_id закреплены в модели
- [x] WorkerService.enqueueJob готов для использования доменными сервисами
