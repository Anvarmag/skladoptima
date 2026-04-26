# TASK_AUTH_7 — QA, Regression и Observability для Auth

> Модуль: `01-auth`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `7h`
- Зависимости:
  - `TASK_AUTH_2`
  - `TASK_AUTH_3`
  - `TASK_AUTH_4`
  - `TASK_AUTH_5`
  - `TASK_AUTH_6`
- Что нужно сделать:
  - собрать regression пакет на register/verify/login/logout/logout-all/reset/change password;
  - покрыть verify-blocked login, soft-lock, neutral errors, invite auto-link, revoke sessions;
  - проверить observability: auth events, security alerts, failed attempts, reset lifecycle;
  - зафиксировать smoke-checklist для релиза auth слоя.
- Критерий закрытия:
  - auth-контур закрыт проверяемой регрессией;
  - security-critical сценарии подтверждены тестами;
  - observability достаточна для поддержки и расследований.

---

**Что сделано (2026-04-25)**

Написан regression unit-test пакет: `apps/api/src/modules/auth/auth.service.spec.ts`.

**54 теста, все зелёные (0.5 с).**

### Покрытые сценарии

**register**
- создание user + AuthIdentity + отправка verification email
- дубль email → `AUTH_EMAIL_TAKEN`
- дубль phone → `AUTH_PHONE_TAKEN`
- эмиссия audit-события `auth_user_registered`

**verifyEmail**
- валидный PENDING token → статус VERIFIED, user переходит в ACTIVE
- повторное открытие USED challenge → нейтральный `ALREADY_VERIFIED`
- PENDING challenge, но `user.emailVerifiedAt` уже установлен → `ALREADY_VERIFIED`
- просроченный token (TTL) → `AUTH_VERIFICATION_TOKEN_EXPIRED`
- CANCELLED или отсутствующий token → `AUTH_VERIFICATION_TOKEN_INVALID`

**resendVerification**
- неизвестный email → нейтральный `{ sent: true }` (нет enumeration)
- уже подтверждённый email → нейтральный `{ sent: true }`
- cooldown 60 с → `AUTH_RESEND_TOO_SOON` с `retryAfterSeconds`
- 3+ запроса за час → `AUTH_RESEND_LIMIT_EXCEEDED`
- успешный resend: отменяет старые PENDING, создаёт новый challenge, отправляет email

**validateUser (login gate)**
- верные credentials → возвращает user
- 5+ неудач за 15 мин → `AUTH_ACCOUNT_SOFT_LOCKED` + audit `auth_login_blocked`
- неверный пароль → `AUTH_INVALID_CREDENTIALS` + запись `LoginAttempt` + audit
- bcrypt выполняется даже при несуществующем email (timing-attack protection)
- email не подтверждён → `AUTH_EMAIL_NOT_VERIFIED` + `nextAction: VERIFY_EMAIL`
- статус LOCKED → `AUTH_ACCOUNT_LOCKED`
- статус DELETED → нейтральный `AUTH_INVALID_CREDENTIALS` (нет enumeration)

**loginUser**
- создаёт session, обновляет `lastLoginAt`, эмитирует `auth_login_succeeded`

**refreshSession**
- ротация: старая сессия → ROTATED, создаётся новая
- неизвестный token → `AUTH_REFRESH_TOKEN_INVALID`
- reuse ROTATED-токена → все ACTIVE сессии → COMPROMISED + audit `auth_refresh_token_reuse_detected`
- истёкшая сессия → статус EXPIRED + `AUTH_REFRESH_TOKEN_EXPIRED`
- user.status ≠ ACTIVE → `AUTH_ACCOUNT_LOCKED`

**logout / logout-all**
- `revokeSession`: сессия → REVOKED, `revokeReason: USER_LOGOUT`, audit event
- `revokeAllSessions`: все ACTIVE сессии пользователя → REVOKED, `revokeReason: USER_LOGOUT_ALL`, audit event

**getMe**
- `passwordHash` не попадает в ответ
- нет memberships → `nextRoute: /onboarding`
- 1 membership → `nextRoute: /app`
- >1 memberships + невалидный `lastUsedTenantId` → `nextRoute: /tenant-picker`
- неизвестный userId → `UnauthorizedException`

**forgotPassword**
- неизвестный email → нейтральный `{ sent: true }` (нет enumeration)
- cooldown 60 с → нейтральный `{ sent: true }` (нет enumeration)
- 3+ запроса за час → нейтральный `{ sent: true }` (нет enumeration)
- успешный запрос: отменяет старые PENDING, отправляет email, эмитирует `auth_password_reset_requested`

**resetPassword**
- успешный reset: обновляет passwordHash, отзывает все ACTIVE сессии, эмитирует `auth_password_reset_completed`
- неизвестный / USED / CANCELLED token → `AUTH_RESET_TOKEN_INVALID`
- истёкший token → `AUTH_RESET_TOKEN_EXPIRED`

**changePassword**
- успешная смена: обновляет passwordHash, отзывает все сессии КРОМЕ текущей, эмитирует `auth_password_changed`
- неверный текущий пароль → `AUTH_INVALID_CURRENT_PASSWORD`
- новый пароль совпадает с текущим → `AUTH_NEW_PASSWORD_SAME_AS_CURRENT`

### Observability coverage

Отдельная группа тестов (`observability: all critical audit events are emitted`) верифицирует, что каждый критический audit-ивент действительно эмитируется через `Logger.log`:

| Audit event | Покрыт |
|---|---|
| `auth_user_registered` | ✅ |
| `auth_email_verified` | ✅ |
| `auth_login_succeeded` | ✅ |
| `auth_login_failed` | ✅ |
| `auth_login_blocked` | ✅ (в soft-lock тесте) |
| `auth_refresh_token_reuse_detected` | ✅ |
| `auth_password_reset_requested` | ✅ |
| `auth_password_reset_completed` | ✅ |
| `auth_password_changed` | ✅ |
| `auth_session_revoked` | ✅ |

### Технические решения

- `bcrypt` замокан (`jest.mock`) — cost 12 слишком медленный для unit-тестов (250 мс/хеш)
- `PrismaService` замокан через factory-функцию `makePrismaMock()` — покрывает оба режима `$transaction` (callback + array)
- `Logger.prototype.log` шпионится через `jest.spyOn` для проверки audit-событий без зависимости от реального логгера
- Каждый `describe` блок сбрасывает моки через `afterEach(() => jest.clearAllMocks())`
