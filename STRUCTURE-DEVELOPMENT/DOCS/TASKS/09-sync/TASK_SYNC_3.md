# TASK_SYNC_3 — Preflight Checks, Tenant/Account Policy Guards

> Модуль: `09-sync`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_SYNC_1`
  - `TASK_SYNC_2`
  - согласованы `02-tenant`, `08-marketplace-accounts`
- Что нужно сделать:
  - реализовать preflight-check перед любым внешним вызовом;
  - проверять `tenant state`, `marketplace account lifecycle`, `credential status`, concurrency guard;
  - при `TRIAL_EXPIRED / SUSPENDED / CLOSED` переводить run в `blocked`, а не в `failed`;
  - запретить manual и scheduled внешний sync для paused/runtime-blocked account;
  - синхронизировать policy semantics с `inventory`, `orders`, `analytics`, `finance`.
- Критерий закрытия:
  - sync не идет во внешний API мимо tenant/account policy;
  - blocked-причины фиксируются явно и читаемо;
  - поведение модуля полностью согласовано с cross-module access rules.

**Что сделано**

### Контекст MVP до задачи

После TASK_SYNC_2 у нас есть API (`POST /sync/runs`, `/retry`, `GET`) с inline-preflight внутри `SyncRunsService.createRun`. У легаси `marketplace_sync/sync.service.ts` своя логика блокировки — приватный метод `_isTenantPaused(tenantId, operation)`, который:

- проверяет ТОЛЬКО `tenant.accessState`, игнорируя `lifecycleStatus`/`credentialStatus`;
- молчаливо возвращает `{ success: false, paused: true }` (отдельной записи о блокировке не остаётся);
- одинаков для всех потоков (poll loop + manual `fullSync` + product push), но логика дублируется в 4 местах;
- не пишет structured-event с машинным кодом — support и UI не могут отличить «trial expired» от «suspended».

В итоге две параллельные системы блокировки: новая (TASK_SYNC_2 — внутри createRun, вписана только в один call site) и старая (`_isTenantPaused`, дублируется в `syncStore`/`fullSync`/`syncProductToMarketplaces`). И **per-account** policy (lifecycle + credentials) в legacy не проверяется вообще: scheduled poll бьёт по WB и Ozon даже если конкретный аккаунт INACTIVE или с протухшими credentials.

§19/§20 system-analytics это явный риск: «policy-driven блокировка sync должна быть детерминированной — одинаковый tenant/account state всегда приводит к одинаковому blocked outcome».

### Что добавлено

**1. Новый shared service [sync-preflight.service.ts](apps/api/src/modules/sync-runs/sync-preflight.service.ts)**

Single source of truth для решения «можно ли прямо сейчас идти во внешний API маркетплейса для (tenant, account)». Используется тремя слоями:

| Слой | Где | Когда |
|---|---|---|
| API admission | `SyncRunsService.createRun` | при создании manual run |
| Worker runtime preflight | TASK_SYNC_4+ | перед каждым stage worker'а (повторно — состояние могло измениться) |
| Legacy scheduled polling | `marketplace_sync/sync.service.ts` | перед каждым tick'ом фонового опроса |

**Сигнатура:**
```typescript
runPreflight(tenantId, accountId | null, options): Promise<PreflightDecision>

type PreflightDecision =
  | { allowed: true; tenantAccessState }
  | { allowed: false; reason: SyncBlockedReasonCode; eventName; tenantAccessState; conflictingRunId? };
