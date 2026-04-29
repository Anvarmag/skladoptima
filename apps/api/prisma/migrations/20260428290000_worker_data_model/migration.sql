-- TASK_WORKER_1: Queue Infra, Job Persistence и Core Data Model
--
-- Аддитивная миграция:
--   + 4 новых enum'а: WorkerJobStatus, WorkerJobPriority, WorkerActorType, WorkerJobType
--   + таблица "worker_jobs"         — lifecycle record фоновой задачи
--   + таблица "worker_failed_jobs"  — immutable snapshot ошибки при final-failed
--   + таблица "worker_schedules"    — реестр cron-расписаний
--
-- Трёхуровневые очереди: critical / default / bulk (§14).
-- tenant_id nullable — system/global jobs не имеют tenant scope.
-- idempotency_key + correlation_id — dedup и cross-module tracing (§15).

-- ─── Enums ──────────────────────────────────────────────────────────────────

-- Lifecycle: queued → in_progress → retrying → success | failed | blocked | dead_lettered | cancelled
CREATE TYPE "WorkerJobStatus" AS ENUM (
    'queued',
    'in_progress',
    'retrying',
    'success',
    'failed',
    'blocked',
    'dead_lettered',
    'cancelled'
);

-- Трёхуровневые очереди (§14): critical > default > bulk
CREATE TYPE "WorkerJobPriority" AS ENUM (
    'critical',
    'default',
    'bulk'
);

-- Актор, создавший job
CREATE TYPE "WorkerActorType" AS ENUM (
    'user',
    'system',
    'support',
    'scheduler'
);

-- Реестр классов задач (§13)
CREATE TYPE "WorkerJobType" AS ENUM (
    'SYNC',
    'NOTIFICATION',
    'BILLING_REMINDER',
    'FILE_CLEANUP',
    'ANALYTICS_REBUILD',
    'AUDIT_MAINTENANCE'
);

-- ─── worker_jobs ─────────────────────────────────────────────────────────────
--
-- Основная запись фоновой задачи с полным lifecycle.
-- lease_owner/lease_until реализуют distributed lock для одного consumer.

CREATE TABLE "worker_jobs" (
    "id"                    TEXT            NOT NULL,
    "tenantId"              TEXT,
    "jobType"               "WorkerJobType" NOT NULL,
    "queueName"             VARCHAR(32)     NOT NULL,
    "priority"              "WorkerJobPriority" NOT NULL DEFAULT 'default',

    -- Dedup и tracing
    "idempotencyKey"        VARCHAR(128),
    "correlationId"         TEXT,

    -- Актор-создатель
    "createdByActorType"    "WorkerActorType" NOT NULL,
    "createdByActorId"      TEXT,

    "payload"               JSONB           NOT NULL,
    "status"                "WorkerJobStatus" NOT NULL DEFAULT 'queued',

    "attempt"               INTEGER         NOT NULL DEFAULT 0,
    "maxAttempts"           INTEGER         NOT NULL DEFAULT 3,

    -- Distributed lease lock
    "leaseOwner"            VARCHAR(128),
    "leaseUntil"            TIMESTAMPTZ,

    "queuedAt"              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    "startedAt"             TIMESTAMPTZ,
    "finishedAt"            TIMESTAMPTZ,
    "nextAttemptAt"         TIMESTAMPTZ,

    "lastError"             TEXT,
    "resultSummary"         JSONB,

    CONSTRAINT "worker_jobs_pkey" PRIMARY KEY ("id")
);

-- FK к Tenant (nullable — system jobs не имеют tenant scope)
ALTER TABLE "worker_jobs"
    ADD CONSTRAINT "worker_jobs_tenantId_fkey"
    FOREIGN KEY ("tenantId")
    REFERENCES "Tenant"("id")
    ON DELETE SET NULL;

-- Consumer polling: WHERE status IN (...) AND queueName = ? ORDER BY nextAttemptAt
CREATE INDEX "worker_jobs_status_queueName_nextAttemptAt_idx"
    ON "worker_jobs" ("status", "queueName", "nextAttemptAt");

-- Tenant-scoped monitoring
CREATE INDEX "worker_jobs_tenantId_status_idx"
    ON "worker_jobs" ("tenantId", "status");

-- Support admin фильтрация по типу задачи
CREATE INDEX "worker_jobs_jobType_status_idx"
    ON "worker_jobs" ("jobType", "status");

-- Dedup check по idempotency_key
CREATE INDEX "worker_jobs_idempotencyKey_idx"
    ON "worker_jobs" ("idempotencyKey");

-- Cross-module tracing по correlationId
CREATE INDEX "worker_jobs_correlationId_idx"
    ON "worker_jobs" ("correlationId");

-- ─── worker_failed_jobs ──────────────────────────────────────────────────────
--
-- Immutable снапшот ошибки при каждом final-failed переходе.
-- Insert-only. Не используется для requeue — только для диагностики.

CREATE TABLE "worker_failed_jobs" (
    "id"              TEXT      NOT NULL,
    "jobId"           TEXT      NOT NULL,
    "failureReason"   TEXT      NOT NULL,
    "payloadSnapshot" JSONB     NOT NULL,
    "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "worker_failed_jobs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "worker_failed_jobs"
    ADD CONSTRAINT "worker_failed_jobs_jobId_fkey"
    FOREIGN KEY ("jobId")
    REFERENCES "worker_jobs"("id")
    ON DELETE CASCADE;

CREATE INDEX "worker_failed_jobs_jobId_idx"
    ON "worker_failed_jobs" ("jobId");

-- ─── worker_schedules ────────────────────────────────────────────────────────
--
-- Реестр cron-расписаний. Scheduler читает isActive=true и выставляет nextRunAt.
-- Ручной запуск: POST /worker/schedules/:name/run (support/admin).

CREATE TABLE "worker_schedules" (
    "id"        TEXT      NOT NULL,
    "name"      VARCHAR(64) NOT NULL,
    "cronExpr"  VARCHAR(64) NOT NULL,
    "jobType"   "WorkerJobType" NOT NULL,
    "queueName" VARCHAR(32) NOT NULL,
    "priority"  "WorkerJobPriority" NOT NULL DEFAULT 'default',
    "payload"   JSONB,
    "isActive"  BOOLEAN   NOT NULL DEFAULT TRUE,
    "lastRunAt" TIMESTAMPTZ,
    "nextRunAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "worker_schedules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "worker_schedules_name_key"
    ON "worker_schedules" ("name");

-- Scheduler polling: WHERE isActive = true ORDER BY nextRunAt
CREATE INDEX "worker_schedules_isActive_nextRunAt_idx"
    ON "worker_schedules" ("isActive", "nextRunAt");
