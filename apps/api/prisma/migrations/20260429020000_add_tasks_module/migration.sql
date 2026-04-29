-- TASK_TASKS_1: Data Model, State Machine и Event Provenance
--
-- Аддитивная миграция:
--   + 5 новых enum'ов: TaskCategory, TaskPriority, TaskStatus,
--                      TaskCommentVisibility, TaskEventType
--   + таблица "tasks"         — основная сущность задачи
--   + таблица "task_comments" — комментарии (soft delete, visibility)
--   + таблица "task_events"   — append-only audit timeline
--
-- State machine (§13):
--   OPEN → IN_PROGRESS / WAITING / DONE / ARCHIVED
--   IN_PROGRESS → WAITING / DONE / OPEN
--   WAITING → IN_PROGRESS / DONE / OPEN
--   DONE → ARCHIVED / OPEN (reopen разрешён)
--   ARCHIVED → нигде (терминальное, защита через application-guard)
--
-- Partial index для cron-фильтра (§15):
--   idx_task_due_active заменяет обычный Prisma-индекс и покрывает только
--   активные задачи — исключает DONE/ARCHIVED из B-tree, ускоряет SELECT
--   на больших объёмах без фильтрации по полному тенанту.
--
-- FK политика SET NULL:
--   relatedOrderId, relatedProductId — задача живёт независимо от Order/Product.
--   assigneeUserId, createdByUserId  — RESTRICT (задача без автора/ответственного
--   не имеет смысла; удаление через soft-delete членов команды).

-- ─── Enums ──────────────────────────────────────────────────────────────────

CREATE TYPE "TaskCategory" AS ENUM (
    'MARKETPLACE_CLIENT_ISSUE',
    'PRODUCTION_INQUIRY',
    'WAREHOUSE',
    'FINANCE',
    'OTHER'
);

CREATE TYPE "TaskPriority" AS ENUM (
    'LOW',
    'NORMAL',
    'HIGH',
    'URGENT'
);

CREATE TYPE "TaskStatus" AS ENUM (
    'OPEN',
    'IN_PROGRESS',
    'WAITING',
    'DONE',
    'ARCHIVED'
);

CREATE TYPE "TaskCommentVisibility" AS ENUM (
    'INTERNAL',
    'CUSTOMER_FACING'
);

CREATE TYPE "TaskEventType" AS ENUM (
    'CREATED',
    'UPDATED',
    'ASSIGNED',
    'STATUS_CHANGED',
    'COMMENTED',
    'DUE_CHANGED',
    'ARCHIVED',
    'DUE_REMINDER_SENT',
    'OVERDUE_NOTIFIED'
);

-- ─── tasks ───────────────────────────────────────────────────────────────────

