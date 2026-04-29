# TASK_WORKER_6 — Support/Admin Console и Product-Specific Status Surfaces

> Модуль: `18-worker`
> Статус: [x] Завершён

---

- [x] Выполнено
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

### Support/Admin Console (уже была реализована в TASK_WORKER_1..5)

Полная worker console доступна только через `x-internal-secret` header (не через JWT). Эндпоинты в `WorkerController` (`@Public()` + secret check):

- `GET /worker/jobs` — листинг jobs с фильтрами по status/jobType/tenantId, пагинация
- `GET /worker/jobs/:jobId` — детальный просмотр job + history из `worker_failed_jobs`
- `POST /worker/jobs/:jobId/retry` — ручной retry failed/dead_lettered/blocked job (contract-aware)
- `POST /worker/jobs/:jobId/cancel` — отмена queued/retrying/blocked job
- `GET /worker/queues/health` — сводка по очередям (count per status per queue + stuck jobs)
- `GET /worker/schedules` / `GET /worker/schedules/:name` — диагностика расписаний
- `POST /worker/schedules/:name/run` — ручной запуск scheduled task

### Tenant-Facing Product Status Surface (реализовано в этой задаче)

Добавлены:

1. **`worker-status.controller.ts`** — отдельный контроллер без `@Public()`, JWT-authenticated. Эндпоинт `GET /worker/status` требует валидного JWT + `activeTenantId` в токене. Возвращает `{ items: [...] }`.

2. **`WorkerService.getProductStatus(tenantId)`** — метод, который:
   - Запрашивает только **tenant-visible** типы задач: `SYNC`, `NOTIFICATION`, `FILE_CLEANUP` (AUDIT_MAINTENANCE и BILLING_REMINDER скрыты)
   - Включает активные задачи (`queued`, `in_progress`, `retrying`, `blocked`) + завершённые за последние 24 часа
   - **Не возвращает** raw internals: `payload`, `lastError`, `leaseOwner`, `leaseUntil`, `attempt`, `maxAttempts`, `createdByActorType`, `idempotencyKey`
   - Возвращает только: `jobId`, `jobType`, `productStatus` (user-friendly label), `correlationId`, `since`, `finishedAt`

3. **Product status mapping** (`toProductStatus`) — функция преобразует технический `(jobType, status)` в продуктовый label:
   - `SYNC`: `sync_pending`, `sync_running`, `sync_failed`, `sync_blocked`, `sync_ok`, `sync_cancelled`
   - `NOTIFICATION`: `notification_pending`, `notification_sending`, `notification_failed`, `notification_blocked`, `notification_delivered`, `notification_cancelled`
   - `FILE_CLEANUP`: `cleanup_pending`, `cleanup_running`, `cleanup_failed`, `cleanup_blocked`, `cleanup_ok`, `cleanup_cancelled`

4. **`WorkerModule`** — зарегистрирован `WorkerStatusController` рядом с `WorkerController`.

### Разделение auth-моделей

| Контур | Контроллер | Auth | Что доступно |
|--------|-----------|------|--------------|
| Support/Admin | `WorkerController` | `x-internal-secret` | Все jobs, все типы, payload, ошибки, retry/cancel/schedule |
| Tenant-facing | `WorkerStatusController` | JWT + activeTenantId | Только SYNC/NOTIFICATION/FILE_CLEANUP, только product labels |

### Файлы изменены / созданы

- `apps/api/src/modules/worker/worker.service.ts` — добавлены `TENANT_VISIBLE_JOB_TYPES`, `STATUS_WINDOW_HOURS`, `ACTIVE_JOB_STATUSES`, `toProductStatus()`, `getProductStatus()`
- `apps/api/src/modules/worker/worker-status.controller.ts` — новый файл, JWT-auth tenant endpoint
- `apps/api/src/modules/worker/worker.module.ts` — зарегистрирован `WorkerStatusController`
