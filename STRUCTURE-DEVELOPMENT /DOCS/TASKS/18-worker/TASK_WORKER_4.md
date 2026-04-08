# TASK_WORKER_4 — Scheduler Registry, Periodic Jobs и Operational Contracts

> Модуль: `18-worker`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_WORKER_1`
  - `TASK_WORKER_2`
  - согласованы `13-billing`, `15-notifications`, `17-files-s3`
- Что нужно сделать:
  - реализовать `worker_schedules` и cron-driven scheduler registry;
  - поддержать periodic jobs для billing reminders, analytics rebuild, file cleanup и maintenance;
  - реализовать `GET /api/v1/worker/queues/health` и `POST /api/v1/worker/schedules/:name/run`;
  - не допускать неявного cron-management вне documented schedules;
  - журналировать schedule runs и missed run anomalies.
- Критерий закрытия:
  - periodic jobs централизованы и наблюдаемы;
  - ручной запуск schedule ограничен support/admin контуром;
  - scheduler не скрывает бизнес-ошибки под технические артефакты.

**Что сделано**

- Не выполнено.
