-- TASK_ANALYTICS_8: WB Finance Report — детализированный отчёт реализации WB.
-- Один ряд = одна строка /api/v5/supplier/reportDetailByPeriod.
-- realizationId = rrd_id из ответа WB (уникальный row-ID, BigInt).

CREATE TABLE "WbFinanceReport" (
    "id"            TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
    "tenantId"      TEXT        NOT NULL,
    "accountId"     TEXT        NOT NULL,
    "realizationId" BIGINT      NOT NULL,
    "orderId"       VARCHAR(64),
    "sku"           VARCHAR(128),
    "commissionRub" DOUBLE PRECISION,
    "deliveryRub"   DOUBLE PRECISION,
    "storageFee"    DOUBLE PRECISION,
    "penalty"       DOUBLE PRECISION,
    "periodFrom"    DATE        NOT NULL,
    "periodTo"      DATE        NOT NULL,
    "rawPayload"    JSONB       NOT NULL,
    "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "WbFinanceReport_pkey" PRIMARY KEY ("id")
);

-- FK → Tenant
ALTER TABLE "WbFinanceReport"
    ADD CONSTRAINT "WbFinanceReport_tenantId_fkey"
    FOREIGN KEY ("tenantId")
    REFERENCES "Tenant"("id")
    ON DELETE CASCADE;

-- FK → MarketplaceAccount
ALTER TABLE "WbFinanceReport"
    ADD CONSTRAINT "WbFinanceReport_accountId_fkey"
    FOREIGN KEY ("accountId")
    REFERENCES "MarketplaceAccount"("id")
    ON DELETE CASCADE;

-- Deduplication: один ряд WB rrd_id на tenant.
CREATE UNIQUE INDEX "WbFinanceReport_tenantId_realizationId_key"
    ON "WbFinanceReport"("tenantId", "realizationId");

-- SKU lookup для finance-snapshot loader.
CREATE INDEX "WbFinanceReport_tenantId_sku_idx"
    ON "WbFinanceReport"("tenantId", "sku");

-- Period range lookup.
CREATE INDEX "WbFinanceReport_tenantId_period_idx"
    ON "WbFinanceReport"("tenantId", "periodFrom", "periodTo");
