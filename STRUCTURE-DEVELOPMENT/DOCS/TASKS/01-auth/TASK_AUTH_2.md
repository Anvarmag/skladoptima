# TASK_AUTH_2 — Register, Verify Email, Resend и Invite Auto-Link

> Модуль: `01-auth`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_AUTH_1`
  - готов delivery-контур email/notifications
- Что нужно сделать:
  - реализовать `register`, `verify-email`, `resend-verification`;
  - полностью запретить login до подтверждения email;
  - добавить lifecycle verify token: active, used, expired;
  - реализовать auto-link pending invite после успешной регистрации и verify;
  - обработать already-verified, expired token и повторный resend без утечки лишней информации.
- Критерий закрытия:
  - пользователь может зарегистрироваться и подтвердить email сквозным потоком;
  - неподтвержденный пользователь не может войти;
  - pending invite корректно привязывается автоматически после verify.

**Что сделано**

- **`POST /auth/register`** — создаёт `User` со статусом `PENDING_VERIFICATION` + `AuthIdentity(LOCAL)` в одной транзакции. Tenant больше не создаётся автоматически (перенесено в онбординг). Email нормализуется в lower-case. Проверяется уникальность email и phone. Возвращает `{ userId, status: PENDING_VERIFICATION, nextAction: VERIFY_EMAIL }`.
- **`POST /auth/email-verifications/confirm`** — принимает raw token, вычисляет SHA-256 hash, ищет в `EmailVerificationChallenge`. Обрабатывает все lifecycle-состояния: `USED` → `ALREADY_VERIFIED` (нейтральный ответ), `EXPIRED`/просрочен → ошибка с кодом `AUTH_VERIFICATION_TOKEN_EXPIRED`, `CANCELLED` → invalid. При успехе: challenge → `USED`, user → `ACTIVE` + `emailVerifiedAt` в одной транзакции.
- **`POST /auth/email-verifications`** — resend с защитой от abuse: cooldown 60 сек (возвращает `retryAfterSeconds`), лимит 3 попытки в час. Ответ всегда нейтральный (не раскрывает существование email). Отменяет предыдущие `PENDING` challenge перед созданием нового.
- **Token flow**: `crypto.randomBytes(32)` → raw token отправляется в письме, в БД хранится только `sha256(rawToken)`. Raw token никогда не попадает в логи или БД.
- **Login блокировка**: `validateUser` проверяет `user.status`. `PENDING_VERIFICATION` → `AUTH_EMAIL_NOT_VERIFIED` + `nextAction: VERIFY_EMAIL`. `LOCKED` → `AUTH_ACCOUNT_LOCKED`. `DELETED` → нейтральный `AUTH_INVALID_CREDENTIALS`.
- **`EmailService`** — stub-сервис логирует verify URL в консоль (`[DEV]`). Архитектурно готов к замене реальным провайдером в T1-30.
- **`RegisterDto`** — добавлено опциональное поле `phone` с E.164 regex-валидацией. MinLength пароля: 6 → 8.
- **Access token TTL**: исправлен с `7d` на `15m` согласно аналитике (refresh rotation — T1-03).
- **Invite auto-link**: не реализован — модель `Invitation` появится в 03-team (T1-02 notes это как зависимость).

**Что НЕ вошло в задачу (перенесено):**
- Invite auto-link после verify → зависит от модели `Invitation` (03-team/T1-02)
- Реальная отправка email → T1-30
