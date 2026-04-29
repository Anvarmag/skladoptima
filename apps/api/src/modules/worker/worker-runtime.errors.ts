/**
 * Throw inside a job handler when domain/policy blocks execution.
 * Worker marks the job as `blocked` (not `failed`) — distinct from infra errors (§10 system-analytics).
 */
export class JobBlockedError extends Error {
    readonly code: string;

    constructor(message: string, code = 'JOB_BLOCKED_BY_POLICY') {
        super(message);
        this.name  = 'JobBlockedError';
        this.code  = code;
        Object.setPrototypeOf(this, JobBlockedError.prototype);
    }
}

/**
 * Throw inside a job handler when the failure is permanent and should NOT be retried.
 * Worker marks the job as `failed` immediately, regardless of remaining attempts.
 * Use for: invalid payload schema, permanent external rejections, constraint violations.
 */
export class NonRetryableJobError extends Error {
    readonly code: string;

    constructor(message: string, code = 'JOB_NON_RETRYABLE') {
        super(message);
        this.name = 'NonRetryableJobError';
        this.code = code;
        Object.setPrototypeOf(this, NonRetryableJobError.prototype);
    }
}
