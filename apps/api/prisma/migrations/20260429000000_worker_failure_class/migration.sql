-- Migration: worker_failure_class
-- TASK_WORKER_3: retryable/non-retryable classification и failure diagnostics
--
-- Adds WorkerFailureClass enum and failureClass column to worker_failed_jobs.
-- Separates TECHNICAL_INFRA (exhausted retries → dead_lettered) from
-- TECHNICAL_NON_RETRYABLE (immediate failure → failed) and NO_HANDLER.

-- 1. Create the enum
CREATE TYPE "WorkerFailureClass" AS ENUM (
  'TECHNICAL_INFRA',
  'TECHNICAL_NON_RETRYABLE',
  'NO_HANDLER'
);

-- 2. Add failureClass column with default for existing rows
ALTER TABLE "worker_failed_jobs"
  ADD COLUMN "failure_class" "WorkerFailureClass" NOT NULL DEFAULT 'TECHNICAL_INFRA';

-- 3. Index for support/admin queries filtered by failure class
CREATE INDEX "worker_failed_jobs_failure_class_idx"
  ON "worker_failed_jobs"("failure_class");
