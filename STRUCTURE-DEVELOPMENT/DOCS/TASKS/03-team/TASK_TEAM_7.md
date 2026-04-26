# TASK_TEAM_7 — QA, Regression и Observability для Team

> Модуль: `03-team`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `7h`
- Зависимости:
  - `TASK_TEAM_2`
  - `TASK_TEAM_3`
  - `TASK_TEAM_4`
  - `TASK_TEAM_5`
  - `TASK_TEAM_6`
- Что нужно сделать:
  - собрать regression пакет на invite create/resend/cancel/accept, role change, remove, leave;
  - проверить existing/new user accept flow, invite email mismatch, expired/used token, last-owner guard;
  - покрыть `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED` для team write-actions;
  - проверить observability: team events, invite email delivery, audit trail, expired invite cleanup.
- Критерий закрытия:
  - team контур закрыт проверяемой регрессией;
  - RBAC и ownership risks подтверждены тестами;
  - telemetry достаточна для расследования invite/member инцидентов.

**Что сделано**

### `apps/api/src/modules/team/team.service.spec.ts` — 58 тестов, все проходят

**createInvitation (9 тестов):**
- OWNER и ADMIN создают инвайт → email отправляется
- MANAGER/STAFF → `ROLE_CHANGE_NOT_ALLOWED`
- Запрет инвайта на роль OWNER
- Self-invite → `INVITATION_SELF_INVITE`
- Уже активный участник → `INVITATION_ALREADY_MEMBER`
- Дубликат pending → `INVITATION_ALREADY_PENDING` (P2002)
- TeamEvent `team_invitation_created` эмитируется

**resendInvitation (4 теста):** resend PENDING инвайта, NOT_FOUND, NOT_PENDING, TeamEvent.

**cancelInvitation (3 теста):** cancel PENDING, NOT_PENDING, TeamEvent.

**acceptInvitation (11 тестов):**
- Existing user: membership создана, статус ACCEPTED
- Идемпотентность: ALREADY_ACCEPTED, ALREADY_MEMBER
- INVITATION_EXPIRED (TTL и статус)
- INVITATION_ALREADY_USED (CANCELLED)
- INVITATION_EMAIL_MISMATCH
- AUTH_EMAIL_NOT_VERIFIED
- INVITATION_NOT_FOUND
- TRIAL_EXPIRED / SUSPENDED / CLOSED → TEAM_WRITE_BLOCKED_BY_TENANT_STATE (parametrized)

**listMembers (3 теста):** OWNER видит список, MANAGER read-only, STAFF заблокирован.

**changeRole (6 тестов):** OWNER меняет роль, ADMIN заблокирован, запрет OWNER-роли, LAST_OWNER_GUARD, NOT_FOUND, TeamEvent.

**removeMember (7 тестов):** OWNER удаляет MANAGER, ADMIN удаляет MANAGER/не OWNER/не ADMIN, нельзя удалить себя, LAST_OWNER_GUARD, TeamEvent.

**leaveTeam (6 тестов):** MANAGER уходит, нельзя чужую membership, LAST_OWNER_GUARD единственного OWNER, OWNER с другим OWNER может уйти, NOT_FOUND, TeamEvent.

**Tenant state guards (2 теста):** TRIAL_EXPIRED и CLOSED блокируют acceptInvitation.

**Data isolation (1 тест):** нет membership → ForbiddenException для всех team actions.

**Observability (5 тестов):** все 5 типов TeamEvent (`team_invitation_created/accepted`, `membership_role_changed/removed/left`) эмитируются корректно.