CREATE TABLE "tasks" (
    "id"                  TEXT              NOT NULL,
    "tenantId"            TEXT              NOT NULL,
    "title"               VARCHAR(255)      NOT NULL,
    "description"         TEXT,
    "category"            "TaskCategory"    NOT NULL DEFAULT 'OTHER',
    "priority"            "TaskPriority"    NOT NULL DEFAULT 'NORMAL',
    "status"              "TaskStatus"      NOT NULL DEFAULT 'OPEN',
    "assigneeUserId"      TEXT              NOT NULL,
    "createdByUserId"     TEXT              NOT NULL,
    "dueAt"               TIMESTAMPTZ(6),
    "dueReminderSentAt"   TIMESTAMPTZ(6),
    "overdueNotifiedAt"   TIMESTAMPTZ(6),
    "relatedOrderId"      TEXT,
    "relatedProductId"    TEXT,
    "tags"                TEXT[]            NOT NULL DEFAULT '{}',
    "completedAt"         TIMESTAMPTZ(6),
    "archivedAt"          TIMESTAMPTZ(6),
    "createdAt"           TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
    "updatedAt"           TIMESTAMPTZ       NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- ─── task_comments ───────────────────────────────────────────────────────────

CREATE TABLE "task_comments" (
    "id"            TEXT                      NOT NULL,
    "taskId"        TEXT                      NOT NULL,
    "authorUserId"  TEXT                      NOT NULL,
    "body"          TEXT                      NOT NULL,
    "visibility"    "TaskCommentVisibility"   NOT NULL DEFAULT 'INTERNAL',
    "editedAt"      TIMESTAMPTZ(6),
    "deletedAt"     TIMESTAMPTZ(6),
    "createdAt"     TIMESTAMPTZ               NOT NULL DEFAULT NOW(),
    "updatedAt"     TIMESTAMPTZ               NOT NULL,

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

-- ─── task_events ─────────────────────────────────────────────────────────────

CREATE TABLE "task_events" (
    "id"            TEXT              NOT NULL,
    "tenantId"      TEXT              NOT NULL,
    "taskId"        TEXT              NOT NULL,
    "actorUserId"   TEXT,
    "eventType"     "TaskEventType"   NOT NULL,
    "payload"       JSONB,
    "createdAt"     TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

    CONSTRAINT "task_events_pkey" PRIMARY KEY ("id")
);

-- ─── Foreign Keys: tasks ─────────────────────────────────────────────────────

ALTER TABLE "tasks"
    ADD CONSTRAINT "tasks_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tasks"
    ADD CONSTRAINT "tasks_assigneeUserId_fkey"
    FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tasks"
    ADD CONSTRAINT "tasks_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tasks"
    ADD CONSTRAINT "tasks_relatedOrderId_fkey"
    FOREIGN KEY ("relatedOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tasks"
    ADD CONSTRAINT "tasks_relatedProductId_fkey"
    FOREIGN KEY ("relatedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Foreign Keys: task_comments ─────────────────────────────────────────────

ALTER TABLE "task_comments"
    ADD CONSTRAINT "task_comments_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_comments"
    ADD CONSTRAINT "task_comments_authorUserId_fkey"
    FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Foreign Keys: task_events ───────────────────────────────────────────────

ALTER TABLE "task_events"
    ADD CONSTRAINT "task_events_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_events"
    ADD CONSTRAINT "task_events_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_events"
    ADD CONSTRAINT "task_events_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Indexes: tasks ───────────────────────────────────────────────────────────

-- Inbox: assignee+status+dueAt — основной фильтр «мои открытые»
CREATE INDEX "tasks_tenantId_assigneeUserId_status_dueAt_idx"
    ON "tasks"("tenantId", "assigneeUserId", "status", "dueAt");

-- Kanban / список задач по статусу и дате
CREATE INDEX "tasks_tenantId_status_createdAt_idx"
    ON "tasks"("tenantId", "status", "createdAt");

-- Inbox: создал я
CREATE INDEX "tasks_tenantId_createdByUserId_createdAt_idx"
    ON "tasks"("tenantId", "createdByUserId", "createdAt");

-- Связка с заказом (relatedOrderId фильтр из карточки заказа)
CREATE INDEX "tasks_tenantId_relatedOrderId_idx"
    ON "tasks"("tenantId", "relatedOrderId");

-- Partial index для cron due-reminders (§15):
-- покрывает только активные задачи (NOT DONE/ARCHIVED) → small B-tree,
-- быстрый SELECT при 10-минутном cron-цикле на миллионе задач.
-- Заменяет стандартный Prisma-индекс (tenantId, dueAt).
CREATE INDEX "tasks_tenantId_dueAt_idx"
    ON "tasks"("tenantId", "dueAt")
    WHERE status NOT IN ('DONE', 'ARCHIVED');

-- ─── Indexes: task_comments ───────────────────────────────────────────────────

-- Timeline комментариев в карточке задачи
CREATE INDEX "task_comments_taskId_createdAt_idx"
    ON "task_comments"("taskId", "createdAt");

-- ─── Indexes: task_events ─────────────────────────────────────────────────────

-- Timeline событий в карточке задачи
CREATE INDEX "task_events_taskId_createdAt_idx"
    ON "task_events"("taskId", "createdAt");

-- Audit: поиск событий по тенанту + тип + дата (observability, §19)
CREATE INDEX "task_events_tenantId_eventType_createdAt_idx"
    ON "task_events"("tenantId", "eventType", "createdAt");
