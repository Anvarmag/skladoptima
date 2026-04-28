# TASK_ORDERS_4 — Inventory Side-Effects и FBS/FBO Boundaries

> Модуль: `10-orders`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_ORDERS_2`
  - `TASK_ORDERS_3`
  - согласованы `06-inventory`, `07-warehouses`, `05-catalog`
- Что нужно сделать:
  - вызывать `inventory.reserve`, `inventory.release`, `inventory.deduct` только по допустимым FBS переходам;
  - передавать стабильный `source_event_id` и scope `tenant/product/warehouse`;
  - не применять stock-effect, если SKU не matched или warehouse scope не определен;
  - для FBO хранить заказ как `display-only`, `affects_stock=false`, `stock_effect_status=not_required`;
  - return events в MVP только логировать без auto-restock.
- Критерий закрытия:
  - FBS inventory-critical flow работает предсказуемо;
  - FBO не смешивается с управляемым stock контуром;
  - return policy соответствует утвержденной MVP модели.

**Что сделано**

### 1. Новый сервис [order-inventory-effects.service.ts](apps/api/src/modules/orders/order-inventory-effects.service.ts)

Бридж между orders state machine (TASK_ORDERS_3) и inventory contracts (`reserve / release / deduct / logReturn` из 06-inventory). Один доменный сервис — единственная точка, через которую orders могут менять stock.

#### `applyTransitionEffect()`

Принимает `{ tenantId, orderId, marketplaceAccountId, fulfillmentMode, transitionFrom, transitionTo, currentStockEffectStatus }` и возвращает новый `OrderStockEffectStatus`, который caller записывает в `Order`.

Логика:

1. **FBO → no-op**. Возвращает `NOT_REQUIRED` без обращения к inventory. §9 шаг 9 + §13: FBO заказы display-only, не смешиваются с управляемым stock-контуром.
2. **Загрузка items** через `prisma.orderItem.findMany`.
3. **Валидация scope** (§14): items, у которых `productId === null` ИЛИ `warehouseId === null`, считаются unresolved. Если хоть один такой — пишем `STOCK_EFFECT_FAILED` event с `reason='UNRESOLVED_SCOPE'` + counters и возвращаем `FAILED`. Inventory НЕ вызывается — это предотвращает silent reserve "в никуда".
4. **Mapping target → inventory call** (по §13 state machine):
   - `RESERVED` → `inventory.reserve(tenantId, sourceEventId, items[])`
   - `CANCELLED` → `inventory.release(...)` **только если `transitionFrom === RESERVED`**. Cancel из IMPORTED/UNRESOLVED — резерва не было, возвращаем `NOT_REQUIRED` (§9 шаг 6).
   - `FULFILLED` → `inventory.deduct(...)` (§9 шаг 7).
5. **Интерпретация результата** inventory:
   - `status='APPLIED'` → `OrderStockEffectStatus.APPLIED`.
   - `status='IGNORED' && idempotent=true` → `APPLIED` (повторный вызов уже применён ранее).
   - `status='IGNORED' && idempotent=false` → `BLOCKED` (paused tenant — inventory сам перевёл lock в IGNORED).
   - exception → `FAILED` + `STOCK_EFFECT_FAILED` event с `reason='INVENTORY_EXCEPTION'`.

#### `logReturn()`

§10 + §15: return event только логируется без auto-restock:
- FBO returns не отслеживаются как stock event.
- Иначе: вызывает `inventory.logReturn(tenantId, sourceEventId, items, 'RETURN')` — это пишет `RETURN_LOGGED` movement с `delta=0` (audit-след без изменения onHand).
- Дополнительно append `OrderEventType.RETURN_LOGGED` в timeline с `payload: {autoRestock: false, itemsCount}`.

#### Стабильный `sourceEventId`

`order:<orderId>:<effect>` где effect ∈ `reserve|release|deduct|return`. Inventory `UNIQUE(tenantId, effectType, sourceEventId)` гарантирует, что повторный ingestion того же transition (например, при retry) не задвоит резерв. Effect-type зашит в строку, чтобы reserve и release одного заказа не конфликтовали (они имеют разные `InventoryEffectType`).

### 2. Интеграция в [orders-ingestion.service.ts](apps/api/src/modules/orders/orders-ingestion.service.ts)

- Добавлена DI-зависимость `OrderInventoryEffectsService`.
- Вызов inventory **вынесен ЗА транзакцию** ingestion'а:
  - Inventory держит свою собственную транзакцию с `SELECT ... FOR UPDATE` на `StockBalance` (06-inventory §LOCKING POLICY). Вкладывать одну в другую — рецепт лишних блокировок и таймаутов.
  - Idempotency держится двумя слоями: (1) UNIQUE на `OrderEvent` — ingestion уникален; (2) UNIQUE на `InventoryEffectLock` — даже повторный вызов не задвоит резерв.
- Внутри транзакции теперь вычисляется `effectTarget`:
  - **Existing order с successful state machine transition** → `{from: existing.internalStatus, to: target}`.
  - **New FBS order, чей `initialStatus` сразу попал в RESERVED/CANCELLED/FULFILLED** (благодаря mapper'у TASK_ORDERS_3) → `{from: IMPORTED, to: initialStatus}`. Логически "от IMPORTED" — потому что concept-wise мы сначала importнули, затем сразу приняли target.
- После закрытия транзакции — единый вызов `effects.applyTransitionEffect(...)` + отдельный `prisma.order.update({stockEffectStatus})`. Отдельный update сделан намеренно: не блокирует другие ingestion'ы и виден сразу в UI.
- Внутренние return-ы из транзакции дискриминированы по `kind: 'OUT_OF_ORDER' | 'INGESTED'` — TypeScript теперь точно различает, нужно ли вызывать inventory.

### 3. Регистрация модулей

[orders.module.ts](apps/api/src/modules/orders/orders.module.ts) теперь импортирует `InventoryModule` и провайдит/экспортирует `OrderInventoryEffectsService`. `InventoryModule` уже экспортирует `InventoryService` — менять его не нужно.

### 4. FBS/FBO разграничение и return policy — концретные точки

| Сценарий | Что происходит в orders | Что происходит в inventory |
|---------|------------------------|----------------------------|
| FBS new + matched + warehouse scope | `internalStatus=RESERVED`, append `RESERVED` event, `applyTransitionEffect → reserve` | `reserve(...)` → `reserved += qty`, `available -= qty`, `InventoryEffectLock=APPLIED` |
| FBS new + unmatched | `internalStatus=UNRESOLVED`, `stockEffectStatus=PENDING`, **никакого inventory call** | — |
| FBS new + matched но без warehouseId | `internalStatus=RESERVED` (mapper), `applyTransitionEffect` → `STOCK_EFFECT_FAILED` event с `UNRESOLVED_SCOPE`, `stockEffectStatus=FAILED` | — (защита §14) |
| FBS RESERVED → CANCELLED | append `RESERVE_RELEASED` event, `applyTransitionEffect → release` | `release(...)` → `reserved -= qty` |
| FBS IMPORTED/UNRESOLVED → CANCELLED (immediate cancel) | append `RESERVE_RELEASED` event, `applyTransitionEffect` → `NOT_REQUIRED` | — (резерва не было) |
| FBS RESERVED → FULFILLED | append `DEDUCTED` event, `applyTransitionEffect → deduct` | `deduct(...)` → `reserved -= qty`, `onHand -= qty` |
| FBO any | `internalStatus=DISPLAY_ONLY_FBO`, `affectsStock=false`, `stockEffectStatus=NOT_REQUIRED` | — |
| Return event (через `logReturn`) | append `RETURN_LOGGED` event с `autoRestock:false` | `logReturn(...)` пишет `RETURN_LOGGED` movement с `delta=0` (audit) |
| Tenant TRIAL_EXPIRED во время вызова | inventory возвращает `IGNORED` non-idempotent → `stockEffectStatus=BLOCKED` | inventory сам пишет lock=IGNORED (см. 06-inventory `_isTenantPaused`) |

### 5. Проверки

- `npx prisma validate` → schema valid (миграций не понадобилось).
- `npx tsc --noEmit -p tsconfig.json` → 0 ошибок в `orders/*`, `sync.service`, `sync.module`. Общий счётчик 20 — все pre-existing в чужих модулях (`fix-ozon-dates.ts`, `test-fbo*.ts`, `update-pwd.ts`, `catalog/import.service*`, `team-scheduler.service.ts`, `sync-runs.regression.spec.ts`).

### 6. DoD сверка

- ✅ **`reserve/release/deduct` только по допустимым FBS переходам**: в `applyTransitionEffect` явный `switch (transitionTo)` поверх 3 значений, FBO → early return `NOT_REQUIRED`. State machine guard TASK_ORDERS_3 уже не пропустит невалидные transitions.
- ✅ **Стабильный `source_event_id` и scope**: формат `order:<orderId>:<effect>` гарантирует idempotency через `InventoryEffectLock UNIQUE`. Scope `(productId, warehouseId, qty)` передаётся как `InventoryEffectItem[]`.
- ✅ **Не применяем stock-effect без resolved scope**: проверка `unresolved.length > 0` перед любым inventory call. Нет silent reserve "в никуда".
- ✅ **FBO display-only**: при FBO mapper выставляет `DISPLAY_ONLY_FBO`, ingestion ставит `affectsStock=false, stockEffectStatus=NOT_REQUIRED`, effects-сервис early-return'ит без вызова inventory.
- ✅ **Return events только логируются**: `logReturn` в orders-effects вызывает только `inventory.logReturn` (`delta=0`, audit) + append `RETURN_LOGGED` event с `autoRestock:false`. Никаких +qty в onHand.

### 7. Что НЕ сделано (намеренно — TASK_ORDERS_5)

- **Warehouse scope mapper**: сейчас `OrderItem.warehouseId` приходит из sync.service'овских adapter'ов (которые передают `null` — у них нет mapping marketplace warehouse → наш Warehouse). Из-за этого FBS заказы фактически попадут в `stockEffectStatus=FAILED` с `UNRESOLVED_SCOPE` — это корректное и ожидаемое поведение per §14, пока TASK_ORDERS_5 не подключит warehouse resolver.
- **REST endpoints `/api/v1/orders/.../reprocess`**: reprocess пути для FAILED заказов появятся в TASK_ORDERS_5 — он сможет вызвать `applyTransitionEffect` снова после ручного резолва маппинга.
- **Trigger `logReturn` из sync.service**: сейчас orders-effects.logReturn доступен через DI, но sync-адаптеры WB/Ozon ещё не различают return webhooks/events. Будет в следующих TASK'ах модуля sync (или после реализации webhooks).
