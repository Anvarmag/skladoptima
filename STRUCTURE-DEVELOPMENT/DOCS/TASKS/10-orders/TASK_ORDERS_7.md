# TASK_ORDERS_7 — QA, Regression и Observability

> Модуль: `10-orders`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `10h`
- Зависимости:
  - `TASK_ORDERS_1`
  - `TASK_ORDERS_2`
  - `TASK_ORDERS_3`
  - `TASK_ORDERS_4`
  - `TASK_ORDERS_5`
  - `TASK_ORDERS_6`
- Что нужно сделать:
  - покрыть тестами new FBS/FBO order, duplicate event, out-of-order event, cancel, fulfill, unmatched SKU;
  - добавить кейс `return_logged` без auto-restock;
  - проверить, что FBS order без warehouse scope не применяет stock-effect;
  - покрыть сценарии `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED` для blocked external ingestion;
  - завести метрики по duplicate rate, unresolved orders, stock effect failures и timeline processing latency.
- Критерий закрытия:
  - регрессии по idempotency и inventory side-effects ловятся автоматически;
  - observability показывает реальные operational проблемы orders;
  - тестовая матрица покрывает утвержденную MVP state machine.

**Что сделано**

### 1. Регрессионные spec'и (4 файла, 48 проходящих тестов)

#### [order-status-mapper.spec.ts](apps/api/src/modules/orders/order-status-mapper.spec.ts) — 18 тестов

Чистая логика mapper'а без mock'ов БД. Покрывает:
- **WB dictionary**: `new/waiting → RESERVED`, `confirm/sorted → INTERMEDIATE`, `sold/delivered → FULFILLED`, все cancel-варианты → `CANCELLED`.
- **Ozon dictionary**: `awaiting_* → RESERVED`, `delivering/driver_pickup/sent_by_seller → INTERMEDIATE`, `delivered → FULFILLED`, `cancelled/not_accepted → CANCELLED`.
- **FBO** всегда `INTERMEDIATE` независимо от external (§13).
- **Unknown статусы** → `INTERMEDIATE` с `reason='unknown_status'`.
- **Case-insensitive** (`NEW`, `New ` обрабатываются как `new`).
- **`resolveInitialStatus`**: FBO → DISPLAY_ONLY_FBO; FBS+unmatched → UNRESOLVED; FBS+matched → mapper или IMPORTED fallback.
- **`isTransitionAllowed`** state machine §13: терминальные состояния не покидаются (защита §20), `IMPORTED → *` разрешено, `UNRESOLVED → RESERVED` разрешено, `RESERVED → IMPORTED` запрещён, no-op (`from===to`) разрешён.

#### [orders-ingestion.spec.ts](apps/api/src/modules/orders/orders-ingestion.spec.ts) — 11 тестов

Покрывает §16 тестовую матрицу через mock-prisma + spy на effects:
- **Новый FBS+matched** → `effects.applyTransitionEffect` вызывается с `{from: IMPORTED, to: RESERVED}`, `stockEffectStatus=APPLIED` записывается в Order.
- **Новый FBO** → `internalStatus=DISPLAY_ONLY_FBO`, `affectsStock=false`, `stockEffectStatus=NOT_REQUIRED`, effects **НЕ** вызывается.
- **Новый FBS с unmatched SKU** → `internalStatus=UNRESOLVED`, effects **НЕ** вызывается.
- **Duplicate event** (existing `OrderEvent` через `findUnique`) → `DUPLICATE_IGNORED`, ни transaction, ни effects не запускаются.
- **Out-of-order event** (`occurredAt < processedAt`) → `OUT_OF_ORDER_IGNORED` event пишется, но upsert и effects не выполняются.
- **TRIAL_EXPIRED / SUSPENDED / CLOSED** preflight → `BLOCKED_BY_POLICY`, нет ни одного DB-write.
- **Cancel/fulfill** для existing RESERVED заказа → пишутся 3 event'а (`RECEIVED`, `STATUS_CHANGED`, `RESERVE_RELEASED`), `effects.applyTransitionEffect({from: RESERVED, to: CANCELLED})` вызывается.
- **Метрики**: `duplicate_order_events` инкрементируется на дубль; `observeLatency` на каждом исходе; `order_ingest_blocked_by_tenant` для paused.

