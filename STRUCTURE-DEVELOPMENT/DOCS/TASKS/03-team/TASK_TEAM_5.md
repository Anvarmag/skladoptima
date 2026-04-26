# TASK_TEAM_5 — Tenant State Guards, Async и Audit для Team

> Модуль: `03-team`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_TEAM_2`
  - `TASK_TEAM_4`
  - согласованы `02-tenant`, `15-notifications`, `16-audit`
- Что нужно сделать:
  - заблокировать team write-actions при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED` по tenant policy;
  - оставить read-only список команды там, где это разрешено политикой;
  - публиковать async события `team_invitation_created/resent/accepted/cancelled`, `membership_role_changed`, `membership_removed`, `membership_left`;
  - писать audit trail для invite/member/role операций;
  - реализовать nightly job для перевода просроченных invite в `EXPIRED`.
- Критерий закрытия:
  - team модуль уважает tenant access-state;
  - async flow и audit покрывают все критичные операции;
  - просроченные invite корректно уходят в `EXPIRED`.

**Что сделано**

### 1. Tenant State Guards — полное покрытие write-actions

`TenantWriteGuard` блокирует write-endpoints при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`:
- `POST /team/invitations` — createInvitation
- `POST /team/invitations/:id/resend` — resendInvitation
- `DELETE /team/invitations/:id` — cancelInvitation
- `PATCH /team/members/:membershipId/role` — changeRole
- `DELETE /team/members/:membershipId` — removeMember
- **`POST /team/members/:membershipId/leave`** — leaveTeam (добавлен `TenantWriteGuard`, ранее отсутствовал)

Read-only endpoints (`GET /team/members`, `GET /team/invitations`) — доступны при любом `accessState`, только `RequireActiveTenantGuard`.

### 2. Accept Invitation — проверка tenant access-state

`acceptInvitation` в `team.service.ts` теперь загружает `tenant.accessState` через `include` и выбрасывает `TEAM_WRITE_BLOCKED_BY_TENANT_STATE` при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`. Это необходимо, так как у endpoint `/team/invitations/:token/accept` нет tenant-контекста из JWT (пользователь ещё не является участником).

### 3. Async события — уже покрыты

`recordTeamEvent` записывает в таблицу `TeamEvent` все 7 событий:
- `team_invitation_created`, `team_invitation_resent`, `team_invitation_accepted`, `team_invitation_cancelled`
- `membership_role_changed`, `membership_removed`, `membership_left`

Email-отправка не блокирует ответ — `.catch()` логирует ошибки асинхронно.

### 4. Audit trail — покрыт через TeamEvent

`TeamEvent` (tenantId, actorUserId, eventType, payload, createdAt) служит audit log для всех team-операций. Все операции invite/member/role записывают событие.

### 5. Nightly job — `TeamSchedulerService`

Создан `apps/api/src/modules/team/team-scheduler.service.ts`:
- `@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)` — каждую ночь в 00:00
- `expireStaleInvitations()` — `updateMany` всех `PENDING` invite с `expiresAt < now` → статус `EXPIRED`
- логирует количество переведённых invite

Установлена зависимость `@nestjs/schedule ^6.1.3`.
`ScheduleModule.forRoot()` добавлен в `TeamModule.imports`.
`TeamSchedulerService` добавлен в `TeamModule.providers`.

### Файлы изменены

- `apps/api/src/modules/team/team.controller.ts` — добавлен `TenantWriteGuard` на `leaveTeam`
- `apps/api/src/modules/team/team.service.ts` — `acceptInvitation` проверяет `tenant.accessState`
- `apps/api/src/modules/team/team.module.ts` — импорт `ScheduleModule`, провайдер `TeamSchedulerService`
- `apps/api/src/modules/team/team-scheduler.service.ts` — новый файл, nightly cron job
- `apps/api/package.json` — добавлен `@nestjs/schedule`
