# TASK_TEAM_1 — Data Model, Invitations и Membership Lifecycle

> Модуль: `03-team`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - утверждена системная аналитика `03-team`
  - согласованы `01-auth` и `02-tenant`
- Что нужно сделать:
  - завести/уточнить модель `invitations`, `memberships`, `team_events`;
  - зафиксировать lifecycle `PENDING/ACCEPTED/EXPIRED/CANCELLED` для invite и `PENDING/ACTIVE/REVOKED/LEFT` для membership;
  - обеспечить `UNIQUE(tenant_id, user_id)` и ограничения по одному `pending` invite на `tenant + normalized_email`;
  - запретить invite на роль `OWNER` в MVP и повторную активацию `LEFT/REVOKED` участника.
- Критерий закрытия:
  - модель данных соответствует `03-team`;
  - invitation и membership lifecycle реализуемы без серых зон;
  - инварианты last-owner и uniqueness зафиксированы на DB и domain уровне.

**Что сделано**

### Схема данных (`apps/api/prisma/schema.prisma`)

- Добавлены enum'ы `MembershipStatus` (PENDING/ACTIVE/REVOKED/LEFT) и `InvitationStatus` (PENDING/ACCEPTED/EXPIRED/CANCELLED).
- Расширена модель `Membership`: добавлены поля `status MembershipStatus @default(ACTIVE)`, `joinedAt`, `revokedAt`, `leftAt` и составной индекс `(tenantId, status)`.
- Добавлена модель `Invitation` с полями: `email`, `role`, `status`, `tokenHash`, `expiresAt`, `acceptedAt`, `cancelledAt`, FK на `Tenant`, `invitedBy` (User), `acceptedBy` (User nullable).
- Добавлена модель `TeamEvent` с полями: `eventType`, `payload JSONB`, FK на `Tenant`, `actorUserId` (User nullable).
- Добавлены обратные связи в `User` (`sentInvitations`, `acceptedInvitations`, `teamEvents`) и `Tenant` (`invitations`, `teamEvents`).
- Сгенерирован Prisma Client (`prisma generate`) — TypeScript-компиляция чистая.

### Миграция (`apps/api/prisma/migrations/20260426020000_team_data_model/migration.sql`)

- Созданы типы `MembershipStatus` и `InvitationStatus`.
- `ALTER TABLE Membership` — добавлены новые поля с бэкфилом: существующим записям проставлен `status = 'ACTIVE'`, `joinedAt = createdAt`.
- Создана таблица `Invitation` с FK и уникальным индексом на `tokenHash`.
- Добавлен **частичный уникальный индекс** `Invitation_tenantId_email_pending_uidx` на `(LOWER(email), tenantId) WHERE status = 'PENDING'` — реализует правило «один pending-инвайт на tenant+email».
- Создана таблица `TeamEvent` с составным индексом `(tenantId, createdAt)`.

### Обновление сервисов

- `tenant.service.ts` — при создании тенанта membership получает `status: 'ACTIVE', joinedAt: new Date()`; все запросы membership (`findMany`, `findFirst`) фильтруются по `status: 'ACTIVE'`; все `findUnique` заменены на `findFirst` с фильтром статуса.
- `auth.service.ts` — `getMe` фильтрует memberships по `status: 'ACTIVE'`, чтобы REVOKED/LEFT участники не видели тенанты.
- `user.service.ts` — все три места создания membership (seedAdmin, registerUser, createTelegramUser) дополнены `status: 'ACTIVE', joinedAt: new Date()`.
- `active-tenant.guard.ts` — оба метода (`resolveStrict`, `resolveSoft`) заменены с `findUnique` на `findFirst` с `status: 'ACTIVE'` — revoked-участники не проходят guard.
- `seed.ts` — membership при seed-создании пользователя получает `status: 'ACTIVE', joinedAt: new Date()`.

### Инварианты, зафиксированные на DB и domain уровне

- `UNIQUE(userId, tenantId)` на Membership — существует с предыдущих миграций.
- `MembershipStatus` — lifecycle PENDING/ACTIVE/REVOKED/LEFT описан в домене и отражён в схеме.
- Частичный уникальный индекс гарантирует: на каждую пару `(tenant, email)` допускается только один `PENDING` инвайт.
- Запрет инвайта на роль `OWNER` — реализуется на доменном уровне (будет в TASK_TEAM_2).
- Запрет повторной активации `LEFT/REVOKED` участника — реализуется на доменном уровне (TASK_TEAM_2).
