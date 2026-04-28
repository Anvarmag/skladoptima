-- TASK_REFERRALS_5: ReferralAuditLog + sourceIp index на ReferralAttribution
-- Аддитивная миграция: 1 новый enum + 1 новая таблица + индексы + доп. индекс.

-- CreateEnum
CREATE TYPE "ReferralAuditEventType" AS ENUM (
    'ATTRIBUTION_CAPTURED',
    'ATTRIBUTION_LOCKED',
    'ATTRIBUTION_REJECTED',
    'ATTRIBUTION_FRAUD_REVIEW',
    'REWARD_CREDITED',
    'REWARD_SKIPPED',
    'PROMO_APPLIED',
    'PROMO_REJECTED',
    'FRAUD_RECHECK_COMPLETED'
);

-- CreateTable ReferralAuditLog
CREATE TABLE "ReferralAuditLog" (
    "id"            TEXT                       NOT NULL,
    "eventType"     "ReferralAuditEventType"   NOT NULL,
    "attributionId" TEXT,
    "actorId"       TEXT,
    "tenantId"      TEXT,
    "ruleId"        VARCHAR(64),
    "data"          JSONB,
    "createdAt"     TIMESTAMPTZ(6)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReferralAuditLog_pkey" PRIMARY KEY ("id")
);

-- Indexes for ReferralAuditLog
CREATE INDEX "ReferralAuditLog_attributionId_idx"    ON "ReferralAuditLog"("attributionId");
CREATE INDEX "ReferralAuditLog_eventType_createdAt_idx" ON "ReferralAuditLog"("eventType", "createdAt");
CREATE INDEX "ReferralAuditLog_tenantId_idx"          ON "ReferralAuditLog"("tenantId");

-- Index on ReferralAttribution(sourceIp, registrationAttributedAt)
-- для fraud-rule queries (IP overuse per code / rapid-fire detection).
CREATE INDEX "ReferralAttribution_sourceIp_registrationAttributedAt_idx"
    ON "ReferralAttribution"("sourceIp", "registrationAttributedAt");
