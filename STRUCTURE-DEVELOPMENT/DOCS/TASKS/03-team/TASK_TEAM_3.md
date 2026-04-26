# TASK_TEAM_3 — Accept Invite для Existing/New User и Auth Auto-Link

> Модуль: `03-team`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_TEAM_1`
  - `TASK_TEAM_2`
  - согласован `01-auth`
- Что нужно сделать:
  - реализовать `POST /team/invitations/:token/accept`;
  - поддержать existing user flow через login и new user flow через register + verify;
  - использовать pending invite auto-link после регистрации и verify;
  - валидировать token, TTL, status, tenant scope и `verified email match`;
  - делать accept идемпотентным при повторном открытии уже использованной ссылки.
- Критерий закрытия:
  - invite корректно принимается существующим и новым пользователем;
  - mismatch по verified email блокирует доступ;
  - auto-link invite после auth работает без ручных обходов.

**Что сделано**

### `team.service.ts` — новый метод `acceptInvitation(rawToken, userId)`

Полный цикл принятия приглашения для существующего пользователя:
1. Хэширует rawToken → ищет invitation по tokenHash.
2. Статус ACCEPTED → идемпотентный ответ `{ status: 'ALREADY_ACCEPTED' }`.
3. Статус CANCELLED → `INVITATION_ALREADY_USED`.
4. Истёкший TTL или статус EXPIRED → обновляет статус в БД → `INVITATION_EXPIRED`.
5. Проверяет наличие `emailVerifiedAt` у пользователя → `AUTH_EMAIL_NOT_VERIFIED`.
6. Сравнивает `user.email` с `invitation.email` → `INVITATION_EMAIL_MISMATCH`.
7. Если пользователь уже ACTIVE-участник tenant → только помечает инвайт ACCEPTED, возвращает `{ status: 'ALREADY_MEMBER' }`.
8. Иначе: транзакция — создаёт ACTIVE Membership + помечает инвайт ACCEPTED.
9. Записывает TeamEvent `team_invitation_accepted` с `via: 'token'`.

### `team.controller.ts` — новый эндпоинт + рефакторинг guards

- Добавлен `POST /team/invitations/:token/accept` — **без** `RequireActiveTenantGuard`, т.к. принимающий пользователь ещё не участник tenant.
- `RequireActiveTenantGuard` перенесён с уровня класса на уровень каждого метода, которому он нужен (list, create, resend, cancel).
- Accept требует только JWT-аутентификации (пользователь должен быть залогинен).

### `auth.service.ts` — auto-link в `verifyEmail`

После успешной верификации email вызывается `autoLinkPendingInvites(userId, email)`:
- Ищет все PENDING инвайты для этого email с не истёкшим TTL.
- Для каждого: если пользователь уже ACTIVE-участник → только помечает инвайт ACCEPTED; иначе транзакция создаёт Membership + помечает инвайт ACCEPTED.
- Для каждого записывает TeamEvent `team_invitation_accepted` с `via: 'auto_link'`.
- Логирует `team_invite_auto_linked` в audit.
- Не бросает исключений — ошибки авто-линковки не должны ломать flow верификации.

### Сценарии

| Сценарий | Flow | Результат |
|---|---|---|
| Existing user, правильный email | `POST /team/invitations/:token/accept` | Membership создана, `ACCEPTED` |
| New user | register → verify → auto-link | Membership создана без токена |
| Повторный click на invite link | accept → idempotency check | `ALREADY_ACCEPTED` |
| Пользователь уже в tenant | accept → membership check | `ALREADY_MEMBER` |
| Email mismatch | accept | `INVITATION_EMAIL_MISMATCH` |
| Email не верифицирован | accept | `AUTH_EMAIL_NOT_VERIFIED` |
| Истёкший токен | accept | `INVITATION_EXPIRED` |
| Отменённый инвайт | accept | `INVITATION_ALREADY_USED` |

TypeScript-компиляция чистая.
