# TASK_ADMIN_1 — Support Users, RBAC и Internal Control-Plane Boundaries

> Модуль: `19-admin`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - утверждена системная аналитика `19-admin`
  - согласованы `16-audit`, `13-billing`
- Что нужно сделать:
  - завести `support_users` и role model `support_admin / support_readonly`;
  - реализовать admin RBAC middleware и отдельный internal auth/session контур;
  - изолировать admin-plane от tenant-facing RBAC и tenant picker;
  - запретить SQL-like/manual direct writes в доменные таблицы из admin-панели;
  - закрепить границу internal control plane и допустимых support contracts.
- Критерий закрытия:
  - support роли технически отделены от tenant users;
  - read-only и mutating support scopes не смешиваются;
  - admin контур не создает обходных путей мимо доменных сервисов.

**Что сделано**

### 1. Data model (Prisma + миграция)

В [apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma) добавлены:

- enum `SupportUserRole { SUPPORT_ADMIN, SUPPORT_READONLY }` — внутренний RBAC, не пересекается с tenant `Role`;
- enum `SupportSessionStatus { ACTIVE, ROTATED, REVOKED, EXPIRED, COMPROMISED }` — отдельный жизненный цикл admin-сессий;
- enum `SupportSecurityEventType` — internal_only audit события (`admin_login_success/failed`, `admin_session_revoked`, `admin_password_changed`, `admin_rbac_denied`);
- модель `SupportUser` (`support_users`) — оператор поддержки. Полностью изолирована от `User`: нет `memberships`, нет `phone`, нет `Role`. Поля: `id`, `email` (unique), `passwordHash` (bcrypt), `role`, `isActive`, `lastLoginAt`, `createdAt`, `updatedAt`;
- модель `SupportAuthSession` (`support_auth_sessions`) — refresh-rotation + reuse detection, идентичная семантика c tenant `AuthSession`, но со своим cookie/secret/audience;
- модель `SupportLoginAttempt` (`support_login_attempts`) — soft-lock 5 неудач за 15 минут по паре `(email, IP)`. Изолирован от tenant `LoginAttempt`, чтобы атаки на admin не смешивались с tenant-flow;
- модель `SupportSecurityEvent` (`support_security_events`) — отдельный security stream (см. §15 аналитики «internal_only»), tenant-facing `AuditLog`/`SecurityEvent` остаётся неприкосновенным.

Миграция: [apps/api/prisma/migrations/20260429100000_admin_support_control_plane/migration.sql](apps/api/prisma/migrations/20260429100000_admin_support_control_plane/migration.sql) — аддитивная, без изменений в существующих tenant-таблицах.

### 2. Admin module (NestJS)

Новый изолированный модуль [apps/api/src/modules/admin/admin.module.ts](apps/api/src/modules/admin/admin.module.ts):

- собственный `JwtModule.register({})` — без default secret, токены подписываются явно `ADMIN_JWT_SECRET` + `audience: 'admin'`. Это исключает риск, что tenant access token примут за admin (у них разные secret и aud);
- импорт `AuthModule` сделан **только** ради `CsrfService` (одинаковая double-submit логика). Никакие admin-сервисы не дёргают tenant `AuthService`;
- зарегистрирован в [apps/api/src/app.module.ts](apps/api/src/app.module.ts) рядом с другими модулями.

### 3. AdminAuthService — internal auth контур

[apps/api/src/modules/admin/admin-auth/admin-auth.service.ts](apps/api/src/modules/admin/admin-auth/admin-auth.service.ts):

- `login(email, password, ip, userAgent)` — soft-lock check, timing-safe bcrypt (`TIMING_DUMMY_HASH`), статус `isActive`, выдача access (15m) + refresh (7d) токенов, запись `admin_login_success` / `admin_login_failed`;
- `refresh(rawToken, ip, userAgent)` — token-reuse detection: если найден `ROTATED`/`COMPROMISED` token, все ACTIVE сессии того же оператора помечаются `COMPROMISED`;
- `revokeSession(sessionId, supportUserId, ip)` — logout текущей сессии + audit `admin_session_revoked`;
- `changePassword(...)` — current-password check, защита от same-as-current, обнуление всех других ACTIVE сессий;
- `validateAccessToken(rawToken)` — используется guard'ом: проверяет JWT (явный `audience: 'admin'`), live-status сессии, `isActive` оператора;
- `writeSecurityEvent(...)` — отдельный internal_only audit stream, не валит request при ошибке записи.

Все ошибки возвращаются через типизированные коды `ADMIN_AUTH_*` / `ADMIN_CSRF_*` / `FORBIDDEN_SUPPORT_*`, что не пересекается с tenant-кодами `AUTH_*` (разделение error-namespace из аналитики §10).

### 4. AdminAuthGuard — RBAC + CSRF + JWT

[apps/api/src/modules/admin/admin-auth/admin-auth.guard.ts](apps/api/src/modules/admin/admin-auth/admin-auth.guard.ts):

