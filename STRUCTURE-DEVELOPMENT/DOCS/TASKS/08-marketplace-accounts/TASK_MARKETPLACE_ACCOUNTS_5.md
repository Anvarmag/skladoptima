# TASK_MARKETPLACE_ACCOUNTS_5 — Tenant-State Guards и Single-Active-Account Policy

> Модуль: `08-marketplace-accounts`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `7h`
- Зависимости:
  - `TASK_MARKETPLACE_ACCOUNTS_2`
  - `TASK_MARKETPLACE_ACCOUNTS_3`
  - согласованы `02-tenant`, `09-sync`
- Что нужно сделать:
  - при `TRIAL_EXPIRED` блокировать `validate`, `reactivate`, `sync now` и любые внешние API actions;
  - при `TRIAL_EXPIRED` оставить доступными только внутренние операции `PATCH label` и `deactivate`;
  - при `SUSPENDED` и `CLOSED` перевести модуль в read-only diagnostic mode;
  - гарантировать запрет второго `active` account того же marketplace до деактивации текущего;
  - синхронизировать effective runtime policy с `sync`, `warehouses`, `orders`, `finance`.
- Критерий закрытия:
  - account behavior не расходится с tenant commercial/access policy;
  - нет серой зоны, где интеграция продолжает работать после блокировки tenant;
  - single-active-account rule соблюдается и в API, и в runtime.

**Что сделано**

### Контекст MVP до задачи

К моменту начала задачи в проекте:
- Все CRUD/lifecycle endpoints (TASK_2-3) и diagnostics (TASK_4) уже работали;
- `TenantWriteGuard` грубо блокировал все write actions для TRIAL_EXPIRED/SUSPENDED/CLOSED — но это слишком строго: §10 system-analytics требует, чтобы в TRIAL_EXPIRED были разрешены `PATCH label` и `deactivate` (внутренние действия без external API);
- `MarketplaceAccountsService.create/update/validate/deactivate/reactivate` НЕ проверяли `tenant.accessState` сами — полагались только на HTTP guard. Прямой вызов из jobs/scheduler/REPL (минуя HTTP) обошёл бы блокировку;
- `reportSyncRun` (TASK_4) для paused tenant'а спокойно обновил бы `lastSyncAt/Result/Error*` — sync.service в paused state мог бы случайно дёрнуться и записать health-данные;
- DB partial UNIQUE из TASK_1 уже даёт single-active enforce, но application-level pre-checks отдавали понятные `ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE` коды только в `create` и `reactivate` — ни consistent test coverage для всего жизненного цикла.

### Что добавлено

**1. Service-level helpers в [marketplace-accounts.service.ts](apps/api/src/modules/marketplace-accounts/marketplace-accounts.service.ts)**

Две константы action policy:

```
PAUSED_TENANT_STATES = { TRIAL_EXPIRED, SUSPENDED, CLOSED }     // блокируют external API
READ_ONLY_TENANT_STATES = { SUSPENDED, CLOSED }                 // блокируют все write
```

Три приватных helper'а:

- `_getTenantAccessState(tenantId)` — `tenant.findUnique` → `accessState`. Throws `TENANT_NOT_FOUND` если tenant не существует. Бросать NotFound вместо silent ignore — чтобы scheduler/jobs не работали с фантомными аккаунтами.
- `_assertExternalApiAllowed(tenantId, accountId, action)` — для validate/reactivate/credentials update/create. Бросает `Forbidden` с `ACCOUNT_ACTION_BLOCKED_BY_TENANT_STATE` + `action` + `accessState` payload. Записывает `PAUSED_BY_TENANT_STATE` event (audit chain). На sentinel `accountId='new-account'` (для create) пропускает event-запись (FK ещё не существует).
- `_assertInternalWriteAllowed(tenantId, accountId, action)` — для label-update/deactivate. Допускает TRIAL_EXPIRED, блокирует только READ_ONLY_TENANT_STATES.

**2. Wire-up в существующие методы (defense-in-depth)**

| Method | Guard helper | Block в TRIAL_EXPIRED | Block в SUSPENDED/CLOSED |
|---|---|---|---|
| `create` | `_assertExternalApiAllowed` (sentinel `'new-account'`) | ✓ | ✓ |
| `update(label only)` | `_assertInternalWriteAllowed` | — | ✓ |
| `update(credentials)` | `_assertExternalApiAllowed` | ✓ | ✓ |
| `validate` | `_assertExternalApiAllowed` | ✓ | ✓ |
| `deactivate` | `_assertInternalWriteAllowed` | — | ✓ |
| `reactivate` | `_assertExternalApiAllowed` | ✓ | ✓ |
| `reportSyncRun` | inline pause check | early return `{paused: true}` без записи health | early return |
| `list` / `getById` / `getDiagnostics` | — | — | — (read доступен всегда) |

`update` сам выбирает, какой helper вызвать, по тому, какие поля присутствуют в DTO. Для `dto.credentials` — внешний API guard, иначе — внутренний.

