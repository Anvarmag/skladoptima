-- TASK_SYNC_1: Data Model, Run Registry и Queue Orchestration (09-sync §8)
--
-- Что делает миграция:
-- 1. Добавляет 6 новых enum для sync run lifecycle:
--    - SyncRunStatus (queued / in_progress / success / partial_success /
--      failed / blocked / cancelled) — `BLOCKED` отделён от `FAILED` per §20.
--    - SyncTriggerType (manual / scheduled / retry).
--    - SyncTriggerScope (account / tenant_full).
--    - SyncRunItemType (stock / order / product / warehouse).
--    - SyncRunItemStage (preflight / pull / transform / apply / push).
--    - SyncRunItemStatus (success / failed / skipped / conflict / blocked).
-- 2. Создаёт таблицу `SyncRun` — реестр всех manual/scheduled/retry запусков
--    с агрегированными счётчиками success/error path (правило §8: success
--    хранится агрегатами, а не item-level логом).
-- 3. Создаёт таблицу `SyncRunItem` — item-level диагностика ТОЛЬКО для
--    проблемных кейсов (failed/skipped/conflict/blocked). Каскадное
--    удаление с run.
-- 4. Создаёт таблицу `SyncConflict` — реестр конфликтов синхронизации
--    (run помечается PARTIAL_SUCCESS, конфликт виден в diagnostics).
-- 5. UNIQUE(tenantId, jobKey) на `SyncRun` — DB-level idempotency для
--    queue contract: один и тот же job не попадёт в очередь дважды.
-- 6. Self-relation `SyncRun.originRunId` для retry-цепочек (см. §9 сценарий 2).
--
-- Что НЕ делает (намеренно):
-- - Не трогает существующий `marketplace_sync` (sync.service.ts) — он
--   продолжает работать на legacy `MarketplaceAccount.lastSyncStatus String?`.
--   Переключение sync.service на запись в `SyncRun` — TASK_SYNC_2/3 (queue
--   worker и API endpoints).
-- - Не создаёт API endpoints `/api/v1/sync/runs` — они появятся в TASK_SYNC_3.
-- - Не пишет worker orchestration / retry policy / preflight guards — это
--   TASK_SYNC_2/3/5.
-- - Не добавляет partial unique "один активный run на (account, syncType)"
--   на уровне БД: типы хранятся как TEXT[], DB-side это требовало бы GIN
--   индекс с array intersection — слишком сложно для MVP. Concurrency
--   guard реализуется на application слое через `jobKey` UNIQUE и
--   проверку статуса перед постановкой в очередь (TASK_SYNC_2).

-- ================================================================
-- 1. ENUMS
-- ================================================================

CREATE TYPE "SyncRunStatus" AS ENUM (
  'QUEUED',
  'IN_PROGRESS',
  'SUCCESS',
  'PARTIAL_SUCCESS',
  'FAILED',
  'BLOCKED',
  'CANCELLED'
);

CREATE TYPE "SyncTriggerType" AS ENUM (
  'MANUAL',
  'SCHEDULED',
  'RETRY'
);

CREATE TYPE "SyncTriggerScope" AS ENUM (
  'ACCOUNT',
  'TENANT_FULL'
);

CREATE TYPE "SyncRunItemType" AS ENUM (
  'STOCK',
  'ORDER',
  'PRODUCT',
  'WAREHOUSE'
);

CREATE TYPE "SyncRunItemStage" AS ENUM (
  'PREFLIGHT',
  'PULL',
  'TRANSFORM',
  'APPLY',
  'PUSH'
);

CREATE TYPE "SyncRunItemStatus" AS ENUM (
  'SUCCESS',
  'FAILED',
  'SKIPPED',
  'CONFLICT',
  'BLOCKED'
);

-- ================================================================
-- 2. SyncRun — реестр запусков синхронизации
-- ================================================================

