# Авторизация — Системная аналитика (Dev Spec)

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

## 1. Назначение

Модуль отвечает за регистрацию, подтверждение email, вход/выход, восстановление пароля, управление сессиями и выдачу контекста пользователя (`userId`, `tenantId`, `membershipId`, `role`).

## 2. Функциональный контур и границы

### Что входит в модуль
- регистрация локальной учетной записи;
- подтверждение email и контроль допуска к login-flow;
- выдача и отзыв пользовательских сессий;
- восстановление и смена пароля;
- базовый security telemetry слой для auth-событий.

### Что не входит в модуль
- управление tenant membership и ролями;
- биллинг, тарифы и доступ tenant;
- пользовательский профиль, настройки интерфейса и бизнес-данные;
- внешняя SSO-экосистема, если она не входит в MVP.

### Главный результат работы модуля
- система однозначно знает, кто пользователь, прошел ли он verification, какие у него активные сессии и какой auth-context можно безопасно передавать в другие модули.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Гость | Регистрируется, логинится, запрашивает reset | Не имеет доступа к приватным API |
| Авторизованный пользователь | Меняет пароль, завершает свои сессии, читает `me` | Не управляет чужими сессиями |
| Email provider | Доставляет verification/reset письма | Асинхронная зависимость, не участвует в бизнес-решении |
| Security/Support | Анализирует auth-инциденты | Не должен видеть password/token values |

## 4. Базовые сценарии использования

### Сценарий 1. Регистрация нового пользователя
1. Клиент отправляет email/phone/password.
2. Backend валидирует уникальность и политику пароля.
3. Создается пользователь в статусе `active`, но без `email_verified_at`.
4. Генерируется одноразовый verification token.
5. Email уходит асинхронно, клиент получает нейтральный успешный ответ.

### Сценарий 2. Login verified пользователя
1. Пользователь передает email/password.
2. Backend проверяет hash пароля и статус аккаунта.
3. Если email не подтвержден, логин не завершается выдачей сессии.
4. При успехе создается `auth_session`, клиент получает access + refresh.
5. Security event фиксируется независимо от результата.

### Сценарий 3. Сброс пароля
1. Пользователь инициирует forgot-password по email.
2. Backend всегда отвечает нейтрально, чтобы не раскрывать существование учетной записи.
3. Для существующего пользователя создается reset token с TTL.
4. После успешного reset обновляется password hash.
5. Все остальные активные сессии отзываются.

## 5. Зависимости и интеграции

- Email provider (verification, reset, invite)
- JWT provider
- Rate limit layer (login/reset/resend)
- Audit module (security events)
- Tenant module (первичный вход без компании и выбор компании)

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `POST` | `/api/v1/auth/register` | Public | Регистрация пользователя |
| `POST` | `/api/v1/auth/verify-email` | Public | Подтверждение email по токену |
| `POST` | `/api/v1/auth/resend-verification` | Public | Повторная отправка verification |
| `POST` | `/api/v1/auth/login` | Public | Вход по email/password |
| `POST` | `/api/v1/auth/logout` | User | Выход из текущей сессии |
| `GET` | `/api/v1/auth/me` | User | Текущий профиль и доступные tenant |
| `POST` | `/api/v1/auth/password/forgot` | Public | Запрос ссылки сброса |
| `POST` | `/api/v1/auth/password/reset` | Public | Сброс пароля по токену |
| `POST` | `/api/v1/auth/password/change` | User | Смена пароля (revoke остальных сессий) |
| `GET` | `/api/v1/auth/sessions` | User | Список активных сессий |

## 7. Примеры вызова API

### Регистрация

```bash
curl -X POST /api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@demo.ru","phone":"+79990000000","password":"StrongPass123!"}'
```

```json
{
  "userId": "usr_...",
  "emailVerificationRequired": true,
  "nextStep": "verify_email"
}
```

### Логин

```bash
curl -X POST /api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@demo.ru","password":"StrongPass123!"}'
```

```json
{
  "accessToken": "jwt...",
  "refreshToken": "rft...",
  "expiresInSec": 900,
  "user": { "id": "usr_...", "email": "user@demo.ru" },
  "memberships": []
}
```

## 8. Модель данных (PostgreSQL)

### `users`
- `id UUID PK`
- `email VARCHAR(255) UNIQUE NOT NULL`
- `phone VARCHAR(32) UNIQUE NULL`
- `password_hash TEXT NOT NULL`
- `email_verified_at TIMESTAMPTZ NULL`
- `status ENUM(active, blocked, deleted)`
- `last_login_at TIMESTAMPTZ NULL`
- `created_at`, `updated_at`, `deleted_at`

### `auth_identities`
- `id UUID PK`
- `user_id UUID FK users(id)`
- `provider ENUM(local, telegram, google, yandex, sms)`
- `provider_uid TEXT NULL`
- `created_at`
- `UNIQUE(provider, provider_uid)`

### `auth_sessions`
- `id UUID PK`
- `user_id UUID FK`
- `refresh_token_hash TEXT NOT NULL`
- `ip INET`, `user_agent TEXT`
- `expires_at TIMESTAMPTZ NOT NULL`
- `revoked_at TIMESTAMPTZ NULL`
- `created_at`
- Индексы: `(user_id, revoked_at)`, `(expires_at)`

### `email_verification_tokens`
- `id UUID PK`, `user_id UUID FK`, `token_hash TEXT`, `expires_at`, `used_at`, `created_at`

### `password_reset_tokens`
- `id UUID PK`, `user_id UUID FK`, `token_hash TEXT`, `expires_at`, `used_at`, `created_at`

### `auth_events`
- `id UUID PK`, `user_id UUID NULL`, `event_type`, `source_ip`, `metadata JSONB`, `created_at`

