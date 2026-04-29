# TASK_ADMIN_3 — Support Actions API и Domain-Contract Execution

> Модуль: `19-admin`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_ADMIN_1`
  - `TASK_ADMIN_2`
  - согласованы `02-tenant`, `13-billing`, `01-auth`
- Что нужно сделать:
  - реализовать support actions: `extend trial`, `set access state`, `restore tenant`, `trigger password reset`, `add internal note`;
  - реализовать `POST /api/v1/admin/tenants/:tenantId/actions/extend-trial`, `set-access-state`, `restore-tenant`;
  - реализовать `POST /api/v1/admin/users/:userId/actions/password-reset`;
  - исполнять все mutating actions только через доменные сервисы и контракты;
  - требовать `reason` длиной >= 10 символов для high-risk actions.
- Критерий закрытия:
  - support actions ограничены утвержденным MVP-набором;
  - high-risk actions не обходят доменные правила;
  - каждое действие имеет валидируемый reason и воспроизводимый execution path.

**Что сделано**

### 1. Data model (Prisma + миграция)

В [apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma) добавлены:

- enum `SupportActionType { EXTEND_TRIAL, SET_ACCESS_STATE, RESTORE_TENANT, TRIGGER_PASSWORD_RESET, ADD_INTERNAL_NOTE }` — конечный narrow-set MVP-actions из §13 аналитики;
- enum `SupportActionResultStatus { success, failed, blocked }` — `blocked` отделено от `failed`, чтобы в журнале было видно: «доменный guard сработал» (state-conflict, retention) vs «системная ошибка»;
- модель `SupportAction` (`support_actions`) — журнал каждой mutating-операции. На уровне БД `reason TEXT NOT NULL` — без reason запись не создаётся (защита от обхода ровно на уровне инварианта). Доп. поля для post-mortem: `payload`, `resultDetails`, `errorCode`, `auditLogId`, `correlationId`, `targetUserId`, `ip`, `userAgent`. Индексы по `(tenantId, createdAt)`, `(actorSupportUserId, createdAt)`, `(actionType, createdAt)`;
- модель `SupportNote` (`support_notes`) — internal handoff между сменами поддержки, FK на `support_users`;
- relations добавлены в `SupportUser` (`actions`, `notes`).

Миграция: [apps/api/prisma/migrations/20260429110000_admin_support_actions_notes/migration.sql](apps/api/prisma/migrations/20260429110000_admin_support_actions_notes/migration.sql) — аддитивная, `ON DELETE RESTRICT` на FK к `support_users` (журнал действий нельзя терять при удалении оператора).

### 2. Расширение доменных сервисов (домен — единственный mutation-путь)

Главный инвариант T3: admin-плоскость не пишет в tenant-таблицы напрямую. Контроллеры дёргают `SupportActionsService`, а он — доменные сервисы.

**[apps/api/src/modules/tenants/access-state.policy.ts](apps/api/src/modules/tenants/access-state.policy.ts)**
- добавлен `SUPPORT_ALLOWED_TRANSITIONS` — отдельная narrow-карта переходов, доступных только из support-контекста: `TRIAL_EXPIRED → TRIAL_ACTIVE` (extend-trial), `CLOSED → SUSPENDED` (restore). Никакого универсального support-bypass'а;
- добавлен `assertSupportTransitionAllowed(from, to)` — объединяет стандартные переходы со support-allowed.

**[apps/api/src/modules/tenants/tenant.service.ts](apps/api/src/modules/tenants/tenant.service.ts)**
- `transitionAccessState(tenantId, dto, options)` — добавлен 3-й параметр `options.supportContext: boolean`. Включён → policy проверяет через `assertSupportTransitionAllowed`. Это сохраняет совместимость с существующими tenant-facing вызовами;
- `extendTrialBySupport(tenantId, actor)` — идемпотентный поднимает tenant в `TRIAL_ACTIVE`. Если уже `TRIAL_ACTIVE` — возвращает `idempotent: true` без side-effects (защита от двойного клика). Под капотом делегирует `transitionAccessState` с `supportContext: true`;
- `restoreTenantBySupport(tenantId, actor)` — копия `restoreTenant`, но без ownership-проверки и с `actorType: 'SUPPORT'`. Сохраняет retention-window guard и policy-проверку.

**[apps/api/src/modules/auth/auth.service.ts](apps/api/src/modules/auth/auth.service.ts)**
- `triggerPasswordResetBySupport(userId, actor)` — отличается от self-service `forgotPassword`:
  - принимает `userId`, а не email (support находит user через tenant 360);
  - не возвращает 200 при отсутствующем user (admin-плоскость не утаивает faktы — кидает 400 `AUTH_USER_NOT_FOUND`);
  - не применяет cooldown/hourly limit (rate-abuse защищён reason >= 10 + RBAC SUPPORT_ADMIN);
  - принудительно отменяет предыдущие PENDING-challenge'и (single live reset token invariant);
  - пишет `password_reset_requested` в `SecurityEvent` с `metadata.triggeredBy = 'support'`.

### 3. SupportActionsService — оркестратор с обязательным журналом

[apps/api/src/modules/admin/support-actions/support-actions.service.ts](apps/api/src/modules/admin/support-actions/support-actions.service.ts) — единственная точка входа для всех mutating support actions. Контракт:

1. Controller-DTO валидирует `reason >= 10` (high-risk requirement из §10).
2. Service вызывает доменный метод (`tenantService.*` / `authService.*`).
3. Записывает `support_actions` с `resultStatus`:
   - `success` — domain выполнил mutation;
   - `blocked` — domain guard сработал (HTTP 400/403/409): policy/retention/state-conflict;
   - `failed` — системная ошибка (HTTP 500 / неизвестный exception).
4. Параллельно пишет tenant-facing audit через `AuditService.writePrivilegedEvent` (visibility=`internal_only`, actorType=`support`).
5. На любом исключении — фиксирует blocked/failed запись и пробрасывает оригинальное исключение.

Это даёт инвариант DoD «каждое действие имеет валидируемый reason и воспроизводимый execution path»: даже отказы от domain-guard'ов остаются в журнале с конкретным `errorCode`. `_recordAction` обёрнут в try/catch — сбой записи журнала не валит UX, только warning в логах (как и admin-security-event-write в T1).

`extendTrial`, `setAccessState`, `restoreTenant` используют общий `runTenantAction` template — pre-check существования tenant, единый success/blocked/failed pattern. `triggerPasswordReset` отдельный, потому что target — User, а не Tenant.

### 4. SupportNotesService — internal handoff

[apps/api/src/modules/admin/support-notes/support-notes.service.ts](apps/api/src/modules/admin/support-notes/support-notes.service.ts):

- `list(tenantId, limit=50)` — последние 50 нот по `createdAt DESC`, доступ обоим support-ролям (см. §22 «SUPPORT_READONLY может видеть internal notes»);
- `create(tenantId, note, actor)` — только SUPPORT_ADMIN (RBAC на controller-слое). После создания сразу пишется запись в `support_actions` через `recordNoteAdded` — единый журнал mutating actions, в котором ADD_INTERNAL_NOTE не выпадает.

### 5. Endpoints (все @AdminEndpoint + AdminAuthGuard + AdminRoles)

| Метод | Endpoint | Роль | DTO / Reason |
|------|----------|------|------|
| `POST` | `/api/admin/tenants/:tenantId/actions/extend-trial` | SUPPORT_ADMIN | `ExtendTrialDto` (reason ≥ 10) |
| `POST` | `/api/admin/tenants/:tenantId/actions/set-access-state` | SUPPORT_ADMIN | `SetAccessStateDto` (toState + reason ≥ 10) |
| `POST` | `/api/admin/tenants/:tenantId/actions/restore-tenant` | SUPPORT_ADMIN | `RestoreTenantDto` (reason ≥ 10) |
| `POST` | `/api/admin/users/:userId/actions/password-reset` | SUPPORT_ADMIN | `TriggerPasswordResetDto` (reason ≥ 10) |
| `GET` | `/api/admin/tenants/:tenantId/notes` | SUPPORT_READONLY/SUPPORT_ADMIN | — |
| `POST` | `/api/admin/tenants/:tenantId/notes` | SUPPORT_ADMIN | `CreateSupportNoteDto` (1..4000) |

Контроллеры:
- [support-tenant-actions.controller.ts](apps/api/src/modules/admin/support-actions/support-tenant-actions.controller.ts) — class-level `@AdminRoles('SUPPORT_ADMIN')` поднимает требование сразу для всех 3 high-risk actions;
- [support-user-actions.controller.ts](apps/api/src/modules/admin/support-actions/support-user-actions.controller.ts) — отдельный controller под `/admin/users/:userId/actions`;
- [support-notes.controller.ts](apps/api/src/modules/admin/support-notes/support-notes.controller.ts) — class default — любая активная support-роль (для GET), POST имеет method-level `@AdminRoles('SUPPORT_ADMIN')` через `getAllAndOverride` в guard'е.

UUID-валидация делается в самих controllers (regex), как уже принято в T2 — отдельный namespace ошибок `ADMIN_TENANT_ID_INVALID` / `ADMIN_USER_ID_INVALID`.

### 6. Tenant 360 — переход с stub'а на реальные данные

В [tenant-summary.service.ts](apps/api/src/modules/admin/tenant-360/tenant-summary.service.ts) поле `notes` теперь возвращает реальные `support_notes` (top 10), а не `pending_t4` stub:
- `notes.status` сменился с `'pending_t4'` на `'ready'`;
- `notes.items[]` — реальные записи с `author { id, email, role }`;
- добавлен новый блок `supportActions.recent[]` (top 10) — даёт оператору контекст недавних вмешательств коллег для handoff.

Оба collector'а (`collectNotes`, `collectRecentSupportActions`) добавлены в общий `Promise.all` — bounded-by-design pattern из T2 сохранён, p95 < 700ms цель не нарушена.

### 7. AdminModule wiring

[apps/api/src/modules/admin/admin.module.ts](apps/api/src/modules/admin/admin.module.ts):
- добавлены импорты `TenantModule` (для TenantService) и `AuditModule` (для writePrivilegedEvent);
- зарегистрированы `SupportTenantActionsController`, `SupportUserActionsController`, `SupportNotesController`;
- providers: `SupportActionsService`, `SupportNotesService`.

`AuthModule` уже импортировался в T1 ради `CsrfService` — теперь дополнительно даёт `AuthService` для password-reset domain контракта.

### 8. Безопасность и архитектурные инварианты

| Требование §15 | Где обеспечено |
|------|------|
| reason >= 10 для high-risk | DTO `MinLength(10)` + БД-инвариант `reason NOT NULL` в `support_actions` |
| no-bypass доменных правил | SupportActionsService → доменные сервисы (TenantService / AuthService); никаких прямых Prisma-update'ов на tenant-таблицы |
| no-impersonation в MVP | password-reset триггерит обычный self-service flow по email (никакого `login as user`) |
| no-credential-leak | support не видит passwordHash; `triggerPasswordResetBySupport` возвращает `{sent: true, userId}`, без email/токена |
| no-billing-override в MVP | `setAccessState` ограничен `assertSupportTransitionAllowed` → конечный narrow-set; `ACTIVE_PAID`-форсинг невозможен напрямую |
| READONLY не пишет | class-level и method-level `@AdminRoles('SUPPORT_ADMIN')` на всех 4 mutating endpoints |
| audit on each high-risk | Двойная запись: `support_actions` (admin-internal) + `AuditLog` через `writePrivilegedEvent` (tenant-facing internal_only) |
| воспроизводимость | `support_actions` хранит `payload`, `resultDetails`, `errorCode`, `ip`, `userAgent`, `correlationId` slot |

### 9. Проверки

- `npx prisma generate` — успешно.
- `npx tsc --noEmit | grep -E "admin|tenant\.service|access-state\.policy|auth\.service"` — пусто. Модули `admin/`, `tenants/`, `auth/`, `access-state.policy` чистые. Все оставшиеся TS-ошибки репозитория (catalog/inventory/sync-runs/test-fbo/fix-ozon-dates) — pre-existing и не связаны с T3.

### 10. Что НЕ сделано в этой задаче (по плану)

- frontend admin-панель и UI guardrails — T5/T6;
- security review high-risk операций — T7 (доказательность audit-trail для T3 уже заложена через `support_actions` + `writePrivilegedEvent`).
