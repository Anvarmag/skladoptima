# TASK_WORKER_4 — Scheduler Registry, Periodic Jobs и Operational Contracts

> Модуль: `18-worker`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
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

### Gap-анализ перед реализацией

TASK_WORKER_1 уже создал: `WorkerSchedule` модель в Prisma, `listSchedules()`, `runSchedule()` (ручной запуск), `GET /worker/schedules`, `POST /worker/schedules/:name/run`. Но **автоматического cron-driven планировщика** не было — никакой код не читал `worker_schedules` из БД и не запускал jobs по `cronExpr`.

### `WorkerSchedulerService` (`worker-scheduler.service.ts`) — новый файл

Создан DB-driven планировщик, который запускается только в worker-режиме (`IS_WORKER=true`):

**Seed documented schedules** (`seedSchedules()`)
На старте upsert'ит четыре задокументированных расписания (§13, §15 system-analytics), если их ещё нет в БД. Поле `update: {}` — существующие записи, возможно изменённые support'ом вручную, не перезаписываются:
- `billing-reminders-daily` — `0 9 * * *` (Critical queue, daily 09:00 UTC)
- `analytics-rebuild-daily` — `0 3 * * *` (Default queue, daily 03:00 UTC)
- `file-cleanup-daily` — `0 2 * * *` (Bulk queue, daily 02:00 UTC)
- `audit-maintenance-weekly` — `0 1 * * 0` (Bulk queue, Sundays 01:00 UTC)

**Polling loop**
`setInterval` с интервалом 60 секунд — вызывает `tickSchedules()`. На старте запускается немедленно (без ожидания первого тика), чтобы выполнить просроченные расписания после рестарта.

**`tickSchedules()`**
Ищет все активные (`isActive=true`) записи, где `nextRunAt <= now` или `nextRunAt IS NULL` (никогда не запускались). Для каждой вызывает `processSchedule()`.

**`processSchedule()`**
- Детектирует missed-run anomaly: если `nextRunAt` просрочен более чем на 5 минут — значит worker был down в ожидаемое время. Логирует `schedule_missed_run_anomaly` с `expectedAt` и `overdueMs`.
- Вычисляет следующий `nextRunAt` через `calcNextRunAt(cronExpr)` (использует `CronJob` из пакета `cron`, транзитивная зависимость `@nestjs/schedule`).
- Атомарно в `$transaction`: создаёт `WorkerJob` с `createdByActorType='scheduler'` + обновляет `lastRunAt`/`nextRunAt` в `WorkerSchedule`. Если транзакция упала — `lastRunAt` не обновляется, расписание повторится на следующем тике.
- Логирует `schedule_run_fired` с `jobId` и `nextRunAt`.

**Missed-run anomaly logging**
Все структурированные JSON-логи: `scheduler_start`, `scheduler_seeds_applied`, `scheduler_tick_complete`, `schedule_run_fired`, `schedule_missed_run_anomaly`, `schedule_fire_error`, `schedule_cron_parse_error`.

### `WorkerModule` — добавлен `WorkerSchedulerService`

`WorkerSchedulerService` добавлен в `providers` и `exports`.

### `WorkerService.getSchedule(name)` + `GET /worker/schedules/:name`

Новый метод для получения деталей одного расписания (support-диагностика: `lastRunAt`, `nextRunAt`, `isActive`, `cronExpr`). Эндпоинт `GET /worker/schedules/:name` добавлен в `WorkerController`.

### Критерии закрытия

- [x] Periodic jobs централизованы: только `worker_schedules` таблица управляет расписаниями
- [x] Ручной запуск ограничен support/admin (x-internal-secret)
- [x] Автоматический запуск использует `createdByActorType='scheduler'`, ручной — `'support'`
- [x] Missed-run аномалии логируются отдельно — scheduler не скрывает пропущенные запуски
- [x] Scheduler не скрывает бизнес-ошибки под технические артефакты — cron-parse errors логируются и пропускают расписание без crash'а
