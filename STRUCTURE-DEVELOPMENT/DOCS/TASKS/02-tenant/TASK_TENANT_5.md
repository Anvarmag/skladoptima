# TASK_TENANT_5 — AccessState Transitions, Warnings и Runtime Policy

> Модуль: `02-tenant`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - `TASK_TENANT_1`
  - `TASK_TENANT_4`
- Что нужно сделать:
  - реализовать internal transition flow для `tenant_access_state`;
  - зафиксировать allowed transitions и mapping billing/subscription -> tenant access state;
  - реализовать warnings/read model для `TRIAL_EXPIRED`, `GRACE_PERIOD`, `SUSPENDED`, `CLOSED`;
  - обеспечить, что `TRIAL_EXPIRED` сразу дает read-only режим, а не partial write access;
  - писать события переходов в audit и `tenant_access_state_events`.
- Критерий закрытия:
  - AccessState работает как единый источник истины;
  - доменные модули получают согласованную policy;
  - UI и backend одинаково понимают allowed/blocked actions.

---

**Что сделано (2026-04-26)**

### Новые файлы

**`apps/api/src/modules/tenants/access-state.policy.ts`** — `AccessStatePolicy`

Injectable-сервис — единственный источник истины по AccessState правилам:

- `ALLOWED_TRANSITIONS` map — все допустимые переходы из аналитики:
  ```
  EARLY_ACCESS  → [TRIAL_ACTIVE, CLOSED]
  TRIAL_ACTIVE  → [ACTIVE_PAID, TRIAL_EXPIRED, CLOSED]
  TRIAL_EXPIRED → [ACTIVE_PAID, SUSPENDED]
  ACTIVE_PAID   → [GRACE_PERIOD, SUSPENDED, CLOSED]
  GRACE_PERIOD  → [ACTIVE_PAID, SUSPENDED]
  SUSPENDED     → [ACTIVE_PAID, CLOSED]
  ```
- `assertTransitionAllowed(from, to)` — бросает `400 TENANT_ACCESS_STATE_TRANSITION_NOT_ALLOWED` если переход недопустим
- `isWriteAllowed(state)` — write заблокирован для: `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`
- `getWarnings(state)` — возвращает массив `{ code, message, severity }` для UI:
  - `TRIAL_EXPIRED` → severity: error
  - `GRACE_PERIOD` → severity: warning
  - `SUSPENDED` → severity: error
  - `CLOSED` → severity: error

**`apps/api/src/modules/tenants/dto/transition-access-state.dto.ts`** — DTO для transition endpoint:
- `toState: AccessState` (enum validation)
- `reasonCode: string`
- `actorType: TenantActorType`
- `actorId?: string` (optional UUID)
- `reasonDetails?: Record<string, unknown>` (optional JSONB payload)

**`apps/api/src/modules/tenants/guards/tenant-write.guard.ts`** — `TenantWriteGuard`

Лёгкий guard без DB запросов. Читает `req.activeTenant.accessState` (заполняется `ActiveTenantGuard`). Бросает `403 TENANT_WRITE_BLOCKED` для `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`.

### Изменённые файлы

**`active-tenant.guard.ts`** — теперь помимо `req.activeTenantId` устанавливает `req.activeTenant = { id, status, accessState }`. Это позволяет `TenantWriteGuard` работать без лишних DB запросов.

**`tenant.service.ts`** — добавлены два метода:

- `transitionAccessState(tenantId, dto)`:
  - Загружает текущий tenant и текущий accessState
  - Вызывает `policy.assertTransitionAllowed(from, to)` — throws при недопустимом переходе
  - В одной транзакции: обновляет `tenant.accessState`, при `toState=CLOSED` также ставит `status=CLOSED` и `closedAt`
  - Создаёт запись в `TenantAccessStateEvent` (fromState, toState, reasonCode, reasonDetails, actorType, actorId)
  - Пишет audit log `tenant_access_state_changed`

- `getAccessWarnings(userId, tenantId)`:
  - Проверяет membership пользователя
  - Возвращает `{ tenantId, accessState, isWriteAllowed, warnings[] }`

**`tenant.controller.ts`** — добавлены два endpoint:

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/tenants/:tenantId/access-warnings` | Предупреждения по состоянию для UI |
| `POST` | `/tenants/:tenantId/access-state-transitions` | Internal: смена AccessState |

**`tenant.module.ts`** — добавлены `AccessStatePolicy` и `TenantWriteGuard` в providers/exports.

**`product.controller.ts`** — `@UseGuards(TenantWriteGuard)` на: `create`, `update`, `adjustStock`, `remove`, `importProducts`.

**`settings.controller.ts`** — `@UseGuards(TenantWriteGuard)` на: `updateMarketplaces`, `updateStore`.

**`sync.controller.ts`** — `@UseGuards(TenantWriteGuard)` на все POST-методы (syncProduct, testWb, testOzon, pullFromWb, pullFromOzon, pollOrders, syncMetadata, fullSync). GET-методы (getOrders, getWbStocks, getWbWarehouses, getOrderDetails) остаются доступными в read-only режиме.

### Guard chain для write-sensitive запросов

```
JwtAuthGuard           → JWT valid, req.user set
ActiveTenantGuard      → membership check, req.activeTenantId + req.activeTenant set
RequireActiveTenantGuard → req.activeTenantId !== null
TenantWriteGuard       → accessState not in [TRIAL_EXPIRED, SUSPENDED, CLOSED]
```

### Верификация

- `tsc --noEmit` → 0 ошибок.
