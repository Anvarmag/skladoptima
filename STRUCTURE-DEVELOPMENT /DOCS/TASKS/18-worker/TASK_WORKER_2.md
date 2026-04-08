# TASK_WORKER_2 — Generic Worker Runtime, Leases и Graceful Recovery

> Модуль: `18-worker`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `11h`
- Зависимости:
  - `TASK_WORKER_1`
- Что нужно сделать:
  - реализовать generic worker consumer/runtime поверх очереди;
  - ввести lease/lock механику для `in_progress` jobs;
  - обеспечить graceful shutdown и возврат/перевод jobs в recovery-needed состояние;
  - после рестарта корректно requeue/retry orphaned `in_progress` jobs;
  - гарантировать, что API не блокируется на тяжелых background operations.
- Критерий закрытия:
  - worker устойчив к рестартам и redeploy;
  - stuck/orphaned jobs обрабатываются по формализованной policy;
  - длительные операции исполняются вне HTTP-контекста без потери lifecycle signals.

**Что сделано**

- Не выполнено.
