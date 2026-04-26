# TASK_AUTH_3 — Login, Session Lifecycle, `me`, Logout и `logout-all`

> Модуль: `01-auth`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_AUTH_1`
  - `TASK_AUTH_2`
- Что нужно сделать:
  - реализовать `login`, `GET /auth/me`, `logout`, `logout-all`;
  - завести server-controlled sessions с rotation/revoke policy;
  - гарантировать, что `logout-all` отзывает все сессии по правилам, согласованным в аналитике;
  - вернуть через `me` нормализованный auth context для downstream routing;
  - учесть trusted tenant context и post-login handoff в `tenant/onboarding`.
- Критерий закрытия:
  - login создает валидную серверную сессию;
  - logout и `logout-all` корректно инвалидируют доступ;
  - `me` отдает пригодный для продукта auth context без неоднозначностей.

**Что сделано**

- **`POST /auth/login`** — `validateUser` проверяет пароль + статус, затем `loginUser` создаёт `AuthSession` в БД с SHA-256 хэшем refresh token. JWT payload содержит `{ sub: userId, sessionId, activeTenantId, membershipVersion }`. Устанавливаются два httpOnly cookie: `Authentication` (TTL 15 мин, path `/`) и `Refresh` (TTL 7 дней, path `/auth/refresh`). Обновляется `User.lastLoginAt`. Ответ: `{ ok: true }` — ни access token, ни user не попадают в тело ответа.

- **`POST /auth/refresh`** — `@Public()`, читает cookie `Refresh`, вычисляет SHA-256, ищет `AuthSession` по хэшу. Reuse detection: если сессия не `ACTIVE` (статус `ROTATED` или `COMPROMISED`) — все активные сессии пользователя переводятся в `COMPROMISED` с `revokeReason: REFRESH_TOKEN_REUSE`. Если истекла — статус `EXPIRED`. При успехе старая сессия → `ROTATED`, создаётся новая сессия, оба cookie перевыставляются с новыми значениями.

- **`POST /auth/logout`** — защищённый endpoint (требует валидный access token). Отзывает конкретную сессию по `sessionId` из JWT (статус `REVOKED`, `revokeReason: USER_LOGOUT`). Очищает оба cookie.

- **`POST /auth/logout-all`** — защищённый endpoint. Отзывает все `ACTIVE` сессии пользователя (`revokeReason: USER_LOGOUT_ALL`). Очищает оба cookie.

- **`GET /auth/me`** — возвращает user + memberships (с tenant.name, tenant.accessState) + preferences + `sessionId` + `nextRoute` routing hint для клиента:
  - нет memberships → `/onboarding`
  - 1 membership → `/app`
  - несколько memberships, последний использованный tenant валиден → `/app`, иначе → `/tenant-picker`

- **`JwtStrategy.validate`** — теперь проверяет `sessionId` из payload против `AuthSession.status === 'ACTIVE'` (server-side invalidation). Добавлен best-effort апдейт `lastSeenAt`. Проверяется `user.status === 'ACTIVE'`. В объект пользователя добавлен `sessionId`.

- **Cookie security** — helper методы `setAuthCookies` / `clearAuthCookies` в контроллере. `sameSite: strict` при `FORCE_HTTPS=true`, `lax` при dev. Refresh cookie ограничен path `/auth/refresh`.

- **TypeScript** — `tsc --noEmit` выдаёт 0 ошибок после изменений.

---

**✅ Gap закрыт (2026-04-26)**

JWT payload расширен: теперь содержит `{ sub, sessionId, activeTenantId, membershipVersion }`.

- `User.membershipVersion` — счётчик (Int, default 0), инкрементируется атомарно в транзакции при: принятии инвайта, auto-link, смене роли, удалении из команды, выходе из команды.
- `createSession` параллельно создаёт `AuthSession` и читает `UserPreference.lastUsedTenantId` + `User.membershipVersion` → упаковывает в JWT.
- `JwtStrategy.validate` сравнивает `payload.membershipVersion` с `user.membershipVersion`; при совпадении пишет `req.user.activeTenantId` из токена.
- `ActiveTenantGuard` использует `req.user.activeTenantId` (если задан) — экономит DB-запрос к `UserPreference` на каждый запрос; при несовпадении версии fallback на DB-lookup.
- Миграция `20260426030000_user_membership_version` добавляет колонку с `DEFAULT 0`.
