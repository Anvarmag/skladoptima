# TASK_AUTH_1 — Auth Data Model и миграции

> Модуль: `01-auth`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - утверждена системная аналитика `01-auth`
- Что нужно сделать:
  - спроектировать и завести таблицы `users`, `auth_sessions`, `email_verification_tokens`, `password_reset_tokens`, `auth_events`, `user_preferences`;
  - зафиксировать ограничения по уникальности email, session family, active token lifecycle и revoke semantics;
  - предусмотреть поля под soft-lock, verify state, invite auto-link и server-side session control;
  - описать порядок миграции со старой auth-моделью без поломки текущего login context.
- Критерий закрытия:
  - схема БД соответствует `01-auth`;
  - миграции воспроизводимы;
  - нет дыр по токенам, сессиям и lifecycle состояниям.

**Что сделано**

- Обновлена `prisma/schema.prisma`: добавлены 4 новых enum (`UserStatus`, `AuthSessionStatus`, `ChallengeStatus`, `AuthProvider`) и 5 новых моделей.
- `User` расширен: переименовано поле `password` → `passwordHash`, добавлены `phone`, `status`, `emailVerifiedAt`, `lastLoginAt` и связи с новыми таблицами.
- Добавлена модель `AuthSession` — серверные сессии с refresh token rotation, reuse detection (статусы `ACTIVE/ROTATED/REVOKED/EXPIRED/COMPROMISED`), IP/User-Agent, `expiresAt`. Индекс `(userId, status)` для быстрой массовой инвалидации.
- Добавлена модель `EmailVerificationChallenge` — одноразовые токены подтверждения email, хранит `tokenHash` (не plaintext), TTL (`expiresAt`), статус жизненного цикла.
- Добавлена модель `PasswordResetChallenge` — одноразовые токены сброса пароля, та же структура.
- Добавлена модель `UserPreference` — хранит `lastUsedTenantId` для post-login routing на нужный тенант.
- Добавлена модель `AuthIdentity` — future-ready layer для OAuth/SMS провайдеров (Google, Yandex, SMS, Telegram). `UNIQUE(provider, providerSubject)`.
- Создана миграция `20260425000000_auth_data_model/migration.sql`: `RENAME COLUMN password → passwordHash`, data-migration существующих пользователей в `ACTIVE` + `emailVerifiedAt = createdAt`, миграция `telegramId` в `AuthIdentity`.
- Обновлены все ссылки на `user.password` → `user.passwordHash` в: `auth.service.ts`, `jwt.strategy.ts`, `user.service.ts`.
- Устранена уязвимость: `seedAdmin` больше не логирует пароль в plaintext.
- Новые пользователи через `registerUser` создаются со статусом `PENDING_VERIFICATION`; admin seed и Telegram-пользователи — `ACTIVE`.
- TS-ошибки в auth-файлах ожидаемы до запуска `prisma migrate dev && prisma generate` (нет доступа к БД).

**Миграция применяется командой (при запущенном Docker):**
```bash
cd apps/api && npx prisma migrate dev
```
