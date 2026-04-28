-- TASK_ORDERS_1: Data Model, Ingestion Registry и Event Provenance
-- (10-orders system-analytics §8/§9/§13/§15).
--
-- Что делает миграция:
-- 1. Добавляет 5 новых enum для orders domain:
--    - OrderFulfillmentMode (FBS / FBO).
--    - OrderInternalStatus (IMPORTED / RESERVED / CANCELLED / FULFILLED /
--      DISPLAY_ONLY_FBO / UNRESOLVED) — внутренний lifecycle, отдельный
--      от raw external_status (§13 правило MVP).
--    - OrderStockEffectStatus (NOT_REQUIRED / PENDING / APPLIED /
--      BLOCKED / FAILED) — состояние применения inventory side-effect
--      отдельно от логического статуса (§9 шаг 8).
--    - OrderItemMatchStatus (MATCHED / UNMATCHED) — без блокировки
--      сохранения заказа при отсутствии маппинга (§14).
--    - OrderEventType (RECEIVED / STATUS_CHANGED / RESERVED /
--      RESERVE_RELEASED / DEDUCTED / RETURN_LOGGED / DUPLICATE_IGNORED /
--      OUT_OF_ORDER_IGNORED / STOCK_EFFECT_FAILED) — см. §15.
--
-- 2. Создаёт таблицу `Order` — header заказа с провенансом
--    (`marketplaceAccountId` обязателен, `syncRunId` опционален) и
--    явным разделением FBS/FBO (`fulfillmentMode`, `affectsStock`,
--    `stockEffectStatus`).
--
-- 3. Создаёт таблицу `OrderItem` — строки заказа с матчингом на каталог
--    (`productId` nullable + `matchStatus`) и warehouse scope per-item.
--
-- 4. Создаёт таблицу `OrderEvent` — append-only timeline и provenance
--    каждого внешнего события. UNIQUE(tenantId, marketplaceAccountId,
--    externalEventId) реализует идемпотентность ingestion на уровне БД
--    (§9 шаг 3, §12 DoD).
--
-- 5. UNIQUE(tenantId, marketplace, marketplaceOrderId) на `Order` —
--    один и тот же external заказ не может быть вставлен дважды в
--    рамках tenant/marketplace.
--
-- Что НЕ делает (намеренно):
-- - Не трогает legacy `MarketplaceOrder` — sync.service продолжает писать
--   туда. Переключение sync на запись в новый домен — TASK_ORDERS_2/3
--   (ingestion use-case + status mapping + side-effects orchestration).
-- - Не создаёт REST endpoints `/api/v1/orders/...` — они появятся в
--   TASK_ORDERS_5 (timeline/details API).
-- - Не реализует state machine, idempotent ingestion handler, mapping
--   external→internal статусов, связку с inventory — это чеклист §11
--   пунктов 2-5, отдельные TASK'и.

-- ================================================================
-- 1. ENUMS
-- ================================================================

CREATE TYPE "OrderFulfillmentMode" AS ENUM (
  'FBS',
  'FBO'
);

CREATE TYPE "OrderInternalStatus" AS ENUM (
  'IMPORTED',
  'RESERVED',
  'CANCELLED',
  'FULFILLED',
  'DISPLAY_ONLY_FBO',
  'UNRESOLVED'
);

CREATE TYPE "OrderStockEffectStatus" AS ENUM (
  'NOT_REQUIRED',
  'PENDING',
  'APPLIED',
  'BLOCKED',
  'FAILED'
);

CREATE TYPE "OrderItemMatchStatus" AS ENUM (
  'MATCHED',
  'UNMATCHED'
);

CREATE TYPE "OrderEventType" AS ENUM (
  'RECEIVED',
  'STATUS_CHANGED',
  'RESERVED',
  'RESERVE_RELEASED',
  'DEDUCTED',
  'RETURN_LOGGED',
  'DUPLICATE_IGNORED',
  'OUT_OF_ORDER_IGNORED',
  'STOCK_EFFECT_FAILED'
);

-- ================================================================
-- 2. Order — header заказа
-- ================================================================

