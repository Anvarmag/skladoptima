# TASK_TASKS_2 — CRUD сервис, переходы статусов и комментарии

> Модуль: `21-tasks`
> Статус: [x] Завершён

---

- [x] Выполнено
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

Реализован `TasksService` — чистый сервис бизнес-логики модуля задач (`21-tasks`) согласно аналитике §9, §13, §14.

### Созданные файлы

**`apps/api/src/modules/tasks/`**

#### DTOs
- `dto/create-task.dto.ts` — `title` (обязателен, max 255), `assigneeUserId` (UUID, обязателен), опциональные `description`, `category`, `priority`, `relatedOrderId`, `relatedProductId`, `dueAt`, `tags`
- `dto/update-task.dto.ts` — все поля опциональные; `dueAt?: string | null` (null снимает дедлайн через `@ValidateIf`)
- `dto/assign-task.dto.ts` — `assigneeUserId`
- `dto/change-status.dto.ts` — `status: TaskStatus`
- `dto/add-comment.dto.ts` — `body` (max 10 000), `visibility` (default INTERNAL)

#### `tasks.service.ts`
Методы:
- **`create`** — `assertWriteAllowed` + `assertActiveMember(assigneeUserId)` + проверка `relatedOrderId` принадлежности тенанту → `Task` + `TaskEvent(CREATED)` + `TaskEvent(ASSIGNED)` в одной транзакции (`createMany`)
- **`update`** — diff полей; если `dueAt` изменился — `updateData.dueReminderSentAt = null` + `overdueNotifiedAt = null` (новый дедлайн = новое окно напоминаний, §9 step 2) + `TaskEvent(UPDATED)` + `TaskEvent(DUE_CHANGED)` в одной транзакции
- **`assign`** — `assertActiveMember` + `TaskEvent(ASSIGNED, {from, to})` в транзакции
- **`changeStatus`** — State machine guard: `VALID_TRANSITIONS.get(from).has(to)` → 409 при недопустимом переходе; если `DONE` → `completedAt = now`; если reopen `OPEN` → `completedAt = null`; если `ARCHIVED` → `archivedAt = now`; + `TaskEvent(STATUS_CHANGED)`
- **`archive`** — дополнительный guard: только `OWNER`/`ADMIN` или автор (`createdByUserId === actorUserId`); через state machine (проверяет, что переход → ARCHIVED допустим из текущего статуса)
- **`addComment`** — `TaskComment` + `TaskEvent(COMMENTED, {commentId})` в транзакции
- **`deleteComment`** — soft delete (`deletedAt = now`); проверяет `authorUserId === actorUserId`, иначе 403

Private guards:
- `assertWriteAllowed` — проверяет `tenant.accessState` ∈ {TRIAL_EXPIRED, SUSPENDED, CLOSED} → 403 `TASK_WRITE_BLOCKED_BY_TENANT_STATE`
- `assertActiveMember` — `Membership.status = ACTIVE` → 403 `TASK_ASSIGN_TO_NON_MEMBER`
- `assertValidTransition` — state machine map → 409 `TASK_INVALID_STATE_TRANSITION`
- `assertCanArchive` — проверяет автора или роль OWNER/ADMIN → 403 `TASK_ARCHIVE_NOT_ALLOWED`

State machine (константа `VALID_TRANSITIONS`):
```
OPEN        → IN_PROGRESS | WAITING | DONE | ARCHIVED
IN_PROGRESS → WAITING | DONE | OPEN
WAITING     → IN_PROGRESS | DONE | OPEN
DONE        → ARCHIVED | OPEN  (completedAt сбрасывается при reopen)
ARCHIVED    → ∅  (терминальное)
```

#### `tasks.module.ts`
Минимальный модуль: `providers: [TasksService]`, `exports: [TasksService]`. `PrismaModule` не нужно импортировать — он `@Global()`.

### Изменения в существующих файлах
- `apps/api/src/app.module.ts` — импорт и регистрация `TasksModule`
- `apps/api/prisma/` — `prisma generate` выполнен, Prisma client обновлён (новые enum'ы и модели доступны в `@prisma/client`)

### Верификация
- `npx tsc --noEmit` — нет ошибок в модуле tasks
- Все mutations атомарны (Task + TaskEvent в одной `$transaction`)
- State machine не позволяет покинуть ARCHIVED (пустой `Set` в `VALID_TRANSITIONS`)
- Сервис не зависит от REST/notify слоёв — принимает только примитивные аргументы
