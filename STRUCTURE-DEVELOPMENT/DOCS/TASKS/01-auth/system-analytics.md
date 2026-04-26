# Авторизация — Системная аналитика

> Статус: [x] В работе
> Последнее обновление: 2026-04-25
> Связанный раздел: `01-auth`

## 1. Назначение модуля

Модуль отвечает за identity lifecycle пользователя: регистрация, подтверждение email, login/logout, reset/change password, управление web-session и выбор активного tenant после входа.

### Текущее состояние (as-is)

**Выполнено (T1-01, 2026-04-25):**
- Схема БД приведена в соответствие с аналитикой: добавлены `AuthSession`, `EmailVerificationChallenge`, `PasswordResetChallenge`, `UserPreference`, `AuthIdentity`; `User` расширен полями `phone`, `status`, `emailVerifiedAt`, `lastLoginAt`; поле `password` переименовано в `passwordHash`.
- Миграция `20260425000000_auth_data_model` написана с data-migration существующих пользователей в `ACTIVE`.
- Все ссылки на старое поле `password` обновлены в `auth.service.ts`, `jwt.strategy.ts`, `user.service.ts`.
- Убрано логирование пароля в plaintext из `seedAdmin`.

**Выполнено (T1-02, 2026-04-25):**
- Register + email verification + resend flow реализованы (детали в TASK_AUTH_2.md).

**Выполнено (T1-03, 2026-04-25):**
- Server-side AuthSession с refresh token rotation и reuse/COMPROMISED detection.
- `POST /auth/login` — создаёт сессию, выставляет два httpOnly cookie (`Authentication` 15м, `Refresh` 30д, path `/auth/refresh`).
- `POST /auth/refresh` — ротирует refresh token, детектирует reuse → COMPROMISED для всех активных сессий.
- `POST /auth/logout` / `POST /auth/logout-all` — серверный revoke по sessionId / всех сессий пользователя.
- `GET /auth/me` — user + memberships + routing hint (`/onboarding`, `/app`, `/tenant-picker`).
- `JwtStrategy` — проверяет sessionId против `AuthSession.status = ACTIVE` (server-side invalidation).

**Выполнено (T1-04, 2026-04-25):**
- `POST /auth/password-resets` — forgot-password с нейтральным ответом (не раскрывает наличие аккаунта). Отменяет предыдущие PENDING challenges перед созданием нового. Rate limit: cooldown 60с + лимит 3 запроса в час; превышение возвращает нейтральный `{ sent: true }`.
- `POST /auth/password-resets/confirm` — reset по одноразовому токену (SHA-256 хеш, TTL 24ч). Состояния not-found / used / cancelled → один код `AUTH_RESET_TOKEN_INVALID`; expired → `AUTH_RESET_TOKEN_EXPIRED`. После успеха: обновляет passwordHash, отзывает все ACTIVE сессии (reason `PASSWORD_RESET`), очищает auth cookies.
- `POST /auth/change-password` — смена пароля авторизованным пользователем. Требует текущий пароль; запрещает повторное использование того же пароля (`AUTH_NEW_PASSWORD_SAME_AS_CURRENT`). После успеха: обновляет passwordHash, отзывает все ACTIVE сессии кроме текущей (reason `PASSWORD_CHANGE`) — пользователь остаётся залогиненным.
- Добавлены DTOs: `ForgotPasswordDto`, `ResetPasswordDto`, `ChangePasswordDto`.
- Приватный хелпер `createAndSendResetChallenge` — по аналогии с verification challenge.

**Выполнено (2026-04-26, исправления по аудиту):**
- JWT payload расширен: `{ sub, sessionId, activeTenantId, membershipVersion }` — gap T1-03 закрыт.
- `User.membershipVersion` — счётчик, инкрементируется атомарно при всех операциях с memberships.
- `ActiveTenantGuard` использует `activeTenantId` из JWT когда `membershipVersion` совпадает (экономия DB-хита).
- `REFRESH_TOKEN_TTL_MS` исправлен с 30 дней на 7 дней — устранено рассогласование с cookie TTL.

**Ещё не реализовано:**
- async email delivery — EmailService остаётся stub (`T1-30`);
- стыки `auth → tenant`, `auth → team invites`, `auth → onboarding` на уровне кода (`T1-07`).

### Целевое состояние (to-be)

