# Управление командой — Системная аналитика (Dev Spec)

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

## 1. Назначение

Модуль реализует управление участниками tenant: приглашения по email, принятие инвайта, изменение роли, удаление участника, выход из tenant.

## 2. Функциональный контур и границы

### Что входит в модуль
- приглашения участников в tenant;
- membership lifecycle: pending, active, revoked, left;
- назначение и изменение ролей;
- защита правил ownership и last-owner guard;
- выдача команде корректного RBAC-контекста.

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
| Owner | Приглашает, меняет роли, удаляет участников | Не может оставить tenant без owner |
| Admin | Может управлять частью команды по политике | Не должен эскалировать себя в owner |
| Manager/Staff | Работает в пределах выданных прав | Не управляет командой, если не разрешено |
| Invitee | Принимает приглашение | Не получает доступ без завершенного accept flow |

## 4. Базовые сценарии использования

### Сценарий 1. Приглашение нового участника
1. Owner/Admin создает invite по email и роли.
2. Backend проверяет уникальность активного invite.
3. Генерируется invitation token/link.
4. Email уходит асинхронно, invite получает статус `pending`.

### Сценарий 2. Принятие приглашения
1. Получатель открывает invite link.
2. Если учетной записи нет, проходит auth/registration flow.
3. Backend валидирует token, TTL и tenant scope.
4. Создается или активируется membership.
5. Invite помечается как `accepted`.

### Сценарий 3. Изменение роли / удаление участника
1. Уполномоченный actor запрашивает изменение membership.
2. Policy layer проверяет матрицу ролей и last-owner rule.
3. Role или membership status обновляется транзакционно.
4. Изменение отражается в audit и последующих JWT/context refresh flows.

## 5. Зависимости и интеграции

- Tenant/Membership
- Auth (сценарий принятия invite для нового пользователя)
- Notifications (invite email)
- Audit (role/member actions)

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `GET` | `/api/v1/team/members` | Owner/Admin/Manager | Список участников tenant |
| `POST` | `/api/v1/team/invitations` | Owner/Admin | Отправить инвайт |
| `GET` | `/api/v1/team/invitations` | Owner/Admin | Список инвайтов |
| `POST` | `/api/v1/team/invitations/:token/accept` | Public/User | Принять приглашение |
| `POST` | `/api/v1/team/invitations/:id/resend` | Owner/Admin | Переотправить инвайт |
| `PATCH` | `/api/v1/team/members/:membershipId/role` | Owner | Изменить роль |
| `DELETE` | `/api/v1/team/members/:membershipId` | Owner/Admin | Удалить участника |
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

## 8. Модель данных (PostgreSQL)

### `invitations`
- `id UUID PK`
- `tenant_id UUID FK`
- `invited_by_user_id UUID FK`
- `email VARCHAR(255) NOT NULL`
- `role ENUM(admin, manager, staff) NOT NULL`
- `token_hash TEXT UNIQUE NOT NULL`
- `status ENUM(pending, accepted, expired, cancelled)`
- `expires_at TIMESTAMPTZ NOT NULL`
- `accepted_at TIMESTAMPTZ NULL`
- `created_at`, `updated_at`

### `memberships` (используется повторно)
- изменение ролей только в рамках tenant
- нельзя удалить последнего owner tenant

### `team_events`
- `id UUID PK`
- `tenant_id`, `actor_user_id`, `event_type`, `payload JSONB`, `created_at`

## 9. Сценарии и алгоритмы (step-by-step)

1. Отправка invite: проверить права, создать invitation token, отправить email.
2. Принятие invite: проверить token/ttl/status, создать или обновить membership.
3. Если пользователь не зарегистрирован: пройти register+verify, затем `accept`.
4. Изменение роли: Owner может менять роли с проверкой ограничений.
5. Удаление участника: soft-off membership (`status=left/suspended`), audit запись.

## 10. Валидации и ошибки

- Запрет `self-invite` в тот же tenant.
- Запрет дублирующего invite для `pending` email.
- Запрет понижения/удаления последнего owner.
- Ошибки:
  - `CONFLICT: INVITATION_ALREADY_PENDING`
  - `CONFLICT: INVITATION_EXPIRED`
  - `FORBIDDEN: ROLE_CHANGE_NOT_ALLOWED`
  - `NOT_FOUND: MEMBERSHIP_NOT_FOUND`

## 11. Чеклист реализации

- [ ] CRUD приглашений + token flow.
- [ ] Обработчик принятия invite для existing/new user.
- [ ] RBAC policy для team actions.
- [ ] Аудит всех member/role операций.
- [ ] Интеграционные тесты role matrix.

## 12. Критерии готовности (DoD)

- Инвайт-флоу работает для существующего и нового пользователя.
- Роли применяются корректно на уровне authorization.
- Все операции команды отражаются в audit.

## 13. Матрица ролей

### `OWNER`
- отправка инвайтов
- изменение ролей
- удаление участников
- просмотр всей команды и истории инвайтов

### `ADMIN`
- отправка инвайтов
- удаление `MANAGER/STAFF`
- без права менять/удалять `OWNER`

### `MANAGER`
- read-only список команды на MVP

### `STAFF`
- доступа к модулю нет

## 14. Lifecycle invitation

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

## 15. Async процессы и события

- `team_invitation_created`
- `team_invitation_resent`
- `team_invitation_accepted`
- `membership_role_changed`
- `membership_removed`

### Async
- отправка invite email
- напоминание по pending invite
- nightly job, переводящий просроченные invite в `EXPIRED`

## 16. Тестовая матрица

- Invite существующего пользователя.
- Invite нового пользователя с последующей регистрацией.
- Повторная отправка active invite.
- Попытка дать роль `OWNER` через invite на MVP.
- Удаление последнего owner.
- Самостоятельный выход единственного owner.

## 17. Фазы внедрения

1. Таблицы invitations/team events.
2. API members + invitations.
3. Acceptance flow для existing/new user.
4. RBAC enforcement.
5. Async reminders + audit trail.

## 18. Нефункциональные требования и SLA

- Invite creation/accept flow должен быть `p95 < 500 мс`, кроме асинхронной отправки email.
- Изменение роли должно становиться эффективным для новых запросов не позже чем через `60 сек`.
- Матрица ролей должна проверяться на backend, а frontend only отражает разрешения.
- История membership не должна теряться даже после revoke/remove для расследований и аналитики.

## 19. Observability, логи и алерты

- Метрики: `invites_sent`, `invite_accept_rate`, `invite_expired`, `membership_role_changed`, `rbac_denied_by_module`.
- Логи: invite lifecycle, role transitions, last-owner guard violations.
- Алерты: повторяющиеся invite send failures, anomalous role changes, попытка удалить последнего owner.
- Dashboards: invite funnel, RBAC deny heatmap, team growth monitor.

## 20. Риски реализации и архитектурные замечания

- Самая опасная ошибка: трактовать роль как свойство пользователя, а не membership tenant.
- Нужно заранее решить, как role changes синхронизируются с JWT/session context, иначе права будут “залипать”.
- Last-owner guard должен жить в доменной логике, а не только в UI.
- Invite tokens, email и membership связываются аккуратно, чтобы не создать параллельные активные membership на один и тот же email.
