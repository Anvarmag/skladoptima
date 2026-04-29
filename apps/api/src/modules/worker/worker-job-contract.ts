import { WorkerJobPriority, WorkerJobType } from '@prisma/client';

// ─── Special handling classes (§13, §19 system-analytics) ────────────────────

/**
 * Marks jobs that carry elevated risk and require traceable replay.
 * Used in retryJob() to emit audit-grade logs before any replay.
 *
 * MONEY_AFFECTING   — produces financial side-effects (charges, refunds, ledger entries)
 * STOCK_AFFECTING   — mutates inventory stock levels
 * ACCESS_AFFECTING  — grants/revokes tenant or user access
 */
export type SpecialHandlingClass =
    | 'MONEY_AFFECTING'
    | 'STOCK_AFFECTING'
    | 'ACCESS_AFFECTING';

// ─── Replay policy ────────────────────────────────────────────────────────────

/**
 * allowed      — any support/admin can replay (safe to repeat, no irreversible side-effects)
 * support-only — replay requires explicit support/admin scope (already enforced by x-internal-secret)
 *                + high-risk replay is logged with specialHandling annotation
 * forbidden    — replay is never allowed by contract (one-shot jobs, completed settlements)
 */
export type ReplayPolicy = 'allowed' | 'support-only' | 'forbidden';

// ─── Job contract ─────────────────────────────────────────────────────────────

export interface JobContract {
    /** Default queue name (§14). Used when caller omits queueName. */
    defaultQueue: string;
    /** Default priority. Must match the queue tier. */
    defaultPriority: WorkerJobPriority;
    /** How many attempts before final-failed. Overridable per enqueue call. */
    defaultMaxAttempts: number;
    /** If true, enqueueJob() rejects the call when idempotencyKey is absent. */
    requiresIdempotencyKey: boolean;
    /** If true, enqueueJob() warns when tenantId is absent (domain-level advisory). */
    requiresTenantScope: boolean;
    /** Zero or more special handling classes. Each triggers audit-grade replay logging. */
    specialHandling: SpecialHandlingClass[];
    /** Controls whether retryJob() is allowed, support-only, or forbidden. */
    replayPolicy: ReplayPolicy;
}

// ─── Contracts registry (§15 system-analytics) ───────────────────────────────

export const JOB_CONTRACTS: Record<WorkerJobType, JobContract> = {
    /**
     * SYNC — marketplace sync job.
     * Tenant-scoped, requires idempotency to prevent duplicate syncs.
     * Replay allowed only by support after investigation.
     */
    SYNC: {
        defaultQueue:           'default',
        defaultPriority:        'default',
        defaultMaxAttempts:     5,
        requiresIdempotencyKey: true,
        requiresTenantScope:    true,
        specialHandling:        [],
        replayPolicy:           'support-only',
    },

    /**
     * NOTIFICATION — email/push/SMS dispatch.
     * Safe to repeat (at-most-once delivery is handled inside the handler).
     */
    NOTIFICATION: {
        defaultQueue:           'default',
        defaultPriority:        'default',
        defaultMaxAttempts:     3,
        requiresIdempotencyKey: false,
        requiresTenantScope:    false,
        specialHandling:        [],
        replayPolicy:           'support-only',
    },

    /**
     * BILLING_REMINDER — billing cycle reminders.
     * MONEY_AFFECTING: any replay must be logged with audit-grade trace.
     * Strict dedup: idempotencyKey required.
     */
    BILLING_REMINDER: {
        defaultQueue:           'critical',
        defaultPriority:        'critical',
        defaultMaxAttempts:     5,
        requiresIdempotencyKey: true,
        requiresTenantScope:    true,
        specialHandling:        ['MONEY_AFFECTING'],
        replayPolicy:           'support-only',
    },

    /**
     * FILE_CLEANUP — orphaned file and temp-object cleanup.
     * Always idempotent: deleting a non-existent object is a no-op.
     */
    FILE_CLEANUP: {
        defaultQueue:           'bulk',
        defaultPriority:        'bulk',
        defaultMaxAttempts:     3,
        requiresIdempotencyKey: false,
        requiresTenantScope:    false,
        specialHandling:        [],
        replayPolicy:           'allowed',
    },

    /**
     * ANALYTICS_REBUILD — finance/analytics snapshot rebuild.
     * Idempotent by nature (rebuilds from source of truth).
     */
    ANALYTICS_REBUILD: {
        defaultQueue:           'default',
        defaultPriority:        'default',
        defaultMaxAttempts:     3,
        requiresIdempotencyKey: false,
        requiresTenantScope:    false,
        specialHandling:        [],
        replayPolicy:           'allowed',
    },

    /**
     * AUDIT_MAINTENANCE — internal audit log archival and cleanup.
     * Internal-only, never shown in tenant-facing UI.
     */
    AUDIT_MAINTENANCE: {
        defaultQueue:           'bulk',
        defaultPriority:        'bulk',
        defaultMaxAttempts:     2,
        requiresIdempotencyKey: false,
        requiresTenantScope:    false,
        specialHandling:        [],
        replayPolicy:           'allowed',
    },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns true if any of the job's special handling classes indicate financial risk. */
export function isHighRiskJob(contract: JobContract): boolean {
    return contract.specialHandling.length > 0;
}
