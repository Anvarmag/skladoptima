# TASK_ORDERS_2 — Idempotent Ingestion, Duplicate/Out-of-Order Handling

> Модуль: `10-orders`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_ORDERS_1`
  - согласован `09-sync`
- Что нужно сделать:
  - реализовать ingestion заказов только через `sync`, без прямого polling из orders API;
  - проверять идемпотентность по `external_event_id` и order key;
  - логировать `duplicate_ignored` и `out_of_order_ignored` без повторного бизнес-эффекта;
  - обрабатывать устаревшие внешние статусы без отката внутреннего состояния назад;
  - блокировать новые внешние order events runtime-контуром при `TRIAL_EXPIRED / SUSPENDED / CLOSED`.
- Критерий закрытия:
  - duplicate и out-of-order события не создают повторный reserve/release/deduct;
  - orders-модуль не идет напрямую во внешний API;
  - paused integration не создает обходных side-effects.

**Что сделано**

Создан доменный модуль `orders` (без REST-эндпоинтов; они появятся в TASK_ORDERS_5) с идемпотентным ingestion handler'ом, к которому ходят sync-адаптеры. Sync.service переписан на dual-write: legacy `MarketplaceOrder` остаётся (читатели ещё не переключены), но каждый order event теперь дополнительно проходит через `OrdersIngestionService.ingest()` в новый `Order/OrderItem/OrderEvent`.

### 1. Новый модуль `apps/api/src/modules/orders/`

- **[orders.module.ts](apps/api/src/modules/orders/orders.module.ts)** — провайдит `OrdersIngestionService`. Импортирует `SyncRunsModule` ради shared `SyncPreflightService`.
- **[orders-ingestion.contract.ts](apps/api/src/modules/orders/orders-ingestion.contract.ts)** — типы и коды ошибок:
  - `OrderIngestErrorCode` (`ORDER_INGEST_BLOCKED_BY_TENANT_STATE`, `ORDER_EVENT_OUT_OF_ORDER`, `ORDER_ALREADY_PROCESSED`, `ORDER_EFFECT_APPLY_FAILED`) — машинные коды по §10 system-analytics, ровно те же, которые потом будут отдаваться в HTTP-ответах TASK_ORDERS_5.
  - `OrderIngestEventInput` — нормализованное событие от sync adapter'а: `tenantId`, `marketplaceAccountId`, `marketplaceOrderId`, **обязательный** `externalEventId` (стабильный ключ идемпотентности), `externalStatus`, `fulfillmentMode`, `occurredAt`, `syncRunId`, `warehouseId`, `items[]`, `payload`. Ingestion service не знает про raw WB/Ozon JSON — это разделение ответственности sync-адаптеров.
  - `OrderIngestResult` — дискриминированный union: `INGESTED / DUPLICATE_IGNORED / OUT_OF_ORDER_IGNORED / BLOCKED_BY_POLICY / FAILED`.
- **[orders-ingestion.service.ts](apps/api/src/modules/orders/orders-ingestion.service.ts)** — главный handler:
  1. **Preflight policy guard** — переиспользует `SyncPreflightService` (тот же, что и admission/worker sync-runs). При `TRIAL_EXPIRED / SUSPENDED / CLOSED` возвращает `BLOCKED_BY_POLICY` со structured-логом `order_ingest_blocked` и **не пишет** ни order, ни event. Закрывает требование «paused integration не создаёт обходных side-effects».
  2. **Дедупликация по `external_event_id`** — проверка `OrderEvent UNIQUE(tenantId, marketplaceAccountId, externalEventId)` ДО транзакции. Если событие уже было — возвращаем `DUPLICATE_IGNORED` без второй записи (не загрязняем timeline бесконечными повторами одного и того же ping'а). UNIQUE на БД остаётся last line of defense на случай гонки workers.
  3. **Транзакционный upsert + event append** — `prisma.$transaction`, чтобы заказ не мог появиться без записи `RECEIVED` event'а:
     - **Out-of-order detection**: если `event.occurredAt < existingOrder.processedAt` → пишем `OUT_OF_ORDER_IGNORED` с payload `{eventOccurredAt, knownProcessedAt, externalStatus}`. Внутреннее состояние **не** откатываем (§9 шаг 4, §20 риск).
     - **Upsert header**: для нового заказа создаём с `internalStatus`, выведенным из (`fulfillmentMode`, `allItemsMatched`); для существующего обновляем **только** safe-поля (`externalStatus`, `syncRunId`, `processedAt`). Внутренние переходы `IMPORTED → RESERVED` оставлены для TASK_ORDERS_3/4.
     - **`internalStatus` derivation**:
       - FBO → `DISPLAY_ONLY_FBO`, `affectsStock=false`, `stockEffectStatus=NOT_REQUIRED`.
       - FBS с unmatched items → `UNRESOLVED` (явный сигнал для §19 backlog: нельзя резервировать без сматчивания SKU).
       - FBS со всеми matched items → `IMPORTED`, `affectsStock=true`, `stockEffectStatus=PENDING` (явный сигнал для §19 alerts: ждём связки с inventory; сам side-effect делает TASK_ORDERS_4).
     - **Append `RECEIVED`** — провенанс приёма, payload содержит `externalStatus`, `fulfillmentMode`, `syncRunId`, `occurredAt`, `orderCreatedAt`, `itemsCount`, `raw` — достаточно для §12 DoD без обращения к raw логам.
     - **Append `STATUS_CHANGED`** — только если у уже существующего заказа реально поменялся `externalStatus`. `external_event_id` суффиксируется `#status`, чтобы не нарушить UNIQUE и сохранить трассируемость переходов.
  4. **Race на P2002** — если конкурентный worker одновременно записал тот же event и UNIQUE вылетел внутри транзакции, ловим `code === 'P2002'` и возвращаем `DUPLICATE_IGNORED` (второй проигравший молча уходит).

