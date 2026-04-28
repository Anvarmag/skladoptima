-- TASK_CATALOG_1: Catalog Data Model — Master Product и Channel Mappings
--
-- Что делает эта миграция:
-- 1. Добавляет 6 новых enum-типов для каталога.
-- 2. Расширяет таблицу Product: brand, barcode, mainImageFileId,
--    sourceOfTruth, status, createdBy, updatedBy.
-- 3. Создаёт таблицу ProductChannelMapping с UNIQUE(tenantId, marketplace, externalProductId).
-- 4. Создаёт таблицы CatalogImportJob и CatalogImportJobItem.
-- 5. Добавляет индексы для production-нагрузки.
--
-- Безопасность данных:
-- - Все новые колонки Product — nullable или имеют DEFAULT → не ломают существующие строки.
-- - status DEFAULT 'ACTIVE', затем data-migration для soft-deleted товаров.
-- - sourceOfTruth DEFAULT 'MANUAL' — отражает реальность для всех существующих товаров.

-- ================================================================
-- 1. НОВЫЕ ENUM-ТИПЫ
-- ================================================================

CREATE TYPE "ProductSourceOfTruth" AS ENUM ('MANUAL', 'IMPORT', 'SYNC');
CREATE TYPE "ProductStatus"        AS ENUM ('ACTIVE', 'DELETED');
CREATE TYPE "ChannelMarketplace"   AS ENUM ('WB', 'OZON', 'YANDEX_MARKET', 'SITE');
CREATE TYPE "ImportJobStatus"      AS ENUM ('PREVIEW', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "ImportJobSource"      AS ENUM ('API_SYNC', 'EXCEL');
CREATE TYPE "ImportItemAction"     AS ENUM ('CREATE', 'UPDATE', 'SKIP', 'MANUAL_REVIEW');

-- ================================================================
-- 2. РАСШИРЕНИЕ ТАБЛИЦЫ Product
-- ================================================================

ALTER TABLE "Product"
  ADD COLUMN "brand"           VARCHAR(128),
  ADD COLUMN "barcode"         VARCHAR(128),
  ADD COLUMN "mainImageFileId" TEXT,
  ADD COLUMN "sourceOfTruth"   "ProductSourceOfTruth" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "status"          "ProductStatus"        NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "createdBy"       TEXT,
  ADD COLUMN "updatedBy"       TEXT;

-- Data migration: товары с deletedAt → status = DELETED
UPDATE "Product" SET "status" = 'DELETED' WHERE "deletedAt" IS NOT NULL;

-- Индекс для фильтрации по (tenantId, status) — основной паттерн запросов
CREATE INDEX "Product_tenantId_status_idx" ON "Product"("tenantId", "status");

-- FK: createdBy → User (ON DELETE SET NULL — удаление пользователя не каскадирует)
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- FK: updatedBy → User
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ================================================================
-- 3. ProductChannelMapping — маппинг внутреннего SKU → внешний marketplace item
-- ================================================================

CREATE TABLE "ProductChannelMapping" (
  "id"                TEXT                NOT NULL,
  "tenantId"          TEXT                NOT NULL,
  "productId"         TEXT                NOT NULL,
  "marketplace"       "ChannelMarketplace" NOT NULL,
  "externalProductId" VARCHAR(128)        NOT NULL,
  "externalSku"       VARCHAR(128),
  "isAutoMatched"     BOOLEAN             NOT NULL DEFAULT false,
  "createdBy"         TEXT,
  "createdAt"         TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductChannelMapping_pkey" PRIMARY KEY ("id")
);

-- UNIQUE-ограничение: один маппинг на комбинацию tenant + маркетплейс + внешний ID
CREATE UNIQUE INDEX "ProductChannelMapping_tenantId_marketplace_externalProductId_key"
  ON "ProductChannelMapping"("tenantId", "marketplace", "externalProductId");

-- Индекс для выборки маппингов конкретного товара
CREATE INDEX "ProductChannelMapping_tenantId_productId_idx"
  ON "ProductChannelMapping"("tenantId", "productId");

ALTER TABLE "ProductChannelMapping"
  ADD CONSTRAINT "ProductChannelMapping_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductChannelMapping"
  ADD CONSTRAINT "ProductChannelMapping_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductChannelMapping"
  ADD CONSTRAINT "ProductChannelMapping_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ================================================================
-- 4. CatalogImportJob — задача на импорт каталога
-- ================================================================

CREATE TABLE "CatalogImportJob" (
  "id"             TEXT                NOT NULL,
  "tenantId"       TEXT                NOT NULL,
  "source"         "ImportJobSource"   NOT NULL,
  "status"         "ImportJobStatus"   NOT NULL DEFAULT 'PREVIEW',
  "totalRows"      INTEGER             NOT NULL DEFAULT 0,
  "createdCount"   INTEGER             NOT NULL DEFAULT 0,
  "updatedCount"   INTEGER             NOT NULL DEFAULT 0,
  "errorCount"     INTEGER             NOT NULL DEFAULT 0,
  "idempotencyKey" VARCHAR(128),
  "createdBy"      TEXT,
  "createdAt"      TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"     TIMESTAMP(3),

  CONSTRAINT "CatalogImportJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CatalogImportJob_tenantId_createdAt_idx"
  ON "CatalogImportJob"("tenantId", "createdAt");

CREATE INDEX "CatalogImportJob_tenantId_status_idx"
  ON "CatalogImportJob"("tenantId", "status");

ALTER TABLE "CatalogImportJob"
  ADD CONSTRAINT "CatalogImportJob_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CatalogImportJob"
  ADD CONSTRAINT "CatalogImportJob_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ================================================================
-- 5. CatalogImportJobItem — строки import job (preview + commit)
-- ================================================================

CREATE TABLE "CatalogImportJobItem" (
  "id"               TEXT                NOT NULL,
  "jobId"            TEXT                NOT NULL,
  "rowNumber"        INTEGER             NOT NULL,
  "rawPayload"       JSONB               NOT NULL,
  "validationErrors" JSONB,
  "action"           "ImportItemAction",

  CONSTRAINT "CatalogImportJobItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CatalogImportJobItem_jobId_idx"
  ON "CatalogImportJobItem"("jobId");

ALTER TABLE "CatalogImportJobItem"
  ADD CONSTRAINT "CatalogImportJobItem_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "CatalogImportJob"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
