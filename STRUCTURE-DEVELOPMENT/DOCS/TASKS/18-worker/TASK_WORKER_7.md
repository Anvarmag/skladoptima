# TASK_WORKER_7 — QA, Regression и Observability Worker

> Модуль: `18-worker`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
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

- Не выполнено.
