# TASK_TASKS_3 — REST API, Inbox-фильтры и role gating

> Модуль: `21-tasks`
> Статус: [x] Завершён

---

- [x] Выполнено
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

**Что сделано** _(2026-04-29)_

**Создан `ListTasksQueryDto`** ([dto/list-tasks.query.ts](apps/api/src/modules/tasks/dto/list-tasks.query.ts)):
- Фильтры: `assignee` (me | UUID), `createdBy` (me | UUID), `status` (comma-separated: OPEN,IN_PROGRESS,WAITING), `category`, `priority`, `overdue=true`, `relatedOrderId`, `search` (по title).
- Параметр `view` (inbox | kanban) управляет сортировкой.
- Пагинация: `page`, `limit` (max 100).
- Все enum-параметры нормализуются через `@Transform` (`.toUpperCase()`).
- `status` парсится из comma-separated строки в массив `TaskStatus[]` с валидацией `@IsEnum({ each: true })`.
- `overdue` приводится к boolean через `@Transform`.

**Добавлены методы в `TasksService`** ([tasks.service.ts](apps/api/src/modules/tasks/tasks.service.ts)):
- `findAll(tenantId, actorUserId, query)` — Inbox/Kanban list с пагинацией. `assignee=me` / `createdBy=me` разворачиваются в `actorUserId`. `overdue=true` и `status[]` комбинируются через Prisma `AND`, чтобы избежать конфликта условий на одном поле. Сортировка Inbox: `dueAt ASC NULLS LAST, createdAt DESC` (Prisma 5 `{ sort, nulls }`). Сортировка Kanban: `updatedAt DESC`.
- `findOne(tenantId, taskId)` — деталь задачи + комментарии (без soft-deleted) + events timeline. Даты сериализуются в ISO string.
- Приватный `mapTask()` — выходное DTO плоское, все `Date` → ISO string, нет Prisma-инстансов.

**Создан `TasksController`** ([tasks.controller.ts](apps/api/src/modules/tasks/tasks.controller.ts)):
- `@UseGuards(RequireActiveTenantGuard)` на уровне класса — все 9 методов требуют `activeTenantId`.
- `@UseGuards(TenantWriteGuard)` на всех write-операциях (POST/PATCH/DELETE).
- Endpoints: `GET /tasks`, `GET /tasks/:taskId`, `POST /tasks`, `PATCH /tasks/:taskId`, `POST /tasks/:taskId/assign`, `POST /tasks/:taskId/status`, `POST /tasks/:taskId/comments`, `DELETE /tasks/:taskId/comments/:commentId`, `POST /tasks/:taskId/archive`.
- Role gating archive (OWNER/ADMIN или автор) — в сервисе `assertCanArchive`.
- `POST ..../assign`, `POST .../status`, `POST .../archive` возвращают `200 OK` (`@HttpCode(HttpStatus.OK)`).
- `DELETE .../comments/:commentId` возвращает `204 No Content`.

**Обновлён `TasksModule`** — добавлен `TasksController` в `controllers`.

**TypeScript**: `tsc --noEmit` по всем файлам tasks-модуля — ошибок нет.
