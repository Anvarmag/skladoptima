# TASK_AUTH_4 — Forgot, Reset и Change Password

> Модуль: `01-auth`
> Статус: [x] Выполнено

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_AUTH_1`
  - email delivery для reset-писем
- Что нужно сделать:
  - реализовать `forgot-password` с нейтральным ответом;
  - реализовать reset flow по одноразовому токену с TTL `24 часа`;
  - реализовать `change-password` для авторизованного пользователя;
  - отзывать другие сессии после смены пароля по server-side policy;
  - закрыть состояния expired, used, invalid token без account enumeration.
- Критерий закрытия:
  - пароль можно безопасно восстановить и сменить;
  - reset token одноразовый и неиспользуемый повторно;
  - другие сессии корректно отзываются после password change/reset.

**Что сделано**

Реализован полный forgot / reset / change-password flow в `auth` модуле.

### 1. Новые DTOs (`apps/api/src/modules/auth/dto/`)

- **`forgot-password.dto.ts`** — поле `email` с `@IsEmail()` валидацией.
- **`reset-password.dto.ts`** — поля `token` (`@IsString @IsNotEmpty`) и `newPassword` (`@MinLength(8)`).
- **`change-password.dto.ts`** — поля `currentPassword` и `newPassword` (`@MinLength(8)`).

### 2. Сервисные методы (`auth.service.ts`)

Добавлена константа `RESET_TOKEN_TTL_MS = 24 * 60 * 60 * 1000` (24 часа).

**`forgotPassword(email)`**
- Нормализует email, ищет пользователя.
- Всегда возвращает `{ sent: true }` — нейтральный ответ без account enumeration (несуществующий email, удалённый аккаунт и успех — один и тот же ответ).
- Отменяет (`CANCELLED`) все предыдущие `PENDING` reset challenges пользователя перед созданием нового.
- Создаёт `PasswordResetChallenge` с хешем токена и вызывает `emailService.sendPasswordResetEmail()`.

**`resetPassword(rawToken, newPassword)`**
- Хеширует входящий токен и ищет challenge по хешу.
- Состояния `NOT_FOUND`, `USED`, `CANCELLED` → один код `AUTH_RESET_TOKEN_INVALID` (нет account enumeration).
- Состояние `EXPIRED` или `expiresAt < now` → код `AUTH_RESET_TOKEN_EXPIRED`; обновляет статус challenge в `EXPIRED`.
- При успехе в одной транзакции:
  1. Помечает challenge `USED` + проставляет `usedAt`.
  2. Обновляет `passwordHash` пользователя (bcrypt 12 rounds).
  3. Отзывает все `ACTIVE` сессии пользователя (`REVOKED`, reason `PASSWORD_RESET`).

**`changePassword(userId, sessionId, currentPassword, newPassword)`**
- Загружает пользователя, сравнивает `currentPassword` с `passwordHash` через bcrypt.
- Неверный пароль → `AUTH_INVALID_CURRENT_PASSWORD`.
- При успехе в одной транзакции:
  1. Обновляет `passwordHash`.
  2. Отзывает все `ACTIVE` сессии **кроме текущей** (`id: { not: sessionId }`) — пользователь остаётся залогиненным, другие устройства выбиваются. Reason: `PASSWORD_CHANGE`.

**Приватный хелпер `createAndSendResetChallenge(userId, email)`**
- Генерирует 32-байтовый случайный токен (`crypto.randomBytes`), хранит только его SHA-256 хеш.
- Создаёт `PasswordResetChallenge` с TTL 24 часа.
- Отправляет email через `emailService.sendPasswordResetEmail()`.

### 3. Новые endpoints (`auth.controller.ts`)

| Метод | Endpoint | Auth | Описание |
|-------|----------|------|----------|
| `POST` | `/auth/password-resets` | Public | forgot-password — нейтральный ответ |
| `POST` | `/auth/password-resets/confirm` | Public | reset по одноразовому токену; сбрасывает auth cookies |
| `POST` | `/auth/change-password` | User (JWT) | смена пароля из профиля; текущая сессия сохраняется |

`POST /auth/password-resets/confirm` дополнительно очищает `Authentication` и `Refresh` cookies через `clearAuthCookies()` — после сброса пароля пользователь должен войти заново.

### 4. Безопасность

- Токены не хранятся в plaintext — только SHA-256 хеш.
- TTL = 24 часа, одноразовость гарантируется статусом `USED`.
- `forgotPassword` не позволяет определить, зарегистрирован ли email.
- Все expired/used/invalid состояния mapped к единому коду без излишних деталей.
- После `resetPassword` — все сессии отозваны.
- После `changePassword` — все сессии кроме текущей отозваны.

### 5. Дополнительные улучшения по итогам аудита MVP

- **Rate limiting на `forgotPassword`** — добавлены константы `RESET_RESEND_COOLDOWN_MS = 60_000` и `RESET_HOURLY_LIMIT = 3`. Cooldown 60 секунд между запросами на один аккаунт + лимит 3 запроса в час. При превышении ответ остаётся нейтральным (`{ sent: true }`) — чтобы не раскрывать наличие аккаунта и факт rate limit. Защищает email-адрес жертвы от спама reset-письмами. По аналогии с `resendVerification` (T1-02).
- **Same-password check в `changePassword`** — после успешной проверки `currentPassword` дополнительно сверяем `newPassword` с текущим хешем через `bcrypt.compare`. Если совпадает — `BadRequestException { code: 'AUTH_NEW_PASSWORD_SAME_AS_CURRENT' }`. Не позволяет «сменить» пароль на тот же.

### 6. Проверки

- `tsc --noEmit` — 0 ошибок после всех правок.
- Покрытые состояния: not-found / used / cancelled / expired / valid challenge; правильный пароль / неправильный / совпадает с текущим; revoke сессий после reset (все ACTIVE) и change (все ACTIVE кроме текущей).

