# TASK_TASKS_2 — CRUD сервис, переходы статусов и комментарии

> Модуль: `21-tasks`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_TASKS_1`
- Что нужно сделать:
  - реализовать `TasksService` с операциями: `create / update / assign / changeStatus / addComment / archive`;
  - валидировать assignee по active membership (`TASK_ASSIGN_TO_NON_MEMBER`);
  - реализовать state machine guard §13 через сервис (`TASK_INVALID_STATE_TRANSITION` для перехода из ARCHIVED);
  - писать `TaskEvent` (CREATED / UPDATED / ASSIGNED / STATUS_CHANGED / COMMENTED / DUE_CHANGED / ARCHIVED) в той же транзакции, что и изменение `Task`;
  - при `status=DONE` заполнять `completedAt`, при `dueAt` change — обнулять `dueReminderSentAt` и `overdueNotifiedAt` (новый дедлайн = новое окно напоминаний);
  - комментарии: `addComment` создаёт `TaskComment` + `TaskEvent(COMMENTED)`; soft-delete только своих комментариев.
- Критерий закрытия:
  - все mutations атомарны (Task + TaskEvent в одной транзакции);
  - state machine не позволяет покинуть ARCHIVED;
  - reopen DONE → OPEN разрешён, completedAt сбрасывается в null;
  - сервис не зависит от REST/notify слоёв (чистая бизнес-логика, легко тестировать).

**Что сделано**

- Не выполнено.