CREATE TABLE "SyncRun" (
  "id"                    TEXT              NOT NULL,
  "tenantId"              TEXT              NOT NULL,
  "marketplaceAccountId"  TEXT,

  "triggerType"           "SyncTriggerType" NOT NULL,
  "triggerScope"          "SyncTriggerScope" NOT NULL DEFAULT 'ACCOUNT',
  "syncTypes"             TEXT[]            NOT NULL DEFAULT ARRAY[]::TEXT[],

  "status"                "SyncRunStatus"   NOT NULL DEFAULT 'QUEUED',

  "originRunId"           TEXT,
  "jobKey"                VARCHAR(128),
  "idempotencyKey"        VARCHAR(128),

  "requestedBy"           TEXT,
  "blockedReason"         VARCHAR(64),

  "startedAt"             TIMESTAMP(3),
  "finishedAt"            TIMESTAMP(3),
  "durationMs"            INTEGER,

  "processedCount"        INTEGER           NOT NULL DEFAULT 0,
  "errorCount"            INTEGER           NOT NULL DEFAULT 0,

  "errorCode"             VARCHAR(64),
  "errorMessage"          TEXT,

  "attemptNumber"         INTEGER           NOT NULL DEFAULT 1,
  "maxAttempts"           INTEGER           NOT NULL DEFAULT 3,
  "nextAttemptAt"         TIMESTAMP(3),

  "createdAt"             TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- FK: tenant CASCADE (удаление tenant удаляет всю историю sync).
ALTER TABLE "SyncRun"
  ADD CONSTRAINT "SyncRun_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: marketplace account SET NULL — отключение/удаление аккаунта не
-- должно ломать историю run'ов. Run всё равно содержит `tenantId` и
-- `syncTypes`, чего достаточно для post-mortem.
ALTER TABLE "SyncRun"
  ADD CONSTRAINT "SyncRun_marketplaceAccountId_fkey"
    FOREIGN KEY ("marketplaceAccountId") REFERENCES "MarketplaceAccount"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- FK: self-relation для retry-цепочек. SET NULL — если оригинальный run
-- удалён, retry не теряется.
ALTER TABLE "SyncRun"
  ADD CONSTRAINT "SyncRun_originRunId_fkey"
    FOREIGN KEY ("originRunId") REFERENCES "SyncRun"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- DB-level idempotency: один jobKey на tenant — только один run.
-- NULL value не участвует в UNIQUE (Postgres semantics), что корректно
-- для legacy/scheduled run'ов без явного jobKey.
CREATE UNIQUE INDEX "SyncRun_tenantId_jobKey_key"
  ON "SyncRun"("tenantId", "jobKey");

-- UI: список последних run'ов по tenant с фильтром по статусу.
CREATE INDEX "SyncRun_tenantId_status_createdAt_idx"
  ON "SyncRun"("tenantId", "status", "createdAt");

-- UI: история запусков по конкретному account.
CREATE INDEX "SyncRun_tenantId_marketplaceAccountId_createdAt_idx"
  ON "SyncRun"("tenantId", "marketplaceAccountId", "createdAt");

-- Поиск всех retry-потомков конкретного origin run.
CREATE INDEX "SyncRun_originRunId_idx"
  ON "SyncRun"("originRunId");

-- ================================================================
-- 3. SyncRunItem — item-level диагностика проблемных кейсов
-- ================================================================

CREATE TABLE "SyncRunItem" (
  "id"               TEXT                 NOT NULL,
  "runId"            TEXT                 NOT NULL,

  "itemType"         "SyncRunItemType"    NOT NULL,
  "itemKey"          VARCHAR(128)         NOT NULL,
  "stage"            "SyncRunItemStage"   NOT NULL,
  "status"           "SyncRunItemStatus"  NOT NULL,

  "externalEventId"  VARCHAR(128),
  "payload"          JSONB,
  "error"            JSONB,

  "createdAt"        TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SyncRunItem_pkey" PRIMARY KEY ("id")
);

-- FK: каскад с run (удаление run чистит item-level трассу).
ALTER TABLE "SyncRunItem"
  ADD CONSTRAINT "SyncRunItem_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "SyncRun"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Диагностические индексы внутри run.
CREATE INDEX "SyncRunItem_runId_status_idx"
  ON "SyncRunItem"("runId", "status");

CREATE INDEX "SyncRunItem_runId_itemType_idx"
  ON "SyncRunItem"("runId", "itemType");

CREATE INDEX "SyncRunItem_runId_stage_idx"
  ON "SyncRunItem"("runId", "stage");

-- ================================================================
-- 4. SyncConflict — реестр конфликтов
-- ================================================================

CREATE TABLE "SyncConflict" (
  "id"            TEXT          NOT NULL,
  "tenantId"      TEXT          NOT NULL,
  "runId"         TEXT          NOT NULL,

  "entityType"    VARCHAR(64)   NOT NULL,
  "entityId"      VARCHAR(128),
  "conflictType"  VARCHAR(64)   NOT NULL,
  "payload"       JSONB,

  "resolvedAt"    TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SyncConflict_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SyncConflict"
  ADD CONSTRAINT "SyncConflict_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SyncConflict"
  ADD CONSTRAINT "SyncConflict_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "SyncRun"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- UI: список открытых конфликтов tenant с сортировкой по дате.
CREATE INDEX "SyncConflict_tenantId_resolvedAt_createdAt_idx"
  ON "SyncConflict"("tenantId", "resolvedAt", "createdAt");

-- Диагностика: все конфликты по конкретной сущности.
CREATE INDEX "SyncConflict_tenantId_entityType_entityId_idx"
  ON "SyncConflict"("tenantId", "entityType", "entityId");

-- Конфликты конкретного run.
CREATE INDEX "SyncConflict_runId_idx"
  ON "SyncConflict"("runId");
