# TASK_TASKS_4 — MAX/Telegram нотификации и due-reminders

> Модуль: `21-tasks`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_TASKS_2`
  - согласован `15-notifications` (точка отправки push'ей)
  - проверена работоспособность существующего `MaxNotifierModule`
- Что нужно сделать:
  - подписаться на TaskEvent (in-process EventEmitter или прямой вызов из `TasksService`) и слать push на:
    - `ASSIGNED` (если новый assignee != actor);
    - `COMMENTED` (если comment.author != assignee), с дебаунсом 30 сек на пару `(taskId, recipientUserId)`;
    - `STATUS_CHANGED` — только если actor != assignee и не изменено самим assignee'ем;
  - формат push'а: короткое сообщение + deep-link `https://app/tasks/<id>`;
  - cron `taskDueReminderJob` каждые 10 минут:
    - `dueReminderSent`: `dueAt BETWEEN now AND now+1h AND dueReminderSentAt IS NULL AND status NOT IN (done, archived)` → push + атомарный `UPDATE ... SET dueReminderSentAt=now() WHERE dueReminderSentAt IS NULL`;
    - `overdueNotified`: `dueAt < now AND overdueNotifiedAt IS NULL AND status NOT IN (done, archived)` → push + такой же атомарный гард;
  - **paused tenant**: cron skip, structured log `cron_skipped_paused`, write-API уже отбит guard'ом на уровне TASK_TASKS_3;
  - notify failure: never block API; только counter `task_notification_send_failures` и structured log;
  - per-user preference на opt-out отдельных eventType (заложить колонку `UserPreference.taskNotifyPreferences JSONB`, без UI на MVP).
- Критерий закрытия:
  - один дедлайн = один due-reminder (атомарный UPDATE гарантирует);
  - серия из 5 комментариев за 30 сек → один групповой пуш;
  - paused tenant не получает spam'а от бота;
  - notify ошибка не валит сценарий create/update.

**Что сделано**

- Не выполнено.
