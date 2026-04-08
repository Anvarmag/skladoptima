# TASK_WORKER_5 — Job Classes, Priorities, Idempotency и Replay Policy

> Модуль: `18-worker`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_WORKER_1`
  - `TASK_WORKER_3`
  - `TASK_WORKER_4`
  - согласованы `09-sync`, `13-billing`, `17-files-s3`
- Что нужно сделать:
  - закрепить job classes `SYNC`, `NOTIFICATION`, `BILLING_REMINDER`, `FILE_CLEANUP`, `ANALYTICS_REBUILD`, `AUDIT_MAINTENANCE`;
  - описать special handling classes `MONEY_AFFECTING`, `STOCK_AFFECTING`, `ACCESS_AFFECTING`;
  - требовать `idempotency_key` для idempotent jobs;
  - разрешить manual replay только для `failed / dead_lettered` retryable jobs;
  - ограничить manual replay support/admin контуром и запретить replay для success/non-retryable high-risk jobs без явной contract policy.
- Критерий закрытия:
  - job contracts и ownership стандартизированы;
  - critical jobs имеют idempotency trace и safe replay boundaries;
  - replay policy не создает скрытых money/stock/access рисков.

**Что сделано**

- Не выполнено.