CREATE TABLE "Order" (
  "id"                    TEXT                       NOT NULL,
  "tenantId"              TEXT                       NOT NULL,

  "marketplace"           "MarketplaceType"          NOT NULL,
  "marketplaceAccountId"  TEXT                       NOT NULL,

  -- Связь с конкретным sync run (provenance §12 DoD). NULL для
  -- исторических заказов и manual reprocess.
  "syncRunId"             TEXT,

  "marketplaceOrderId"    VARCHAR(128)               NOT NULL,

  "fulfillmentMode"       "OrderFulfillmentMode"     NOT NULL,

  "externalStatus"        VARCHAR(128),
  "internalStatus"        "OrderInternalStatus"      NOT NULL DEFAULT 'IMPORTED',

  "affectsStock"          BOOLEAN                    NOT NULL DEFAULT false,
  "stockEffectStatus"     "OrderStockEffectStatus"   NOT NULL DEFAULT 'NOT_REQUIRED',

  -- Warehouse scope для FBS effects. NULL для FBO/UNRESOLVED.
  "warehouseId"           TEXT,

  "orderCreatedAt"        TIMESTAMP(3),
  "processedAt"           TIMESTAMP(3),

  "createdAt"             TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- FK: tenant CASCADE — закрытие tenant удаляет всю историю заказов.
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: marketplace account CASCADE — удаление аккаунта удаляет связанные
-- с ним заказы. Согласовано с CASCADE на `MarketplaceAccountEvent` и
-- `Warehouse(marketplaceAccountId)`.
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_marketplaceAccountId_fkey"
    FOREIGN KEY ("marketplaceAccountId") REFERENCES "MarketplaceAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: sync run SET NULL — удаление run'а не должно осиротить заказ;
-- провенанс просто становится "неизвестен", сам заказ остаётся валидным.
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_syncRunId_fkey"
    FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- FK: warehouse SET NULL — архивация склада не должна ломать заказы.
-- Warehouse в системе read-only по политике 07-warehouses §13/§20,
-- но даже теоретическое удаление не должно удалять заказ.
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- §8: один и тот же external order не вставится дважды в рамках
-- tenant/marketplace. Account намеренно НЕ входит в ключ — заказ
-- семантически принадлежит маркетплейсу, не аккаунту.
CREATE UNIQUE INDEX "Order_tenantId_marketplace_marketplaceOrderId_key"
  ON "Order"("tenantId", "marketplace", "marketplaceOrderId");

-- UI: списки заказов с фильтром по внутреннему статусу.
CREATE INDEX "Order_tenantId_internalStatus_createdAt_idx"
  ON "Order"("tenantId", "internalStatus", "createdAt");

-- UI: история заказов конкретного аккаунта.
CREATE INDEX "Order_tenantId_marketplaceAccountId_createdAt_idx"
  ON "Order"("tenantId", "marketplaceAccountId", "createdAt");

-- Диагностика stuck pending stock-effects (§19 alerts:
-- repeated side-effect failures, stuck pending statuses).
CREATE INDEX "Order_tenantId_stockEffectStatus_createdAt_idx"
  ON "Order"("tenantId", "stockEffectStatus", "createdAt");

-- Поиск всех заказов конкретного sync run (incident post-mortem).
CREATE INDEX "Order_syncRunId_idx"
  ON "Order"("syncRunId");

-- ================================================================
-- 3. OrderItem — строки заказа
-- ================================================================

CREATE TABLE "OrderItem" (
  "id"          TEXT                    NOT NULL,
  "orderId"     TEXT                    NOT NULL,

  "productId"   TEXT,
  "sku"         VARCHAR(128),
  "name"        VARCHAR(255),

  "matchStatus" "OrderItemMatchStatus"  NOT NULL DEFAULT 'UNMATCHED',

  "warehouseId" TEXT,

  "quantity"    INTEGER                 NOT NULL,
  -- NUMERIC(12,2): точное представление цены без float-дрифта.
  "price"       DECIMAL(12,2),

  "createdAt"   TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- FK: order CASCADE — удаление заказа чистит items.
ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: product SET NULL — товар может быть soft-deleted, но item должен
-- сохраниться с историческим SKU/name для аналитики и timeline.
ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- FK: warehouse SET NULL — см. комментарий на Order.warehouseId.
ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Базовый поиск items заказа.
CREATE INDEX "OrderItem_orderId_idx"
  ON "OrderItem"("orderId");

-- §19 alerts: unmatched_sku_orders — backlog нерезолвенных строк.
CREATE INDEX "OrderItem_orderId_matchStatus_idx"
  ON "OrderItem"("orderId", "matchStatus");

-- Поиск всех order items конкретного товара (отчёты).
CREATE INDEX "OrderItem_productId_idx"
  ON "OrderItem"("productId");

-- ================================================================
-- 4. OrderEvent — provenance и timeline
-- ================================================================

CREATE TABLE "OrderEvent" (
  "id"                    TEXT              NOT NULL,
  "tenantId"              TEXT              NOT NULL,
  "orderId"               TEXT              NOT NULL,
  "marketplaceAccountId"  TEXT              NOT NULL,

  "externalEventId"       VARCHAR(128)      NOT NULL,
  "eventType"             "OrderEventType"  NOT NULL,

  "payload"               JSONB,
  "createdAt"             TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- FK: tenant CASCADE.
ALTER TABLE "OrderEvent"
  ADD CONSTRAINT "OrderEvent_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: order CASCADE — удаление заказа чистит timeline.
ALTER TABLE "OrderEvent"
  ADD CONSTRAINT "OrderEvent_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: marketplace account CASCADE — provenance event'а потеряет
-- смысл без аккаунта.
ALTER TABLE "OrderEvent"
  ADD CONSTRAINT "OrderEvent_marketplaceAccountId_fkey"
    FOREIGN KEY ("marketplaceAccountId") REFERENCES "MarketplaceAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- §8: DB-level idempotency. Повторный event с тем же external id в
-- рамках того же account отклоняется на UNIQUE constraint, что
-- гарантирует отсутствие дублирующего reserve/deduct (§9 шаг 3).
CREATE UNIQUE INDEX "OrderEvent_tenantId_marketplaceAccountId_externalEventId_key"
  ON "OrderEvent"("tenantId", "marketplaceAccountId", "externalEventId");

-- Order timeline: последние события заказа в хронологическом порядке.
CREATE INDEX "OrderEvent_orderId_createdAt_idx"
  ON "OrderEvent"("orderId", "createdAt");

-- §19 dashboards: duplicate/out-of-order monitor — события по типу.
CREATE INDEX "OrderEvent_tenantId_eventType_createdAt_idx"
  ON "OrderEvent"("tenantId", "eventType", "createdAt");
