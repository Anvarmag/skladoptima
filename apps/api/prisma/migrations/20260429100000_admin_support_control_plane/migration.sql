-- TASK_ADMIN_1: Internal Admin / Support Control Plane
--
-- Создаёт изолированный internal control plane для support-контура:
--   + 3 enum'а: SupportUserRole, SupportSessionStatus, SupportSecurityEventType
--   + таблица "support_users"             — support-операторы (отделены от tenant Users)
--   + таблица "support_auth_sessions"     — refresh rotation + reuse detection
--   + таблица "support_login_attempts"    — soft-lock по (email + IP)
--   + таблица "support_security_events"   — internal_only audit, не смешивается с tenant SecurityEvent
--
-- Архитектурный инвариант (см. 19-admin §3, §15):
--   - support_user НЕ имеет memberships, tenant picker и tenant-RBAC;
--   - admin-плоскость не использует таблицы Users / Membership / AuthSession;
--   - SupportSecurityEvent — отдельный security stream (internal_only zone),
--     tenant audit через AuditLog/SecurityEvent остаётся неприкосновенным.

-- ─── Enums ──────────────────────────────────────────────────────────────────

CREATE TYPE "SupportUserRole" AS ENUM (
    'SUPPORT_ADMIN',
    'SUPPORT_READONLY'
);

CREATE TYPE "SupportSessionStatus" AS ENUM (
    'ACTIVE',
    'ROTATED',
    'REVOKED',
    'EXPIRED',
    'COMPROMISED'
);

CREATE TYPE "SupportSecurityEventType" AS ENUM (
    'admin_login_success',
    'admin_login_failed',
    'admin_session_revoked',
    'admin_password_changed',
    'admin_rbac_denied'
);

-- ─── support_users ──────────────────────────────────────────────────────────

CREATE TABLE "support_users" (
    "id"           TEXT              NOT NULL,
    "email"        TEXT              NOT NULL,
    "passwordHash" TEXT              NOT NULL,
    "role"         "SupportUserRole" NOT NULL,
    "isActive"     BOOLEAN           NOT NULL DEFAULT true,
    "lastLoginAt"  TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3)      NOT NULL,

    CONSTRAINT "support_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "support_users_email_key" ON "support_users"("email");

-- ─── support_auth_sessions ──────────────────────────────────────────────────

CREATE TABLE "support_auth_sessions" (
    "id"               TEXT                   NOT NULL,
    "supportUserId"    TEXT                   NOT NULL,
    "refreshTokenHash" TEXT                   NOT NULL,
    "status"           "SupportSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "ip"               TEXT,
    "userAgent"        TEXT,
    "lastSeenAt"       TIMESTAMP(3),
    "expiresAt"        TIMESTAMP(3)           NOT NULL,
    "revokedAt"        TIMESTAMP(3),
    "revokeReason"     TEXT,
    "createdAt"        TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3)           NOT NULL,

    CONSTRAINT "support_auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "support_auth_sessions_refreshTokenHash_key"
    ON "support_auth_sessions"("refreshTokenHash");

CREATE INDEX "support_auth_sessions_supportUserId_status_idx"
    ON "support_auth_sessions"("supportUserId", "status");

ALTER TABLE "support_auth_sessions"
    ADD CONSTRAINT "support_auth_sessions_supportUserId_fkey"
    FOREIGN KEY ("supportUserId") REFERENCES "support_users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── support_login_attempts ─────────────────────────────────────────────────

CREATE TABLE "support_login_attempts" (
    "id"              TEXT         NOT NULL,
    "normalizedEmail" TEXT         NOT NULL,
    "ip"              TEXT         NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_login_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_login_attempts_normalizedEmail_ip_createdAt_idx"
    ON "support_login_attempts"("normalizedEmail", "ip", "createdAt");

-- ─── support_security_events ───────────────────────────────────────────────

CREATE TABLE "support_security_events" (
    "id"            TEXT                       NOT NULL,
    "supportUserId" TEXT,
    "eventType"     "SupportSecurityEventType" NOT NULL,
    "ip"            TEXT,
    "userAgent"     TEXT,
    "metadata"      JSONB,
    "createdAt"     TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_security_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_security_events_supportUserId_eventType_createdAt_idx"
    ON "support_security_events"("supportUserId", "eventType", "createdAt");

CREATE INDEX "support_security_events_eventType_createdAt_idx"
    ON "support_security_events"("eventType", "createdAt");

ALTER TABLE "support_security_events"
    ADD CONSTRAINT "support_security_events_supportUserId_fkey"
    FOREIGN KEY ("supportUserId") REFERENCES "support_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
