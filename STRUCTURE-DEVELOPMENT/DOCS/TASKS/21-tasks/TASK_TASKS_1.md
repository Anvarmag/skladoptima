# TASK_TASKS_1 — Data Model, State Machine и Event Provenance

> Модуль: `21-tasks`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
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

- Не выполнено.