- auth должен стать отдельным модулем с явными API-контрактами, server-side session invalidation и audit следом по критическим событиям;
- пользователь должен иметь единый account без глобальных ролей, а доступ к рабочему контексту должен определяться через membership и active tenant;
- login/session модель должна быть безопасной для web: short-lived access token, rotating refresh session, cookie-based transport, CSRF protection и детектирование reuse/compromise.

## 2. Функциональный контур и границы

### Что входит в модуль

- регистрация пользователя по `email + phone + password`;
- email verification flow;
- login/logout и refresh web-session;
- forgot/reset password и change password;
- хранение и инвалидирование auth sessions;
- выбор активного tenant после login;
- обработка auth-стыка для invite acceptance;
- anti-abuse, audit и security controls auth-процессов.

### Что не входит в модуль

- детальная модель ролей и permissions внутри tenant;
- управление составом команды как самостоятельный доменный модуль;
- billing/trial policy как коммерческая логика tenant;
- SSO, OAuth social login и SMS login в MVP;
- device management UI beyond базовый logout/invalidation flow.

### Главный результат работы модуля

- система достоверно знает, кто пользователь, подтвержден ли его identity, какие у него активные сессии и в каком tenant-контексте он продолжает работу после входа.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Guest | Регистрация, login, reset password, verify email | Не имеет доступа к private API |
| Authenticated User | Logout, change password, tenant switching | Права внутри продукта определяются не auth, а membership |
| User without tenant | Login и продолжение в onboarding | Не получает полноценный app context без tenant |
| Invitee | Переходит по invite link и завершает auth flow | Не получает membership без валидного invite |
| Auth service | Выдает и инвалидирует session artifacts | Не определяет RBAC по модулям |
| Notification service | Отправляет verification/reset/invite email | Работает асинхронно через outbox/job |

## 4. Базовые сценарии использования

### Сценарий 1. Регистрация нового пользователя

1. Гость отправляет `email`, `phone`, `password`.
2. Backend нормализует идентификаторы и проверяет уникальность.
3. Создается `user` со статусом `pending_verification`.
4. Создается verification challenge и ставится email dispatch job.
5. До подтверждения email пользователь не получает доступ в private app routes.

### Сценарий 2. Подтверждение email

1. Пользователь открывает verification link.
2. Backend валидирует token hash, TTL, статус и принадлежность user.
3. Email помечается как verified, challenge закрывается.
4. Пользователь переводится в состояние `active`.
5. Система показывает success/neutral/expired screen и предлагает login либо resend.

### Сценарий 3. Login и выбор tenant-контекста

1. Пользователь отправляет `email + password`.
2. Backend проверяет password hash, статус пользователя и rate limits.
3. Если email не подтвержден, login полностью запрещается, session не создается, пользователю возвращается `nextAction=VERIFY_EMAIL`.
4. Если проверки пройдены, создается access token и refresh session.
5. После login backend определяет post-login route:
   - нет tenant -> onboarding;
   - один tenant -> открыть его;
   - несколько tenant -> last used tenant, иначе tenant picker.

### Сценарий 4. Reset/change password

1. Forgot password создает reset challenge и отправляет email.
2. Reset по ссылке меняет password hash и инвалидирует остальные сессии.
3. Change password из профиля требует текущий password и тоже завершает остальные сессии.
4. Текущая сессия либо сохраняется с rotation, либо перевыпускается заново.

### Сценарий 5. Принятие инвайта новым или существующим пользователем

1. Invitee открывает invite link.
2. Backend определяет, существует ли user с email из invite.
3. Existing user проходит login и затем accept invite.
4. New user проходит register + email verify, после чего pending invite привязывается автоматически и выполняется accept invite без повторного ручного открытия ссылки.
5. Membership создается только если email invite совпадает с verified email account.

## 5. Зависимости и интеграции

- `02-tenant`: active tenant context, tenant picker, last used tenant;
- `03-team`: invitation accept flow, membership activation;
- `04-onboarding`: маршрут пользователя без tenant;
- `15-notifications`: email delivery verification/reset/invite;
- `16-audit`: security-critical events;
- edge/gateway layer: rate limiting, cookie policy, CSRF.

## 6. Доменная модель и состояния

### `user.status`

- `PENDING_VERIFICATION`
- `ACTIVE`
- `LOCKED`
- `DELETED`

### `email_verification.status`

- `PENDING`
- `USED`
- `EXPIRED`
- `CANCELLED`

