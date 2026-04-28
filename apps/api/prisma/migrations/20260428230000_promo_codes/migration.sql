-- TASK_REFERRALS_4: PromoCode + PromoRedemption
-- Аддитивная миграция: 2 новых enum + 2 новые таблицы + FK + индексы.
-- Не затрагивает существующие таблицы.

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "PromoStackPolicy" AS ENUM ('EXCLUSIVE', 'COMBINABLE_WITH_BONUS');

-- CreateTable PromoCode
CREATE TABLE "PromoCode" (
    "id"                  TEXT             NOT NULL,
    "code"                VARCHAR(32)      NOT NULL,
    "discountType"        "DiscountType"   NOT NULL,
    "discountValue"       DECIMAL(12, 2)   NOT NULL,
    "stackPolicy"         "PromoStackPolicy" NOT NULL DEFAULT 'EXCLUSIVE',
    "applicablePlanCodes" TEXT[]           NOT NULL DEFAULT '{}',
    "maxUses"             INTEGER,
    "usedCount"           INTEGER          NOT NULL DEFAULT 0,
    "expiresAt"           TIMESTAMPTZ(6),
    "isActive"            BOOLEAN          NOT NULL DEFAULT true,
    "createdAt"           TIMESTAMPTZ(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMPTZ(6)   NOT NULL,
    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex UNIQUE(code) — глобальный токен не должен коллидировать
CREATE UNIQUE INDEX "PromoCode_code_key" ON "PromoCode"("code");

-- CreateTable PromoRedemption
CREATE TABLE "PromoRedemption" (
    "id"        TEXT           NOT NULL,
    "promoId"   TEXT           NOT NULL,
    "tenantId"  TEXT           NOT NULL,
    "appliedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromoRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex UNIQUE(promoId, tenantId) — один tenant не применяет промокод дважды
CREATE UNIQUE INDEX "PromoRedemption_promoId_tenantId_key" ON "PromoRedemption"("promoId", "tenantId");

-- CreateIndex — быстрый поиск redemptions по tenant
CREATE INDEX "PromoRedemption_tenantId_idx" ON "PromoRedemption"("tenantId");

-- AddForeignKey PromoRedemption → PromoCode
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_promoId_fkey"
    FOREIGN KEY ("promoId") REFERENCES "PromoCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
