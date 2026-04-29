import { WorkerJobPriority, WorkerJobType } from '@prisma/client';

export interface EnqueueJobDto {
    jobType: WorkerJobType;
    /**
     * Queue name. If omitted, the value from JOB_CONTRACTS[jobType].defaultQueue is used.
     * Explicit override is allowed for special routing (e.g. urgent bulk re-run).
     */
    queueName?: string;
    /** Priority. Defaults to JOB_CONTRACTS[jobType].defaultPriority. */
    priority?: WorkerJobPriority;
    payload: Record<string, unknown>;
    tenantId?: string;
    idempotencyKey?: string;
    correlationId?: string;
    createdByActorType: 'user' | 'system' | 'support' | 'scheduler';
    createdByActorId?: string;
    /** Max attempts. Defaults to JOB_CONTRACTS[jobType].defaultMaxAttempts. */
    maxAttempts?: number;
}

// Queue name constants aligned with §14 three-tier model
export const QUEUE = {
    CRITICAL: 'critical',
    DEFAULT:  'default',
    BULK:     'bulk',
} as const;

// Queue to priority mapping (canonical mapping per §14)
export const QUEUE_PRIORITY: Record<string, WorkerJobPriority> = {
    [QUEUE.CRITICAL]: 'critical',
    [QUEUE.DEFAULT]:  'default',
    [QUEUE.BULK]:     'bulk',
};
