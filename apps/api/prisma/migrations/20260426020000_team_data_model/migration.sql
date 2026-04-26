-- T3-01: Team Data Model — Invitations, Membership Lifecycle, TeamEvent
-- Расширяет Membership: добавляет status/joinedAt/revokedAt/leftAt.
-- Создаёт таблицы: Invitation, TeamEvent.
-- Добавляет частичный уникальный индекс для одного pending-инвайта на (tenant, email).
--
-- Безопасность данных:
-- - существующие записи Membership получают status = 'ACTIVE', joinedAt = createdAt.
-- - email в Invitation всегда хранится в нижнем регистре (нормализация на app-уровне).

-- 1. Новые enum-типы
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED', 'LEFT');
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELLED');

-- 2. Расширяем таблицу Membership
ALTER TABLE "Membership"
  ADD COLUMN "status"    "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "joinedAt"  TIMESTAMP(3),
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "leftAt"    TIMESTAMP(3);

-- Бэкфил: все существующие участники — активны, joinedAt = createdAt
UPDATE "Membership"
  SET "joinedAt" = "createdAt"
  WHERE "status" = 'ACTIVE';

-- Составной индекс для быстрой фильтрации по тенанту и статусу
CREATE INDEX "Membership_tenantId_status_idx" ON "Membership"("tenantId", "status");

-- 3. Таблица Invitation
CREATE TABLE "Invitation" (
  "id"               TEXT               NOT NULL,
  "email"            TEXT               NOT NULL,
  "role"             "Role"             NOT NULL,
  "status"           "InvitationStatus" NOT NULL DEFAULT 'PENDING',
  "tokenHash"        TEXT               NOT NULL,
  "expiresAt"        TIMESTAMP(3)       NOT NULL,
  "acceptedAt"       TIMESTAMP(3),
  "cancelledAt"      TIMESTAMP(3),
  "tenantId"         TEXT               NOT NULL,
  "invitedByUserId"  TEXT               NOT NULL,
  "acceptedByUserId" TEXT,
  "createdAt"        TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Invitation_pkey"          PRIMARY KEY ("id"),
  CONSTRAINT "Invitation_tokenHash_key" UNIQUE ("tokenHash"),
  CONSTRAINT "Invitation_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Invitation_invitedByUserId_fkey"
    FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON UPDATE CASCADE,
  CONSTRAINT "Invitation_acceptedByUserId_fkey"
    FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON UPDATE CASCADE
);

CREATE INDEX "Invitation_tenantId_idx"   ON "Invitation"("tenantId");
CREATE INDEX "Invitation_tokenHash_idx"  ON "Invitation"("tokenHash");

-- Частичный уникальный индекс: не более одного pending-инвайта на пару (tenant, email)
CREATE UNIQUE INDEX "Invitation_tenantId_email_pending_uidx"
  ON "Invitation"(LOWER("email"), "tenantId")
  WHERE "status" = 'PENDING';

-- 4. Таблица TeamEvent
CREATE TABLE "TeamEvent" (
  "id"          TEXT         NOT NULL,
  "eventType"   TEXT         NOT NULL,
  "payload"     JSONB,
  "tenantId"    TEXT         NOT NULL,
  "actorUserId" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TeamEvent_pkey"      PRIMARY KEY ("id"),
  CONSTRAINT "TeamEvent_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TeamEvent_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON UPDATE CASCADE
);

CREATE INDEX "TeamEvent_tenantId_createdAt_idx" ON "TeamEvent"("tenantId", "createdAt");
