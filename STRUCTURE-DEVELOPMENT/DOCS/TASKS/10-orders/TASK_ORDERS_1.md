# TASK_ORDERS_1 — Data Model, Ingestion Registry и Event Provenance

> Модуль: `10-orders`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - утверждена системная аналитика `10-orders`
  - согласованы `09-sync`, `06-inventory`
- Что нужно сделать:
  - завести таблицы `orders`, `order_items`, `order_events`;
  - закрепить поля `marketplace_account_id`, `sync_run_id`, `marketplace_order_id`, `fulfillment_mode`, `internal_status`, `stock_effect_status`;
  - хранить `external_event_id` и provenance каждого входящего order event;
  - зафиксировать уникальности по `marketplace_order_id` и `external_event_id`;
  - предусмотреть `warehouse_id`, `match_status`, `processed_at`, `affects_stock`.
- Критерий закрытия:
  - модель данных полностью покрывает ingestion, timeline и stock-effect диагностику;
  - источник order event и связанный `sync_run` восстанавливаются без сырых логов;
  - FBS/FBO различия выражены в data model явно.

**Что сделано**

Доменная модель orders заведена параллельно legacy `MarketplaceOrder` (sync.service продолжает работать со старой плоской таблицей; переключение писателей — следующие задачи модуля). Добавлено в `apps/api/prisma/schema.prisma` и в миграции `20260426130000_orders_data_model`:

1. **Пять новых enum'ов** под orders domain:
   - `OrderFulfillmentMode` — `FBS / FBO`. Изолированный enum (не reuse `InventoryFulfillmentMode`/`WarehouseType`), чтобы orders domain не сцеплялся семантически с inventory enum'ами при возможных hybrid-схемах у Yandex Market.
   - `OrderInternalStatus` — `IMPORTED / RESERVED / CANCELLED / FULFILLED / DISPLAY_ONLY_FBO / UNRESOLVED` (см. §13). Для FBS business-critical только `RESERVED / CANCELLED / FULFILLED`; внешние `PACKED / SHIPPED` остаются в `externalStatus` и не порождают внутренний переход.
   - `OrderStockEffectStatus` — `NOT_REQUIRED / PENDING / APPLIED / BLOCKED / FAILED`. Отделён от `internalStatus`, потому что заказ может быть RESERVED логически, но stock-effect ещё PENDING (нет warehouse scope) или FAILED (inventory отказал) — см. §9 шаг 8.
   - `OrderItemMatchStatus` — `MATCHED / UNMATCHED`. Отсутствие маппинга не блокирует сохранение заказа, item помечается UNMATCHED и исключается из stock-effect (§14).
   - `OrderEventType` — `RECEIVED / STATUS_CHANGED / RESERVED / RESERVE_RELEASED / DEDUCTED / RETURN_LOGGED / DUPLICATE_IGNORED / OUT_OF_ORDER_IGNORED / STOCK_EFFECT_FAILED` (см. §15).

2. **Таблица `Order`** — header заказа:
   - `tenantId`, `marketplace` (`MarketplaceType`), `marketplaceAccountId` (NOT NULL — provenance аккаунта), `syncRunId` (nullable — связка с конкретным `SyncRun` для §12 DoD), `marketplaceOrderId` `VARCHAR(128)`.
   - `fulfillmentMode`, `externalStatus`, `internalStatus DEFAULT IMPORTED`, `affectsStock DEFAULT false`, `stockEffectStatus DEFAULT NOT_REQUIRED`.
   - `warehouseId` nullable (FBS warehouse scope; для FBO/UNRESOLVED — NULL).
   - `orderCreatedAt` (нормализованное время маркетплейса, отдельно от нашего `createdAt`), `processedAt` (для out-of-order detection).
   - **Уникальность**: `UNIQUE(tenantId, marketplace, marketplaceOrderId)` — один external заказ не вставится дважды; account намеренно не входит в ключ, потому что заказ принадлежит маркетплейсу, а не аккаунту.
   - **Индексы**: `(tenantId, internalStatus, createdAt)`, `(tenantId, marketplaceAccountId, createdAt)`, `(tenantId, stockEffectStatus, createdAt)` под §19 алерты stuck pending, `(syncRunId)` под incident post-mortem.
   - **FK-политика**: `tenantId` CASCADE; `marketplaceAccountId` CASCADE (заказ без аккаунта теряет смысл, согласовано с CASCADE на `MarketplaceAccountEvent`); `syncRunId` SET NULL (run исчезает — provenance "неизвестен", но заказ остаётся валидным); `warehouseId` SET NULL (архивация склада не должна ломать заказы).

