-- TASK_INVENTORY_1: Inventory Data Model — Balances, Movements, Effect Locks, Settings
--
-- Что делает эта миграция:
-- 1. Добавляет 5 новых enum-типов для inventory.
-- 2. Создаёт таблицу StockBalance с STORED GENERATED колонкой available = onHand - reserved.
-- 3. Создаёт таблицу StockMovement — append-only лог с поддержкой source/idempotency tracing.
-- 4. Создаёт таблицу InventoryEffectLock для строгой идемпотентности reserve/release/deduct.
-- 5. Создаёт таблицу InventorySettings (low-stock порог per-tenant).
-- 6. Добавляет CHECK constraints (no negative onHand/reserved, reserved <= onHand для управляемого контура).
-- 7. Добавляет partial unique для idempotencyKey (NULL допускается многократно).
--
-- Сценарии будущих задач (TASK_INVENTORY_2..5):
-- - migration существующих Product.total / Product.reserved в StockBalance;
-- - перенос ozonFbs/ozonFbo/wbFbs/wbFbo как отдельных рядов с warehouseId/fulfillmentMode;
-- - сервисный слой reserve/release/deduct с FOR UPDATE на StockBalance.

-- ================================================================
-- 1. ENUMS
-- ================================================================

CREATE TYPE "StockMovementType" AS ENUM (
  'MANUAL_ADD',
  'MANUAL_REMOVE',
  'ORDER_RESERVED',
  'ORDER_RELEASED',
  'ORDER_DEDUCTED',
  'INVENTORY_ADJUSTMENT',
  'RETURN_LOGGED',
  'CONFLICT_DETECTED'
);

CREATE TYPE "StockMovementSource" AS ENUM ('USER', 'SYSTEM', 'MARKETPLACE');

CREATE TYPE "InventoryFulfillmentMode" AS ENUM ('FBS', 'FBO');

CREATE TYPE "InventoryEffectType" AS ENUM (
  'ORDER_RESERVE',
  'ORDER_RELEASE',
  'ORDER_DEDUCT',
  'SYNC_RECONCILE'
);

CREATE TYPE "InventoryEffectStatus" AS ENUM (
  'PROCESSING',
  'APPLIED',
  'IGNORED',
  'FAILED'
);

-- ================================================================
-- 2. StockBalance — агрегированный остаток (tenant, product, warehouse)
-- ================================================================

CREATE TABLE "StockBalance" (
  "id"              TEXT                       NOT NULL,
  "tenantId"        TEXT                       NOT NULL,
  "productId"       TEXT                       NOT NULL,
  "warehouseId"     TEXT                       NOT NULL,
  "fulfillmentMode" "InventoryFulfillmentMode" NOT NULL DEFAULT 'FBS',
  "isExternal"      BOOLEAN                    NOT NULL DEFAULT false,
  "onHand"          INTEGER                    NOT NULL DEFAULT 0,
  "reserved"        INTEGER                    NOT NULL DEFAULT 0,
  "available"       INTEGER                    GENERATED ALWAYS AS ("onHand" - "reserved") STORED,
  "createdAt"       TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id"),

  -- MVP-policy: запрещаем отрицательный on_hand/reserved.
  CONSTRAINT "StockBalance_onHand_nonneg"   CHECK ("onHand"   >= 0),
  CONSTRAINT "StockBalance_reserved_nonneg" CHECK ("reserved" >= 0),

  -- Для управляемого контура (FBS, isExternal=false) reserved не может превышать onHand.
  -- Для внешнего FBO баланс информационный — allowance шире.
  CONSTRAINT "StockBalance_reserved_lte_onHand_managed"
    CHECK ("isExternal" = true OR "reserved" <= "onHand")
);

CREATE UNIQUE INDEX "StockBalance_tenantId_productId_warehouseId_key"
  ON "StockBalance"("tenantId", "productId", "warehouseId");

CREATE INDEX "StockBalance_tenantId_productId_idx"
  ON "StockBalance"("tenantId", "productId");

CREATE INDEX "StockBalance_tenantId_fulfillmentMode_idx"
  ON "StockBalance"("tenantId", "fulfillmentMode");

ALTER TABLE "StockBalance"
  ADD CONSTRAINT "StockBalance_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockBalance"
  ADD CONSTRAINT "StockBalance_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ================================================================
-- 3. StockMovement — append-only лог изменений остатка
-- ================================================================

CREATE TABLE "StockMovement" (
  "id"              TEXT                  NOT NULL,
  "tenantId"        TEXT                  NOT NULL,
  "productId"       TEXT                  NOT NULL,
  "warehouseId"     TEXT,
  "movementType"    "StockMovementType"   NOT NULL,
  "delta"           INTEGER               NOT NULL,
  "onHandBefore"    INTEGER,
  "onHandAfter"     INTEGER,
  "reservedBefore"  INTEGER,
  "reservedAfter"   INTEGER,
  "reasonCode"      VARCHAR(64),
  "comment"         TEXT,
  "source"          "StockMovementSource" NOT NULL,
  "sourceEventId"   VARCHAR(128),
  "idempotencyKey"  VARCHAR(128),
  "actorUserId"     TEXT,
  "createdAt"       TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StockMovement_tenantId_productId_createdAt_idx"
  ON "StockMovement"("tenantId", "productId", "createdAt");

CREATE INDEX "StockMovement_tenantId_sourceEventId_idx"
  ON "StockMovement"("tenantId", "sourceEventId");

CREATE INDEX "StockMovement_tenantId_movementType_createdAt_idx"
  ON "StockMovement"("tenantId", "movementType", "createdAt");

-- Partial unique: один и тот же idempotencyKey в рамках tenant не повторяется,
-- но NULL разрешён многократно (manual movements могут идти без ключа).
CREATE UNIQUE INDEX "StockMovement_tenantId_idempotencyKey_key"
  ON "StockMovement"("tenantId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ================================================================
-- 4. InventoryEffectLock — idempotency для order/sync side-effects
-- ================================================================

CREATE TABLE "InventoryEffectLock" (
  "id"            TEXT                    NOT NULL,
  "tenantId"      TEXT                    NOT NULL,
  "effectType"    "InventoryEffectType"   NOT NULL,
  "sourceEventId" VARCHAR(128)            NOT NULL,
  "status"        "InventoryEffectStatus" NOT NULL DEFAULT 'PROCESSING',
  "createdAt"     TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InventoryEffectLock_pkey" PRIMARY KEY ("id")
);

-- Главный гарант идемпотентности: одно и то же (tenant, effect, event) применяется ровно один раз.
CREATE UNIQUE INDEX "InventoryEffectLock_tenantId_effectType_sourceEventId_key"
  ON "InventoryEffectLock"("tenantId", "effectType", "sourceEventId");

CREATE INDEX "InventoryEffectLock_tenantId_status_idx"
  ON "InventoryEffectLock"("tenantId", "status");

ALTER TABLE "InventoryEffectLock"
  ADD CONSTRAINT "InventoryEffectLock_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ================================================================
-- 5. InventorySettings — настройки инвентаря per-tenant
-- ================================================================

CREATE TABLE "InventorySettings" (
  "tenantId"          TEXT         NOT NULL,
  "lowStockThreshold" INTEGER      NOT NULL DEFAULT 5,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InventorySettings_pkey" PRIMARY KEY ("tenantId"),
  CONSTRAINT "InventorySettings_lowStockThreshold_nonneg"
    CHECK ("lowStockThreshold" >= 0)
);

ALTER TABLE "InventorySettings"
  ADD CONSTRAINT "InventorySettings_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
