# Worker / Background Jobs — Системная аналитика (Dev Spec)

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

## 1. Назначение

Модуль исполняет фоновые задачи вне HTTP-контекста: sync, notifications, billing reminders, cleanup, scheduled jobs, retry/failure handling.

## 2. Функциональный контур и границы

### Что входит в модуль
- унифицированное выполнение background jobs;
- очереди, приоритеты, retry/backoff;
- scheduled jobs и recovery после рестартов;
- dead-letter и повторный разбор неуспешных job;
- operational diagnostics по job lifecycle.

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

## 5. Зависимости и интеграции

- Redis/queue broker
- Sync, Notifications, Billing, Files
- Observability stack (logs, metrics, alerts)

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

## 8. Модель данных (PostgreSQL)

### `worker_jobs`
- `id UUID PK`, `tenant_id UUID NULL`
- `job_type VARCHAR(64)`
- `payload JSONB`
- `status ENUM(queued, in_progress, retrying, success, failed)`
- `attempt INT`, `max_attempts INT`
- `queued_at`, `started_at`, `finished_at`
- `last_error TEXT NULL`

### `worker_failed_jobs`
- `id UUID PK`, `job_id UUID`, `failure_reason TEXT`, `payload_snapshot JSONB`, `created_at`

### `worker_schedules`
- `id UUID PK`, `name VARCHAR(64) UNIQUE`
- `cron_expr VARCHAR(64)`
- `is_active BOOLEAN`, `last_run_at`, `next_run_at`

## 9. Сценарии и алгоритмы (step-by-step)

1. Producer создает job (или пушит в очередь) и запись `worker_jobs`.
2. Worker-consumer берет job, меняет статус на `in_progress`.
3. При временной ошибке -> `retrying` с exponential backoff.
4. После `max_attempts` job уходит в `failed` + запись в `worker_failed_jobs`.
5. Scheduler запускает cron-jobs по `worker_schedules`.

## 10. Валидации и ошибки

- Повторный retry для `success` jobs запрещен.
- Для idempotent jobs обязательный `idempotency_key`.
- Ошибки:
  - `CONFLICT: JOB_RETRY_NOT_ALLOWED`
  - `NOT_FOUND: JOB_NOT_FOUND`

## 11. Чеклист реализации

- [ ] Очереди + worker runtime.
- [ ] Таблицы мониторинга jobs.
- [ ] Retry/backoff policy.
- [ ] Scheduled jobs registry.
- [ ] Алерты по failed/backlog.

## 12. Критерии готовности (DoD)

- Фоновые задачи не блокируют API.
- Failed jobs наблюдаемы и воспроизводимы.
- Поведение worker устойчиво к рестартам.

## 13. Классы jobs

- `SYNC`
- `NOTIFICATION`
- `BILLING_REMINDER`
- `FILE_CLEANUP`
- `ANALYTICS_REBUILD`
- `AUDIT_MAINTENANCE`

## 14. Очереди и приоритеты

### Рекомендуемое разделение очередей
- `critical`
- `default`
- `bulk`

### Что идет в `critical`
- billing reminders
- critical sync alerts
- verification/reset emails

## 15. Graceful shutdown и recovery

- worker должен завершать активную job корректно или возвращать ее в очередь со статусом recovery-needed
- stuck jobs должны обнаруживаться heartbeat-механизмом
- после рестарта orphaned `in_progress` jobs переводятся в `retrying` или `failed`, по policy

## 16. Тестовая матрица

- Success path queued->success.
- Retry после временной ошибки.
- Final failed после исчерпания attempts.
- Scheduled job run.
- Restart worker во время `in_progress` job.
- Большой backlog очереди.

## 17. Фазы внедрения

1. Queue infra и job persistence.
2. Generic worker runtime.
3. Retry/backoff/failure handling.
4. Scheduled jobs registry.
5. Monitoring + support/admin visibility.

## 18. Нефункциональные требования и SLA

- Worker runtime не должен терять job при рестарте, redeploy или временной недоступности внешних систем.
- Queue latency для critical jobs должна иметь отдельный SLA; целевой `p95 < 60 сек` на старте выполнения.
- Retry policy должна быть параметризуемой по классу job.
- Dead-letter и retry tracing обязательны для money/stock/access affecting tasks.

## 19. Observability, логи и алерты

- Метрики: `jobs_queued`, `jobs_running`, `jobs_failed_final`, `retry_scheduled`, `dead_letter_count`, `queue_lag_p95`.
- Логи: job lifecycle с `job_id`, `type`, `attempt`, `tenant_id`, `correlation_id`, `error class`.
- Алерты: backlog growth, final-failed spike, missing scheduled run, lost lease/recovery anomalies.
- Dashboards: queue performance, retry efficiency, dead-letter board, scheduler adherence.

## 20. Риски реализации и архитектурные замечания

- Нельзя скрывать доменную идемпотентность за общей очередью: job могут быть повторно доставлены всегда.
- Lease/lock model должна быть формализована до имплементации recovery.
- Общая очередь без приоритетов быстро приведет к starvation критичных задач.
- Слишком “умный” worker без стандарта job contracts превратится в неуправляемый runtime.
