# TASK_WORKER_6 — Support/Admin Console и Product-Specific Status Surfaces

> Модуль: `18-worker`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P1`
- Оценка: `9h`
- Зависимости:
  - `TASK_WORKER_3`
  - `TASK_WORKER_4`
  - `TASK_WORKER_5`
- Что нужно сделать:
  - реализовать `GET /api/v1/worker/jobs`, `GET /api/v1/worker/jobs/:jobId`, `POST /api/v1/worker/jobs/:jobId/retry`;
  - оставить полную worker console только support/admin контуру;
  - для tenant-facing UX поддержать только product-specific status surfaces (`sync running`, `cleanup pending`, `notification failed`);
  - не строить общий tenant-facing job center в MVP;
  - показать достаточную diagnostics depth для support without exposing raw internals to end users.
- Критерий закрытия:
  - support/admin получают operational visibility по jobs и queues;
  - tenant-facing UI остается продуктовым, а не техническим;
  - visibility model соответствует утвержденной MVP границе.

**Что сделано**

- Не выполнено.
