# WORKER — Task Pack

> Модуль: `18-worker`
> Статус: [x] Подготовлено
> Основание: `DOCS/SYSTEM-ANALYTICS/18-worker/system-analytics.md`

---

## Состав

- `TASK_WORKER_1.md` — Queue infra, job persistence и core data model
- `TASK_WORKER_2.md` — Generic worker runtime, leases и graceful recovery
- `TASK_WORKER_3.md` — Retry/backoff, dead-letter и blocked-by-policy semantics
- `TASK_WORKER_4.md` — Scheduler registry, periodic jobs и operational contracts
- `TASK_WORKER_5.md` — Job classes, priorities, idempotency и replay policy
- `TASK_WORKER_6.md` — Support/admin console и product-specific status surfaces
- `TASK_WORKER_7.md` — QA, regression и observability worker

## Правила

- Каждый файл описывает отдельный инженерный блок.
- Чекбокс задачи закрывается только после заполнения блока `Что сделано`.
- Если задача переносится или дробится, это фиксируется внутри соответствующего файла.
- Порядок выполнения предполагается сверху вниз, если в файле не указано иное.
