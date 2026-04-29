-- TASK_ADMIN_3: Support Actions API и Internal Notes
--
-- Добавляет в internal control plane:
--   + 2 enum'а: SupportActionType, SupportActionResultStatus
--   + таблица "support_actions"  — журнал mutating support-операций (см. 19-admin §8)
--   + таблица "support_notes"    — internal handoff между сменами поддержки
--
-- Архитектурный инвариант (см. 19-admin §10, §15):
--   - support_actions фиксирует ЛЮБУЮ попытку mutating action — даже blocked'и failed,
--     чтобы execution path был воспроизводим;
--   - reason обязателен (NOT NULL) на уровне БД — domain-валидация требует длину >= 10
--     для high-risk actions, но БД защищает инвариант "audit-without-reason недопустим";
--   - support_notes изолированы от tenant-facing audit и не доступны через tenant API.

-- ─── Enums ──────────────────────────────────────────────────────────────────

CREATE TYPE "SupportActionType" AS ENUM (
    'EXTEND_TRIAL',
    'SET_ACCESS_STATE',
    'RESTORE_TENANT',
    'TRIGGER_PASSWORD_RESET',
    'ADD_INTERNAL_NOTE'
);

CREATE TYPE "SupportActionResultStatus" AS ENUM (
    'success',
    'failed',
    'blocked'
);

-- ─── support_actions ────────────────────────────────────────────────────────

CREATE TABLE "support_actions" (
    "id"                 TEXT                        NOT NULL,
    "tenantId"           TEXT,
    "actorSupportUserId" TEXT                        NOT NULL,
    "actionType"         "SupportActionType"         NOT NULL,
    "reason"             TEXT                        NOT NULL,
    "payload"            JSONB,
    "resultStatus"       "SupportActionResultStatus" NOT NULL,
    "resultDetails"      JSONB,
    "errorCode"          TEXT,
    "auditLogId"         TEXT,
    "correlationId"      TEXT,
    "targetUserId"       TEXT,
    "ip"                 TEXT,
    "userAgent"          TEXT,
    "createdAt"          TIMESTAMP(3)                NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_actions_tenantId_createdAt_idx"
    ON "support_actions"("tenantId", "createdAt");

CREATE INDEX "support_actions_actorSupportUserId_createdAt_idx"
    ON "support_actions"("actorSupportUserId", "createdAt");

CREATE INDEX "support_actions_actionType_createdAt_idx"
    ON "support_actions"("actionType", "createdAt");

ALTER TABLE "support_actions"
    ADD CONSTRAINT "support_actions_actorSupportUserId_fkey"
    FOREIGN KEY ("actorSupportUserId") REFERENCES "support_users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── support_notes ──────────────────────────────────────────────────────────

CREATE TABLE "support_notes" (
    "id"                  TEXT         NOT NULL,
    "tenantId"            TEXT         NOT NULL,
    "authorSupportUserId" TEXT         NOT NULL,
    "note"                TEXT         NOT NULL,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_notes_tenantId_createdAt_idx"
    ON "support_notes"("tenantId", "createdAt");

ALTER TABLE "support_notes"
    ADD CONSTRAINT "support_notes_authorSupportUserId_fkey"
    FOREIGN KEY ("authorSupportUserId") REFERENCES "support_users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
