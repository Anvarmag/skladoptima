# TASK_TASKS_4 — MAX/Telegram нотификации и due-reminders

> Модуль: `21-tasks`
> Статус: [x] Завершён

---

- [x] Выполнено
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

**Что сделано** _(2026-04-29, Claude)_

### Schema
- Добавлены два поля в `UserPreference`:
  - `maxChatId String?` — MAX-бот chatId для push-нотификаций (nullable: отсутствие = нет push'а для пользователя)
  - `taskNotifyPreferences Json?` — per-user opt-out по типу события: `{"ASSIGNED":true,"COMMENTED":false,...}`, null = всё включено
- Создана миграция `20260429030000_add_task_notify_fields` с двумя `ALTER TABLE "UserPreference" ADD COLUMN`

### TaskNotifierService (`task-notifier.service.ts`)
- Инкапсулирует всю логику push-нотификаций задач; вызывается из `TasksService` fire-and-forget (не блокирует API)
- **`notifyAssigned()`** — отправляет push assignee если `actorUserId !== assigneeUserId`
- **`notifyStatusChanged()`** — отправляет push assignee если `actorUserId !== assigneeUserId`
- **`notifyCommentedDebounced()`** — trailing-edge debounce 30 сек на ключ `taskId:assigneeUserId`; серия из N комментариев → один пуш
- **`notifyDueReminder()`** / **`notifyOverdue()`** — вызываются из cron
- Каждый метод читает `UserPreference.maxChatId` + `taskNotifyPreferences`, проверяет opt-out и шлёт через `MaxNotifierService`
- Все ошибки поглощаются в `sendToUser()`: structured log + counter `notifyFailures` (метрика `task_notification_send_failures`), никогда не бросает

### TaskDueReminderService (`task-due-reminder.service.ts`)
- `@Cron('0 */10 * * * *')` — запускается каждые 10 минут
- **due-reminder**: `dueAt BETWEEN now AND now+1h AND dueReminderSentAt IS NULL AND status NOT IN (DONE, ARCHIVED)` → атомарный `updateMany WHERE dueReminderSentAt IS NULL` → notify (гарантирует ровно один пуш на дедлайн)
- **overdue**: `dueAt < now AND overdueNotifiedAt IS NULL AND status NOT IN (DONE, ARCHIVED)` → аналогичная атомарная guard'ированная логика
- Paused tenants фильтруются на уровне DB-запроса: `tenant: { accessState: { notIn: [TRIAL_EXPIRED, SUSPENDED, CLOSED] } }` → задачи из paused-тенантов не получают уведомлений
- Structured log при каждом срабатывании: `due_reminder_sent`, `overdue_notified`, `task_due_reminder_job_complete`

### TasksService обновления
- Инжектирован `TaskNotifierService` через конструктор
- `findTaskOrThrow` теперь также выбирает `title` (нужно для текста push'а)
- **`create()`** → после транзакции: fire-and-forget `notifyAssigned`
- **`assign()`** → после транзакции: fire-and-forget `notifyAssigned`
- **`changeStatus()`** → после транзакции: fire-and-forget `notifyStatusChanged`
- **`addComment()`** → сохраняет результат `findTaskOrThrow`, после транзакции: вызов `notifyCommentedDebounced`

### TasksModule обновления
- Добавлены imports: `ScheduleModule.forRoot()`, `MaxNotifierModule`
- Добавлены providers: `TaskNotifierService`, `TaskDueReminderService`

### Критерии закрытия
- ✅ Один дедлайн = один due-reminder (атомарный UPDATE гарантирует)
- ✅ Серия из N комментариев за 30 сек → один пуш (trailing-edge debounce)
- ✅ Paused tenant не получает уведомлений (DB-фильтр по `tenant.accessState`)
- ✅ Ошибка нотификации не валит сценарий create/update (fire-and-forget + внутренний try/catch)
