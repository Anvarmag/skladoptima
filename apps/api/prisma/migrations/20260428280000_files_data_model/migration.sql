-- TASK_FILES_1: File Metadata, Object Key Strategy и Lifecycle Data Model
--
-- Аддитивная миграция:
--   + 4 новых enum'а: FileEntityType, FileStatus, FileStorageProvider, FileVisibility
--   + таблица "File" (metadata + object key + lifecycle status)
--   + таблица "FileLifecycleEvent" (immutable lifecycle event log per file)
--   + FK Product.mainImageFileId → File.id (ON DELETE SET NULL)
--
-- Object key strategy: {tenant_id}/products/{file_id}.{ext}
--   - original filename хранится только в metadata, НИКОГДА не в object key
--   - object key не содержит SKU, бизнес-названий, пользовательских имен
--
-- Lifecycle:
--   uploading → active → replaced | deleted → cleanup_pending → (purged from storage)
--   uploading → orphaned → cleanup_pending → (purged from storage)

-- ─── Enums ──────────────────────────────────────────────────────────────────

CREATE TYPE "FileEntityType" AS ENUM ('product_main_image');

CREATE TYPE "FileStatus" AS ENUM (
    'uploading',
    'active',
    'replaced',
    'deleted',
    'orphaned',
    'cleanup_pending',
    'cleanup_failed'
);

CREATE TYPE "FileStorageProvider" AS ENUM ('s3_compatible');

-- MVP: только private; CDN без tenant-isolation не входит в scope
CREATE TYPE "FileVisibility" AS ENUM ('private');

-- ─── File table ──────────────────────────────────────────────────────────────

CREATE TABLE "File" (
    "id"               TEXT         NOT NULL,
    "tenantId"         TEXT         NOT NULL,
    "entityType"       "FileEntityType"     NOT NULL,
    "entityId"         TEXT,
    -- S3 object key: строго {tenant_id}/products/{file_id}.{ext}, без бизнес-данных
    "objectKey"        TEXT         NOT NULL,
    "bucket"           VARCHAR(128) NOT NULL,
    "storageProvider"  "FileStorageProvider" NOT NULL DEFAULT 's3_compatible',
    "mimeType"         VARCHAR(128),
    "sizeBytes"        BIGINT,
    "checksumSha256"   VARCHAR(64),
    "originalFilename" TEXT,
    "status"           "FileStatus"     NOT NULL DEFAULT 'uploading',
    "visibility"       "FileVisibility" NOT NULL DEFAULT 'private',
    "uploadedBy"       TEXT,
    "uploadedAt"       TIMESTAMPTZ,
    "deletedAt"        TIMESTAMPTZ,
    "createdAt"        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updatedAt"        TIMESTAMPTZ  NOT NULL,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- ─── FileLifecycleEvent table ────────────────────────────────────────────────

CREATE TABLE "FileLifecycleEvent" (
    "id"        TEXT         NOT NULL,
    "fileId"    TEXT         NOT NULL,
    "eventType" VARCHAR(64)  NOT NULL,
    "payload"   JSONB,
    "createdAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "FileLifecycleEvent_pkey" PRIMARY KEY ("id")
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX "File_tenantId_status_idx"             ON "File"("tenantId", "status");
CREATE INDEX "File_tenantId_entityType_entityId_idx" ON "File"("tenantId", "entityType", "entityId");
CREATE INDEX "File_tenantId_createdAt_idx"          ON "File"("tenantId", "createdAt" DESC);
CREATE INDEX "FileLifecycleEvent_fileId_createdAt_idx" ON "FileLifecycleEvent"("fileId", "createdAt" DESC);

-- ─── Foreign Keys ────────────────────────────────────────────────────────────

-- File → Tenant: CASCADE delete (при удалении tenant все его файлы удаляются вместе)
ALTER TABLE "File"
    ADD CONSTRAINT "File_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FileLifecycleEvent → File: CASCADE delete (события удаляются вместе с файлом)
ALTER TABLE "FileLifecycleEvent"
    ADD CONSTRAINT "FileLifecycleEvent_fileId_fkey"
    FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Product.mainImageFileId → File.id
-- ON DELETE SET NULL: при удалении File запись Product обнуляет ссылку безопасно
ALTER TABLE "Product"
    ADD CONSTRAINT "Product_mainImageFileId_fkey"
    FOREIGN KEY ("mainImageFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;