`reportSyncRun` отличается: вместо throw — возвращает `{ ...readModel, paused: true }`, чтобы caller (sync.service) мог отличить "sync не разрешён" от "sync упал". Health-поля при этом физически не пишутся. PAUSED event эмитится в audit chain.

**3. Controller cleanup в [marketplace-accounts.controller.ts](apps/api/src/modules/marketplace-accounts/marketplace-accounts.controller.ts)**

Удалён `TenantWriteGuard` с `PATCH /:id` и `POST /:id/deactivate` — теперь service-level policy сам решает per-action. На `POST /` (create), `POST /:id/validate`, `POST /:id/reactivate` — `TenantWriteGuard` остаётся как fast-fail HTTP-слой (HTTP 403 раньше, чем достигнем service), но service-level guard продолжает работать как defense-in-depth для прямых вызовов.

**4. `MarketplaceAccountEvents.PAUSED_BY_TENANT_STATE`**

Зарезервированный в TASK_4 событийный код теперь активно пишется в `MarketplaceAccountEvent` журнал при каждом отвергнутом действии. Payload: `{ action, accessState }`. Это даёт UI/support полную audit chain «когда tenant paused, какие действия попытались выполнить».

**5. Тесты — [marketplace-accounts.tenant-state.spec.ts](apps/api/src/modules/marketplace-accounts/marketplace-accounts.tenant-state.spec.ts)**

31 новый тест в 6 describe-блоках:

*TRIAL_EXPIRED — внешние API блокируются (4):* create → 403 + action='create'; validate → 403 + PAUSED event без вызова validator; reactivate → 403; update credentials → 403.

*TRIAL_EXPIRED — внутренние actions РАЗРЕШЕНЫ (2):* PATCH label работает + LABEL_UPDATED event; deactivate работает + DEACTIVATED event.

*SUSPENDED/CLOSED — read-only mode (7):* `it.each` на оба state × create/validate/reactivate/update label/update credentials/deactivate — все 12 проверок (5 it.each + 1 single + 1 для read доступности через 3 endpoints в 3 paused state).

*reportSyncRun в paused tenant (4):* `it.each` на 3 paused state — `paused: true`, БЕЗ записи health, PAUSED event записан; ACTIVE_PAID — нормально пишет health.

*Single-active rule (4):* application pre-check для create и reactivate с `conflictAccountId`; DB partial UNIQUE (P2002) catch для create и reactivate.

*TENANT_NOT_FOUND (2):* validate и deactivate бросают TENANT_NOT_FOUND для фантомного tenant.

**6. Регрессия 61 предыдущих тестов**

В TASK_2/3/4 моки `tenant.findUnique` либо отсутствовали, либо мокались только для diagnostics. После добавления guard'ов все методы стали читать accessState — пришлось добавить `tenant.findUnique.mockResolvedValue({ accessState: 'ACTIVE_PAID' })` в `makePrismaMock` для service.spec.ts и lifecycle.spec.ts. Все 61 предыдущих тест продолжают проходить без изменения assertion'ов.

Совокупно — `Tests: 92 passed, 92 total` для marketplace-accounts (22+19+20+31). Глобально (inventory + warehouses + marketplace-accounts): `Tests: 278 passed, 278 total` в 14 suites. `tsc --noEmit` чисто.

### Соответствие критериям закрытия

- **Account behavior не расходится с tenant commercial/access policy**: для каждого write-action есть явный guard helper, который проверяет `accessState` ДО любых side-effect'ов; PAUSED event пишется в audit chain; `_assertInternalWriteAllowed` различает TRIAL_EXPIRED (мягкая пауза с возможностью label/deactivate) и SUSPENDED/CLOSED (read-only mode).
- **Нет серой зоны, где интеграция продолжает работать после блокировки tenant**: `_assertExternalApiAllowed` блокирует все external API actions; `reportSyncRun` принудительно paused для paused tenant; HTTP `TenantWriteGuard` остаётся как первая линия защиты для create/validate/reactivate. Прямой вызов из jobs/scheduler невозможно — service-level guard на каждом методе.
- **Single-active-account rule соблюдается и в API, и в runtime**: application pre-check `ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE` в create и reactivate с `conflictAccountId` payload; DB partial UNIQUE INDEX из TASK_1 ловит race conditions через P2002 catch (тесты подтверждают оба пути).

### Что осталось вне scope

- RBAC (Owner/Admin only для write, Owner/Admin/Manager для read/diagnostics) через `RolesGuard` — отдельный refactoring задача, выходит за scope «tenant-state guards».
- Подключение `sync.service` к `reportSyncRun` (вместо текущей записи `lastSyncAt/lastSyncStatus String?` legacy полей) — отдельная задача после TASK_7.
- Frontend UX подключений с indicator'ом TRIAL_EXPIRED/SUSPENDED/CLOSED состояния и расширенными hint'ами per-action — TASK_6.
- Observability runbook + QA matrix — TASK_7.
- Координация с warehouses/inventory/finance модулями для согласованного effective runtime — частично уже в diagnostics `effectiveRuntimeState` (TASK_4); отдельный cross-module synchronization-таск может быть в `09-sync` или `10-orders`.
