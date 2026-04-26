-- T2-01: Tenant Domain Model
-- Расширяет модель Tenant: inn, status, primaryOwnerUserId, closedAt.
-- Выносит taxSystem/vatThresholdExceeded из Tenant в новую TenantSettings.
-- Добавляет GRACE_PERIOD в AccessState enum.
-- Добавляет таблицы: TenantSettings, TenantAccessStateEvent, TenantClosureJob.
--
-- Безопасность данных:
-- - taxSystem/vatThresholdExceeded мигрируются в TenantSettings до удаления из Tenant.
-- - inn, primaryOwnerUserId, closedAt — nullable: не ломают существующие записи.
-- - Все новые таблицы имеют ON DELETE CASCADE от Tenant.

-- 1. Новые enum-типы
CREATE TYPE "TenantStatus"           AS ENUM ('ACTIVE', 'CLOSED');
CREATE TYPE "TenantActorType"        AS ENUM ('SYSTEM', 'BILLING', 'SUPPORT', 'USER');
CREATE TYPE "TenantClosureJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'ARCHIVED', 'DELETED', 'FAILED');

-- 2. Добавляем GRACE_PERIOD в существующий AccessState enum
--    (PostgreSQL 12+ поддерживает ADD VALUE внутри транзакции)
ALTER TYPE "AccessState" ADD VALUE 'GRACE_PERIOD' AFTER 'ACTIVE_PAID';

-- 3. Новые поля таблицы Tenant
ALTER TABLE "Tenant"
  ADD COLUMN "inn"                TEXT,
  ADD COLUMN "status"             "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "primaryOwnerUserId" TEXT,
  ADD COLUMN "closedAt"           TIMESTAMP(3);

CREATE UNIQUE INDEX "Tenant_inn_key" ON "Tenant"("inn");

ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_primaryOwnerUserId_fkey"
    FOREIGN KEY ("primaryOwnerUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Создаём TenantSettings
CREATE TABLE "TenantSettings" (
  "tenantId"             TEXT         NOT NULL,
  "taxSystem"            "TaxSystem"  NOT NULL DEFAULT 'USN_6',
  "vatThresholdExceeded" BOOLEAN      NOT NULL DEFAULT false,
  "country"              TEXT,
  "currency"             TEXT,
  "timezone"             TEXT,
  "legalName"            TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TenantSettings_pkey" PRIMARY KEY ("tenantId"),
  CONSTRAINT "TenantSettings_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 5. Data migration: копируем taxSystem и vatThresholdExceeded в TenantSettings
INSERT INTO "TenantSettings" ("tenantId", "taxSystem", "vatThresholdExceeded", "updatedAt")
SELECT "id", "taxSystem", "vatThresholdExceeded", NOW()
FROM "Tenant";

-- 6. Убираем поля из Tenant (данные уже перенесены выше)
ALTER TABLE "Tenant"
  DROP COLUMN "taxSystem",
  DROP COLUMN "vatThresholdExceeded";

-- 7. TenantAccessStateEvent — audit trail каждого AccessState-перехода
CREATE TABLE "TenantAccessStateEvent" (
  "id"            TEXT               NOT NULL,
  "tenantId"      TEXT               NOT NULL,
  "fromState"     "AccessState",
  "toState"       "AccessState"      NOT NULL,
  "reasonCode"    TEXT               NOT NULL,
  "reasonDetails" JSONB,
  "actorType"     "TenantActorType"  NOT NULL,
  "actorId"       TEXT,
  "createdAt"     TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TenantAccessStateEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TenantAccessStateEvent_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "TenantAccessStateEvent_tenantId_createdAt_idx"
  ON "TenantAccessStateEvent"("tenantId", "createdAt");

-- 8. TenantClosureJob — задача на retention/archival после закрытия
CREATE TABLE "TenantClosureJob" (
  "id"            TEXT                    NOT NULL,
  "tenantId"      TEXT                    NOT NULL,
  "status"        "TenantClosureJobStatus" NOT NULL DEFAULT 'PENDING',
  "scheduledFor"  TIMESTAMP(3)            NOT NULL,
  "processedAt"   TIMESTAMP(3),
  "failureReason" TEXT,
  "createdAt"     TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TenantClosureJob_pkey"      PRIMARY KEY ("id"),
  CONSTRAINT "TenantClosureJob_tenantId_key" UNIQUE ("tenantId"),
  CONSTRAINT "TenantClosureJob_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
