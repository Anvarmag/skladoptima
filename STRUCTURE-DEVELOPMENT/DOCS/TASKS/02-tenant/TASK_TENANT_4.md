# TASK_TENANT_4 — Tenant Isolation Guards и Access Enforcement

> Модуль: `02-tenant`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_TENANT_1`
  - `TASK_TENANT_3`
- Что нужно сделать:
  - внедрить middleware/guard на trusted `activeTenantId`;
  - проверять membership, tenant scope и access-state policy для write-sensitive операций;
  - зафиксировать правило `любой tenant-scoped объект обязан иметь tenant_id`;
  - исключить cross-tenant read/write и "общие" бизнес-сущности без scope.
- Критерий закрытия:
  - backend защищен от cross-tenant доступа;
  - write в tenant без membership технически невозможен;
  - tenant isolation одинаково работает во всех доменных модулях.

---

**Что сделано (2026-04-26)**

### Проблема

Все 6 доменных контроллеров (`product`, `finance`, `settings`, `analytics`, `sync`, `audit`) обращались к `req.user.tenantId` — полю, которое в TASK_TENANT_3 было корректно удалено из `jwt.strategy.ts` (там оно устанавливалось как `memberships[0].tenantId`, что неверно). После TASK_TENANT_3 эти контроллеры оказались сломаны: `req.user.tenantId` всегда `undefined`.

### Новые файлы

**`apps/api/src/modules/tenants/guards/require-active-tenant.guard.ts`** — `RequireActiveTenantGuard`

Легковесный guard без зависимостей. Проверяет, что `req.activeTenantId` установлен (`ActiveTenantGuard` уже проверил membership и статус тенанта). Если `activeTenantId === null | undefined` — бросает `403 TENANT_CONTEXT_REQUIRED`. Применяется на уровне контроллера через `@UseGuards(RequireActiveTenantGuard)`.

### Изменённые файлы

**`tenant.module.ts`** — добавлен `RequireActiveTenantGuard` в `providers` и `exports`.

**`product.controller.ts`**:
- добавлен `@UseGuards(RequireActiveTenantGuard)`
- заменены все `req.user.tenantId` → `req.activeTenantId` (7 вхождений: create, findAll, findOne, update, adjustStock, remove, importProducts)

**`finance.controller.ts`**:
- добавлен `@UseGuards(RequireActiveTenantGuard)`
- `req.user.tenantId` → `req.activeTenantId`

**`settings.controller.ts`**:
- добавлен `@UseGuards(RequireActiveTenantGuard)`
- удалён дублирующий `@UseGuards(JwtAuthGuard)` (JwtAuthGuard уже глобальный)
- `req.user.tenantId` → `req.activeTenantId` (4 вхождения)

**`analytics.controller.ts`**:
- добавлен `@UseGuards(RequireActiveTenantGuard)`
- `req.user.tenantId` → `req.activeTenantId` (3 вхождения)

**`sync.controller.ts`**:
- добавлен `@UseGuards(RequireActiveTenantGuard)`
- `req.user.tenantId` → `req.activeTenantId` (11 вхождений)

**`audit.controller.ts`**:
- добавлен `@UseGuards(RequireActiveTenantGuard)`
- `req.user.tenantId` → `req.activeTenantId`

### Guard chain на tenant-scoped endpoints

```
JwtAuthGuard (глобальный)
  → проверяет JWT, устанавливает req.user
ActiveTenantGuard (глобальный)
  → читает X-Tenant-Id header или UserPreference
  → проверяет membership + статус тенанта
  → устанавливает req.activeTenantId (или null)
RequireActiveTenantGuard (на контроллере)
  → гарантирует req.activeTenantId !== null
  → иначе 403 TENANT_CONTEXT_REQUIRED
```

### Верификация

- `tsc --noEmit` → 0 ошибок.