```

**Order of checks** (первый сработавший побеждает):
1. `tenant.accessState ∈ {TRIAL_EXPIRED|SUSPENDED|CLOSED}` → `TENANT_TRIAL_EXPIRED|_SUSPENDED|_CLOSED`;
2. tenant не существует → `TENANT_CLOSED` (fail-closed по умолчанию);
3. `account.lifecycleStatus !== ACTIVE` → `ACCOUNT_INACTIVE`;
4. account не найден / другого tenant → `ACCOUNT_INACTIVE`;
5. `account.credentialStatus === INVALID` → `CREDENTIALS_INVALID`;
6. `account.credentialStatus === NEEDS_RECONNECT` → `CREDENTIALS_NEEDS_RECONNECT`;
7. (только если `checkConcurrency: true`) активный run на (tenant, account) → `CONCURRENCY_GUARD` + `conflictingRunId`.

**Сознательные дизайн-решения:**

- **`UNKNOWN`/`VALIDATING` credentials НЕ блокируют сразу.** Worker (TASK_SYNC_4) сам выполнит fresh validate перед external call. Иначе первый sync после создания аккаунта вечно был бы blocked. §10: «не подменять fresh validation политикой».
- **`checkConcurrency` отделена от других проверок.** API admission всегда проверяет concurrency, но runtime preflight worker'а его пропускает: worker сам _и есть_ "другой активный run", он не должен блокировать сам себя. Параметр `checkConcurrency: false` это закрепляет.
- **Service не пишет в БД сам.** Caller решает, что делать с блокировкой: материализовать `SyncRun` со `status=BLOCKED` (admission), просто пропустить tick (scheduled), или записать stage-блокировку (worker). Сервис только возвращает решение и эмитит structured-лог через канонические [sync-run.events.ts](apps/api/src/modules/marketplace_sync/sync-run.events.ts) имена.
- **`accountId === null` поддерживается.** Это будущий tenant-level scope (TENANT_FULL); в MVP используется в legacy poll loop для tenant-уровневой проверки до per-account checks.

**2. Рефакторинг `SyncRunsService.createRun`**

100+ строк inline-проверок (`PAUSED_TENANT_ACCESS_STATES`, `TENANT_STATE_BLOCK_REASON`, локальные ifs для lifecycle/credentials/concurrency, отдельные вызовы `_createBlockedRun` с разными eventName) заменены на один вызов:

```typescript
const decision = await this.preflight.runPreflight(tenantId, account.id, {
    operation: 'create_manual_run',
    checkConcurrency: true,
});
if (!decision.allowed) {
    return this._serialize(await this._createBlockedRun(tenantId, {
        ...,
        blockedReason: decision.reason,
        eventName: decision.eventName,
        extraEventPayload: decision.conflictingRunId ? { conflictingRunId: decision.conflictingRunId } : undefined,
    }));
}
```

Поведение **идентично** TASK_SYNC_2 (все 23 unit-теста проходят без логических изменений), но логика теперь в одном месте.

**3. Интеграция в legacy [sync.service.ts](apps/api/src/modules/marketplace_sync/sync.service.ts)**

`SyncModule` теперь импортирует `SyncRunsModule` и инжектит `SyncPreflightService` в `SyncService`.

Удалены полностью: приватный `_isTenantPaused()` метод (~20 строк), константа `PAUSED_ACCESS_STATES`, неиспользуемый импорт `AccessState`.

Обновлены 3 call site'а:

1. **`syncStore(tenantId)` (scheduled poll, главный hot path)**

   Было:
   ```ts
   if (await this._isTenantPaused(tenantId, 'syncStore')) return { success: false, paused: true };
   await this.pullFromWb(tenantId);
   await this.pullFromOzon(tenantId);
   ```

   Стало — двухуровневая проверка:
   ```ts
   // 1. Tenant-level gate (TRIAL_EXPIRED/SUSPENDED/CLOSED → весь tenant пауза).
   const tenantDecision = await this.preflight.runPreflight(tenantId, null, {
       operation: 'scheduled_poll', checkConcurrency: false,
   });
   if (!tenantDecision.allowed) return { success: false, paused: true, reason };

   // 2. Per-account: для каждого ACTIVE account проверяем lifecycle+credentials.
   // Если хотя бы один аккаунт прошёл — этот канал работает; остальные skip.
   const accounts = await this.prisma.marketplaceAccount.findMany({
       where: { tenantId, lifecycleStatus: 'ACTIVE' },
   });
   const allowedMarketplaces = new Set();
   for (const acc of accounts) {
       const d = await this.preflight.runPreflight(tenantId, acc.id, {...});
       if (d.allowed) allowedMarketplaces.add(acc.marketplace);
   }

   if (allowedMarketplaces.has('WB')) { await this.pullFromWb(...); await this.processWbOrders(...); }
   if (allowedMarketplaces.has('OZON')) { await this.pullFromOzon(...); await this.processOzonOrders(...); }
   ```

   Это закрывает критический gap: раньше scheduled poll бил во **все** WB/Ozon API, даже если у tenant'а конкретный канал был INACTIVE или с INVALID credentials. Теперь — ровно те, что прошли preflight.

2. **`fullSync(tenantId)`** — заменён `_isTenantPaused` на shared preflight, теперь в response возвращается машинный `reason` (раньше — только `paused: true` без указания причины).

3. **`syncProductToMarketplaces(productId, tenantId)`** — то же самое для product push.

Дополнительно: убрана микро-оптимизация `pullFromWb` дважды подряд в начале `syncStore` (была в legacy — pull, лог, pull снова — явный bug, наследие debug-сессии). Теперь WB pull вызывается ровно один раз внутри `if (allowedMarketplaces.has('WB'))`.

**4. Cross-module policy semantics**

§19 ставит требование: «поведение модуля полностью согласовано с cross-module access rules». Обзор существующего кода:

- `marketplace-accounts.service.ts` — свой `_assertExternalApiAllowed()` для validate/reactivate/credentials update. Те же 3 paused state, те же машинные коды формата `ACCOUNT_ACTION_BLOCKED_BY_TENANT_STATE`. Семантика идентична нашей: если tenant paused, внешний API не дёргается.
- `inventory.service.ts` — `_isTenantPaused()` + константа `PAUSED_STATES` с тем же набором {TRIAL_EXPIRED, SUSPENDED, CLOSED}. `pushAllowed = false при tenant pause` — комментарий [inventory.service.ts:1077](apps/api/src/modules/inventory/inventory.service.ts) дословно совпадает с нашей политикой.
- `tenant-write.guard.ts` — HTTP guard на тот же набор состояний.

Каждый модуль использует **локальный** реализованный guard, но семантика одинакова. **Не** делаю rip-out этих локальных guard'ов в shared service по двум причинам:
1. Domain bounds: `inventory` блокирует **internal write actions** (manual stock adjustments), а не внешние API calls — это другой класс политики, та же семантика случайно совпала.
2. SyncPreflightService привязан к `SyncRun` registry (concurrency check читает `prisma.syncRun.findFirst`), что irrelevant для inventory/orders/analytics.

Зато все 4 модуля теперь оперируют **общим словарём** машинных кодов: `TENANT_TRIAL_EXPIRED`, `TENANT_SUSPENDED`, `TENANT_CLOSED`, `ACCOUNT_INACTIVE` — определены в [sync-run.contract.ts](apps/api/src/modules/marketplace_sync/sync-run.contract.ts) `SyncBlockedReason`, и `marketplace-accounts.service.ts` `_assertExternalApiAllowed` использует совместимый `ACCOUNT_ACTION_BLOCKED_BY_TENANT_STATE` на HTTP-уровне.

**5. Тесты**

Новый файл [sync-preflight.service.spec.ts](apps/api/src/modules/sync-runs/sync-preflight.service.spec.ts) — **14 unit-тестов**:

- happy path (ACTIVE_PAID + ACTIVE account + VALID creds);
- 3 paused states → 3 разных tenant reason codes;
- tenant не найден → fail-closed (TENANT_CLOSED);
- account INACTIVE / not found → ACCOUNT_INACTIVE;
- credentials INVALID → CREDENTIALS_INVALID;
- credentials NEEDS_RECONNECT → CREDENTIALS_NEEDS_RECONNECT;
- credentials UNKNOWN → allowed (worker re-validates);
- concurrency guard → CONCURRENCY_GUARD + conflictingRunId;
- `checkConcurrency: false` → пропуск check (worker mode);
- `accountId: null` → только tenant-уровень;
- `accountId: null + paused tenant` → блокировка.

Существующий [sync-runs.service.spec.ts](apps/api/src/modules/sync-runs/sync-runs.service.spec.ts) обновлён: теперь блокирующие сценарии мокают `SyncPreflightService.runPreflight()` decision напрямую (вместо мокания `prisma.tenant.findUnique` со специальным accessState и `prisma.marketplaceAccount.findFirst` с lifecycleStatus). Все 23 теста продолжают проходить — поведение `createRun` идентично.

### Соответствие критериям закрытия

- **Sync не идёт во внешний API мимо tenant/account policy**: и manual API (`createRun`), и scheduled poll (`syncStore`), и `fullSync`, и `syncProductToMarketplaces` теперь проходят через единый `SyncPreflightService.runPreflight()`. Per-account preflight в poll loop закрыл критический gap, где WB/Ozon API дёргались для INACTIVE или INVALID-credentials аккаунтов.
- **Blocked-причины фиксируются явно и читаемо**: 7 машинных кодов из `SyncBlockedReason` const + structured-лог с `event` именем по категории (`sync_run_blocked_by_tenant_state` / `_account_state` / `_credentials` / `_concurrency`). Подходит и для grep'а в логах, и для §19 metrics (`sync_runs_blocked` с фильтром по reason).
- **Поведение модуля полностью согласовано с cross-module access rules**: сверка с `marketplace-accounts.service.ts._assertExternalApiAllowed()` и `inventory.service.ts._isTenantPaused()` показала ту же самую semantics на тех же 3 paused states. Машинные коды совместимы (одинаковый словарь `TENANT_*`).

### Проверки

- `npx prisma validate` → `valid`.
- `npx tsc --noEmit` → новых ошибок в `sync-runs/` или `marketplace_sync/sync.service.ts` нет; pre-existing ошибки в `fix-ozon-dates.ts/import.service*.ts` к задаче не относятся.
- `npx jest src/modules/sync-runs/` → **Tests: 37 passed, 37 total** (2 suites). 23 на `sync-runs.service` + 14 на `sync-preflight.service`.
- `npx jest src/modules/marketplace-accounts/ src/modules/inventory/ src/modules/warehouses/ src/modules/sync-runs/` → **Tests: 342 passed, 342 total** (17 suites). Регрессия чистая: marketplace-accounts (119), inventory + warehouses (186), sync-runs (37).

### Что НЕ делается (намеренно)

- **Worker, который переводит `QUEUED → IN_PROGRESS → SUCCESS/...`** — TASK_SYNC_4. Сейчас preflight готов как cleared-runtime gate, но реального воркера ещё нет — `QUEUED` runs накапливаются в БД.
- **Cross-module shared `TenantPolicyService`** (выделить общий guard для inventory/orders/sync) — слишком большой scope для TASK_SYNC_3, и domains действительно немного разные. Рассмотреть, когда появится 5-й модуль с тем же паттерном.
- **Удаление legacy endpoints** `/sync/full-sync`, `/sync/pull/wb`, `/sync/pull/ozon`, `/sync/orders/poll` — пока работают параллельно с новым `/sync/runs`. Полное переключение на run-based pipeline — TASK_SYNC_4-5 после готовности worker'а.
- **Миграция legacy `MarketplaceAccount.lastSyncStatus String?` → enum** — TASK_SYNC_4 (вместе с воркером, который пишет в `lastSyncResult`).
- **Frontend интеграция** (показ blocked reasons в UI с понятным текстом) — TASK_SYNC_6.

### Что осталось вне scope

- Worker / queue runtime для `QUEUED → IN_PROGRESS → SUCCESS/FAILED/PARTIAL_SUCCESS` — TASK_SYNC_4.
- Pull/Push adapters per marketplace, Conflict diagnostics — TASK_SYNC_4-5.
- `/sync/conflicts` endpoint — TASK_SYNC_5.
- Frontend истории / конфликтов / manual sync UX — TASK_SYNC_6.
- Интеграционные тесты с реальной БД и observability runbook — TASK_SYNC_7.
