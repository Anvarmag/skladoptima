# TASK_WORKER_1 — Queue Infra, Job Persistence и Core Data Model

> Модуль: `18-worker`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
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

- Не выполнено.
