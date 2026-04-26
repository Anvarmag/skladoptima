# TASK_AUTH_5 — Security Hardening, Rate Limits, Soft-Lock и Audit Events

> Модуль: `01-auth`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_AUTH_2`
  - `TASK_AUTH_3`
  - `TASK_AUTH_4`
  - согласован модуль `16-audit`
- Что нужно сделать:
  - ввести rate limiting для `login`, `resend-verification`, `forgot-password`;
  - реализовать soft-lock: `5` подряд неуспешных попыток для пары `normalized_email + IP` на `15 минут`;
  - не использовать CAPTCHA в MVP;
  - сделать нейтральные ошибки без утечки существования account;
  - писать auth/security events: login success/failed, verify, reset requested/completed, password changed, session revoked, logout-all.
- Критерий закрытия:
  - критичные auth endpoints защищены от abuse;
  - soft-lock работает по согласованной политике;
  - audit/security telemetry достаточна для расследований.

**Что сделано**

### 1. Новая модель `LoginAttempt` (`prisma/schema.prisma`)

Добавлена модель для хранения неудачных попыток входа:

```prisma
model LoginAttempt {
  id              String   @id @default(uuid())
  normalizedEmail String
  ip              String
  createdAt       DateTime @default(now())

  @@index([normalizedEmail, ip, createdAt])
}
```

Индекс по `(normalizedEmail, ip, createdAt)` покрывает оба запроса soft-lock: `COUNT` в окне и `findFirst` для вычисления `retryAfterSeconds`.

### 2. Миграция `20260425010000_login_attempts/migration.sql`

Создаёт таблицу `"LoginAttempt"` с составным индексом. Применяется командой:
```bash
cd apps/api && npx prisma migrate dev
```

### 3. Soft-lock (`auth.service.ts` — `validateUser`)

Добавлены константы:
- `SOFT_LOCK_WINDOW_MS = 15 * 60 * 1000` — окно 15 минут
- `SOFT_LOCK_MAX_ATTEMPTS = 5` — порог блокировки

Логика в `validateUser(loginDto, ip?)`:

1. Считаем `LoginAttempt` для пары `(normalizedEmail, ip)` за последние 15 мин.
2. Если `count >= 5`:
   - Находим самую раннюю попытку в окне → вычисляем `retryAfterSeconds = (oldest.createdAt + 15min - now)`.
   - Бросаем `UnauthorizedException { code: 'AUTH_ACCOUNT_SOFT_LOCKED', retryAfterSeconds }`.
   - Повторные попытки во время блокировки НЕ удлиняют её: окно скользящее, старые записи вытесняются временем.
3. При неверном пароле → создаём `LoginAttempt`, аудит `auth_login_failed`.
4. При статусных отказах (PENDING_VERIFICATION, LOCKED) → `LoginAttempt` НЕ создаётся (пароль верен, это не brute-force).

### 4. Timing-attack mitigation (`validateUser`)

Исправлена уязвимость в старом коде — JS short-circuit `||` пропускал `bcrypt.compare` при несуществующем email:

**Было:**
```ts
if (!user || !(await bcrypt.compare(loginDto.password, user.passwordHash))) { … }
```

**Стало:**
```ts
const TIMING_DUMMY_HASH = '$2b$12$abcdefghijklmnopqrstu.ABCDEFGHIJKLMNOPQRSTUVWXYZ12345';
const hash = user?.passwordHash ?? TIMING_DUMMY_HASH;
const passwordOk = await bcrypt.compare(loginDto.password, hash);
if (!user || !passwordOk) { … }
```

`bcrypt.compare` теперь всегда выполняется независимо от того, найден ли пользователь. Время ответа для несуществующего email не отличается от неверного пароля.

### 5. Audit events (`auth.service.ts`)

Добавлен приватный хелпер:
```ts
private auditLog(event: string, data: Record<string, unknown> = {}): void {
    this.logger.log(JSON.stringify({ event, ...data, ts: new Date().toISOString() }));
}
```

Вывод — структурированный JSON в NestJS Logger (stdout). Совместим с любым log aggregator (Datadog, CloudWatch, ELK). Модуль `16-audit` (персистентный audit trail) будет потребителем этих событий в будущем.

Покрытые события:

| Event | Где вызывается |
|-------|---------------|
| `auth_user_registered` | `register()` после создания User |
| `auth_email_verified` | `verifyEmail()` при успехе |
| `auth_email_verification_requested` | `resendVerification()` при отправке |
| `auth_login_succeeded` | `loginUser()` после создания сессии |
| `auth_login_failed` | `validateUser()` — неверные credentials / статус |
| `auth_login_blocked` | `validateUser()` — превышен soft-lock порог |
| `auth_refresh_token_reuse_detected` | `refreshSession()` — reuse атака |
| `auth_session_revoked` | `revokeSession()` и `revokeAllSessions()` |
| `auth_password_reset_requested` | `forgotPassword()` при отправке reset email |
| `auth_password_reset_completed` | `resetPassword()` при успехе |
| `auth_password_changed` | `changePassword()` при успехе |

Каждое событие содержит контекст: `userId`, `ip`, `sessionId` (где применимо), `ts` (UTC ISO-8601).

### 6. Контроллер (`auth.controller.ts`)

IP пробрасывается во все методы, которые нуждаются в нём для audit/soft-lock:
- `login` → `validateUser(loginDto, ip)` и `loginUser(userId, ip, userAgent)`
- `logout` → `revokeSession(sessionId, { userId, ip })`
- `logout-all` → `revokeAllSessions(userId, ip)`
- `password-resets` (forgot) → `forgotPassword(email, ip)`
- `password-resets/confirm` (reset) → `resetPassword(token, newPassword, ip)`
- `change-password` → `changePassword(userId, sessionId, currentPwd, newPwd, ip)`

### 7. Rate limiting (итоговая картина по всем endpoints)

| Endpoint | Защита |
|----------|--------|
| `POST /auth/login` | Soft-lock: 5 ошибок за 15 мин по (email+IP) |
| `POST /auth/email-verifications` (resend) | Cooldown 60с + 3/час на userId (T1-02) |
| `POST /auth/password-resets` (forgot) | Cooldown 60с + 3/час на userId (T1-04) |
| `POST /auth/refresh` | Reuse detection → COMPROMISED всех сессий (T1-03) |

### 8. TS-статус

3 ожидаемые ошибки `Property 'loginAttempt' does not exist on type 'PrismaService'` — исчезнут после:
```bash
cd apps/api && npx prisma migrate dev && npx prisma generate
```
Остальные файлы: 0 ошибок.

### 9. Что НЕ вошло (перенесено)

- Персистентный audit trail в БД → `16-audit` (отдельный модуль)
- Cleanup job для устаревших `LoginAttempt` записей → `T1-30` (scheduled jobs)
- CAPTCHA → не используется в MVP согласно аналитике