#### [order-inventory-effects.spec.ts](apps/api/src/modules/orders/order-inventory-effects.spec.ts) — 14 тестов

Покрывает §14 + §16 inventory contract:
- **FBS RESERVED** → `inventory.reserve(tenantId, "order:<id>:reserve", items)` (стабильный sourceEventId).
- **FBS RESERVED→CANCELLED** → `inventory.release(tenantId, "order:<id>:release", ...)`.
- **FBS RESERVED→FULFILLED** → `inventory.deduct(tenantId, "order:<id>:deduct", ...)`.
- **FBS IMPORTED→CANCELLED** (без резерва) → `NOT_REQUIRED`, release **НЕ** вызывается.
- **FBO** → `NOT_REQUIRED`, никаких inventory вызовов даже если caller просит RESERVED.
- **FBS без `warehouseId`** → `STOCK_EFFECT_FAILED` event с `payload.reason='UNRESOLVED_SCOPE'`, status=`FAILED`, inventory **НЕ** вызывается (§14: не silent reserve в никуда).
- **FBS с `productId=null`** (UNMATCHED) → так же `FAILED`.
- **Inventory `IGNORED+!idempotent`** (paused tenant) → `BLOCKED`.
- **Inventory `IGNORED+idempotent`** (повтор того же `sourceEventId`) → `APPLIED`.
- **Inventory exception** → `STOCK_EFFECT_FAILED` event с `reason='INVENTORY_EXCEPTION'`.
- **`logReturn` для FBS** → `inventory.logReturn` вызывается + `RETURN_LOGGED` event с `autoRestock:false` (§10: no auto-restock).
- **`logReturn` для FBO** → no-op (FBO returns в MVP не отслеживаются).

#### [orders.metrics.spec.ts](apps/api/src/modules/orders/orders.metrics.spec.ts) — 4 теста

- `increment` накапливает counter, `snapshot()` возвращает значения.
- `observeLatency` считает p50/p95 по скользящему окну.
- Окно ограничено 200 значениями (вытеснение старых).
- `reset()` обнуляет состояние.

### 2. Observability — [orders.metrics.ts](apps/api/src/modules/orders/orders.metrics.ts)

Новый сервис `OrdersMetricsRegistry` — process-local in-memory counters + structured-логи. **Не Prometheus client** сознательно: integration с pull-scraper'ом и cardinality control — отдельная инфра-задача; для MVP достаточно log-based metrics через Loki/Datadog (Datadog умеет считать events на пайплайне).

Все §19 метрики из system-analytics реализованы как стабильные имена в `OrdersMetricNames`:

| Имя | Когда инкрементируется |
|---|---|
| `orders_ingested` | Каждый успешный INGESTED исход |
| `duplicate_order_events` | Дубль через `findUnique` или race на P2002 |
| `out_of_order_ignored` | Event старше `processedAt` |
| `status_mapping_failures` | Mapper вернул `INTERMEDIATE` с `reason='unknown_status'` |
| `unmatched_sku_orders` | Заказ оказался в `UNRESOLVED` после ingestion |
| `order_side_effect_failures` | `stockEffectStatus=FAILED` после applyTransitionEffect, или ingest exception |
| `order_ingest_blocked_by_tenant` | Preflight отказал с reason TENANT_TRIAL_EXPIRED/SUSPENDED/CLOSED |
| `order_timeline_processing_latency_ms` | Wall-clock от вызова `ingest()` до `return` (полный preflight + tx + inventory) |
| `order_reprocess_invoked` | Зарезервировано для TASK reprocess instrumentation (метрика-имя стабильна, инжект сделает следующая итерация) |

`OrdersMetricsRegistry.snapshot()` отдаёт `{counters, latency: {count, p50, p95}}` — готов к подключению как `/health/orders` endpoint в будущем (TASK на дашборды).