### `password_reset.status`

- `PENDING`
- `USED`
- `EXPIRED`
- `CANCELLED`

### `auth_session.status`

- `ACTIVE`
- `ROTATED`
- `REVOKED`
- `EXPIRED`
- `COMPROMISED`

### Ключевые принципы

- глобальной роли у `user` нет, identity отделена от membership;
- активный tenant не хранится только на клиенте, а фиксируется сервером как preference/session context;
- все одноразовые токены хранятся не в plaintext, а как hash;
- любые auth state transitions должны быть audit-friendly и idempotent.

## 7. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `POST` | `/api/v1/auth/register` | Public | Регистрация пользователя |
| `POST` | `/api/v1/auth/email-verifications` | Public | Повторная отправка verification email |
| `POST` | `/api/v1/auth/email-verifications/confirm` | Public | Подтверждение email по token |
| `POST` | `/api/v1/auth/login` | Public | Login и создание web-session |
| `POST` | `/api/v1/auth/refresh` | Cookie | Ротация access/refresh session |
| `POST` | `/api/v1/auth/logout` | User | Logout текущей сессии |
| `POST` | `/api/v1/auth/logout-all` | User | Завершить все сессии, кроме текущей или включая текущую по флагу |
| `POST` | `/api/v1/auth/password-resets` | Public | Запрос reset password |
| `POST` | `/api/v1/auth/password-resets/confirm` | Public | Установка нового пароля по reset token |
| `POST` | `/api/v1/auth/change-password` | User | Смена пароля из профиля |
| `GET` | `/api/v1/auth/me` | User | Текущий пользователь, memberships, active tenant |
| `POST` | `/api/v1/auth/active-tenant` | User | Переключение active tenant |

## 8. Примеры вызова API

```bash
curl -X POST /api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@demo.ru","phone":"+79991234567","password":"StrongPass123!"}'
```

```json
{
  "userId": "usr_...",
  "status": "PENDING_VERIFICATION",
  "nextAction": "VERIFY_EMAIL"
}
```

```bash
curl -X POST /api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@demo.ru","password":"StrongPass123!"}'
```

```json
{
  "user": {
    "id": "usr_...",
    "email": "owner@demo.ru",
    "emailVerified": true
  },
  "postLogin": {
    "type": "TENANT_PICKER",
    "lastUsedTenantId": null
  }
}
```

### Frontend поведение

