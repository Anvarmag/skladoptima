# TASK_AUTH_6 — Frontend Auth Flows и Post-Login Routing

> Модуль: `01-auth`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_AUTH_2`, `TASK_AUTH_3`, `TASK_AUTH_4`
  - согласованы `02-tenant` и `04-onboarding`

**Что сделано**

### 1. `AuthContext.tsx` — полный рефакторинг

**Было:** устаревший тип `User { id, email, store? }`, `checkAuth()` парсил `res.data` вместо `res.data.user`, нет `nextRoute`, `loginViaTelegram` читал `res.data.user` из `{ ok: true }`.

**Стало:**
- Тип `AuthUser` соответствует новому API: `status`, `emailVerifiedAt`, `memberships`, `preferences`.
- `checkAuth()` возвращает `nextRoute` (строку) — вызывающий код делает redirect сам.
- `nextRoute` добавлен в контекст.
- `loginViaTelegram` теперь вызывает `checkAuth()` после `/auth/telegram` — не читает user из тела ответа (там `{ ok: true }`).
- Убраны `as any` касты, контекст полностью типизирован.

### 2. `Login.tsx` — полный рефакторинг

**Исправлено:**
- `input type="text"` → `type="email"`.
- Post-login redirect: `navigate(route ?? '/app')` через `nextRoute` из `checkAuth()`.
- Добавлена ссылка «Забыли пароль?» → `/forgot-password`.
- Обработка error-кодов бэкенда:
  - `AUTH_EMAIL_NOT_VERIFIED` → dedicated state «Подтвердите email» с кнопкой resend.
  - `AUTH_ACCOUNT_SOFT_LOCKED` → dedicated state «Слишком много попыток» с `retryAfterSeconds`.
  - `AUTH_ACCOUNT_LOCKED` → «Аккаунт заблокирован. Обратитесь в поддержку».
  - generic → «Неверный email или пароль».

### 3. `Register.tsx` — полный рефакторинг

**Исправлено:**
- Убрано поле `storeName` (tenant создаётся в onboarding, не при регистрации).
- После успешной регистрации показывается state «Проверьте почту» вместо `navigate('/app')` (пользователь ещё не залогинен, статус `PENDING_VERIFICATION`).
- Подсказка «6 символов» → «8 символов», `minLength={8}` на input.
- Обработка `AUTH_EMAIL_TAKEN` и `AUTH_PHONE_TAKEN` с понятными сообщениями.

### 4. Новая страница `VerifyEmail.tsx` — `/verify-email`

- Читает `?token=` из URL, вызывает `POST /auth/email-verifications/confirm`.
- States: `loading` → `success` / `already_verified` / `expired` / `invalid`.
- `expired` и `invalid` показывают форму resend с email-полем.
- Resend обрабатывает `AUTH_RESEND_TOO_SOON` (с `retryAfterSeconds`) и `AUTH_RESEND_LIMIT_EXCEEDED`.
- Поддерживает `?resend=1&email=...` — прямой вход в режим resend (из Login при `AUTH_EMAIL_NOT_VERIFIED`).

### 5. Новая страница `ForgotPassword.tsx` — `/forgot-password`

- Email → `POST /auth/password-resets`.
- Всегда показывает нейтральный success («если аккаунт существует, письмо отправлено»).
- Ошибки бэкенда подавляются — нейтральный UX без account enumeration.

### 6. Новая страница `ResetPassword.tsx` — `/reset-password`

- Читает `?token=` из URL.
- `POST /auth/password-resets/confirm { token, newPassword }`.
- States: `form` / `success` / `expired` / `invalid`.
- `expired` → предлагает «Запросить новую ссылку» → `/forgot-password`.
- `success` → «Все активные сессии завершены. Войдите с новым паролем» → `/login`.
- `minLength={8}` на input пароля.

### 7. `App.tsx` — добавлены маршруты

```tsx
<Route path="/verify-email"    element={<VerifyEmail />} />
<Route path="/forgot-password" element={<ForgotPassword />} />
<Route path="/reset-password"  element={<ResetPassword />} />
```

### 8. Что НЕ вошло (перенесено)

- Onboarding flow после login без tenant → `04-onboarding` (T1-07 в списке).
- Tenant picker UI → `02-tenant`.
- Settings → change-password UI → отдельная задача.