Labels включают `tenantId`, `marketplace`, `fulfillmentMode`, `reason`, `source` — пишутся в structured-логе, локально не аггрегируются (cardinality control делает scraper).

### 3. Интеграция metrics в ingestion

`OrdersIngestionService` теперь принимает `OrdersMetricsRegistry` через DI. Внутри `ingest()`:
- Старт `Date.now()` в начале и `observeAndReturn()` обёртка вокруг каждого return — гарантирует latency-измерение **на любом исходе**, а не только на happy path.
- Inкременты на каждом из 7 исходов (INGESTED / DUPLICATE / OUT_OF_ORDER / BLOCKED_BY_POLICY / FAILED / status_mapping_failed / unmatched_sku_orders).

### 4. Проверки

```
$ npx tsc --noEmit -p tsconfig.json | grep -E "orders" | wc -l
0  (новых ошибок нет)

$ npx jest --testPathPatterns="modules/orders"
PASS src/modules/orders/orders-ingestion.spec.ts
PASS src/modules/orders/order-status-mapper.spec.ts
PASS src/modules/orders/orders.metrics.spec.ts
PASS src/modules/orders/order-inventory-effects.spec.ts
Test Suites: 4 passed, 4 total
Tests:       48 passed, 48 total
```

### 5. Соответствие §16 тестовой матрице

| Сценарий из §16 | Покрыто spec'ом |
|---|---|
| Новый FBS order | `orders-ingestion.spec.ts` ✓ |
| Новый FBO order | `orders-ingestion.spec.ts` ✓ |
| Duplicate event того же заказа | `orders-ingestion.spec.ts` ✓ |
| Out-of-order event после более нового статуса | `orders-ingestion.spec.ts` ✓ |
| Cancel order после reserve | `orders-ingestion.spec.ts` + `order-inventory-effects.spec.ts` ✓ |
| Fulfill order после reserve | `order-inventory-effects.spec.ts` ✓ |
| Return event без автопополнения stock | `order-inventory-effects.spec.ts` ✓ |
| Unmatched SKU в order item | `orders-ingestion.spec.ts` + `order-inventory-effects.spec.ts` ✓ |
| FBS order без warehouse scope не применяет stock-effect | `order-inventory-effects.spec.ts` ✓ |
| `TRIAL_EXPIRED` блокирует новые order side-effects | `orders-ingestion.spec.ts` ✓ (+ SUSPENDED + CLOSED) |
| Внешний `PACKED/SHIPPED` не создаёт новый внутренний inventory-critical статус | `order-status-mapper.spec.ts` ✓ |

### 6. DoD сверка

- ✅ **Регрессии по idempotency и inventory side-effects ловятся автоматически**: дубль/out-of-order/sourceEventId race/unresolved scope/inventory exception — все проверены unit-тестами с моканной БД и spy на inventory.
- ✅ **Observability показывает реальные operational проблемы**: 8 структурированных метрик (counters + latency) покрывают весь набор §19 dashboard'ов: ingestion volume, duplicate rate, out-of-order, status mapping failures, unmatched backlog, side-effect failures, blocked-by-tenant, processing latency p50/p95.
- ✅ **Тестовая матрица покрывает утверждённую MVP state machine**: все 11 строк §16 закрыты + дополнительно state machine guard (терминальные не покидаются), case-insensitive статусы, no-op transitions.

### 7. Что НЕ сделано (за пределами scope §11)

- **`/health/orders` endpoint** — публичный snapshot метрик через REST. Реестр готов, controller добавится в отдельной задаче на operational dashboards.
- **`order_reprocess_invoked` инжект** — имя зарезервировано в `OrdersMetricNames`, но `OrdersReprocessService` пока не дёргает counter. Чисто instrumentation-tweak, добавляется одной строкой в TASK на reprocess analytics.
- **Property-based tests на mapper** — mapper-spec покрывает все enum-значения вручную; добавление fast-check для рандомизированных кейсов не требуется в scope MVP.
- **E2E test через `supertest`** на `/api/orders/...` endpoints — рамки jest unit; e2e setup в `test/jest-e2e.json` существует, но требует поднятой БД, выходит за scope этой задачи.
