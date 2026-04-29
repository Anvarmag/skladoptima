# TASK_TASKS_1 — Data Model, State Machine и Event Provenance

> Модуль: `21-tasks`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - утверждена системная аналитика `21-tasks`
  - согласованы `01-auth`, `03-team`, `10-orders`, `05-catalog`
- Что нужно сделать:
  - завести таблицы `Task`, `TaskComment`, `TaskEvent` + 5 enum'ов из §8;
  - закрепить FK на `User` (assignee, createdBy, comment author), optional FK на `Order` (`relatedOrderId`) и `Product` (`relatedProductId`) с политикой SET NULL;
  - предусмотреть partial-индекс по `(tenantId, dueAt) WHERE status NOT IN (done, archived)` для cron-фильтра §15;
  - добавить indexed-партишены под Inbox-фильтры (`assignee+status+dueAt`, `createdBy+createdAt`, `relatedOrderId`);
  - не трогать существующие модули — только новая миграция.
- Критерий закрытия:
  - модель данных полностью покрывает Inbox/Kanban сценарии, связку с Order/Product и cron due-reminders;
  - state machine §13 защищена от silent-overwrite через application-guard (БД хранит enum, сервис проверяет переход);
  - prisma validate проходит, миграция применяется без удаления существующих данных.

**Что сделано**

Реализована полная модель данных модуля задач (`21-tasks`) согласно системной аналитике §8, §13, §15.

### Изменения в `apps/api/prisma/schema.prisma`

**5 новых enum'ов:**
- `TaskCategory` — категории задач: MARKETPLACE_CLIENT_ISSUE, PRODUCTION_INQUIRY, WAREHOUSE, FINANCE, OTHER
- `TaskPriority` — приоритет: LOW, NORMAL, HIGH, URGENT
- `TaskStatus` — статусы state machine §13: OPEN, IN_PROGRESS, WAITING, DONE, ARCHIVED
- `TaskCommentVisibility` — видимость комментария: INTERNAL, CUSTOMER_FACING
- `TaskEventType` — типы событий audit timeline: CREATED, UPDATED, ASSIGNED, STATUS_CHANGED, COMMENTED, DUE_CHANGED, ARCHIVED, DUE_REMINDER_SENT, OVERDUE_NOTIFIED

**3 новых модели:**

1. **`Task`** (`@@map("tasks")`) — основная сущность:
   - `assigneeUserId NOT NULL` + FK → User (RESTRICT) — задача без ответственного не создаётся
   - `createdByUserId NOT NULL` + FK → User (RESTRICT)
   - `relatedOrderId NULL` + FK → Order (SET NULL) — задача живёт независимо от заказа
   - `relatedProductId NULL` + FK → Product (SET NULL)
   - `dueReminderSentAt` и `overdueNotifiedAt` — анти-спам флаги для cron (атомарная UPDATE ... WHERE IS NULL)
   - `tags TEXT[]`, `completedAt`, `archivedAt` для аналитики и Inbox-фильтров
   - 5 индексов включая partial-index `(tenantId, dueAt) WHERE status NOT IN ('DONE','ARCHIVED')` для cron §15

2. **`TaskComment`** (`@@map("task_comments")`) — мягкое удаление через `deletedAt`, `editedAt` для UI «изменено»

3. **`TaskEvent`** (`@@map("task_events")`) — append-only timeline, `actorUserId NULL` для системных событий (cron)

**Обратные связи добавлены в:**
- `User` — `assignedTasks`, `createdTasks`, `taskComments`, `taskEvents`
- `Order` — `relatedTasks`
- `Product` — `relatedTasks`
- `Tenant` — `tasks`, `taskEvents`

### Новая миграция

`apps/api/prisma/migrations/20260429020000_add_tasks_module/migration.sql` — аддитивная миграция:
- создаёт 5 enum'ов, 3 таблицы, все FK и индексы
- partial index `idx_task_due_active` заменяет стандартный Prisma-индекс через raw SQL `WHERE status NOT IN ('DONE','ARCHIVED')`
- не затрагивает существующие таблицы (только новые)

### Верификация

- `prisma validate` проходит без ошибок
- Миграция аддитивная, не удаляет и не изменяет существующие данные
- State machine §13 защищена на уровне приложения (application-guard); БД хранит enum, сервис проверяет допустимость перехода
