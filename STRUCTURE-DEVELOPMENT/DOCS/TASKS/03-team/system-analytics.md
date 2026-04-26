# Управление командой — Системная аналитика

> Статус: [x] На review
> Последнее обновление: 2026-04-18
> Связанный раздел: `03-team`

## 1. Назначение модуля

Модуль реализует управление участниками tenant: приглашения по email, принятие инвайта, изменение роли, удаление участника, выход из tenant.

### Текущее состояние (as-is)

- в коде нет выделенного backend-модуля team и нет отдельного UI управления участниками;
- membership-контекст существует косвенно через auth/tenant слой, но invite lifecycle еще не оформлен как доменный модуль;
- RBAC-ограничения команды пока описаны детальнее в аналитике, чем закреплены в прикладных контрактах.

### Целевое состояние (to-be)

- team-модуль должен закрывать invitations, membership lifecycle, role changes и revoke/leave сценарии;
- роль должна интерпретироваться только в контексте tenant membership, а не как глобальное свойство пользователя;
- last-owner guard и вся role policy должны жить в доменной логике, а не только во frontend;
- invite acceptance должен быть согласован с уже утвержденным auth-flow: verified email match, auto-link pending invite после регистрации и серверный tenant scope check.


## 2. Функциональный контур и границы

### Что входит в модуль
- приглашения участников в tenant;
- membership lifecycle: pending, active, revoked, left;
- назначение и изменение ролей;
- защита правил ownership и last-owner guard;
- выдача команде корректного RBAC-контекста;
- server-side guards на team write actions в зависимости от tenant `AccessState`.

### Что не входит в модуль
- аутентификация и хранение credential;
- платежные лимиты и тарификация team seats;
- support/admin override действия вне tenant;
- пользовательские notification preferences.

### Главный результат работы модуля
- система знает, кто именно и с какой ролью имеет доступ к tenant, а любые изменения команды воспроизводимы и контролируемы.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Owner | Приглашает, меняет роли, удаляет участников | На MVP в tenant должен оставаться минимум один активный owner |
| Admin | Может приглашать и удалять часть команды по policy MVP | Не может менять/удалять `OWNER` и не может эскалировать себя в `OWNER` |
| Manager/Staff | Работает в пределах выданных прав | Не управляет командой, если не разрешено |
| Invitee | Принимает приглашение | Не получает доступ без завершенного accept flow |

## 4. Базовые сценарии использования

### Сценарий 1. Приглашение нового участника
1. Уполномоченный actor создает invite по email и роли.
2. Backend проверяет уникальность активного invite.
3. Генерируется invitation token/link.
4. Email уходит асинхронно, invite получает статус `pending`.

### Сценарий 2. Принятие приглашения
1. Получатель открывает invite link.
2. Если учетной записи нет, проходит auth/registration flow.
3. После регистрации pending invite должен автоматически привязаться к verified email account по правилам auth.
4. Backend валидирует token, TTL, tenant scope и совпадение invite email с verified email account.
5. Создается или активируется membership.
6. Invite помечается как `accepted`.

### Сценарий 3. Изменение роли / удаление участника
1. Уполномоченный actor запрашивает изменение membership.
2. Policy layer проверяет матрицу ролей и last-owner rule.
3. Role или membership status обновляется транзакционно.
4. Изменение отражается в audit и последующих JWT/context refresh flows.

## 5. Зависимости и интеграции

