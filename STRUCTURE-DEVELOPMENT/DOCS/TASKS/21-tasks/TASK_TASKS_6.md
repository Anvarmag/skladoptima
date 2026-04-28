# TASK_TASKS_6 — QA, Regression и Observability

> Модуль: `21-tasks`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
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

- Не выполнено.
