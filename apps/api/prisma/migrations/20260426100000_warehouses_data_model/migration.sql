-- TASK_WAREHOUSES_1: Warehouse Reference Data Model
--
-- Что делает миграция:
-- 1. Добавляет 3 новых enum типа (WarehouseType, WarehouseStatus, WarehouseSourceMarketplace).
-- 2. Создаёт таблицу `Warehouse` со всеми полями §8 system-analytics:
--    external identity (immutable: tenantId + marketplaceAccountId + externalWarehouseId),
--    sync-managed metadata (name, city, type, source, lastSyncedAt, firstSeenAt),
--    tenant-local metadata (aliasName, labels[]),
--    lifecycle (status, deactivationReason, inactiveSince),
--    audit (metadataUpdatedAt, metadataUpdatedBy).
-- 3. UNIQUE на (tenantId, marketplaceAccountId, externalWarehouseId) — гарантирует
--    immutable external identity и идемпотентность sync upsert.
-- 4. FK: tenant CASCADE, marketplaceAccount CASCADE, metadataUpdatedBy SetNull.
-- 5. Индексы для типичных запросов:
--    (tenantId, status) — listAllActive по tenant,
--    (tenantId, sourceMarketplace, warehouseType) — фильтр FBS/FBO в UI,
--    (marketplaceAccountId, status) — sync-job выбирает свой scope.
--
-- Что НЕ делает (отдельные задачи):
-- - не вводит FK на StockBalance.warehouseId (TASK_INVENTORY_5 sentinel `default`
--   останется валидным, bridge добавится в TASK_WAREHOUSES_2/3 после первичной
--   синхронизации справочника).
-- - не пишет sync use-case (TASK_WAREHOUSES_2).
-- - не строит API/UI (TASK_WAREHOUSES_3-5).

-- ================================================================
-- 1. ENUMS
-- ================================================================

CREATE TYPE "WarehouseType" AS ENUM ('FBS', 'FBO');

CREATE TYPE "WarehouseStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

CREATE TYPE "WarehouseSourceMarketplace" AS ENUM ('WB', 'OZON', 'YANDEX_MARKET');

-- ================================================================
-- 2. Warehouse — справочник внешних складов
-- ================================================================

CREATE TABLE "Warehouse" (
  "id"                    TEXT                         NOT NULL,
  "tenantId"              TEXT                         NOT NULL,
  "marketplaceAccountId"  TEXT                         NOT NULL,

  "externalWarehouseId"   VARCHAR(128)                 NOT NULL,
  "name"                  VARCHAR(255)                 NOT NULL,
  "city"                  VARCHAR(128),

  "warehouseType"         "WarehouseType"              NOT NULL,
  "sourceMarketplace"     "WarehouseSourceMarketplace" NOT NULL,

  -- Tenant-local metadata (изменяется через PATCH /warehouses/:id/metadata).
  "aliasName"             VARCHAR(255),
  "labels"                TEXT[]                       NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- Lifecycle.
  "status"                "WarehouseStatus"            NOT NULL DEFAULT 'ACTIVE',
  "deactivationReason"    VARCHAR(64),

  "firstSeenAt"           TIMESTAMP(3)                 NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSyncedAt"          TIMESTAMP(3),
  "inactiveSince"         TIMESTAMP(3),

  -- Audit для tenant-local правок.
  "metadataUpdatedAt"     TIMESTAMP(3),
  "metadataUpdatedBy"     TEXT,

  "createdAt"             TIMESTAMP(3)                 NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3)                 NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- Главный гарант immutable external identity: один и тот же внешний склад из
-- разных аккаунтов считается разными связями (см. §13 invariant).
CREATE UNIQUE INDEX "Warehouse_tenantId_marketplaceAccountId_externalWarehouseId_key"
  ON "Warehouse"("tenantId", "marketplaceAccountId", "externalWarehouseId");

CREATE INDEX "Warehouse_tenantId_status_idx"
  ON "Warehouse"("tenantId", "status");

CREATE INDEX "Warehouse_tenantId_sourceMarketplace_warehouseType_idx"
  ON "Warehouse"("tenantId", "sourceMarketplace", "warehouseType");

CREATE INDEX "Warehouse_marketplaceAccountId_status_idx"
  ON "Warehouse"("marketplaceAccountId", "status");

-- ================================================================
-- 3. FOREIGN KEYS
-- ================================================================

ALTER TABLE "Warehouse"
  ADD CONSTRAINT "Warehouse_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Warehouse"
  ADD CONSTRAINT "Warehouse_marketplaceAccountId_fkey"
    FOREIGN KEY ("marketplaceAccountId") REFERENCES "MarketplaceAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Удаление пользователя не должно ломать справочник — оставляем NULL в audit-поле.
ALTER TABLE "Warehouse"
  ADD CONSTRAINT "Warehouse_metadataUpdatedBy_fkey"
    FOREIGN KEY ("metadataUpdatedBy") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
