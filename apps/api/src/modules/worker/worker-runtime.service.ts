import {
    Injectable,
    Logger,
    OnApplicationBootstrap,
    OnApplicationShutdown,
} from '@nestjs/common';
import { hostname } from 'os';
import { WorkerJob, WorkerFailureClass, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JobHandlerRegistry } from './job-handler.registry';
import { JobBlockedError, NonRetryableJobError } from './worker-runtime.errors';

// ─── Constants ────────────────────────────────────────────────────────────────

/** How long a worker lease lasts before being considered stale. */
const LEASE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** How long graceful shutdown waits for active jobs to finish. */
const SHUTDOWN_TIMEOUT_MS = 30_000; // 30 seconds

/** Polling cadence per queue tier (ms). */
const POLL_INTERVAL_MS: Record<string, number> = {
    critical: 3_000,
    default:  10_000,
    bulk:     30_000,
};

/** Exponential backoff base (ms). Applied as: base * 2^(attempt-1), capped at 1h. */
const BACKOFF_BASE_MS = 30_000;

const QUEUE_NAMES = ['critical', 'default', 'bulk'] as const;

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class WorkerRuntimeService
    implements OnApplicationBootstrap, OnApplicationShutdown
{
    private readonly logger   = new Logger(WorkerRuntimeService.name);
    private readonly workerId = `worker-${hostname()}-${process.pid}`;

    // Guards
    private isShuttingDown = false;

    // Active job executions: jobId → promise
    private readonly activeJobs = new Map<string, Promise<void>>();

    // Polling intervals to clear on shutdown
    private readonly pollTimers: NodeJS.Timeout[] = [];

    constructor(
        private readonly prisma:   PrismaService,
        private readonly registry: JobHandlerRegistry,
    ) {}

    // ─── Lifecycle hooks ─────────────────────────────────────────────────────

    async onApplicationBootstrap(): Promise<void> {
        if (process.env.IS_WORKER !== 'true') return;

        this.logger.log(JSON.stringify({
            event:    'worker_runtime_start',
            workerId: this.workerId,
            ts:       new Date().toISOString(),
        }));

        await this.recoverOrphanedJobs();
        this.startPolling();
    }

    async onApplicationShutdown(signal?: string): Promise<void> {
        if (process.env.IS_WORKER !== 'true') return;

        this.isShuttingDown = true;

        this.logger.log(JSON.stringify({
            event:    'worker_shutdown_start',
            signal,
            workerId: this.workerId,
            active:   this.activeJobs.size,
            ts:       new Date().toISOString(),
        }));

        // Stop accepting new jobs
        for (const timer of this.pollTimers) clearInterval(timer);
        this.pollTimers.length = 0;

        await this.awaitActiveJobs();

        this.logger.log(JSON.stringify({
            event:    'worker_shutdown_complete',
            workerId: this.workerId,
            ts:       new Date().toISOString(),
        }));
    }

    // ─── Recovery on startup ─────────────────────────────────────────────────

    /**
     * Finds jobs that were in_progress when the previous worker crashed
     * (leaseUntil < now). Re-queues or marks final-failed based on attempt count.
     */
    async recoverOrphanedJobs(): Promise<void> {
        const now = new Date();

        const orphaned = await this.prisma.workerJob.findMany({
            where:  { status: 'in_progress', leaseUntil: { lt: now } },
            select: { id: true, attempt: true, maxAttempts: true, payload: true, jobType: true, tenantId: true },
        });

        if (orphaned.length === 0) return;

        for (const job of orphaned) {
            if (job.attempt >= job.maxAttempts) {
                await this.markFinalFailed(
                    { id: job.id, attempt: job.attempt, maxAttempts: job.maxAttempts, payload: job.payload, jobType: job.jobType },
                    'ORPHANED_EXCEEDED_MAX_ATTEMPTS',
                    'TECHNICAL_INFRA',
                );
            } else {
                const nextAttemptAt = this.calcNextAttemptAt(job.attempt);
                await this.prisma.workerJob.update({
                    where: { id: job.id },
                    data: {
                        status:        'retrying',
                        leaseOwner:    null,
                        leaseUntil:    null,
                        nextAttemptAt,
                        lastError:     'ORPHANED_BY_RESTART',
                    },
                });
            }
        }

        this.logger.warn(JSON.stringify({
            event:    'orphaned_jobs_recovered',
            count:    orphaned.length,
            workerId: this.workerId,
            ts:       now.toISOString(),
        }));
    }

    // ─── Polling ─────────────────────────────────────────────────────────────

    private startPolling(): void {
        for (const queueName of QUEUE_NAMES) {
            const interval = POLL_INTERVAL_MS[queueName];
            this.pollTimers.push(
                setInterval(() => this.pollQueue(queueName), interval),
            );
        }

        this.logger.log(JSON.stringify({
            event:    'worker_polling_started',
            queues:   QUEUE_NAMES,
            workerId: this.workerId,
            ts:       new Date().toISOString(),
        }));
    }

    private pollQueue(queueName: string): void {
        if (this.isShuttingDown) return;

        this.tryProcessNextJob(queueName).catch((err) =>
            this.logger.error(JSON.stringify({
                event:     'poll_unhandled_error',
                queueName,
                error:     err?.message,
                ts:        new Date().toISOString(),
            })),
        );
    }

    private async tryProcessNextJob(queueName: string): Promise<void> {
        const job = await this.acquireNextJob(queueName);
        if (!job) return;

        const execution = this.executeJob(job);
        this.activeJobs.set(job.id, execution);
        execution.finally(() => this.activeJobs.delete(job.id));
        await execution;
    }

    // ─── Lease acquisition ───────────────────────────────────────────────────

    /**
     * Atomically finds and claims the next eligible job in the given queue.
     * Two-step: findFirst (to locate candidate) + update with status check (atomic claim).
     * If another worker grabs the same job first, Prisma throws P2025 — we return null.
     */
    private async acquireNextJob(queueName: string): Promise<WorkerJob | null> {
        const now       = new Date();
        const leaseUntil = new Date(now.getTime() + LEASE_TTL_MS);

        const candidate = await this.prisma.workerJob.findFirst({
            where: {
                queueName,
                status: { in: ['queued', 'retrying'] },
                OR: [
                    { nextAttemptAt: null },
                    { nextAttemptAt: { lte: now } },
                ],
            },
            orderBy: [{ priority: 'asc' }, { queuedAt: 'asc' }],
        });

        if (!candidate) return null;

        try {
            return await this.prisma.workerJob.update({
                where: {
                    id:     candidate.id,
                    // Re-check status atomically — guard against concurrent claim
                    status: { in: ['queued', 'retrying'] },
                },
                data: {
                    status:     'in_progress',
                    leaseOwner: this.workerId,
                    leaseUntil,
                    startedAt:  now,
                    attempt:    { increment: 1 },
                },
            });
        } catch {
            // P2025: another worker claimed it — not an error
            return null;
        }
    }

    // ─── Job execution ───────────────────────────────────────────────────────

    private async executeJob(job: WorkerJob): Promise<void> {
        const { id, jobType, attempt, maxAttempts } = job;

        this.logger.log(JSON.stringify({
            event:   'job_start',
            jobId:   id,
            jobType,
            attempt,
            ts:      new Date().toISOString(),
        }));

        const handler = this.registry.get(jobType);

        if (!handler) {
            await this.markFinalFailed(job, `NO_HANDLER_REGISTERED:${jobType}`, 'NO_HANDLER');
            return;
        }

        try {
            await handler.handle(job);

            await this.prisma.workerJob.update({
                where: { id },
                data:  {
                    status:     'success',
                    finishedAt: new Date(),
                    leaseOwner: null,
                    leaseUntil: null,
                    lastError:  null,
                },
            });

            this.logger.log(JSON.stringify({
                event:   'job_success',
                jobId:   id,
                jobType,
                attempt,
                ts:      new Date().toISOString(),
            }));

        } catch (err: unknown) {
            await this.handleJobError(job, err, handler);
        }
    }

    // ─── Error handling ──────────────────────────────────────────────────────

    private async handleJobError(job: WorkerJob, err: unknown, handler?: { classifyError?(e: Error): 'retryable' | 'non-retryable' }): Promise<void> {
        const { id, jobType, attempt, maxAttempts } = job;
        const errorMessage = err instanceof Error ? err.message : String(err);

        // Domain policy block — distinct from all infra errors (§10 system-analytics)
        if (err instanceof JobBlockedError) {
            await this.prisma.workerJob.update({
                where: { id },
                data:  {
                    status:     'blocked',
                    finishedAt: new Date(),
                    leaseOwner: null,
                    leaseUntil: null,
                    lastError:  errorMessage,
                },
            });

            this.logger.warn(JSON.stringify({
                event:        'job_blocked',
                jobId:        id,
                jobType,
                attempt,
                failureClass: 'DOMAIN_POLICY',
                code:         (err as JobBlockedError).code,
                ts:           new Date().toISOString(),
            }));
            return;
        }

        // Non-retryable: immediate final failure regardless of remaining attempts
        const isNonRetryable =
            err instanceof NonRetryableJobError ||
            (err instanceof Error && handler?.classifyError?.(err) === 'non-retryable');

        if (isNonRetryable) {
            await this.markFinalFailed(job, errorMessage, 'TECHNICAL_NON_RETRYABLE');
            return;
        }

        // Retryable: schedule next attempt or exhaust
        if (attempt >= maxAttempts) {
            await this.markFinalFailed(job, errorMessage, 'TECHNICAL_INFRA');
        } else {
            const nextAttemptAt = this.calcNextAttemptAt(attempt);

            await this.prisma.workerJob.update({
                where: { id },
                data:  {
                    status:        'retrying',
                    leaseOwner:    null,
                    leaseUntil:    null,
                    lastError:     errorMessage,
                    nextAttemptAt,
                },
            });

            this.logger.warn(JSON.stringify({
                event:         'job_retrying',
                jobId:         id,
                jobType,
                attempt,
                maxAttempts,
                failureClass:  'TECHNICAL_INFRA',
                nextAttemptAt: nextAttemptAt.toISOString(),
                error:         errorMessage,
                ts:            new Date().toISOString(),
            }));
        }
    }

    // ─── Final failure ───────────────────────────────────────────────────────

    private async markFinalFailed(
        job: Pick<WorkerJob, 'id' | 'attempt' | 'maxAttempts' | 'payload' | 'jobType'>,
        reason: string,
        failureClass: WorkerFailureClass = 'TECHNICAL_INFRA',
    ): Promise<void> {
        // TECHNICAL_INFRA exhausted retries → dead_lettered; all others → failed
        const finalStatus = failureClass === 'TECHNICAL_INFRA' && job.attempt >= job.maxAttempts
            ? 'dead_lettered'
            : 'failed';

        await this.prisma.$transaction([
            this.prisma.workerJob.update({
                where: { id: job.id },
                data: {
                    status:     finalStatus,
                    finishedAt: new Date(),
                    leaseOwner: null,
                    leaseUntil: null,
                    lastError:  reason,
                },
            }),
            this.prisma.workerFailedJob.create({
                data: {
                    jobId:           job.id,
                    failureReason:   reason,
                    failureClass,
                    payloadSnapshot: job.payload as Prisma.InputJsonValue,
                },
            }),
        ]);

        this.logger.error(JSON.stringify({
            event:        'job_final_failed',
            jobId:        job.id,
            jobType:      job.jobType,
            attempt:      job.attempt,
            finalStatus,
            failureClass,
            reason,
            ts:           new Date().toISOString(),
        }));
    }

    // ─── Graceful shutdown wait ───────────────────────────────────────────────

    private async awaitActiveJobs(): Promise<void> {
        if (this.activeJobs.size === 0) return;

        this.logger.log(JSON.stringify({
            event:  'worker_waiting_for_active_jobs',
            count:  this.activeJobs.size,
            timeout: SHUTDOWN_TIMEOUT_MS,
            ts:     new Date().toISOString(),
        }));

        const allSettled = Promise.allSettled([...this.activeJobs.values()]);
        const timeout    = new Promise<void>((resolve) =>
            setTimeout(resolve, SHUTDOWN_TIMEOUT_MS),
        );

        await Promise.race([allSettled, timeout]);

        // Jobs still running after timeout: expire their leases so the next
        // worker instance will recover them via recoverOrphanedJobs()
        const remaining = [...this.activeJobs.keys()];
        if (remaining.length > 0) {
            await this.prisma.workerJob.updateMany({
                where: { id: { in: remaining }, status: 'in_progress' },
                data:  { leaseUntil: new Date(), lastError: 'WORKER_SHUTDOWN_TIMEOUT' },
            });

            this.logger.warn(JSON.stringify({
                event:   'worker_shutdown_jobs_expired',
                count:   remaining.length,
                jobIds:  remaining,
                ts:      new Date().toISOString(),
            }));
        }
    }

    // ─── Utilities ───────────────────────────────────────────────────────────

    private calcNextAttemptAt(attempt: number): Date {
        // Exponential backoff: 30s, 60s, 120s, ..., capped at 1h
        const delaySec   = (BACKOFF_BASE_MS / 1000) * Math.pow(2, Math.max(0, attempt - 1));
        const cappedSec  = Math.min(delaySec, 3600);
        const jitterMs   = Math.random() * 0.1 * cappedSec * 1000; // ±10% jitter
        return new Date(Date.now() + cappedSec * 1000 + jitterMs);
    }
}
