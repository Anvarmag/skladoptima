# TASK_WORKER_3 — Retry/Backoff, Dead-Letter и Blocked-by-Policy Semantics

> Модуль: `18-worker`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_WORKER_1`
  - `TASK_WORKER_2`
  - согласованы `02-tenant`, `09-sync`
- Что нужно сделать:
  - реализовать retryable/non-retryable classification и backoff policy;
  - переводить policy-blocked jobs в `blocked` или `cancelled`, а не в `failed`;
  - уводить исчерпавшие попытки jobs в `failed` или `dead_lettered`;
  - вести `worker_failed_jobs` и failure snapshots;
  - отделить technical failures от domain policy failures на уровне статусов и diagnostics.
- Критерий закрытия:
  - `blocked by policy` диагностируется отдельно от инфраструктурных ошибок;
  - retry/dead-letter model воспроизводима и explainable;
  - финальные failure states пригодны для support и replay policy.

**Что сделано**

### `NonRetryableJobError` (`worker-runtime.errors.ts`)

Добавлен новый класс ошибки `NonRetryableJobError`. Когда обработчик бросает его, worker немедленно переводит job в `failed` без каких-либо повторных попыток, независимо от оставшихся `maxAttempts`. Используется для постоянных ошибок: невалидный payload, нарушение constraint, перманентный отказ внешнего сервиса.

### `classifyError?` в `IJobHandler` (`job-handler.interface.ts`)

В интерфейс добавлен необязательный метод `classifyError?(error: Error): 'retryable' | 'non-retryable'`. Позволяет доменным обработчикам классифицировать ошибки сторонних библиотек без необходимости обворачивать каждую в `NonRetryableJobError`. `WorkerRuntimeService` вызывает его при наличии.

### `WorkerFailureClass` enum + `failureClass` в `WorkerFailedJob` (`schema.prisma`)

Добавлен enum `WorkerFailureClass` с тремя значениями:
- `TECHNICAL_INFRA` — retryable ошибка исчерпала `maxAttempts` → статус `dead_lettered`
- `TECHNICAL_NON_RETRYABLE` — non-retryable ошибка, мгновенный переход → статус `failed`
- `NO_HANDLER` — для job type не зарегистрирован обработчик → статус `failed`

Поле `failureClass` добавлено в `WorkerFailedJob` (default: `TECHNICAL_INFRA`). Добавлен индекс `@@index([failureClass])` для support-запросов по классу сбоя.

### Миграция `20260429000000_worker_failure_class`

DDL: `CREATE TYPE "WorkerFailureClass"`, `ALTER TABLE "worker_failed_jobs" ADD COLUMN "failure_class"`, `CREATE INDEX`.

### Обновлён `WorkerRuntimeService` (`worker-runtime.service.ts`)

- `handleJobError()` расширен тремя ветками:
  1. `JobBlockedError` → `blocked` (без `worker_failed_jobs` snapshot, диагностика через `failureClass: 'DOMAIN_POLICY'` в логах)
  2. `NonRetryableJobError` или `handler.classifyError(err) === 'non-retryable'` → `markFinalFailed(..., 'TECHNICAL_NON_RETRYABLE')` → `failed`
  3. Retryable: retry → `retrying` или исчерпание → `markFinalFailed(..., 'TECHNICAL_INFRA')` → `dead_lettered`
- `markFinalFailed()` принимает `failureClass` и передаёт его в `worker_failed_jobs` + структурированный лог.
- Логи `job_blocked`, `job_retrying`, `job_final_failed` теперь содержат `failureClass` — разделение DOMAIN_POLICY / TECHNICAL_INFRA / TECHNICAL_NON_RETRYABLE / NO_HANDLER.
- `NO_HANDLER` → `markFinalFailed(..., 'NO_HANDLER')` → `failed`.
- `ORPHANED_EXCEEDED_MAX_ATTEMPTS` (recovery) → `markFinalFailed(..., 'TECHNICAL_INFRA')` → `dead_lettered`.

### `cancelJob()` в `WorkerService` + `POST /worker/jobs/:jobId/cancel`

Support/admin может отменить job в статусе `queued`, `retrying` или `blocked`. Переводит в `cancelled` с очисткой lease и `nextAttemptAt`. Статус `blocked` добавлен в `RETRYABLE_TERMINAL_STATUSES` — support может повторить заблокированную job после изменения политики (§10 system-analytics).

### Критерии закрытия

- [x] `blocked by policy` диагностируется отдельно от инфраструктурных ошибок: статус `blocked` + `failureClass: 'DOMAIN_POLICY'` в логах
- [x] retry/dead-letter model воспроизводима: `TECHNICAL_INFRA` exhausted → `dead_lettered` + snapshot
- [x] non-retryable: `TECHNICAL_NON_RETRYABLE` → `failed` + snapshot без retry
- [x] финальные failure states пригодны для support и replay policy: `failureClass` в `worker_failed_jobs`, `cancelJob()`, `retryJob()` поддерживает `blocked`
