# TASK_TASKS_3 — REST API, Inbox-фильтры и role gating

> Модуль: `21-tasks`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_TASKS_2`
- Что нужно сделать:
  - реализовать `TasksController` с endpoint'ами из §6;
  - Inbox-фильтры в `GET /api/tasks`: `assignee=me|<userId>`, `createdBy=me|<userId>`, `status=open,in_progress,waiting`, `category`, `priority`, `overdue=true` (вычислимый `dueAt < now AND status NOT IN (done, archived)`), `relatedOrderId`, `search` по title;
  - сортировка по `dueAt asc nulls last, createdAt desc` для Inbox; по `updatedAt desc` для Kanban;
  - guards: `RequireActiveTenantGuard` для всех; `TenantWriteGuard` для всех write-ops;
  - role gating: `archive` доступен только OWNER/ADMIN или автору задачи (`TASK_ARCHIVE_NOT_ALLOWED`);
  - DTO с `class-validator`, нормализация enum через `@Transform`;
  - выходные DTO плоские (Date → ISO string).
- Критерий закрытия:
  - Inbox-вьюхи отдают данные за один запрос с пагинацией;
  - все write-операции отбиваются `TenantWriteGuard` при TRIAL_EXPIRED/SUSPENDED/CLOSED;
  - REST-слой не содержит axios/fetch — это чисто доменный модуль.

**Что сделано**

- Не выполнено.
