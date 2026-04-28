-- TASK_MARKETPLACE_ACCOUNTS_1: Data Model, Encrypted Credentials, Account Statuses
--
-- Что делает миграция:
-- 1. Добавляет 4 новых enum для разделения lifecycle / credential / sync health /
--    last sync result статусов (ранее всё было либо плоской String? полем,
--    либо отсутствовало).
-- 2. Расширяет `MarketplaceAccount` 13 новыми полями §8 system-analytics
--    (label, lifecycleStatus, credentialStatus, syncHealthStatus,
--    syncHealthReason, lastValidatedAt, lastValidationError*, lastSyncResult,
--    lastSyncError*, deactivatedAt/By).
-- 3. Backfill `label` из существующего `name` для исторических аккаунтов,
--    после чего поле становится NOT NULL.
-- 4. UNIQUE(tenantId, marketplace, label) — стабильное имя per marketplace.
-- 5. **Partial unique** UNIQUE(tenantId, marketplace) WHERE lifecycleStatus='ACTIVE'
--    — DB-level enforce единственного активного аккаунта на marketplace
--    (см. §10 invariant). Prisma напрямую partial unique не поддерживает,
--    создаётся через CREATE UNIQUE INDEX ... WHERE.
-- 6. Создаёт таблицу `MarketplaceCredential` (1:1) для шифрованного хранилища
--    с поддержкой rotation и schema versioning.
-- 7. Создаёт `MarketplaceAccountEvent` (append-only лог жизненного цикла).
--
-- Что НЕ делает (намеренно):
-- - Не удаляет legacy plaintext поля `apiKey/clientId/statApiKey/warehouseId`
--   и `lastSyncStatus/lastSyncError String?` — sync.service / settings.service
--   продолжают на них работать. Полная миграция secrets в encrypted payload и
--   переключение читателей — TASK_MARKETPLACE_ACCOUNTS_2/3.
-- - Не изменяет `MarketplaceType` enum (Yandex Market пока не подключается).
-- - Не пишет валидаторы/encryption-сервис/API endpoints (они в TASK_2-7).

-- ================================================================
-- 1. ENUMS
-- ================================================================

CREATE TYPE "MarketplaceLifecycleStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TYPE "MarketplaceCredentialStatus" AS ENUM (
  'VALIDATING',
  'VALID',
  'INVALID',
  'NEEDS_RECONNECT',
  'UNKNOWN'
);

CREATE TYPE "MarketplaceSyncHealthStatus" AS ENUM (
  'HEALTHY',
  'DEGRADED',
  'PAUSED',
  'ERROR',
  'UNKNOWN'
);

CREATE TYPE "MarketplaceLastSyncStatus" AS ENUM (
  'SUCCESS',
  'PARTIAL_SUCCESS',
  'FAILED'
);

-- ================================================================
-- 2. MarketplaceAccount — расширение полями §8
-- ================================================================

ALTER TABLE "MarketplaceAccount"
  ADD COLUMN "label"                       VARCHAR(128),
  ADD COLUMN "lifecycleStatus"             "MarketplaceLifecycleStatus"  NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "credentialStatus"            "MarketplaceCredentialStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "syncHealthStatus"            "MarketplaceSyncHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "syncHealthReason"            VARCHAR(64),
  ADD COLUMN "lastValidatedAt"             TIMESTAMP(3),
  ADD COLUMN "lastValidationErrorCode"     VARCHAR(64),
  ADD COLUMN "lastValidationErrorMessage"  TEXT,
  ADD COLUMN "lastSyncResult"              "MarketplaceLastSyncStatus",
  ADD COLUMN "lastSyncErrorCode"           VARCHAR(64),
  ADD COLUMN "lastSyncErrorMessage"        TEXT,
  ADD COLUMN "deactivatedAt"               TIMESTAMP(3),
  ADD COLUMN "deactivatedBy"               TEXT;