## 9. Сценарии и алгоритмы (step-by-step)

1. `register`: создать `users` (неверифицирован), создать `auth_identity(local)`, создать verification token, отправить email.
2. `verify-email`: проверить токен (hash + TTL + not used), выставить `email_verified_at`, пометить токен `used_at`.
3. `login`: валидация credentials + verify status, создать `auth_session`, выдать access/refresh.
4. `change-password`: проверить текущий пароль, обновить hash, отозвать все сессии кроме текущей.
5. `forgot/reset`: нейтральный ответ на forgot, reset по токену с одноразовостью.
6. Каждое security-действие пишет запись в `auth_events`.

## 10. Валидации и ошибки

- Email — RFC формат, lower-case normalize.
- Password — min 8, upper/lower/digit/special.
- `resend-verification` — cooldown 60 сек, max 3/час.
- Ошибки:
  - `CONFLICT: EMAIL_ALREADY_EXISTS`
  - `FORBIDDEN: EMAIL_NOT_VERIFIED`
  - `UNAUTHORIZED: INVALID_CREDENTIALS`
  - `CONFLICT: TOKEN_EXPIRED_OR_USED`
  - `RATE_LIMITED: TOO_MANY_ATTEMPTS`

## 11. Чеклист реализации

- [ ] Миграции для auth-таблиц.
- [ ] JWT + refresh-session стратегия.
- [ ] Email verification/reset flows.
- [ ] Rate limiting на login/reset/resend.
- [ ] Полная audit/security телеметрия.
- [ ] Интеграционные тесты позитивных и edge-сценариев.

## 12. Критерии готовности (DoD)

- Все must-have сценарии из BRD закрыты.
- Успешно проходят e2e: register -> verify -> login -> reset/change.
- Сессии отзываются корректно при смене пароля.
- Нет доступа к приватным маршрутам без JWT.

## 13. RBAC и claims JWT

### Обязательные claims access token
- `sub` — `user_id`
- `tenantId` — активный tenant пользователя
- `membershipId` — активная membership в tenant
- `role` — роль в активном tenant
- `sessionId` — идентификатор текущей auth session
- `iat`, `exp`

### Правила доступа
- Public endpoints: `register`, `verify-email`, `resend-verification`, `login`, `forgot`, `reset`.
- User endpoints: `logout`, `me`, `change-password`, `sessions`.
- Любой tenant-scoped endpoint в системе доверяет только `tenantId` из JWT claims.

## 14. Lifecycle и TTL

### Access token
- TTL: `15 минут`
- Используется для авторизации API
- Не хранится в БД

### Refresh session
- TTL: `7 дней`
- Хранится в `auth_sessions`
- Обновляется только через отдельный refresh-flow

### Verification token
- TTL: `24 часа`
- Одноразовый
- После использования выставляется `used_at`

### Password reset token
- TTL: `30-60 минут`
- Одноразовый
- После успешного reset все прочие сессии пользователя отзываются

## 15. Async процессы и внутренние события

### Outbox/внутренние события
- `user_registered`
- `email_verification_requested`
- `email_verified`
- `login_succeeded`
- `login_failed`
- `password_reset_requested`
- `password_changed`
- `sessions_revoked`

### Какие процессы должны выполняться асинхронно
- отправка verification email
- отправка reset email
- cleanup просроченных verification/reset tokens
- cleanup неподтвержденных аккаунтов старше retention policy

## 16. Тестовая матрица

- Регистрация нового пользователя с валидными данными.
- Повторная регистрация с тем же email.
- Логин до подтверждения email.
- Повторное открытие уже использованной verification ссылки.
- Истекший verification token.
- Forgot password для существующего и несуществующего email.
- Смена пароля с отзывом других сессий.
- Доступ к `GET /me` по отозванной сессии.

## 17. Фазы внедрения

1. База: `users`, `auth_sessions`, verification/reset tokens, security events.
2. Auth API: register, login, logout, me.
3. Email flows: verify, resend, forgot, reset.
4. Session hardening: revoke, refresh, multi-session control.
5. Anti-abuse: rate limits, neutral responses, audit/security monitoring.

## 18. Нефункциональные требования и SLA

- `POST /register`, `POST /login`, `POST /password/*` должны отвечать быстро: целевой `p95 < 500 мс`, не считая асинхронной доставки email.
- Отзыв сессий после смены пароля должен вступать в силу не позже чем через `60 сек` для всех refresh-based потоков.
- Токены в базе хранятся только в hash-виде; логирование plaintext token запрещено.
- Auth API должен быть доступен даже при деградации email provider, кроме сценариев, где доставка письма обязательна для следующего шага пользователя.

## 19. Observability, логи и алерты

- Метрики: `login_success_rate`, `login_failed_rate`, `verification_send_failures`, `password_reset_requests`, `rate_limit_hits`, `active_sessions_count`.
- Логи: security logs с `request_id`, `user_id`, `email fingerprint`, `ip`, `user_agent`, `failure reason`.
- Алерты: всплеск invalid credentials, массовые resend/reset, отказ email provider, рост revoked-session reuse.
- Dashboards: auth funnel, security anomaly board, session health board.

## 20. Риски реализации и архитектурные замечания

- Главный риск: смешать auth-контекст и tenant/RBAC-контекст слишком рано и потерять ясную границу ответственности.
- Нужно сразу проектировать refresh/session revoke как server-side контролируемую модель, иначе потом будет сложно закрыть security gaps.
- Ответы `forgot-password` и часть verification-flow должны быть intentionally neutral, иначе возникнет user enumeration.
- Любые будущие social login/SSO нужно подключать через `auth_identities`, а не переписывать базовую модель пользователя.
