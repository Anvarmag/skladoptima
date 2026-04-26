# TASK_TENANT_3 — Tenant Switch, Bootstrap и Trusted Tenant Context

> Модуль: `02-tenant`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_TENANT_2`
- Что нужно сделать:
  - реализовать `GET /tenants`, `GET /tenants/current`, `POST /tenants/:tenantId/switch`;
  - гарантировать, что downstream tenant context берется только из trusted session/bootstrap;
  - поддержать last used tenant, tenant picker и fallback сценарии;
  - запретить вход в `CLOSED` tenant через switch flow.
- Критерий закрытия:
  - multi-tenant пользователь безопасно переключает рабочую компанию;
  - нет возможности подменить tenant через body/query/local storage;
  - bootstrap payload согласован с `auth` и `team`.

---

**Что сделано (2026-04-26)**

### Новые файлы

**`apps/api/src/modules/tenants/guards/active-tenant.guard.ts`** — `ActiveTenantGuard`

Глобальный guard (второй `APP_GUARD` в AppModule, выполняется после `JwtAuthGuard`). Обеспечивает trusted tenant context:

- Пропускает `@Public()` и `@SkipTenantGuard()` endpoints.
- Если нет `req.user` — пропускает (публичные/анонимные запросы).
- **Жёсткий режим** (клиент передал `X-Tenant-Id` header):
  - Проверяет membership → нет → `403 TENANT_ACCESS_DENIED`.
  - Проверяет `tenant.status !== 'CLOSED'` && `accessState !== 'CLOSED'` → `403 TENANT_CLOSED`.
  - Устанавливает `req.activeTenantId`.
- **Мягкий режим** (нет header, автовыбор из `UserPreference.lastUsedTenantId`):
  - Проверяет membership и статус тенанта.
  - Если нет доступа / CLOSED — тихо сбрасывает `req.activeTenantId = null` (клиент покажет picker).
  - Иначе устанавливает `req.activeTenantId`.
- **Гарантия**: tenant context никогда не берётся из body/query/local storage — только из проверенного header или серверного preference.

**`apps/api/src/modules/tenants/decorators/skip-tenant-guard.decorator.ts`** — `@SkipTenantGuard()`

Декоратор для endpoints, которым не нужен tenant context (применён на `TenantController` целиком — управление тенантами работает до выбора активного тенанта).

**`apps/api/src/modules/tenants/decorators/active-tenant-id.decorator.ts`** — `@ActiveTenantId()`

Param decorator для получения `req.activeTenantId` в handlers: `@ActiveTenantId() tenantId: string | null`.

### Изменения в существующих файлах

**`tenant.controller.ts`** — добавлен `@SkipTenantGuard()` на весь контроллер.

**`tenant.module.ts`** — `ActiveTenantGuard` добавлен в `providers` и `exports`.

**`app.module.ts`** — добавлен второй `APP_GUARD`:
```typescript
{ provide: APP_GUARD, useClass: ActiveTenantGuard }
```

**`tenant.service.ts → switchTenant()`** — добавлена проверка `accessState === 'CLOSED'` дополнительно к `status === 'CLOSED'`. Исправлен `include → select` для загрузки только нужных полей.

**`jwt.strategy.ts`** — удалена неправильная строка `tenantId = user.memberships?.[0]?.tenantId` (брала первый membership как активный тенант — некорректно). Теперь `activeTenantId` разрешается только через `ActiveTenantGuard`.

**`auth.service.ts → getMe()`** — расширен bootstrap payload:
- `activeTenant` — текущий активный тенант `{ id, name, accessState, role }` (из `lastUsedTenantId` или первый доступный, null если нет).
- `tenants[]` — все компании пользователя для tenant picker, включая закрытые (с флагом `isAvailable`).
- `nextRoute` — улучшенная логика: `/onboarding` (нет компаний), `/app` (есть активный тенант), `/tenant-picker` (есть компании, но нет автовыбора).
- Добавлен `status` в select тенанта для корректной фильтрации CLOSED.

### Верификация

- `tsc --noEmit` → 0 ошибок.
