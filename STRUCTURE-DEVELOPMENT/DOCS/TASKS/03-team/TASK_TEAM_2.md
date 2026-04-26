# TASK_TEAM_2 — Create, List, Resend и Cancel Invite Flow

> Модуль: `03-team`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_TEAM_1`
  - готов email delivery контур
- Что нужно сделать:
  - реализовать `GET/POST /team/invitations`, `POST resend`, `DELETE cancel`;
  - генерировать invitation token/link и TTL `7 дней`;
  - не допускать duplicate `pending` invite и `self-invite` в тот же tenant;
  - разрешить resend/cancel только для `PENDING`;
  - отправлять invite email асинхронно и писать team/audit события.
- Критерий закрытия:
  - уполномоченный actor может создать, переотправить и отменить invite;
  - duplicate и invalid invite сценарии предсказуемо обрабатываются;
  - invitation lifecycle согласован с backend и email delivery.

**Что сделано**

### Новые файлы

- `apps/api/src/modules/team/dto/create-invitation.dto.ts` — DTO с валидацией `email` (IsEmail) и `role` (IsEnum Role).
- `apps/api/src/modules/team/team.service.ts` — сервис с четырьмя методами:
  - `createInvitation` — проверяет права актора (OWNER/ADMIN), запрещает роль OWNER, self-invite, дублирующий pending-инвайт и already-member; генерирует SHA-256 токен с TTL 7 дней; fire-and-forget email; записывает TeamEvent.
  - `listInvitations` — возвращает все инвайты tenant с информацией о отправителе.
  - `resendInvitation` — перегенерирует токен/TTL для PENDING инвайта и отправляет новый email.
  - `cancelInvitation` — переводит PENDING инвайт в CANCELLED с меткой времени.
- `apps/api/src/modules/team/team.controller.ts` — контроллер `/team/invitations`, `POST /team/invitations`, `POST /team/invitations/:id/resend`, `DELETE /team/invitations/:id`; write-эндпоинты защищены `TenantWriteGuard`; весь контроллер защищён `RequireActiveTenantGuard`.
- `apps/api/src/modules/team/team.module.ts` — подключает `AuthModule` (для `EmailService`) и `TenantModule` (для guards).

### Обновлённые файлы

- `auth/email.service.ts` — добавлен метод `sendInviteEmail(email, token)` с dev-логированием invite URL.
- `auth/auth.module.ts` — `EmailService` добавлен в `exports` для использования в `TeamModule`.
- `app.module.ts` — `TeamModule` добавлен в импорты приложения.

### Бизнес-правила, реализованные в сервисе

- Только OWNER/ADMIN могут управлять инвайтами.
- Invite на роль `OWNER` запрещён (`ROLE_CHANGE_NOT_ALLOWED`).
- Self-invite запрещён (`INVITATION_SELF_INVITE`).
- Если пользователь с таким email уже ACTIVE-участник tenant — ошибка `INVITATION_ALREADY_MEMBER`.
- Дублирующий pending-инвайт (один на tenant+email) пойман через P2002 от частичного уникального индекса → `INVITATION_ALREADY_PENDING`.
- Resend/cancel разрешены только для `PENDING` → `INVITATION_NOT_PENDING`.
- Write-операции блокируются tenant-guard при `TRIAL_EXPIRED`/`SUSPENDED`/`CLOSED`.
- TeamEvent пишется для каждого действия: `team_invitation_created`, `team_invitation_resent`, `team_invitation_cancelled`.
- TypeScript-компиляция чистая.
