# Worker / Background Jobs — Аналитика

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

---

## 1. Цель аналитики раздела

Измерять надежность фонового слоя: обработка очередей, scheduled jobs, retry/backoff и recoverability после сбоев. Данные раздела нужны для SLA по sync/notifications/billing jobs и для контроля устойчивости платформы.

---

## 2. Ключевые метрики (KPI)

| Метрика | Описание | Цель | Как считается |
|---------|---------|------|--------------|
| Job Success Rate | Доля успешно завершенных jobs | >= 97% | `jobs_success / jobs_total` |
| Retry Recovery Rate | Доля jobs, успешно завершенных после retry | >= 70% | `jobs_success_after_retry / jobs_retried` |
| Failed Jobs Share | Jobs в final failed state | <= 1.5% | `jobs_failed_final / jobs_total` |
| Queue Latency | Время ожидания job в очереди | <= 30 сек p95 | `p95(job_started_at - job_queued_at)` |
| Processing Time SLA | Время выполнения job | <= 120 сек p95 | `p95(job_finished_at - job_started_at)` |
| Schedule Adherence | Точность запуска scheduled jobs | >= 98% | `on_time_scheduled_runs / scheduled_runs_total` |

---

## 3. Воронки и конверсии

```
Job queued -> In progress -> Success
100%       -> 99%         -> 97%
```

Путь ошибки:

```
Job failed (temporary) -> Retrying -> Success after retry / Final failed
100%                  -> 100%     -> 70% / 30%
```

---

## 4. Сегментация пользователей

| Сегмент | Поведение | Потребность |
|---------|----------|------------|
| Primary Owner/Admin | Смотрит бизнес-статус критичных задач | Понятные статусы sync/notifications |
| Manager | Видит ограниченный operational статус | Только actionable сигналы |
| SUPPORT_ADMIN | Диагностирует failed jobs | Расширенный контекст ошибок и retries |
| Platform/DevOps | Контролирует инфраструктуру | Глубокий monitoring очередей и lag |

---

## 5. События для трекинга (Event Tracking)

| Событие | Триггер | Параметры | Приоритет |
|---------|---------|----------|----------|
| `worker_job_queued` | Job поставлена в очередь | `job_type`, `priority`, `tenant_id` | High |
| `worker_job_started` | Старт выполнения job | `job_type`, `attempt` | High |
| `worker_job_succeeded` | Успешное завершение | `job_type`, `duration_sec`, `attempt` | High |
| `worker_job_failed` | Ошибка выполнения | `job_type`, `error_code`, `attempt` | High |
| `worker_job_retry_scheduled` | Назначен retry | `job_type`, `next_retry_in_sec`, `attempt` | High |
| `worker_job_failed_final` | Final failed после всех retries | `job_type`, `attempts_total` | High |
| `worker_scheduled_job_triggered` | Запуск по расписанию | `schedule_name`, `drift_sec` | Med |
| `worker_queue_lag_alert` | Превышен лаг очереди | `queue_name`, `lag_sec` | High |
| `worker_recovery_after_restart` | Восстановление jobs после рестарта | `recovered_jobs_count` | Med |

---

## 6. Текущее состояние (baseline)

- По BRD worker как отдельный модуль отсутствует, поэтому baseline запускается с нуля.
- При запуске нужно сразу фиксировать baseline по queue latency и final failed jobs.
- Раздельный baseline обязателен по классам задач: sync, notifications, billing, cleanup.

---

## 7. Гипотезы и A/B тесты

| Гипотеза | Метрика изменения | Статус |
|---------|-----------------|--------|
| Разделение очередей по типу job снизит p95 latency | `Queue Latency`, `Processing Time SLA` | Идея |
| Экспоненциальный backoff снизит долю final failed для внешних API ошибок | `Failed Jobs Share` | Идея |
| Отдельная high-priority очередь для critical alerts повысит SLA доставки | `critical_notification_latency` | Идея |

---

## 8. Дашборды и отчёты

- [ ] Worker Health: queued/in-progress/success/failed.
- [ ] Retry Analytics: attempts, recovery, final failures.
- [ ] Scheduled Jobs SLA: запуск по расписанию и drift.
- [ ] Queue Performance: лаг, throughput, backlog по очередям.

---

## 9. Риски и аномалии

| Аномалия | Порог | Действие |
|---------|-------|---------|
| Рост final failed jobs | `> 3%` | Проверить retry policy и внешние зависимости |
| Большой лаг очереди | `p95 > 120 сек` | Масштабировать worker и разделить нагрузку |
| Scheduled jobs пропуски | `> 2%` | Проверить cron-триггеры и блокировки |
| Потеря job после рестарта | Любой случай | Критичный дефект устойчивости |

---

## 11. Источники данных и правила расчета

- Источники: queue tables/broker metrics, worker execution logs, retry schedules, dead-letter events, scheduler runs.
- Success/fail аналитика считается на уровне `job execution`, а отдельные отчеты должны агрегировать на уровне `business task`.
- Retry recovery rate включает только jobs, дошедшие до retry, и не должен смешиваться с job, завершившимися на первой попытке.
- Queue latency и processing time нужно считать по типам очередей и приоритетам, иначе среднее скрывает деградацию critical flows.

---

## 12. Data Quality и QA-проверки

- QA должна проверить обычный success, временную ошибку с retry, permanent failure, dead-letter, graceful shutdown, recovery after restart.
- Каждый execution record обязан содержать `job_id`, `job_type`, `attempt`, `queue`, `tenant scope`, `started_at`, `finished_at`, `result`.
- Одна и та же job не должна одновременно находиться в `in_progress` в двух worker без явной стратегии lock/lease.
- Scheduled jobs должны иметь trace до конкретного trigger-run и результата выполнения.

---

## 13. Владельцы метрик и ритм ревью

- Platform/backend lead: очередь, retries, устойчивость исполнения.
- Product owner: SLA фоновых задач, влияющих на пользовательский опыт.
- QA: регрессия по recoverability, dead-letter и нагрузочным сценариям.
- Review cadence: ежедневный мониторинг critical queues, еженедельный обзор retry efficiency и scheduler adherence.

---

## 14. Зависимости, допущения и границы

- Worker слой отвечает за асинхронное выполнение, но бизнес-модули должны сохранять собственную идемпотентность и не перекладывать все гарантии на очередь.
- Для внешних интеграций нужна классификация ошибок на retryable/non-retryable, иначе метрики качества не несут смысла.
- Dead-letter очередь обязательна для разборов и повторных запусков, если job влияет на деньги, остатки, уведомления или доступ.
- Мониторинг worker не должен ограничиваться инфраструктурой; он обязан быть связан с бизнес-эффектом задач.

---

## 15. История изменений

| Дата | Изменение | Автор |
|------|----------|-------|
| 2026-04-15 | Полностью заполнена аналитика раздела по BRD | Codex |
