-- TASK_AUDIT_1: Immutable Storage, Audit Taxonomy и Data Model
-- Аддитивная миграция: 5 новых enum'ов + новые колонки в AuditLog + новая таблица SecurityEvent + индексы.
-- Старые колонки AuditLog остаются nullable для backward compat (будут удалены в TASK_AUDIT_2).

-- ─── Enums ──────────────────────────────────────────────────────────

CREATE TYPE "AuditActorType" AS ENUM (
    'user',
    'system',
    'support',
    'marketplace'
);

CREATE TYPE "AuditSource" AS ENUM (
    'ui',
    'api',
    'worker',
    'marketplace'
);

CREATE TYPE "AuditVisibilityScope" AS ENUM (
    'tenant',
    'internal_only'
);

CREATE TYPE "AuditRedactionLevel" AS ENUM (
    'none',
    'partial',
    'strict'
);

CREATE TYPE "SecurityEventType" AS ENUM (
    'login_success',
    'login_failed',
    'password_reset_requested',
    'password_changed',
    'session_revoked'
);

-- ─── AuditLog — новые канонические колонки ──────────────────────────

ALTER TABLE "AuditLog"
    ADD COLUMN "eventType"      TEXT,
    ADD COLUMN "eventDomain"    TEXT,
    ADD COLUMN "entityType"     TEXT,
    ADD COLUMN "entityId"       TEXT,
    ADD COLUMN "actorType"      "AuditActorType",
    ADD COLUMN "actorId"        TEXT,
    ADD COLUMN "actorRole"      TEXT,
    ADD COLUMN "source"         "AuditSource",
    ADD COLUMN "requestId"      TEXT,
    ADD COLUMN "correlationId"  TEXT,
    ADD COLUMN "before"         JSONB,
    ADD COLUMN "after"          JSONB,
    ADD COLUMN "changedFields"  JSONB,
    ADD COLUMN "metadata"       JSONB,
    ADD COLUMN "visibilityScope" "AuditVisibilityScope" NOT NULL DEFAULT 'tenant',
    ADD COLUMN "redactionLevel"  "AuditRedactionLevel"  NOT NULL DEFAULT 'none';

-- Сделать actionType nullable (legacy, backward compat)
ALTER TABLE "AuditLog" ALTER COLUMN "actionType" DROP NOT NULL;

-- ─── AuditLog — индексы ─────────────────────────────────────────────

CREATE INDEX "AuditLog_tenantId_createdAt_idx"
    ON "AuditLog" ("tenantId", "createdAt" DESC);

CREATE INDEX "AuditLog_tenantId_entityType_entityId_idx"
    ON "AuditLog" ("tenantId", "entityType", "entityId");

CREATE INDEX "AuditLog_tenantId_actorId_createdAt_idx"
    ON "AuditLog" ("tenantId", "actorId", "createdAt" DESC);

CREATE INDEX "AuditLog_requestId_idx"
    ON "AuditLog" ("requestId");

-- ─── SecurityEvent — новая таблица ──────────────────────────────────

CREATE TABLE "SecurityEvent" (
    "id"        TEXT NOT NULL,
    "tenantId"  TEXT,
    "userId"    TEXT,
    "eventType" "SecurityEventType" NOT NULL,
    "ip"        TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "metadata"  JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- ─── SecurityEvent — FK ─────────────────────────────────────────────

ALTER TABLE "SecurityEvent"
    ADD CONSTRAINT "SecurityEvent_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SecurityEvent"
    ADD CONSTRAINT "SecurityEvent_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── SecurityEvent — индексы ─────────────────────────────────────────

CREATE INDEX "SecurityEvent_tenantId_createdAt_idx"
    ON "SecurityEvent" ("tenantId", "createdAt" DESC);

CREATE INDEX "SecurityEvent_userId_createdAt_idx"
    ON "SecurityEvent" ("userId", "createdAt" DESC);

CREATE INDEX "SecurityEvent_eventType_idx"
    ON "SecurityEvent" ("eventType");

CREATE INDEX "SecurityEvent_requestId_idx"
    ON "SecurityEvent" ("requestId");