- собственный CSRF (cookie `admin-csrf-token`, header `x-admin-csrf-token`) — для unsafe методов проверяется ВСЕГДА, даже на `@AdminPublic()` endpoints (login/refresh), кроме `GET csrf-token`;
- читает access token из cookie `AdminAuthentication` или `Authorization: Bearer ...`;
- декоратор `@AdminRoles('SUPPORT_ADMIN')` — RBAC enforcement. Если декоратор отсутствует, требуется любая активная support-роль; если указан — только перечисленные. Mutating actions ОБЯЗАНЫ объявлять `@AdminRoles('SUPPORT_ADMIN')` (T2-T7);
- любой RBAC-deny пишется в `support_security_events` с `eventType: admin_rbac_denied` и контекстом (`actorRole`, `requiredRoles`, `method`, `path`);
- `request.supportUser = { id, role, sessionId }` — никакого `tenantId`, `memberships`, `activeTenant`. У support-actor нет tenant picker.

### 5. Изоляция от tenant-facing контура (главный инвариант T1)

`@AdminEndpoint()` ([decorators/admin-endpoint.decorator.ts](apps/api/src/modules/admin/admin-auth/decorators/admin-endpoint.decorator.ts)) — composite декоратор, который ставит на admin-controller сразу три флага метаданных:

| Флаг | Что делает |
|------|-----------|
| `IS_PUBLIC_KEY` | глобальный tenant `JwtAuthGuard` пропускает endpoint — admin не валидируется tenant JWT |
| `SKIP_CSRF_KEY` | глобальный `CsrfGuard` пропускает endpoint — admin использует свой CSRF-токен |
| `SKIP_TENANT_GUARD_KEY` | `ActiveTenantGuard` пропускает endpoint — у support-actor нет `activeTenantId` |

Безопасность admin-плоскости обеспечивается **только** локальным `AdminAuthGuard`, выставленным через `@UseGuards(AdminAuthGuard)` на каждом admin-controller. Поэтому "Public" в admin-контексте означает «не tenant-auth», а не «открыто всем».

### 6. AdminAuthController — admin контракт API

[apps/api/src/modules/admin/admin-auth/admin-auth.controller.ts](apps/api/src/modules/admin/admin-auth/admin-auth.controller.ts) — реализует endpoints внутри изолированного префикса `/api/admin/auth`:

| Метод | Endpoint | Роль | Назначение |
|------|----------|------|------------|
| `GET` | `/api/admin/auth/csrf-token` | Public | Выдаёт `admin-csrf-token` cookie + JSON |
| `POST` | `/api/admin/auth/login` | Public + admin CSRF | Логин support-actor, выдача `AdminAuthentication` + `AdminRefresh` cookies |
| `POST` | `/api/admin/auth/refresh` | Public + admin CSRF | Refresh rotation, изолированный path `/api/admin/auth/refresh` |
| `GET` | `/api/admin/auth/me` | Авторизованный support | Текущий контекст (id, role, sessionId) |
| `POST` | `/api/admin/auth/logout` | Авторизованный support | Revoke текущей сессии |
| `POST` | `/api/admin/auth/change-password` | Авторизованный support | Смена своего пароля + revoke других сессий |

Все cookies помечены `httpOnly: true`, `sameSite: 'strict'` в prod, refresh ограничен путём `/api/admin/auth/refresh` (узкая поверхность атаки).

### 7. Smoke-controller для RBAC проверки

[apps/api/src/modules/admin/admin-health/admin-health.controller.ts](apps/api/src/modules/admin/admin-health/admin-health.controller.ts):

- `GET /api/admin/health/ping` — обе роли (SUPPORT_READONLY и SUPPORT_ADMIN) видят;
- `GET /api/admin/health/admin-only` — `@AdminRoles('SUPPORT_ADMIN')`, SUPPORT_READONLY получает 403 + audit-запись.

Это даёт T1-приёмке проверяемый смоук-сценарий из тестовой матрицы аналитики (§16: «попытка read-only роли выполнить mutating action»).

### 8. Что НЕ сделано в этой задаче (вынесено в T2-T7)

- `support_actions`, `support_notes` таблицы и API под них — это T2/T4 (tenant directory + support actions);
- tenant 360 read-model — T3;
- frontend admin-панель и UI guardrails — T5/T6;
- security review и observability dashboards — T7.

T1 закладывает **только** RBAC-каркас и границу internal control plane: после слияния mutating support actions T2-T7 добавляются как новые controllers, обёрнутые в `@AdminEndpoint() + @UseGuards(AdminAuthGuard) + @AdminRoles('SUPPORT_ADMIN')`, и не могут вырасти в tenant-обходящий канал по конструкции.

### 9. Проверки

- `npx prisma generate` — успешно.
- `npx tsc --noEmit` — модуль `admin/` чистый. Все оставшиеся 11 ошибок репозитория (catalog/inventory/sync-runs/test-fbo/update-pwd) предсуществовали и не связаны с T1.
- ENV переменная `ADMIN_JWT_SECRET` (≥ 16 символов) обязательна для bootstrap admin-плоскости — иначе `AdminAuthService.adminJwtSecret()` бросит явное исключение «admin control plane disabled» (защита от случайного включения с пустым secret).
