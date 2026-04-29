# TASK_TASKS_6 — QA, Regression и Observability

> Модуль: `21-tasks`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_TASKS_2`
  - `TASK_TASKS_3`
  - `TASK_TASKS_4`
  - `TASK_TASKS_5`
- Что нужно сделать:
  - покрыть jest unit-тестами §16 матрицу:
    - create / assign к non-member → 403;
    - state transitions включая reopen DONE → OPEN;
    - попытка покинуть ARCHIVED → 409 TASK_INVALID_STATE_TRANSITION;
    - комментарий в чужой задаче → push assignee;
    - debounce: 5 комментариев за 30 сек → 1 push (мок таймера);
    - cron due-reminder: повторный запуск → второй пуш не отправляется (проверка `dueReminderSentAt` атомарного UPDATE);
    - overdue notify ровно один раз;
    - paused tenant блокирует write + cron skipped с structured log;
    - Inbox-фильтры (`assignee=me`, `overdue=true`, `relatedOrderId`) корректно собирают Prisma where;
  - заложить `TasksMetricsRegistry` (по образцу `OrdersMetricsRegistry`) с метриками §19:
    - `tasks_created`, `tasks_completed`, `tasks_overdue_active` (gauge), `task_avg_time_to_complete_ms` (histogram), `task_notifications_sent`, `task_notification_send_failures`;
  - инструментировать сервис: каждый mutation + cron + notify → counter/observation;
  - structured-логи на cron decisions (skipped / sent / debounced).
- Критерий закрытия:
  - jest --testPathPatterns="modules/tasks" → все passed;
  - tsc --noEmit без новых ошибок;
  - метрики покрывают весь §19 список.

**Что сделано**

Реализовано покрытие QA + observability для модуля `21-tasks` в соответствии с §16 / §19 system-analytics. Конкретно:

- **`TasksMetricsRegistry`** ([apps/api/src/modules/tasks/tasks.metrics.ts](apps/api/src/modules/tasks/tasks.metrics.ts)) — process-local in-memory counters + structured-логи по образцу `OrdersMetricsRegistry`. Поддерживает counters, gauges (для `tasks_overdue_active`) и скользящее окно completion-time (200 наблюдений) с p50/p95 в `snapshot()`.
  - Имена метрик в `TasksMetricNames`: `tasks_created`, `tasks_completed`, `tasks_overdue_active` (gauge), `task_avg_time_to_complete_ms` (histogram), `task_notifications_sent`, `task_notification_send_failures`, `task_due_reminder_sent`, `task_overdue_notified`, `task_cron_skipped_paused_tenant`, `task_comment_debounce_collapsed`.
  - Зарегистрирован в [tasks.module.ts](apps/api/src/modules/tasks/tasks.module.ts) и экспортируется из модуля.

- **Инструментирование сервиса**:
  - [tasks.service.ts](apps/api/src/modules/tasks/tasks.service.ts) — `create()` инкрементит `tasks_created` (labels: tenantId/category/priority); `changeStatus(DONE)` инкрементит `tasks_completed` и записывает `time-to-complete = completedAt - createdAt` в histogram'е.
  - [task-notifier.service.ts](apps/api/src/modules/tasks/task-notifier.service.ts) — каждый успешный пуш → `task_notifications_sent` (channel=max + notificationType); каждое исключение `MaxNotifierService` → `task_notification_send_failures`. Серия комментариев в одно debounce-окно → `task_comment_debounce_collapsed += (N-1)` при flush'е таймера.
  - [task-due-reminder.service.ts](apps/api/src/modules/tasks/task-due-reminder.service.ts) — counter `task_due_reminder_sent` / `task_overdue_notified` за каждый успешный атомарный UPDATE; counter `task_cron_skipped_paused_tenant += N` если у paused-тенантов есть кандидаты в reminder'ы; gauge `tasks_overdue_active` обновляется в конце каждого run job'а.

- **Structured-логи** на cron decisions: события `task_cron_skipped_paused_tenant`, `due_reminder_sent`, `overdue_notified`, `task_due_reminder_job_complete` пишутся как JSON через `Logger.log` для tail-based metrics в Loki/Datadog.

- **Тестовая матрица §16** — 33 unit-теста, все passed:
  - [tasks.metrics.spec.ts](apps/api/src/modules/tasks/tasks.metrics.spec.ts) (6 тестов): increment/setGauge/observeCompletion/snapshot/окно/reset.
  - [tasks.service.spec.ts](apps/api/src/modules/tasks/tasks.service.spec.ts) (16 тестов): create + assign к non-member → 403; paused tenant (TRIAL_EXPIRED/SUSPENDED/CLOSED) блокирует write; OPEN→DONE заполняет completedAt и инкрементит tasks_completed + time-to-complete; reopen DONE→OPEN сбрасывает completedAt; ARCHIVED→OPEN → 409 TASK_INVALID_STATE_TRANSITION; WAITING→ARCHIVED → 409; комментарий в чужой задаче → notifyCommentedDebounced(assignee); paused tenant блокирует комментарий; Inbox-фильтры (assignee=me, overdue=true, relatedOrderId, view=inbox/kanban) корректно собирают Prisma where + orderBy.
  - [task-notifier.service.spec.ts](apps/api/src/modules/tasks/task-notifier.service.spec.ts) (6 тестов): дебаунс 5 комментариев за 30 сек → ровно 1 push (jest.useFakeTimers) + collapsed counter +4; комментарий от самого assignee не нотифицируется; успешный пуш → counter notifications_sent; исключение sendMessage → counter send_failures; opt-out (taskNotifyPreferences[ASSIGNED] === false) → silent skip; нет maxChatId → silent skip без counter.
  - [task-due-reminder.service.spec.ts](apps/api/src/modules/tasks/task-due-reminder.service.spec.ts) (5 тестов): первый run отправляет reminder и атомарно UPDATE'ит dueReminderSentAt; повторный run при count=0 (race с другим инстансом) → notify НЕ повторяется; overdue notify ровно один раз; paused tenant отфильтрован из findMany (NOT IN PAUSED_STATES) и учитывается в `task_cron_skipped_paused_tenant`; gauge `tasks_overdue_active` обновляется значением count() в конце run.

- **Критерии закрытия**:
  - `npx jest --testPathPatterns="modules/tasks"` → 4 spec'а, **33 passed, 0 failed**.
  - `npx tsc --noEmit` — новых ошибок в `modules/tasks` нет (предсуществующие ошибки в `import.service.ts`, `inventory.service.ts`, `fix-ozon-dates.ts` не относятся к scope этой задачи).
  - Метрики §19 покрыты полностью: `tasks_created`, `tasks_completed`, `tasks_overdue_active` (gauge), `task_avg_time_to_complete_ms` (histogram), `task_notifications_sent` (per channel/type), `task_notification_send_failures`.

- **Замечания по реализации**:
  - В TasksService.changeStatus при transition в DONE добавлен повторный `findUnique({ select: { createdAt, category, priority } })` после транзакции — без него у `findTaskOrThrow` нет `createdAt` в select'е. Альтернатива (расширить select) ухудшила бы общий путь; текущий вариант — единственный лишний запрос и срабатывает только на DONE.
  - Counter `task_comment_debounce_collapsed` инкрементится на flush'е таймера значением `(N-1)`, где N — число комментариев, склеенных в одну серию. Так видно «чистую экономию» пушей, а не общее число событий.
  - Gauge `tasks_overdue_active` пересчитывается count'ом каждый run cron'а (раз в 10 мин). Для MVP этого достаточно; при росте таблицы — переход на materialized view или partial-index aggregate.