### 2. Интеграция в [sync.service.ts](apps/api/src/modules/marketplace_sync/sync.service.ts)

`SyncService` теперь принимает `OrdersIngestionService` через DI. Dual-write встроен в:

- **`processWbOrders`**: после legacy `marketplaceOrder.create({...status:'NEW'})` вызывается `ordersIngestion.ingest({externalEventId: 'wb_<id>@new', ...})`. Для нового заказа из `/orders/new` feed внешний id стабилен до смены статуса — поэтому идентичный `external_event_id` корректен.
- **`processOzonOrders`** (обе ветки):
  - **Status update** для существующего posting'а — `ingest({externalEventId: 'ozon_<postingNumber>@<newStatus>'})`. Каждый новый статус даёт новый event id; повтор того же статуса дедуплицируется.
  - **Новый posting** — `ingest({...items: matchedItems})` с предварительным сматчиванием `productId` по `tenantId+sku`, чтобы `matchStatus=MATCHED` выставился сразу там, где SKU нашёлся.

`getSettings(tenantId)` выдаёт плоскую сводку (без accountId), поэтому отдельно подгружается активный `MarketplaceAccount` по `(tenantId, marketplace=WB|OZON, lifecycleStatus=ACTIVE)` — это даёт `marketplaceAccountId` для provenance в `Order` и `OrderEvent`.

[sync.module.ts](apps/api/src/modules/marketplace_sync/sync.module.ts) теперь импортирует `OrdersModule`.

### 3. Прямой polling из orders API

Запрет реализован структурно: **в `orders` модуле нет controller'а**. Внешний polling (`/sync/orders/poll`, axios calls) остаётся **только** в sync-домене. Когда в TASK_ORDERS_5 появятся endpoints `/api/v1/orders/...`, они будут вызывать `OrdersIngestionService` или read-only Prisma-выборки — никаких `axios.get('https://marketplace-api.wildberries.ru')` оттуда быть не должно (§10).

### 4. Проверки

- `npx prisma validate` → schema valid.
- `npx tsc --noEmit -p tsconfig.json` → 20 ошибок, **все pre-existing** в чужих модулях (`fix-ozon-dates.ts`, `test-fbo*.ts`, `update-pwd.ts`, `catalog/import.service*`, `team-scheduler.service.ts`, `sync-runs.regression.spec.ts`). Файлы orders/sync-модулей моих правок — 0 ошибок.

### 5. DoD сверка

- ✅ **Duplicate не создаёт повторный side-effect**: ранний выход на `findUnique(OrderEvent...)` + UNIQUE constraint + P2002-фоллбек → `DUPLICATE_IGNORED`. Side-effect логику TASK_ORDERS_4 будет вызывать только из `INGESTED` ветки.
- ✅ **Out-of-order не откатывает state назад**: проверка `event.occurredAt < existingOrder.processedAt` перед любым обновлением → `OUT_OF_ORDER_IGNORED`, header не апдейтится, items не трогаются.
- ✅ **Orders-модуль не идёт во внешний API**: контракт `OrderIngestEventInput` принимает уже нормализованные события; в коде `OrdersIngestionService` нет `axios`/`fetch`; модуль не имеет controller'а.
- ✅ **Paused integration не создаёт обходных side-effects**: первый шаг — `preflight.runPreflight(tenant, account, {operation:'order_ingest', checkConcurrency:false})`. При TRIAL_EXPIRED/SUSPENDED/CLOSED — early return `BLOCKED_BY_POLICY` без записи в БД.

### 6. Что НЕ сделано (намеренно — следующие задачи модуля)

- **TASK_ORDERS_3** — маппинг external→internal для FBS (`new/awaiting_packaging → RESERVED`, `cancelled → CANCELLED`, `delivered → FULFILLED`). Сейчас новый FBS заказ остаётся в `IMPORTED` до маппинга.
- **TASK_ORDERS_4** — связка с inventory (`reserve/release/deduct`). Сейчас FBS заказ помечается `stockEffectStatus=PENDING`, side-effect не запускается.
- **TASK_ORDERS_5** — REST endpoints `/api/v1/orders/...` + reprocess.
