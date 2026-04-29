-- TASK_CHANNEL_1: StockChannelLock и channel visibility settings
--
-- Аддитивная миграция:
--   + enum StockLockType (ZERO, FIXED, PAUSED)
--   + таблица "StockChannelLock" с upsert-семантикой (unique per tenant+product+marketplace)
--   + колонка "channelVisibilitySettings" JSONB в таблице "InventorySettings"
--
-- Семантика блокировок:
--   ZERO   — отправить qty=0 на маркетплейс
--   FIXED  — отправить qty=fixedValue на маркетплейс
--   PAUSED — пропустить товар в push batch

-- ─── Enums ──────────────────────────────────────────────────────────────────

CREATE TYPE "StockLockType" AS ENUM ('ZERO', 'FIXED', 'PAUSED');

-- ─── StockChannelLock table ──────────────────────────────────────────────────

CREATE TABLE "StockChannelLock" (
    "id"          TEXT             NOT NULL,
    "tenantId"    TEXT             NOT NULL,
    "productId"   TEXT             NOT NULL,
    "marketplace" "MarketplaceType" NOT NULL,
    "lockType"    "StockLockType"  NOT NULL,
    "fixedValue"  INTEGER,
    "note"        TEXT,
    "createdBy"   TEXT,
    "createdAt"   TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    "updatedAt"   TIMESTAMPTZ      NOT NULL,

    CONSTRAINT "StockChannelLock_pkey" PRIMARY KEY ("id")
);

-- ─── Unique constraint ───────────────────────────────────────────────────────

-- Один товар + один маркетплейс = максимум одна блокировка
ALTER TABLE "StockChannelLock"
    ADD CONSTRAINT "StockChannelLock_tenantId_productId_marketplace_key"
    UNIQUE ("tenantId", "productId", "marketplace");

-- ─── Indexes ─────────────────────────────────────────────────────────────────

-- batch lookup при push_stocks: один SELECT на весь синк-батч по (tenantId, marketplace)
CREATE INDEX "StockChannelLock_tenantId_marketplace_idx"
    ON "StockChannelLock"("tenantId", "marketplace");

-- lookup по товару для UI (карточка товара, таблица остатков)
CREATE INDEX "StockChannelLock_tenantId_productId_idx"
    ON "StockChannelLock"("tenantId", "productId");

-- ─── Foreign Keys ────────────────────────────────────────────────────────────

ALTER TABLE "StockChannelLock"
    ADD CONSTRAINT "StockChannelLock_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockChannelLock"
    ADD CONSTRAINT "StockChannelLock_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockChannelLock"
    ADD CONSTRAINT "StockChannelLock_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── InventorySettings: channel visibility ───────────────────────────────────

-- JSON-поле хранит настройки видимости каналов тенанта:
--   {"visibleMarketplaces": ["WB", "OZON"]}
-- NULL означает «все каналы видимы» (дефолтное поведение).
ALTER TABLE "InventorySettings"
    ADD COLUMN "channelVisibilitySettings" JSONB;