3. **Таблица `OrderItem`** — строки заказа:
   - `orderId` (CASCADE), `productId` nullable (SET NULL — soft-deleted product сохраняет item с историческим SKU/name), `sku VARCHAR(128)`, `name VARCHAR(255)`.
   - `matchStatus DEFAULT UNMATCHED`, `warehouseId` nullable (per-item scope).
   - `quantity INT NOT NULL`, `price DECIMAL(12,2)` (NUMERIC без float-дрифта).
   - **Индексы**: `(orderId)`, `(orderId, matchStatus)` под §19 backlog, `(productId)`.

4. **Таблица `OrderEvent`** — append-only timeline + provenance:
   - `tenantId` (CASCADE), `orderId` (CASCADE — удаление заказа чистит timeline), `marketplaceAccountId` (CASCADE — provenance бессмысленен без аккаунта).
   - `externalEventId VARCHAR(128) NOT NULL`, `eventType OrderEventType`, `payload JSONB`, `createdAt`.
   - **Уникальность**: `UNIQUE(tenantId, marketplaceAccountId, externalEventId)` — DB-level idempotency (§9 шаг 3, §12 DoD): повторный event с тем же id отклоняется на уровне UNIQUE constraint, application слой ловит и пишет один `DUPLICATE_IGNORED`.
   - **Индексы**: `(orderId, createdAt)` под `/orders/:id/timeline`, `(tenantId, eventType, createdAt)` под §19 dashboard duplicate/out-of-order monitor.

5. **Обратные relations** добавлены в `Tenant` (`domainOrders`, `orderEvents`), `MarketplaceAccount` (`orders`, `orderEvents`), `SyncRun` (`orders`), `Warehouse` (`orders`, `orderItems`), `Product` (`orderItems`).

6. **Намеренно НЕ сделано в этой задаче** (зафиксировано в комментариях миграции):
   - Не трогаем `MarketplaceOrder` и sync.service — переключение writers на новый домен в TASK_ORDERS_2/3 (idempotent ingestion + status mapping + inventory side-effects).
   - Не создаём REST endpoints `/api/v1/orders/...` — это TASK_ORDERS_5.
   - Не реализуем state machine, mapping handler и связку с inventory — пункты §11 чеклист 2-5, отдельные TASK'и.

**Файлы:**
- `apps/api/prisma/schema.prisma` — добавлены enum'ы и три модели.
- `apps/api/prisma/migrations/20260426130000_orders_data_model/migration.sql` — DDL.

**Проверки:**
- `npx prisma validate` → schema valid.
- `npx prisma format` → no diff.
- `npx prisma generate` → client сгенерирован.
- `npx tsc --noEmit` → новых TS-ошибок нет (все падения — pre-existing в legacy-скриптах в корне репозитория: `fix-ozon-dates.ts`, `test-fbo*.ts`, `update-pwd.ts`, `import.service.ts`, `team-scheduler.service.ts`).

**DoD сверка:**
- ✅ Модель данных покрывает ingestion (`Order` + `OrderEvent`), timeline (`OrderEvent.orderId+createdAt` index), stock-effect диагностику (`stockEffectStatus` + `Order.tenantId_stockEffectStatus_createdAt` index).
- ✅ Источник order event и связанный `sync_run` восстанавливаются без сырых логов: `OrderEvent.marketplaceAccountId` + `Order.syncRunId`.
- ✅ FBS/FBO различия выражены явно: `fulfillmentMode` + `affectsStock` + `stockEffectStatus=NOT_REQUIRED` для FBO.