-- Backfill label из существующего name для исторических аккаунтов.
-- После этого делаем поле NOT NULL.
UPDATE "MarketplaceAccount" SET "label" = "name" WHERE "label" IS NULL;
ALTER TABLE "MarketplaceAccount" ALTER COLUMN "label" SET NOT NULL;

-- FK: deactivatedBy → User (SET NULL — удаление user не ломает аудит-связь).
ALTER TABLE "MarketplaceAccount"
  ADD CONSTRAINT "MarketplaceAccount_deactivatedBy_fkey"
    FOREIGN KEY ("deactivatedBy") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ================================================================
-- 3. UNIQUE и индексы
-- ================================================================

-- UNIQUE(tenantId, marketplace, label) — стабильное имя per marketplace.
CREATE UNIQUE INDEX "MarketplaceAccount_tenantId_marketplace_label_key"
  ON "MarketplaceAccount"("tenantId", "marketplace", "label");

-- Partial unique: только один ACTIVE аккаунт per (tenant, marketplace).
-- Когда нужен новый — текущий должен быть переведён в INACTIVE сначала.
CREATE UNIQUE INDEX "MarketplaceAccount_one_active_per_marketplace_key"
  ON "MarketplaceAccount"("tenantId", "marketplace")
  WHERE "lifecycleStatus" = 'ACTIVE';

-- Индексы для типичных фильтров UI/диагностики.
CREATE INDEX "MarketplaceAccount_tenantId_lifecycleStatus_idx"
  ON "MarketplaceAccount"("tenantId", "lifecycleStatus");

CREATE INDEX "MarketplaceAccount_tenantId_credentialStatus_idx"
  ON "MarketplaceAccount"("tenantId", "credentialStatus");

CREATE INDEX "MarketplaceAccount_tenantId_syncHealthStatus_idx"
  ON "MarketplaceAccount"("tenantId", "syncHealthStatus");

-- ================================================================
-- 4. MarketplaceCredential — шифрованное хранилище 1:1
-- ================================================================

CREATE TABLE "MarketplaceCredential" (
  "id"                   TEXT          NOT NULL,
  "accountId"            TEXT          NOT NULL,
  "encryptedPayload"     BYTEA         NOT NULL,
  "encryptionKeyVersion" INTEGER       NOT NULL,
  "schemaVersion"        INTEGER       NOT NULL DEFAULT 1,
  "maskedPreview"        JSONB,
  "rotatedAt"            TIMESTAMP(3),
  "createdAt"            TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MarketplaceCredential_pkey" PRIMARY KEY ("id")
);

-- 1:1 с аккаунтом: на один аккаунт ровно одна запись credentials.
CREATE UNIQUE INDEX "MarketplaceCredential_accountId_key"
  ON "MarketplaceCredential"("accountId");

ALTER TABLE "MarketplaceCredential"
  ADD CONSTRAINT "MarketplaceCredential_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "MarketplaceAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ================================================================
-- 5. MarketplaceAccountEvent — append-only журнал жизненного цикла
-- ================================================================

CREATE TABLE "MarketplaceAccountEvent" (
  "id"        TEXT         NOT NULL,
  "tenantId"  TEXT         NOT NULL,
  "accountId" TEXT         NOT NULL,
  "eventType" VARCHAR(64)  NOT NULL,
  "payload"   JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MarketplaceAccountEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketplaceAccountEvent_tenantId_accountId_createdAt_idx"
  ON "MarketplaceAccountEvent"("tenantId", "accountId", "createdAt");

CREATE INDEX "MarketplaceAccountEvent_tenantId_eventType_createdAt_idx"
  ON "MarketplaceAccountEvent"("tenantId", "eventType", "createdAt");

ALTER TABLE "MarketplaceAccountEvent"
  ADD CONSTRAINT "MarketplaceAccountEvent_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketplaceAccountEvent"
  ADD CONSTRAINT "MarketplaceAccountEvent_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "MarketplaceAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
