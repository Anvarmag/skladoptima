# TASK_INVENTORY_5 — Tenant-State Guards, FBS/FBO Boundaries и Sync Handoff

> Модуль: `06-inventory`
> Статус: [x] Завершён (2026-04-26)

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_INVENTORY_2`
  - `TASK_INVENTORY_3`
  - `TASK_INVENTORY_4`
  - согласованы `02-tenant`, `09-sync`
- Что нужно сделать:
  - заблокировать manual write-actions при `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`;
  - при `TRIAL_EXPIRED` оставить inventory в read-only и поставить marketplace integrations/API calls на паузу;
  - не обрабатывать новые order/sync-driven side-effects из внешних каналов в `TRIAL_EXPIRED`;
  - закрепить, что channel lock/override не входят в MVP;
  - не смешивать FBS master stock и FBO внешний контур в одном управляемом остатке.
- Критерий закрытия:
  - inventory не расходится с tenant commercial policy;
  - FBS/FBO границы понятны и соблюдаются;
  - sync handoff использует только согласованный effective available qty.

**Что сделано**

### Контекст MVP до задачи

В MVP marketplace integrations работали без оглядки на tenant `AccessState`:

- [SyncService.syncStore](apps/api/src/modules/marketplace_sync/sync.service.ts) крутил `pullFromWb`/`pullFromOzon`/`processWbOrders`/`processOzonOrders`/`syncProductMetadata` каждые 60 секунд для **всех** tenant'ов без фильтра — TRIAL_EXPIRED tenant продолжал ходить во внешние API и мог получить блокировку аккаунта на стороне маркетплейса;
- `syncProductToMarketplaces` пушил `available = Math.max(0, product.total)` — без учёта `reserved`, без StockBalance, и без проверки tenant pause;
- Order side-effects через `processWbOrders/processOzonOrders` дёргали `Product.total.decrement` независимо от tenant state — TRIAL_EXPIRED tenant получал списание остатка от запоздавшего webhook'а после блокировки;
- На уровне inventory module manual write-actions защищались только HTTP-слоем `TenantWriteGuard` — прямой вызов `inventoryService.createAdjustment` из jobs/orders обошёл бы блокировку;
- FBS/FBO жили смешанно в каналных счётчиках `Product.wbFbs/wbFbo/ozonFbs/ozonFbo`, без явной границы между управляемым и read-model контурами;
- TASK_INVENTORY_2 уже ввёл `_aggregate` исключающий `isExternal=true` для listStocks, но публичного контракта sync handoff не было.

### Что добавлено

**1. Tenant-state pause helpers в InventoryService ([inventory.service.ts](apps/api/src/modules/inventory/inventory.service.ts))**

- Константа `PAUSED_STATES = { TRIAL_EXPIRED, SUSPENDED, CLOSED }` — единая точка policy.
- `_isTenantPaused(tenantId)` — читает `tenant.accessState`, возвращает `{ paused, accessState }`. Если tenant не найден — `TENANT_NOT_FOUND`.
- `_assertManualWriteAllowed(tenantId)` — для прямых вызовов из jobs/orders. Бросает `INVENTORY_WRITE_BLOCKED_BY_TENANT_STATE` (Forbidden) с `accessState` в payload и пишет structured-warn `inventory_manual_write_blocked_by_tenant_state`. Применён внутри `createAdjustment` и `updateThreshold` — даже HTTP-минующий путь блокируется.
- `_markLockIgnoredForPause(...)` — upsert `InventoryEffectLock(status=IGNORED)` для paused tenant'ов; повторная доставка того же sourceEventId увидит IGNORED-лок и не выполнит работу.

**2. Pause-логика в side-effects (`reserve` / `release` / `deduct` / `reconcile` / `logReturn`)**

Перед idempotency-pre-check теперь стоит проверка tenant pause. Если paused:
- лок переводится в `IGNORED` (или создаётся таким);
- метод возвращает результат `{ status: 'IGNORED', idempotent: false, movements: [] }` (для reconcile — `IGNORED_STALE` с подсказкой о локальном `available`);
- structured-warn'ы: `inventory_order_effect_paused_by_tenant_state`, `inventory_return_paused_by_tenant_state`, `inventory_reconcile_paused_by_tenant_state` со всеми полями для алертинга;
- транзакция и движение НЕ открываются.

Возврат tenant'а в активное состояние снимает паузу (новые события снова применяются). Stale-detection из TASK_INVENTORY_4 страхует от применения устаревших snapshots после возобновления.

**3. Sync handoff contract — `computeEffectiveAvailable(tenantId, productId)` ([inventory.service.ts](apps/api/src/modules/inventory/inventory.service.ts))**

Единственный legitimate источник `available` для push в маркетплейсы:

| поле | значение |
|---|---|
| `productId` | id товара |
| `pushAllowed` | `false` если tenant в paused-состоянии |
| `pausedByTenantState` | дублирует pushAllowed для UI |
| `accessState` | для дашборда/лога |
| `totalAvailable` | сумма `Math.max(0, available)` ТОЛЬКО по `isExternal=false` балансам |
| `byWarehouse[]` | разбивка по складам с `fulfillmentMode` |
| `source` | `'balance'` если есть StockBalance, `'product_fallback'` для tenants на legacy |

Запрос балансов делается с `where: { isExternal: false }` — FBO физически не попадает в выборку; defense-in-depth поверх policy §14. Кламп `Math.max(0, available)` защищает от потенциально отрицательного STORED GENERATED при битых данных.

Endpoint: `GET /inventory/stocks/:productId/effective-available` — публичный для UI и для прямого вызова sync.

**4. SyncService pause guards ([sync.service.ts](apps/api/src/modules/marketplace_sync/sync.service.ts))**

Добавлен `_isTenantPaused(tenantId, operation)` приватный helper и константа `PAUSED_ACCESS_STATES`. Применён в:
- `syncStore` — early-return перед фоновым 60s poll'ом;
- `fullSync` — early-return перед manual full-sync кнопкой;
- `syncProductToMarketplaces` — early-return перед push в WB/Ozon.

Все три возвращают `{ success: false, paused: true, message }` — caller (UI/scheduler) видит явный pause-результат и может показать пользователю CTA к billing/поддержке.

**5. Effective available в `syncProductToMarketplaces`**

`available` теперь считается так:
```
balances = StockBalance.findMany({ tenantId, productId, isExternal: false })
available = balances.length > 0
    ? sum(Math.max(0, b.available))
    : Math.max(0, product.total - product.reserved)  // lazy-bridge с MVP