- public routes: `/login`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password`;
- protected bootstrap route делает `GET /auth/me` и не доверяет только local storage;
- при `email not verified` UI не пропускает пользователя в app shell, а показывает dedicated state с resend;
- при невалидном или истекшем invite/reset/verify token UI должен показывать не generic error, а понятный сценарий восстановления.

## 9. Модель данных (PostgreSQL)

### `users`

- `id UUID PK`
- `email CITEXT NOT NULL UNIQUE`
- `phone VARCHAR(32) NOT NULL UNIQUE`
- `password_hash TEXT NOT NULL`
- `status ENUM(pending_verification, active, locked, deleted) NOT NULL`
- `email_verified_at TIMESTAMPTZ NULL`
- `phone_verified_at TIMESTAMPTZ NULL`
- `last_login_at TIMESTAMPTZ NULL`
- `created_at`, `updated_at`

### `auth_identities`

- `id UUID PK`
- `user_id UUID FK`
- `provider ENUM(local, google, yandex, sms) NOT NULL`
- `provider_subject VARCHAR(255) NULL`
- `is_primary BOOLEAN DEFAULT false`
- `created_at`, `updated_at`
- `UNIQUE(provider, provider_subject)` для внешних провайдеров

### `email_verification_challenges`

- `id UUID PK`
- `user_id UUID FK`
- `email_snapshot CITEXT NOT NULL`
- `token_hash TEXT NOT NULL UNIQUE`
- `status ENUM(pending, used, expired, cancelled) NOT NULL`
- `expires_at TIMESTAMPTZ NOT NULL`
- `used_at TIMESTAMPTZ NULL`
- `created_at`, `updated_at`

### `password_reset_challenges`

- `id UUID PK`
- `user_id UUID FK`
- `token_hash TEXT NOT NULL UNIQUE`
- `status ENUM(pending, used, expired, cancelled) NOT NULL`
- `expires_at TIMESTAMPTZ NOT NULL`
- `used_at TIMESTAMPTZ NULL`
- `created_at`, `updated_at`

### `auth_sessions`

- `id UUID PK`
- `user_id UUID FK`
- `refresh_token_hash TEXT NOT NULL UNIQUE`
- `status ENUM(active, rotated, revoked, expired, compromised) NOT NULL`
- `ip INET NULL`
- `user_agent TEXT NULL`
- `last_seen_at TIMESTAMPTZ NULL`
- `expires_at TIMESTAMPTZ NOT NULL`
- `revoked_at TIMESTAMPTZ NULL`
- `revoke_reason VARCHAR(64) NULL`
- `created_at`, `updated_at`

### `user_preferences`

- `user_id UUID PK`
- `last_used_tenant_id UUID NULL`
- `locale VARCHAR(16) NULL`
- `timezone VARCHAR(64) NULL`
- `updated_at TIMESTAMPTZ NOT NULL`

### Индексы и ограничения

- уникальность `email` и `phone` должна применяться к нормализованным значениям;
- одновременно активных verification/reset challenges для одного user может быть несколько, но только один должен считаться текущим по business policy;
- `auth_sessions(user_id, status)` индекс обязателен для массовой invalidation.

## 10. Контракт token/session модели

### Access token

- transport: `httpOnly secure sameSite` cookie либо bearer-only на внутренних вызовах gateway;
- TTL: `15 минут` по BRD;
- содержит `sub`, `sessionId`, `activeTenantId`, `membershipVersion` или эквивалентный version marker.

### Refresh session

- transport: отдельный `httpOnly secure sameSite` cookie;
- TTL: `7 дней` по BRD;
- хранится как hash в `auth_sessions`;
- при каждом `refresh` происходит rotation refresh token;
- reuse старого refresh token переводит session в `COMPROMISED` и ревокает цепочку.

### Cookie policy для web

- `Secure=true`;
- `HttpOnly=true`;
- `SameSite=Lax` по умолчанию, если нет cross-site auth сценариев;
- CSRF protection обязательна для state-changing cookie-auth endpoints.

## 11. Алгоритмы и runtime flow

### Регистрация

1. Нормализовать `email` в lower-case canonical form.
2. Нормализовать `phone` в E.164.
3. Проверить уникальность и rate limit.
4. Захешировать пароль `Argon2id` или эквивалент.
5. Создать `user`, `auth_identity(local)` и verification challenge.
6. Записать outbox event на отправку email.

### Login

1. Поиск пользователя по нормализованному email.
2. Если user не найден, ответ должен оставаться нейтральным по времени и формулировке.
3. Проверка password hash.
4. Проверка `user.status`, `email_verified_at`, `lock` policy.
5. Создание новой `auth_session`.
6. Вычисление `postLoginAction` на основе memberships и `last_used_tenant_id`.

### Refresh

1. Прочитать refresh cookie.
2. Найти session по hash и проверить `status/expires_at`.
3. Выполнить atomic rotation refresh token.
4. Перевыпустить access token.
5. Обновить `last_seen_at`.

### Logout

1. Текущая session переводится в `REVOKED`.
2. Access/refresh cookies очищаются.
3. В audit пишется `auth_logout`.

### Change password

1. Проверить текущий password.
2. Сохранить новый password hash.
3. Ревокнуть все остальные active sessions пользователя.
4. Текущую сессию либо переиздать, либо оставить единственной активной.
5. Отправить security notification.

### Reset password

1. Запрос всегда отвечает нейтрально, даже если email не найден.
2. При существующем user создается reset challenge и email job.
3. По confirm challenge помечается `USED`.
4. Меняется password hash.
5. Все active sessions, кроме текущей отсутствующей public reset session, ревокаются.

### Переключение active tenant

1. Проверить наличие active membership у user в указанном tenant.
2. Обновить `user_preferences.last_used_tenant_id`.
3. Выпустить новый access token с новым tenant context.
4. Обновить app bootstrap state на frontend.

## 12. Приглашения и связка с auth

### Правила accept invite

- invite email должен совпадать с verified email пользователя;
- если user залогинен под другим email, accept invite должен быть запрещен с явным сообщением;
- если invite истек, auth не создает membership и предлагает запросить новый invite;
- если invite уже использован, пользователь видит нейтральный экран с состоянием membership, если оно уже создано.

### Почему это важно

- иначе возможен захват invite через другой account;
- иначе возникают дубли membership и спорные owner/admin права;
- email verification становится обязательной частью trust chain invite flow.

## 13. Валидации, ограничения и anti-abuse

### Валидации

- email format и phone format валидируются на backend, frontend only помогает UX;
- password policy MVP: минимум длина, сложность, запрет очевидных слабых паролей;
- `register/login/reset/resend` должны быть защищены rate limiting и IP/device fingerprint heuristics;
- verification/reset token одноразовые и ограничены TTL.

### Рекомендуемые лимиты

- resend verification cooldown: `60 секунд`;
- resend verification: `3` попытки в `1 час`;
- verification link TTL: `24 часа`;
- unverified account retention: `30 дней`;
- reset password TTL: `24 часа`;
- login rate limit: по IP и normalized email key;
- soft-lock после `5` подряд неуспешных попыток login для пары `normalized_email + IP` на `15 минут`;
- повторные попытки во время soft-lock не должны удлинять lock бесконечно без отдельной policy.

### Дополнительные safeguards, которых не было явно в BRD

- счетчик неудачных login попыток и временный soft-lock обязателен;
- защита от user enumeration в `login`, `forgot password`, `resend`;
- обязательная ротация refresh token;
- фиксация reuse/compromise refresh session;
- CAPTCHA не входит в MVP, базовая защита строится на rate limiting и soft-lock policy;
- security events в audit и notification channel.

## 14. Ошибки и пользовательские состояния

| Код | Когда возвращается | Комментарий |
|-----|--------------------|-------------|
| `AUTH_INVALID_CREDENTIALS` | Неверный email/password | Сообщение нейтральное |
| `AUTH_EMAIL_NOT_VERIFIED` | Попытка login без email verification | Вернуть `nextAction=VERIFY_EMAIL` |
| `AUTH_ACCOUNT_LOCKED` | Временная или ручная блокировка | Не раскрывать лишние причины, для soft-lock вернуть время повторной попытки без деталей о существовании account |
| `AUTH_VERIFICATION_TOKEN_EXPIRED` | Просроченная verification link | Разрешить resend |
| `AUTH_VERIFICATION_TOKEN_USED` | Повторное открытие уже использованной ссылки | Нейтральный success-like screen |
| `AUTH_RESET_TOKEN_EXPIRED` | Просроченный reset token | Предложить новый reset |
| `AUTH_SESSION_EXPIRED` | Нет валидной session | Клиент идет на re-auth |
| `AUTH_TENANT_ACCESS_DENIED` | Нет membership в выбранном tenant | Открыть tenant picker |
| `AUTH_INVITE_EMAIL_MISMATCH` | Invite не соответствует account email | Блокировать accept |

## 15. Security требования

- password хранится только как strong adaptive hash;
- raw tokens не пишутся в logs, audit payload и tracing;
- refresh rotation должна быть atomic и устойчивой к race condition из двух вкладок;
- любые state-changing auth endpoints требуют CSRF protection, если используют cookie auth;
- private endpoints не доверяют `tenantId` из body/query, tenant context берется из session/token;
- security-sensitive операции должны писать audit trail c `actor_user_id`, `session_id`, `ip`, `user_agent`.
- `logout-all` должен быть доступен в MVP как отдельный пользовательский action и должен отзывать все сессии пользователя серверно.

## 16. Async процессы и события

### Доменные события

- `auth_user_registered`
- `auth_email_verification_requested`
- `auth_email_verified`
- `auth_login_succeeded`
- `auth_login_failed`
- `auth_password_reset_requested`
- `auth_password_reset_completed`
- `auth_password_changed`
- `auth_session_revoked`
- `auth_refresh_token_reuse_detected`
- `auth_active_tenant_changed`

### Async owner и обработка

| Процесс | Owner | Retry strategy | Observability |
|---------|-------|----------------|---------------|
| Отправка verification email | Notifications worker | exponential backoff, max 5 | delivery rate, retry count, dead-letter |
| Отправка reset email | Notifications worker | exponential backoff, max 5 | delivery rate, expired-before-open |
| Очистка просроченных challenge | Auth scheduled job | hourly retry on failure | cleanup duration, rows processed |
| Очистка unverified accounts | Auth scheduled job | daily retry on failure | deleted accounts count |
| Истечение auth sessions | DB TTL query / cron | frequent retry | active vs expired sessions |

## 17. Тестовая матрица

- Регистрация нового пользователя с валидными данными.
- Повторная регистрация на уже существующий `email`.
- Login до подтверждения email.
- Успешное подтверждение email.
- Повторное открытие уже использованной verification link.
- Просроченная verification link и resend flow.
- Forgot password для существующего и несуществующего email.
- Reset password с инвалидированием остальных сессий.
- Change password из профиля.
- Refresh token rotation из одной вкладки.
- Параллельный refresh из двух вкладок и reuse detection.
- Login пользователя без tenant.
- Login пользователя с одним tenant.
- Login пользователя с несколькими tenant и недоступным `last_used_tenant_id`.
- Accept invite существующим и новым пользователем.
- Попытка принять invite под другим email.
- Logout current session и logout all sessions.

## 18. Нефункциональные требования и SLA

- `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me` должны укладываться в `p95 < 300 мс`, без учета внешней отправки email;
- email dispatch не блокирует response path и работает через outbox/job;
- invalidation all sessions должна становиться эффективной для новых запросов не позже чем через `60 секунд`, а в идеале мгновенно на backend check;
- auth модуль должен быть idempotent на повторных кликах пользователя и устойчив к refresh race conditions;
- все timestamps хранятся в UTC ISO-8601.

## 19. Observability, логи и алерты

- метрики: `registrations_total`, `email_verification_sent`, `email_verification_success_rate`, `login_success_total`, `login_fail_total`, `password_reset_requested`, `password_reset_completed`, `active_sessions`, `refresh_reuse_detected`, `tenant_switch_total`;
- логи: auth state transitions, token challenge lifecycle, session revocation reasons, invite-email mismatch;
- алерты: всплеск login failures, массовое истечение verification link без confirm, refresh reuse incidents, рост resend volume, неуспешные email dispatch jobs;
- dashboards: registration funnel, verify funnel, login health, password reset funnel, active sessions by age.

## 20. Риски реализации и архитектурные замечания

- если `activeTenantId` будет жить только на клиенте, появятся inconsistent permissions и ошибки при refresh/bootstrap;
- без refresh token rotation нельзя надежно детектировать кражу cookie/session;
- без нейтральных ответов на public auth endpoints система начнет раскрывать существование email в базе;
- invite acceptance без жесткой связки с verified email создаст уязвимость на захват membership;
- массовая invalidation сессий должна быть реализована через DB-backed session store, а не только через stateless JWT, иначе `change password` и `logout all` станут недостоверными.

## 21. Открытые вопросы к продукту и архитектуре

- На текущий момент открытых продуктовых вопросов по MVP auth не осталось.

## 22. Подтвержденные продуктовые решения

- login до подтверждения email запрещен полностью, ограниченный режим не используется;
- TTL reset password link для MVP: `24 часа`;
- `logout-all` входит в MVP как отдельная пользовательская функция;
- pending invite после успешной регистрации и email verification привязывается автоматически;
- soft-lock обязателен: `5` подряд неуспешных login attempts для пары `normalized_email + IP`, блокировка на `15 минут`.
- CAPTCHA в MVP не используется, защита строится на rate limiting и soft-lock.
- изменение email/phone не поддерживается в MVP ни через self-service, ни через support-only flow.

## 23. Фазы внедрения

1. ~~База: `users`, challenges, `auth_sessions`, `user_preferences`, базовые public endpoints.~~ ✅ **Выполнено в T1-01 (2026-04-25)**
2. Email verification + forgot/reset password + outbox email delivery. ← T1-02, T1-04
3. Cookie session model, refresh rotation, `GET /auth/me`, logout/logout-all. ← T1-03
4. Active tenant switching и post-login routing. ← T1-07
5. Security hardening: rate limits, soft-lock, reuse detection, audit/alerts. ← T1-05
6. Future-ready identity layer для `sms/google/yandex`. ← Backlog

## 24. Чеклист готовности раздела

- [x] Текущее и целевое состояние раздела зафиксированы.
- [x] Backend API, frontend поведение и модель данных согласованы между собой.
- [x] Session model, token lifecycle и security controls описаны.
- [x] Async-процессы, observability и тестовая матрица описаны.
- [x] Стыки с tenant, team invite и onboarding не противоречат друг другу.
- [x] Открытые продуктовые решения выделены отдельно.

## 24.1 Чеклист реализации (по задачам)

- [x] T1-01: Auth data model — схема БД, миграция, code references
- [x] T1-02: Register + verify email flow
- [x] T1-03: Login / logout / me / session lifecycle
- [x] T1-04: Forgot / reset / change password
- [x] T1-05: Rate limiting, soft-lock, audit events
- [x] T1-06: Frontend auth flows (login, register, verify-email, forgot/reset-password, post-login routing)
- [x] T1-07 (QA): Regression unit-tests — 54 теста на auth.service (register/verify/login/soft-lock/refresh/logout/reset/change-password + observability)
- [ ] T1-07: Tenant bootstrap после auth (02-tenant)
- [ ] T1-07: Tenant switch и trusted tenant context
- [x] T1-20: Register / login / verify UI — покрыто T1-06
- [x] T1-21: Forgot / reset password UI — покрыто T1-06
- [x] T1-22: Post-login redirect logic — покрыто T1-06
- [ ] T1-07: JWT payload — добавить `activeTenantId` и `membershipVersion` в токен (gap, см. TASK_AUTH_3.md)
- [ ] T1-30: Async email delivery настроен
- [ ] T1-40: Auth happy-path e2e тесты
- [ ] T1-41: Tenant entry и isolation regression тесты

## 25. История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-04-18 | Создана системная аналитика для модуля auth и зафиксированы открытые вопросы | Codex |
| 2026-04-18 | Зафиксированы продуктовые решения по verify policy, reset TTL, logout-all, invite auto-linking и soft-lock policy | Codex |
| 2026-04-18 | Закрыты оставшиеся MVP-вопросы по CAPTCHA и change email/phone policy | Codex |
| 2026-04-25 | T1-03 выполнен: server-side AuthSession, refresh rotation, reuse/COMPROMISED detection, logout/logout-all, GET /auth/me с routing hint | Claude |
| 2026-04-25 | T1-01 выполнен: обновлена схема БД (AuthSession, EmailVerificationChallenge, PasswordResetChallenge, UserPreference, AuthIdentity, расширен User), создана миграция, обновлены code references. Добавлен чеклист реализации 24.1 | Claude |
| 2026-04-25 | T1-02 выполнен: register (PENDING_VERIFICATION + AuthIdentity), verifyEmail (SHA-256 token, lifecycle), resendVerification (cooldown 60s + 3/h), login-блокировка по status, EmailService stub | Claude |
| 2026-04-25 | T1-04 выполнен: forgot/reset/change-password endpoints, SHA-256 reset token TTL 24ч, neutral response без enumeration, revoke сессий после reset/change. Аудит MVP: добавлен rate limit на forgotPassword (60s + 3/h) и same-password check в changePassword (`AUTH_NEW_PASSWORD_SAME_AS_CURRENT`) | Claude |
| 2026-04-25 | T1-05 выполнен: LoginAttempt модель + миграция, soft-lock (5 попыток / 15 мин по email+IP, скользящее окно), timing-attack fix в validateUser (bcrypt всегда выполняется), структурированные audit events (11 событий) через NestJS Logger, IP пробрасывается во все auth-методы контроллера | Claude |
| 2026-04-25 | T1-06 выполнен: AuthContext рефакторинг (AuthUser тип, nextRoute, Telegram fix), Login (error codes, soft-lock state, verify-email state, forgot-password link, post-login routing), Register (убран storeName, pending-verification state, min 8 символов), новые страницы VerifyEmail / ForgotPassword / ResetPassword, маршруты в App.tsx | Claude |
| 2026-04-25 | T1-07 (QA/Regression) выполнен: auth.service.spec.ts — 54 unit-теста (0.5 с). Покрыты: register, verifyEmail, resendVerification, validateUser (soft-lock, timing-protection, verify-blocked, locked/deleted), loginUser, refreshSession (rotation + reuse/COMPROMISED), logout/logout-all, getMe (routing hint), forgotPassword/resetPassword/changePassword. Отдельная группа observability верифицирует эмиссию 10 критических audit-событий через Logger spy. bcrypt замокан для скорости, $transaction поддерживает оба режима (callback + array). | Claude |
| 2026-04-26 | Hotfixes: исправлен баг getMe (множественные tenant без lastUsed → /tenant-picker вместо /app), refresh cookie TTL приведён к 7 дням согласно аналитике (был 30 дней), зафиксирован gap JWT payload (activeTenantId/membershipVersion отсутствуют), T1-20/21/22 закрыты как покрытые T1-06 | Claude |