- Tenant/Membership
- Auth (сценарий принятия invite для нового пользователя)
- Tenant access-state policy (`TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`)
- Notifications (invite email)
- Audit (role/member actions)

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/team/members` | Owner/Admin/Manager | Список участников tenant |
| `POST` | `/api/v1/team/invitations` | Owner/Admin(policy-based) | Отправить инвайт |
| `GET` | `/api/v1/team/invitations` | Owner/Admin(policy-based) | Список инвайтов |
| `POST` | `/api/v1/team/invitations/:token/accept` | Public/User | Принять приглашение |
| `POST` | `/api/v1/team/invitations/:id/resend` | Owner/Admin(policy-based) | Переотправить инвайт |
| `DELETE` | `/api/v1/team/invitations/:id` | Owner/Admin(policy-based) | Отменить pending invite |
| `PATCH` | `/api/v1/team/members/:membershipId/role` | Owner | Изменить роль |
| `DELETE` | `/api/v1/team/members/:membershipId` | Owner/Admin(policy-based) | Удалить участника |
| `POST` | `/api/v1/team/members/:membershipId/leave` | User | Самостоятельный выход |

## 7. Примеры вызова API

```bash
curl -X POST /api/v1/team/invitations \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"email":"manager@demo.ru","role":"MANAGER"}'
```

```json
{
  "invitationId": "inv_...",
  "status": "PENDING",
  "expiresAt": "2026-04-22T12:00:00Z"
}
```

### Frontend поведение

- Текущее состояние: в текущих маршрутах web-приложения нет страниц `/team` и `/team/invite`.
- Целевое состояние: нужны список участников, экран приглашений, accept-flow и понятные RBAC-состояния по ролям.
- UX-правило: пользователь должен видеть не только запрет, но и причину ограничения по роли или ownership policy.
- при `TRIAL_EXPIRED` и `SUSPENDED` write-actions команды должны быть заблокированы согласно tenant policy, но read-only список команды может оставаться доступным;
- при `CLOSED` tenant team UI виден только как недоступный state без возможности invite/change/remove.

## 8. Модель данных (PostgreSQL)

### `invitations`
- `id UUID PK`
- `tenant_id UUID FK`
- `invited_by_user_id UUID FK`
- `email CITEXT NOT NULL`
- `role ENUM(admin, manager, staff) NOT NULL`
- `token_hash TEXT UNIQUE NOT NULL`
- `status ENUM(pending, accepted, expired, cancelled)`
- `expires_at TIMESTAMPTZ NOT NULL`
- `accepted_at TIMESTAMPTZ NULL`
- `accepted_by_user_id UUID NULL`
- `cancelled_at TIMESTAMPTZ NULL`
- `created_at`, `updated_at`

### Ограничения `invitations`
- допускается только один `pending` invite на пару `tenant_id + normalized_email`;
- invite на роль `OWNER` на MVP запрещен;
- invite email используется как trust anchor и должен совпасть с verified email при accept.

### `memberships` (используется повторно)
- изменение ролей только в рамках tenant
- нельзя удалить последнего owner tenant
- `UNIQUE(tenant_id, user_id)` обязателен
- membership должен хранить `role`, `status`, `joined_at`, `revoked_at`, `left_at`
- на MVP в одном tenant допускается только один active `OWNER`

### `team_events`
- `id UUID PK`
- `tenant_id`, `actor_user_id`, `event_type`, `payload JSONB`, `created_at`

## 9. Сценарии и алгоритмы (step-by-step)

1. Отправка invite: проверить права, создать invitation token, отправить email.
2. Принятие invite: проверить token/ttl/status, verified email match и tenant `AccessState`.
3. Если пользователь не зарегистрирован: пройти register+verify, затем auto-link invite и `accept`.
4. Изменение роли: Owner может менять роли с проверкой ограничений и without self-escalation loopholes.
5. Удаление участника: membership переводится в `REVOKED`, audit запись обязательна.
6. Leave: пользователь может сам выйти только если не нарушает last-owner guard.

## 10. Membership lifecycle

### Состояния
- `PENDING`
- `ACTIVE`
- `REVOKED`
- `LEFT`

### Переходы
- invite accept -> `ACTIVE`
- admin/owner remove -> `REVOKED`
- self-leave -> `LEFT`
- повторная активация бывшего участника на MVP не поддерживается

### Инварианты
- один пользователь не может иметь две активные membership в одном tenant;
- роль меняется только у существующей membership, а не через прямую запись в user;
- последнего owner нельзя удалить, понизить или позволить ему выйти самому.

## 11. Валидации и ошибки

- Запрет `self-invite` в тот же tenant.
- Запрет дублирующего invite для `pending` email.
- Запрет понижения/удаления последнего owner.
- Запрет accept invite под account с другим verified email.
- Запрет team write-actions, если tenant находится в `SUSPENDED` или `CLOSED`.
- Для `TRIAL_EXPIRED` поведение зависит от tenant policy: read-only режим без invite/change/remove.
- Ошибки:
  - `CONFLICT: INVITATION_ALREADY_PENDING`
  - `CONFLICT: INVITATION_EXPIRED`
  - `CONFLICT: INVITATION_ALREADY_USED`
  - `FORBIDDEN: INVITATION_EMAIL_MISMATCH`
  - `FORBIDDEN: ROLE_CHANGE_NOT_ALLOWED`
  - `FORBIDDEN: LAST_OWNER_GUARD`
  - `FORBIDDEN: TEAM_WRITE_BLOCKED_BY_TENANT_STATE`
  - `NOT_FOUND: MEMBERSHIP_NOT_FOUND`

## 12. Чеклист реализации

- [x] Модель данных: `Invitation`, расширенный `Membership`, `TeamEvent`, enum'ы `MembershipStatus`/`InvitationStatus`, миграция с бэкфилом и частичным уникальным индексом — **TASK_TEAM_1** (2026-04-26).
- [x] CRUD приглашений + token flow — **TASK_TEAM_2** (2026-04-26).
- [x] Обработчик принятия invite для existing/new user + auto-link при верификации — **TASK_TEAM_3** (2026-04-26).
- [x] RBAC policy для team actions + last-owner guard — **TASK_TEAM_4** (2026-04-26).
- [x] Guard team write-actions по tenant access-state — **TASK_TEAM_5** (2026-04-26).
- [x] Аудит всех member/role операций (TeamEvent) — **TASK_TEAM_5** (2026-04-26).
- [x] Frontend team module: Team.tsx, AcceptInvite.tsx, навигация, Login redirect — **TASK_TEAM_6** (2026-04-26).
- [x] 58 unit-тестов TeamService: role matrix, invite lifecycle, last-owner guard, tenant state guards, observability — **TASK_TEAM_7** (2026-04-26).

## 13. Критерии готовности (DoD)

- Инвайт-флоу работает для существующего и нового пользователя.
- Роли применяются корректно на уровне authorization.
- Все операции команды отражаются в audit.

## 14. Матрица ролей

### Proposed MVP role set

- `OWNER`
- `ADMIN`
- `MANAGER`
- `STAFF`

### `OWNER`
- отправка инвайтов
- изменение ролей
- удаление участников
- просмотр всей команды и истории инвайтов

### `ADMIN`
- отправка invite
- resend/cancel pending invite
- удаление `MANAGER/STAFF`
- без права менять/удалять `OWNER`

### `MANAGER`
- read-only список команды на MVP

### `STAFF`
- доступа к модулю нет

## 15. Lifecycle invitation

### Состояния
- `PENDING`
- `ACCEPTED`
- `EXPIRED`
- `CANCELLED`

### Переходы
- создание -> `PENDING`
- принятие -> `ACCEPTED`
- истечение TTL -> `EXPIRED`
- ручная отмена -> `CANCELLED`

### TTL
- default `7 дней`

### Дополнительные правила
- resend разрешен только для `PENDING`;
- cancel разрешен только для `PENDING`;
- accept должен быть идемпотентным при повторном открытии уже использованной ссылки.

## 16. Async процессы и события

- `team_invitation_created`
- `team_invitation_resent`
- `team_invitation_accepted`
- `team_invitation_cancelled`
- `membership_role_changed`
- `membership_removed`
- `membership_left`

### Async
- отправка invite email
- напоминание по pending invite
- nightly job, переводящий просроченные invite в `EXPIRED`

## 17. Тестовая матрица

- Invite существующего пользователя.
- Invite нового пользователя с последующей регистрацией.
- Повторная отправка active invite.
- Accept invite под account с другим verified email.
- Auto-link pending invite после регистрации и verify.
- Попытка дать роль `OWNER` через invite на MVP.
- Удаление последнего owner.
- Самостоятельный выход единственного owner.
- Попытка team write-action в `TRIAL_EXPIRED`.
- Попытка team write-action в `SUSPENDED/CLOSED`.
- Повторное открытие уже использованного invite link.

## 18. Фазы внедрения

1. Таблицы invitations/team events.
2. API members + invitations.
3. Acceptance flow для existing/new user.
4. RBAC enforcement.
5. Tenant-state guards на team write actions.
6. Async reminders + audit trail.

## 19. Нефункциональные требования и SLA

- Invite creation/accept flow должен быть `p95 < 500 мс`, кроме асинхронной отправки email.
- Изменение роли должно становиться эффективным для новых запросов не позже чем через `60 сек`.
- Матрица ролей должна проверяться на backend, а frontend only отражает разрешения.
- История membership не должна теряться даже после revoke/remove для расследований и аналитики.
- Повторные клики по invite accept/resend/cancel не должны приводить к дублированию membership или гонкам статусов.

## 20. Observability, логи и алерты

- Метрики: `invites_sent`, `invite_accept_rate`, `invite_expired`, `membership_role_changed`, `rbac_denied_by_module`.
- Логи: invite lifecycle, role transitions, last-owner guard violations.
- Алерты: повторяющиеся invite send failures, anomalous role changes, попытка удалить последнего owner, invite-email mismatch spikes.
- Dashboards: invite funnel, RBAC deny heatmap, team growth monitor, membership lifecycle board.

## 21. Риски реализации и архитектурные замечания

- Самая опасная ошибка: трактовать роль как свойство пользователя, а не membership tenant.
- Нужно заранее решить, как role changes синхронизируются с JWT/session context, иначе права будут “залипать”.
- Last-owner guard должен жить в доменной логике, а не только в UI.
- Invite tokens, email и membership связываются аккуратно, чтобы не создать параллельные активные membership на один и тот же email.
- Если team write-actions не завязать на tenant `AccessState`, suspended/closed tenant смогут продолжать менять состав команды.
- Нужно четко разделить `remove member`, `leave tenant` и future `reactivate member`, иначе lifecycle membership станет неоднозначным.

## 22. Открытые вопросы к продукту и архитектуре

- На текущий момент открытых продуктовых вопросов по MVP team не осталось.

## 23. Подтвержденные продуктовые решения

- финальный MVP role set: `OWNER / ADMIN / MANAGER / STAFF`;
- `ADMIN` на MVP может отправлять invite, делать resend/cancel pending invite и удалять `MANAGER/STAFF`;
- повторная активация бывшего участника (`LEFT/REVOKED`) в MVP не поддерживается.

## 24. Чеклист готовности раздела

- [ ] Текущее и целевое состояние раздела зафиксированы.
- [ ] Backend API, frontend поведение и модель данных согласованы между собой.
- [ ] Membership lifecycle и invitation lifecycle описаны отдельно и явно.
- [ ] Async-процессы, observability и тестовая матрица описаны.
- [ ] Стыки с auth, tenant и audit не противоречат друг другу.
- [ ] Открытые продуктовые решения выделены отдельно.

## 25. История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-04-18 | Документ приведен к единой глубине system analytics | Codex |
| 2026-04-18 | Доработаны membership lifecycle, tenant-state guards, invite/email security и вынесены продуктовые вопросы по ролям MVP | Codex |
| 2026-04-18 | Зафиксированы MVP-роли, права `ADMIN` и отказ от reactivation бывших участников | Codex |
| 2026-04-26 | TASK_TEAM_1 выполнена: модель данных Invitation/Membership/TeamEvent, миграция с бэкфилом, частичный уникальный индекс, обновление всех сервисов под MembershipStatus | Claude |
| 2026-04-26 | TASK_TEAM_2 выполнена: TeamModule с invite flow (create/list/resend/cancel), RBAC-проверки, TenantWriteGuard, TeamEvent, sendInviteEmail | Claude |
| 2026-04-26 | TASK_TEAM_3 выполнена: acceptInvitation с полной валидацией и идемпотентностью; auto-link pending invites в verifyEmail; guards рефакторинг | Claude |
| 2026-04-26 | TASK_TEAM_4 выполнена: listMembers, changeRole, removeMember, leaveTeam; role matrix OWNER/ADMIN/MANAGER/STAFF; assertNotLastOwner guard | Claude |
| 2026-04-26 | TASK_TEAM_5 выполнена: TenantWriteGuard на leaveTeam; tenant accessState check в acceptInvitation; TeamSchedulerService nightly job для expire invite; @nestjs/schedule установлен | Claude |
| 2026-04-26 | TASK_TEAM_6 выполнена: Team.tsx (members list, invitations tab, role matrix, write-blocked states), AcceptInvite.tsx (все invite-states), навигация в MainLayout, redirect в Login | Claude |
