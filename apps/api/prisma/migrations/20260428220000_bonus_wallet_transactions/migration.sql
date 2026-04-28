-- TASK_REFERRALS_2: BonusWallet + BonusTransaction
-- Аддитивная миграция: 1 новый enum + 2 новые таблицы + FK + индексы.
-- Не затрагивает существующие таблицы (User, Tenant, Referral*).

-- CreateEnum
CREATE TYPE "BonusTransactionType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateTable BonusWallet
CREATE TABLE "BonusWallet" (
    "id"          TEXT            NOT NULL,
    "ownerUserId" TEXT            NOT NULL,
    "balance"     DECIMAL(12, 2)  NOT NULL DEFAULT 0,
    "createdAt"   TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMPTZ(6)  NOT NULL,
    CONSTRAINT "BonusWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable BonusTransaction
CREATE TABLE "BonusTransaction" (
    "id"               TEXT                    NOT NULL,
    "walletId"         TEXT                    NOT NULL,
    "type"             "BonusTransactionType"  NOT NULL,
    "amount"           DECIMAL(12, 2)          NOT NULL,
    "reasonCode"       VARCHAR(64)             NOT NULL,
    "referredTenantId" VARCHAR(36),
    "metadata"         JSONB,
    "createdAt"        TIMESTAMPTZ(6)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BonusTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (UNIQUE ownerUserId)
CREATE UNIQUE INDEX "BonusWallet_ownerUserId_key" ON "BonusWallet"("ownerUserId");

-- CreateIndex (idempotency: one reward per wallet × reasonCode × referredTenant)
-- NULL referredTenantId IS DISTINCT in PostgreSQL, so debit rows (NULL) are allowed to repeat.
CREATE UNIQUE INDEX "BonusTransaction_walletId_reasonCode_referredTenantId_key"
    ON "BonusTransaction"("walletId", "reasonCode", "referredTenantId");

-- CreateIndex (paginated history)
CREATE INDEX "BonusTransaction_walletId_createdAt_idx"
    ON "BonusTransaction"("walletId", "createdAt");

-- AddForeignKey BonusWallet → User
ALTER TABLE "BonusWallet" ADD CONSTRAINT "BonusWallet_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey BonusTransaction → BonusWallet
ALTER TABLE "BonusTransaction" ADD CONSTRAINT "BonusTransaction_walletId_fkey"
    FOREIGN KEY ("walletId") REFERENCES "BonusWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