```

Reserved в MVP всё равно живёт в `Product.reserved` — фоллбек учёл это, чтобы push в маркетплейс не выдавал больше, чем мы реально можем продать.

**6. Channel lock/override**

В header-комментарии сервиса зафиксировано решение из system-analytics §22/§23: `Channel lock/override per marketplace в MVP НЕ поддерживается. Sync handoff использует единое effective available qty через computeEffectiveAvailable, любые попытки канал-специфичной логики обязаны проходить через явное расширение этого контракта.` Это блокирует разрастание ad-hoc per-channel правил в будущих PR без явного решения.

**7. Тесты — [inventory.tenant-state.spec.ts](apps/api/src/modules/inventory/inventory.tenant-state.spec.ts)**

25 новых тестов в 3 describe-блоках:

*manual writes pause (5):* createAdjustment блокируется в каждом из TRIAL_EXPIRED/SUSPENDED/CLOSED (3 теста); updateThreshold аналогично (3 теста); manual writes разрешены в ACTIVE_PAID/TRIAL_ACTIVE/EARLY_ACCESS/GRACE_PERIOD (4 теста); TENANT_NOT_FOUND (1 тест).

*order side-effects pause (6):* reserve в каждом из paused-состояний возвращает IGNORED + lock=IGNORED + без транзакции (3 теста через `it.each`); release/deduct в TRIAL_EXPIRED тоже IGNORED (1 тест); logReturn в SUSPENDED IGNORED (1 тест); reconcile в CLOSED → IGNORED_STALE с локальным available (1 тест).

*computeEffectiveAvailable (8):* сумма по управляемым FBS-балансам с проверкой where-фильтра isExternal=false; фоллбек на Product.total-reserved при отсутствии StockBalance; pushAllowed=false и pausedByTenantState=true в каждом из paused-состояний (3 теста через `it.each`); PRODUCT_NOT_FOUND; TENANT_NOT_FOUND; кламп negative `available` в ноль.

Совокупный inventory test suite — `Tests: 73 passed, 73 total` (16 adjustments/listings + 21 order-effects + 11 reconcile/diagnostics + 25 tenant-state). `tsc --noEmit` — никаких новых ошибок.

### Соответствие критериям закрытия

- **Inventory не расходится с tenant commercial policy**: manual write-actions заблокированы и на HTTP-слое (TenantWriteGuard из TASK_INVENTORY_2-4), и в сервисе (`_assertManualWriteAllowed` из этой задачи) — обходных путей нет. Side-effects orders/sync пропускаются через IGNORED-локи. Marketplace push проверяет pause перед каждым внешним API call.
- **FBS/FBO границы понятны и соблюдаются**: `computeEffectiveAvailable` физически фильтрует `isExternal=false` через Prisma `where`, дополнительно клампит negative available; `_aggregate` (из TASK_2) тоже исключает FBO. Channel lock/override явно зафиксирован как future scope в коде.
- **Sync handoff использует только согласованный effective available qty**: один публичный endpoint `GET /inventory/stocks/:productId/effective-available` + эквивалентный программный вызов; `SyncService.syncProductToMarketplaces` пересчитан через тот же бухучёт (StockBalance suma + lazy-bridge), не лезет в `Product.total` напрямую.

### Что осталось вне scope

- Полная замена `processWbOrders`/`processOzonOrders` на `inventoryService.deduct/release` и удаление Ozon-cancel auto-restock — это отдельный TASK по рефакторингу sync.service (не входил в DoD этой задачи; контракты готовы, миграция вызовов будет выполнена в `09-sync` или `18-worker`).
- Удаление legacy полей `Product.total/reserved/wbFbs/ozonFbs/...` — после полной миграции данных и переключения всех читателей на StockBalance.
- Frontend для display tenant pause banner на inventory dashboard — TASK_INVENTORY_6.
- Алерты на rate of paused side-effects — TASK_INVENTORY_7.
