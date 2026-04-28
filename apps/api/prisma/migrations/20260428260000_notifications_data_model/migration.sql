-- TASK_NOTIFICATIONS_1: notification_events / notification_dispatches /
-- notification_preferences / notification_inbox + enums
-- Аддитивная миграция: 5 новых enum'ов + 4 новые таблицы + индексы.

-- ─── Enums ──────────────────────────────────────────────────────────

CREATE TYPE "NotificationCategory" AS ENUM (
    'AUTH',
    'BILLING',
    'SYNC',
    'INVENTORY',
    'REFERRAL',
    'SYSTEM'
);

CREATE TYPE "NotificationChannel" AS ENUM (
    'EMAIL',
    'IN_APP',
    'TELEGRAM',
    'MAX'
);

CREATE TYPE "NotificationSeverity" AS ENUM (
    'INFO',
    'WARNING',
    'CRITICAL'
);

CREATE TYPE "NotificationDispatchPolicy" AS ENUM (
    'INSTANT',
    'DIGEST',
    'SCHEDULED',
    'THROTTLED'
);

CREATE TYPE "NotificationDispatchStatus" AS ENUM (
    'QUEUED',
    'SENT',
    'DELIVERED',
    'FAILED',
    'SKIPPED'
);

-- ─── notification_events ────────────────────────────────────────────
-- Источник уведомления. Публикуется доменным модулем.
-- is_mandatory защищает от подавления preferences (AUTH/BILLING/SYSTEM).
-- dedup_key + tenantId + category — окно дедупликации (§10, 15 мин).

CREATE TABLE "NotificationEvent" (
    "id"          TEXT                      NOT NULL,
    "tenantId"    TEXT                      NOT NULL,
    "category"    "NotificationCategory"    NOT NULL,
    "severity"    "NotificationSeverity"    NOT NULL DEFAULT 'INFO',
    "isMandatory" BOOLEAN                   NOT NULL DEFAULT false,
    "dedup_key"   VARCHAR(128),
    "payload"     JSONB,
    "createdAt"   TIMESTAMPTZ(6)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "NotificationEvent"
    ADD CONSTRAINT "NotificationEvent_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE;

CREATE INDEX "NotificationEvent_tenantId_category_createdAt_idx"
    ON "NotificationEvent"("tenantId", "category", "createdAt");

CREATE INDEX "NotificationEvent_tenantId_dedup_key_createdAt_idx"
    ON "NotificationEvent"("tenantId", "dedup_key", "createdAt");

-- ─── notification_dispatches ────────────────────────────────────────
-- Задача доставки: один event → N dispatch-записей (по одной на канал).
-- attempts + lastError поддерживают retry с backoff (§15).
-- sentAt / deliveredAt — для SLA p95 диагностики (§18).

CREATE TABLE "NotificationDispatch" (
    "id"          TEXT                          NOT NULL,
    "eventId"     TEXT                          NOT NULL,
    "channel"     "NotificationChannel"         NOT NULL,
    "policy"      "NotificationDispatchPolicy"  NOT NULL DEFAULT 'INSTANT',
    "status"      "NotificationDispatchStatus"  NOT NULL DEFAULT 'QUEUED',
    "attempts"    INTEGER                       NOT NULL DEFAULT 0,
    "lastError"   TEXT,
    "scheduledAt" TIMESTAMPTZ(6),
    "sentAt"      TIMESTAMPTZ(6),
    "deliveredAt" TIMESTAMPTZ(6),
    "createdAt"   TIMESTAMPTZ(6)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMPTZ(6)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationDispatch_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "NotificationDispatch"
    ADD CONSTRAINT "NotificationDispatch_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "NotificationEvent"("id") ON DELETE CASCADE;

-- Worker queue: все QUEUED задачи по каналу.
CREATE INDEX "NotificationDispatch_channel_status_createdAt_idx"
    ON "NotificationDispatch"("channel", "status", "createdAt");

-- Диагностика retry: все dispatches event'а с ошибками.
CREATE INDEX "NotificationDispatch_eventId_status_idx"
    ON "NotificationDispatch"("eventId", "status");

-- ─── notification_preferences ───────────────────────────────────────
-- Tenant-level настройки каналов и категорий (owner-managed).
-- channels/categories — JSONB для гибкого расширения без миграций.
-- primaryChannel — fallback при preferences evaluation.
-- digestTime зарезервирован (§22: DIGEST не в MVP).

CREATE TABLE "NotificationPreferences" (
    "tenantId"       TEXT                   NOT NULL,
    "channels"       JSONB                  NOT NULL DEFAULT '{"email": true, "in_app": true, "telegram": false, "max": false}',
    "categories"     JSONB                  NOT NULL DEFAULT '{"auth": true, "billing": true, "sync": true, "inventory": true, "referral": true, "system": true}',
    "primaryChannel" "NotificationChannel"  NOT NULL DEFAULT 'IN_APP',
    "digestTime"     VARCHAR(8),
    "timezone"       VARCHAR(64),
    "updatedAt"      TIMESTAMPTZ(6)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationPreferences_pkey" PRIMARY KEY ("tenantId")
);

ALTER TABLE "NotificationPreferences"
    ADD CONSTRAINT "NotificationPreferences_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE;

-- ─── notification_inbox ─────────────────────────────────────────────
-- In-app inbox. Создаётся worker'ом при channel=IN_APP (§9 step 6).
-- isRead + readAt поддерживают UX read/unread и engagement-метрики.

CREATE TABLE "NotificationInbox" (
    "id"        TEXT           NOT NULL,
    "tenantId"  TEXT           NOT NULL,
    "userId"    TEXT           NOT NULL,
    "title"     TEXT           NOT NULL,
    "message"   TEXT           NOT NULL,
    "isRead"    BOOLEAN        NOT NULL DEFAULT false,
    "readAt"    TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationInbox_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "NotificationInbox"
    ADD CONSTRAINT "NotificationInbox_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE;

ALTER TABLE "NotificationInbox"
    ADD CONSTRAINT "NotificationInbox_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;

-- Inbox feed: последние непрочитанные per (tenant, user).
CREATE INDEX "NotificationInbox_tenantId_userId_isRead_createdAt_idx"
    ON "NotificationInbox"("tenantId", "userId", "isRead", "createdAt");

-- Bulk mark-read по user.
CREATE INDEX "NotificationInbox_userId_isRead_idx"
    ON "NotificationInbox"("userId", "isRead");
