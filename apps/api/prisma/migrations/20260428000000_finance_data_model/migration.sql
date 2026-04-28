-- TASK_FINANCE_1: Data Model, Cost Profiles и Warnings
-- (11-finance system-analytics §8/§13/§14).
--
-- Что делает миграция:
-- 1. Добавляет 3 новых enum для finance domain:
--    - FinanceSnapshotPeriodType (WEEK / MONTH / CUSTOM) — детерминированные
--      календарные окна для nightly job + произвольный from/to для
--      on-demand rebuild owner/admin'а.
--    - FinanceSnapshotStatus (READY / INCOMPLETE / FAILED) — INCOMPLETE
--      отделён от READY и FAILED сознательно: расчёт прошёл, но критичные
--      source отсутствуют, UI показывает с warning'ом (§14 + §20 риск
--      "не silently default-to-zero").
--    - FinanceWarningType (MISSING_COST / MISSING_FEES / MISSING_LOGISTICS /
--      MISSING_TAX / MISSING_ADS_COST / MISSING_RETURNS_DATA /
--      STALE_FINANCIAL_SOURCE) — стабильный enum для UI рендера и
--      фильтрации по типу.
--
-- 2. Создаёт таблицу `ProductFinanceProfile` — manual cost input на
--    уровне SKU. Manual в MVP разрешён ТОЛЬКО для baseCost / packagingCost /
--    additionalCost (§10 + §13 + §20 риск "ручной ввод периодных расходов
--    разрушит воспроизводимость").
--
-- 3. Создаёт таблицу `FinanceSnapshot` — снапшот периода с агрегированным
--    payload JSONB и formulaVersion. Идемпотентность rebuild через
--    UNIQUE(tenantId, periodFrom, periodTo, formulaVersion) — повторный
--    rebuild того же периода с той же формулой не создаёт дубль.
--
-- 4. Создаёт таблицу `FinanceDataWarning` — append-only журнал
--    предупреждений о неполных данных. resolvedAt фиксируется warning
--    resolution job'ом (§15), warning не удаляется физически.
--
-- Что НЕ делает (намеренно):
-- - Не трогает legacy `Product.purchasePrice / minPrice / commissionRate /
--   logisticsCost` — текущий `finance.service.ts` их использует.
--   Переключение читателей на `ProductFinanceProfile` — TASK_FINANCE_2/3.
-- - Не создаёт `period_marketplace_charges` или manual periodic expenses —
--   §13 + §20 риск, в MVP запрещено.
-- - Не создаёт REST endpoints `/api/v1/finance/snapshots/...` — они в
--   TASK_FINANCE_3/4.
-- - Не реализует runtime calculator + nightly snapshot job — TASK_FINANCE_2/4.

-- ================================================================
-- 1. ENUMS
-- ================================================================

CREATE TYPE "FinanceSnapshotPeriodType" AS ENUM (
  'WEEK',
  'MONTH',
  'CUSTOM'
);

CREATE TYPE "FinanceSnapshotStatus" AS ENUM (
  'READY',
  'INCOMPLETE',
  'FAILED'
);

CREATE TYPE "FinanceWarningType" AS ENUM (
  'MISSING_COST',
  'MISSING_FEES',
  'MISSING_LOGISTICS',
  'MISSING_TAX',
  'MISSING_ADS_COST',
  'MISSING_RETURNS_DATA',
  'STALE_FINANCIAL_SOURCE'
);

-- ================================================================
-- 2. ProductFinanceProfile — cost profile per SKU
-- ================================================================

CREATE TABLE "ProductFinanceProfile" (
  "id"             TEXT          NOT NULL,
  "tenantId"       TEXT          NOT NULL,
  "productId"      TEXT          NOT NULL,

  -- NUMERIC(12,2) — точное представление денег без float-дрифта.
  "baseCost"       DECIMAL(12,2),
  "packagingCost"  DECIMAL(12,2),
  "additionalCost" DECIMAL(12,2),

  "costCurrency"   VARCHAR(3)    NOT NULL DEFAULT 'RUB',
  "isCostManual"   BOOLEAN       NOT NULL DEFAULT true,

  "updatedBy"      TEXT,

  "createdAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductFinanceProfile_pkey" PRIMARY KEY ("id")
);

-- FK: tenant CASCADE.
ALTER TABLE "ProductFinanceProfile"
  ADD CONSTRAINT "ProductFinanceProfile_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: product CASCADE — удаление товара чистит профиль (он осиротел).
ALTER TABLE "ProductFinanceProfile"
  ADD CONSTRAINT "ProductFinanceProfile_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: updatedBy SET NULL — soft-deleted user не должен ломать историю
-- профилей (audit важнее ссылочной целостности).
ALTER TABLE "ProductFinanceProfile"
  ADD CONSTRAINT "ProductFinanceProfile_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Один профиль на product.
CREATE UNIQUE INDEX "ProductFinanceProfile_productId_key"
  ON "ProductFinanceProfile"("productId");

-- Фильтр по tenant'у + product (для list API).
CREATE INDEX "ProductFinanceProfile_tenantId_productId_idx"
  ON "ProductFinanceProfile"("tenantId", "productId");

-- ================================================================
-- 3. FinanceSnapshot — снапшот периода
-- ================================================================

CREATE TABLE "FinanceSnapshot" (
  "id"              TEXT                          NOT NULL,
  "tenantId"        TEXT                          NOT NULL,

  "periodFrom"      DATE                          NOT NULL,
  "periodTo"        DATE                          NOT NULL,
  "periodType"      "FinanceSnapshotPeriodType"   NOT NULL,

  "formulaVersion"  VARCHAR(32)                   NOT NULL,
  "snapshotStatus"  "FinanceSnapshotStatus"       NOT NULL DEFAULT 'READY',

  "payload"         JSONB                         NOT NULL,
  "sourceFreshness" JSONB,

  "generatedAt"     TIMESTAMP(3)                  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "generatedBy"     TEXT,

  CONSTRAINT "FinanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- FK: tenant CASCADE.
ALTER TABLE "FinanceSnapshot"
  ADD CONSTRAINT "FinanceSnapshot_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: generatedBy SET NULL — пользователь, инициировавший rebuild,
-- мог покинуть tenant; snapshot должен пережить это.
ALTER TABLE "FinanceSnapshot"
  ADD CONSTRAINT "FinanceSnapshot_generatedBy_fkey"
    FOREIGN KEY ("generatedBy") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- §18 SLA + §15 идемпотентность: один snapshot на (tenant, period, formula).
CREATE UNIQUE INDEX "FinanceSnapshot_tenantId_periodFrom_periodTo_formulaVersion_key"
  ON "FinanceSnapshot"("tenantId", "periodFrom", "periodTo", "formulaVersion");

-- UI: последние снапшоты tenant'а с сортировкой по periodTo.
CREATE INDEX "FinanceSnapshot_tenantId_periodTo_generatedAt_idx"
  ON "FinanceSnapshot"("tenantId", "periodTo", "generatedAt");

-- §19 dashboards: snapshot health board.
CREATE INDEX "FinanceSnapshot_tenantId_snapshotStatus_generatedAt_idx"
  ON "FinanceSnapshot"("tenantId", "snapshotStatus", "generatedAt");

-- ================================================================
-- 4. FinanceDataWarning — журнал предупреждений
-- ================================================================

CREATE TABLE "FinanceDataWarning" (
  "id"          TEXT                  NOT NULL,
  "tenantId"    TEXT                  NOT NULL,
  "productId"   TEXT,
  "snapshotId"  TEXT,

  "warningType" "FinanceWarningType"  NOT NULL,
  "isActive"    BOOLEAN               NOT NULL DEFAULT true,
  "details"     JSONB,

  "createdAt"   TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt"  TIMESTAMP(3),

  CONSTRAINT "FinanceDataWarning_pkey" PRIMARY KEY ("id")
);

-- FK: tenant CASCADE.
ALTER TABLE "FinanceDataWarning"
  ADD CONSTRAINT "FinanceDataWarning_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: product SET NULL — product может быть soft-deleted, warning
-- сохраняет исторический контекст.
ALTER TABLE "FinanceDataWarning"
  ADD CONSTRAINT "FinanceDataWarning_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- FK: snapshot CASCADE — удаление snapshot'а чистит warning'и
-- именно этого расчёта.
ALTER TABLE "FinanceDataWarning"
  ADD CONSTRAINT "FinanceDataWarning_snapshotId_fkey"
    FOREIGN KEY ("snapshotId") REFERENCES "FinanceSnapshot"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- §19 dashboards: completeness board / stale-source board.
CREATE INDEX "FinanceDataWarning_tenantId_isActive_warningType_idx"
  ON "FinanceDataWarning"("tenantId", "isActive", "warningType");

-- Список warnings по конкретному товару.
CREATE INDEX "FinanceDataWarning_tenantId_productId_idx"
  ON "FinanceDataWarning"("tenantId", "productId");

-- Все warnings конкретного snapshot'а.
CREATE INDEX "FinanceDataWarning_snapshotId_idx"
  ON "FinanceDataWarning"("snapshotId");
