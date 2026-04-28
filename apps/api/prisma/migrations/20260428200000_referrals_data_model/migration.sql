-- TASK_REFERRALS_1: Referral Links и Attribution Model
-- (14-referrals system-analytics §8/§13).
--
-- Что делает миграция:
-- 1. Добавляет enum `ReferralAttributionStatus` (ATTRIBUTED / PAID /
--    REWARDED / REJECTED / FRAUD_REVIEW). Промежуточный ATTRIBUTED ≠ PAID
--    ≠ REWARDED — §10 reward eligibility разделяется на стадии.
-- 2. Создаёт `ReferralLink` — публичная реферальная ссылка/код владельца.
--    UNIQUE(code) глобально + UNIQUE(ownerUserId, tenantId) для §6
--    «одна активная ссылка на (owner, tenant)».
-- 3. Создаёт `ReferralAttribution` — двухэтапный lock attribution:
--    - регистрация: referredUserId, status=ATTRIBUTED, referredTenantId=NULL;
--    - tenant creation: referredTenantId заполняется, UNIQUE дает lock.
--    Хранит attribution context (utm_*, sourceIp, userAgent) — §13.
--
-- Что НЕ делает (намеренно):
-- - Не создаёт `bonus_wallets` / `bonus_transactions` / `promo_codes` —
--   это TASK_REFERRALS_2/3.
-- - Не дёргает webhook first-payment — TASK_REFERRALS_4.
-- - Не меняет auth.register / tenant.create flow — это код-уровневое
--   wiring в этой же задаче, но не миграция.

-- ================================================================
-- 1. ENUM
-- ================================================================

CREATE TYPE "ReferralAttributionStatus" AS ENUM (
  'ATTRIBUTED',
  'PAID',
  'REWARDED',
  'REJECTED',
  'FRAUD_REVIEW'
);

-- ================================================================
-- 2. ReferralLink — публичная ссылка/код
-- ================================================================

CREATE TABLE "ReferralLink" (
  "id"          TEXT          NOT NULL,
  "ownerUserId" TEXT          NOT NULL,
  "tenantId"    TEXT          NOT NULL,
  "code"        VARCHAR(32)   NOT NULL,
  "isActive"    BOOLEAN       NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReferralLink_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ReferralLink"
  ADD CONSTRAINT "ReferralLink_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReferralLink"
  ADD CONSTRAINT "ReferralLink_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- §6 идемпотентность getOrCreate: одна активная ссылка на (owner, tenant).
CREATE UNIQUE INDEX "ReferralLink_ownerUserId_tenantId_key"
  ON "ReferralLink"("ownerUserId", "tenantId");

-- Глобальный UNIQUE(code) — публичный токен не должен коллидировать.
CREATE UNIQUE INDEX "ReferralLink_code_key"
  ON "ReferralLink"("code");

CREATE INDEX "ReferralLink_ownerUserId_idx"
  ON "ReferralLink"("ownerUserId");

-- ================================================================
-- 3. ReferralAttribution — двухэтапный attribution lock
-- ================================================================

CREATE TABLE "ReferralAttribution" (
  "id"                       TEXT                        NOT NULL,
  "referralLinkId"           TEXT,
  "referralCode"             VARCHAR(32)                 NOT NULL,
  "referredUserId"           TEXT                        NOT NULL,
  "referredTenantId"         TEXT,
  "status"                   "ReferralAttributionStatus" NOT NULL DEFAULT 'ATTRIBUTED',
  "rejectionReason"          VARCHAR(64),

  -- §13 attribution context.
  "utmSource"                VARCHAR(128),
  "utmMedium"                VARCHAR(128),
  "utmCampaign"              VARCHAR(128),
  "utmContent"               VARCHAR(128),
  "utmTerm"                  VARCHAR(128),
  "sourceIp"                 VARCHAR(64),
  "userAgent"                VARCHAR(512),

  "registrationAttributedAt" TIMESTAMP(3)                NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantLockedAt"           TIMESTAMP(3),
  "firstPaidAt"              TIMESTAMP(3),

  "createdAt"                TIMESTAMP(3)                NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                TIMESTAMP(3)                NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReferralAttribution_pkey" PRIMARY KEY ("id")
);

-- FK: link SET NULL — даже если ссылку удалят, attribution сохраняется
-- (snapshot в `referralCode` выше). Это §13 + §19 audit trail.
ALTER TABLE "ReferralAttribution"
  ADD CONSTRAINT "ReferralAttribution_referralLinkId_fkey"
    FOREIGN KEY ("referralLinkId") REFERENCES "ReferralLink"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- FK: referredUser CASCADE — если пользователь полностью удалён, attribution
-- не нужна.
ALTER TABLE "ReferralAttribution"
  ADD CONSTRAINT "ReferralAttribution_referredUserId_fkey"
    FOREIGN KEY ("referredUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: referredTenant SET NULL — tenant может быть закрыт; attribution
-- остаётся для аудита и для предотвращения reuse кода.
ALTER TABLE "ReferralAttribution"
  ADD CONSTRAINT "ReferralAttribution_referredTenantId_fkey"
    FOREIGN KEY ("referredTenantId") REFERENCES "Tenant"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- §13 attribution lock: один user — одна attribution, нельзя перезаписать.
CREATE UNIQUE INDEX "ReferralAttribution_referredUserId_key"
  ON "ReferralAttribution"("referredUserId");

-- §13 attribution lock на уровне tenant: один tenant — одна attribution.
-- Postgres NULLS DISTINCT (default) даёт нам множественные NULL для
-- attributions, ещё не привязанных к tenant.
CREATE UNIQUE INDEX "ReferralAttribution_referredTenantId_key"
  ON "ReferralAttribution"("referredTenantId");

-- §6 + §19 referral funnel dashboards.
CREATE INDEX "ReferralAttribution_referralLinkId_status_idx"
  ON "ReferralAttribution"("referralLinkId", "status");

CREATE INDEX "ReferralAttribution_status_registrationAttributedAt_idx"
  ON "ReferralAttribution"("status", "registrationAttributedAt");
