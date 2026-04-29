import { WorkerJob } from '@prisma/client';

/**
 * Contract that every domain job handler must implement.
 *
 * Rules (§15 system-analytics):
 *   - throw JobBlockedError when domain/policy blocks execution (tenant suspended, billing, etc.)
 *   - throw NonRetryableJobError for permanent, non-recoverable failures
 *   - throw any other Error for retryable infra/transient failures
 *   - must be idempotent: called at-least-once (job may be retried on crash/recovery)
 */
export interface IJobHandler {
    handle(job: WorkerJob): Promise<void>;

    /**
     * Optional handler-level error classification.
     * Implement when third-party error codes/types need to be mapped to retry semantics
     * without polluting the error type hierarchy with NonRetryableJobError wrappers.
     * Return 'non-retryable' to skip remaining attempts and go directly to `failed`.
     */
    classifyError?(error: Error): 'retryable' | 'non-retryable';
}
