import {
    Injectable,
    BadRequestException,
    ForbiddenException,
    NotFoundException,
    ConflictException,
    Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkerJobStatus, WorkerJobType, Prisma } from '@prisma/client';
import { EnqueueJobDto } from './worker-job.types';
import { JOB_CONTRACTS, isHighRiskJob } from './worker-job-contract';
import { randomUUID } from 'crypto';

// Job types that are safe to surface in tenant-facing UI (§7 system-analytics).
// AUDIT_MAINTENANCE is internal-only and must never appear in tenant UX.
const TENANT_VISIBLE_JOB_TYPES: WorkerJobType[] = ['SYNC', 'NOTIFICATION', 'FILE_CLEANUP'];

// How far back to look for recently finished jobs when building the product status surface.
const STATUS_WINDOW_HOURS = 24;

// Active statuses — always included regardless of finishedAt window.
const ACTIVE_JOB_STATUSES: WorkerJobStatus[] = ['queued', 'in_progress', 'retrying', 'blocked'];

// Maps (jobType, status) → product-friendly label shown to tenants.
// Labels follow the pattern: <operation>_<state> per §7 examples.
function toProductStatus(jobType: WorkerJobType, status: WorkerJobStatus): string {
    const map: Partial<Record<WorkerJobType, Partial<Record<WorkerJobStatus, string>>>> = {
        SYNC: {
            queued:        'sync_pending',
            retrying:      'sync_pending',
            in_progress:   'sync_running',
            failed:        'sync_failed',
            dead_lettered: 'sync_failed',
            blocked:       'sync_blocked',
            success:       'sync_ok',
            cancelled:     'sync_cancelled',
        },
        NOTIFICATION: {
            queued:        'notification_pending',
            retrying:      'notification_pending',
            in_progress:   'notification_sending',
            failed:        'notification_failed',
            dead_lettered: 'notification_failed',
            blocked:       'notification_blocked',
            success:       'notification_delivered',
            cancelled:     'notification_cancelled',
        },
        FILE_CLEANUP: {
            queued:        'cleanup_pending',
            retrying:      'cleanup_pending',
            in_progress:   'cleanup_running',
            failed:        'cleanup_failed',
            dead_lettered: 'cleanup_failed',
            blocked:       'cleanup_blocked',
            success:       'cleanup_ok',
            cancelled:     'cleanup_cancelled',
        },
    };
    return map[jobType]?.[status] ?? 'unknown';
}

// Statuses considered "active" — a duplicate job with same idempotency_key in these states
// should not be created (at-most-once semantics, §10 system-analytics).
const ACTIVE_STATUSES: WorkerJobStatus[] = ['queued', 'in_progress', 'retrying', 'blocked'];

// blocked joins failed/dead_lettered — support can manually re-queue after policy change (§10)
const RETRYABLE_TERMINAL_STATUSES: WorkerJobStatus[] = ['failed', 'dead_lettered', 'blocked'];
const NON_RETRYABLE_STATUSES: WorkerJobStatus[] = ['success', 'cancelled'];

// Jobs that can be cancelled by support/admin (not yet executing or waiting for retry)
const CANCELLABLE_STATUSES: WorkerJobStatus[] = ['queued', 'retrying', 'blocked'];

export interface ListJobsFilter {
    status?: WorkerJobStatus;
    jobType?: WorkerJobType;
    tenantId?: string;
    page?: number;
    limit?: number;
}

@Injectable()
export class WorkerService {
    private readonly logger = new Logger(WorkerService.name);

    constructor(private readonly prisma: PrismaService) {}

    // ─── Job Enqueueing ──────────────────────────────────────────────────────

    async enqueueJob(dto: EnqueueJobDto) {
        const contract = JOB_CONTRACTS[dto.jobType];

        // ── Contract: idempotency_key is mandatory for this job type ──────────
        if (contract.requiresIdempotencyKey && !dto.idempotencyKey) {
            throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', jobType: dto.jobType });
        }

        // ── Contract: tenant scope advisory ──────────────────────────────────
        if (contract.requiresTenantScope && !dto.tenantId) {
            this.logger.warn(JSON.stringify({
                event:   'enqueue_missing_tenant_scope',
                jobType: dto.jobType,
                ts:      new Date().toISOString(),
            }));
        }

        // ── Idempotency dedup: return existing active job, don't double-create ─
        if (dto.idempotencyKey) {
            const existing = await this.prisma.workerJob.findFirst({
                where: {
                    idempotencyKey: dto.idempotencyKey,
                    status:         { in: ACTIVE_STATUSES },
                },
            });

            if (existing) {
                this.logger.warn(JSON.stringify({
                    event:          'job_enqueue_dedup',
                    jobType:        dto.jobType,
                    idempotencyKey: dto.idempotencyKey,
                    existingJobId:  existing.id,
                    status:         existing.status,
                    ts:             new Date().toISOString(),
                }));
                return existing;
            }
        }

        // ── Create job using contract defaults where caller omitted values ────
        return this.prisma.workerJob.create({
            data: {
                jobType:            dto.jobType,
                queueName:          dto.queueName          ?? contract.defaultQueue,
                priority:           dto.priority           ?? contract.defaultPriority,
                maxAttempts:        dto.maxAttempts        ?? contract.defaultMaxAttempts,
                payload:            dto.payload as Prisma.InputJsonValue,
                tenantId:           dto.tenantId           ?? null,
                idempotencyKey:     dto.idempotencyKey     ?? null,
                correlationId:      dto.correlationId      ?? null,
                createdByActorType: dto.createdByActorType,
                createdByActorId:   dto.createdByActorId   ?? null,
                status:             'queued',
                queuedAt:           new Date(),
            },
        });
    }

    // ─── Support / Admin Monitoring ──────────────────────────────────────────

    async listJobs(filter: ListJobsFilter) {
        const page  = Math.max(1, filter.page  ?? 1);
        const limit = Math.min(100, Math.max(1, filter.limit ?? 20));
        const skip  = (page - 1) * limit;

        const where: Prisma.WorkerJobWhereInput = {
            ...(filter.status   ? { status:   filter.status }   : {}),
            ...(filter.jobType  ? { jobType:  filter.jobType }  : {}),
            ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
        };

        const [items, total] = await Promise.all([
            this.prisma.workerJob.findMany({
                where,
                orderBy: { queuedAt: 'desc' },
                skip,
                take: limit,
                select: {
                    id:                  true,
                    jobType:             true,
                    queueName:           true,
                    priority:            true,
                    status:              true,
                    attempt:             true,
                    maxAttempts:         true,
                    tenantId:            true,
                    correlationId:       true,
                    idempotencyKey:      true,
                    createdByActorType:  true,
                    queuedAt:            true,
                    startedAt:           true,
                    finishedAt:          true,
                    nextAttemptAt:       true,
                    lastError:           true,
                },
            }),
            this.prisma.workerJob.count({ where }),
        ]);

        return { items, total, page, limit };
    }

    async getJob(jobId: string) {
        const job = await this.prisma.workerJob.findUnique({
            where: { id: jobId },
            include: {
                failedJobs: {
                    orderBy: { createdAt: 'desc' },
                    take: 10,
                },
            },
        });

        if (!job) {
            throw new NotFoundException({ code: 'JOB_NOT_FOUND' });
        }

        return job;
    }

    // ─── Retry (support/admin only, §10) ────────────────────────────────────

    async retryJob(jobId: string) {
        const job = await this.prisma.workerJob.findUnique({
            where:  { id: jobId },
            select: { id: true, status: true, attempt: true, maxAttempts: true, jobType: true },
        });

        if (!job) {
            throw new NotFoundException({ code: 'JOB_NOT_FOUND' });
        }

        // ── Contract: replay policy check ────────────────────────────────────
        const contract = JOB_CONTRACTS[job.jobType];

        if (contract.replayPolicy === 'forbidden') {
            throw new ForbiddenException({ code: 'JOB_REPLAY_FORBIDDEN_BY_CONTRACT' });
        }

        if (NON_RETRYABLE_STATUSES.includes(job.status)) {
            throw new ConflictException({ code: 'JOB_RETRY_NOT_ALLOWED' });
        }

        if (!RETRYABLE_TERMINAL_STATUSES.includes(job.status)) {
            throw new ConflictException({ code: 'JOB_RETRY_NOT_ALLOWED' });
        }

        // ── Audit-grade log for high-risk replays (§19 system-analytics) ─────
        if (isHighRiskJob(contract)) {
            this.logger.warn(JSON.stringify({
                event:           'job_high_risk_replay',
                jobId,
                jobType:         job.jobType,
                specialHandling: contract.specialHandling,
                status:          job.status,
                attempt:         job.attempt,
                ts:              new Date().toISOString(),
            }));
        }

        const updated = await this.prisma.workerJob.update({
            where: { id: jobId },
            data: {
                status:        'queued',
                attempt:       0,
                lastError:     null,
                nextAttemptAt: null,
                startedAt:     null,
                finishedAt:    null,
                leaseOwner:    null,
                leaseUntil:    null,
            },
        });

        this.logger.log(JSON.stringify({
            event:          'job_manual_retry',
            jobId,
            jobType:        job.jobType,
            replayPolicy:   contract.replayPolicy,
            specialHandling: contract.specialHandling,
            ts:             new Date().toISOString(),
        }));

        return updated;
    }

    // ─── Cancel (support/admin only, §10) ───────────────────────────────────

    async cancelJob(jobId: string) {
        const job = await this.prisma.workerJob.findUnique({
            where:  { id: jobId },
            select: { id: true, status: true, jobType: true },
        });

        if (!job) {
            throw new NotFoundException({ code: 'JOB_NOT_FOUND' });
        }

        if (!CANCELLABLE_STATUSES.includes(job.status)) {
            throw new ConflictException({ code: 'JOB_CANCEL_NOT_ALLOWED' });
        }

        const updated = await this.prisma.workerJob.update({
            where: { id: jobId },
            data: {
                status:        'cancelled',
                finishedAt:    new Date(),
                leaseOwner:    null,
                leaseUntil:    null,
                nextAttemptAt: null,
            },
        });

        this.logger.log(
            JSON.stringify({ event: 'job_manual_cancel', jobId, jobType: job.jobType, ts: new Date().toISOString() }),
        );

        return updated;
    }

    // ─── Queues Health ───────────────────────────────────────────────────────

    async getQueuesHealth() {
        const statusCounts = await this.prisma.workerJob.groupBy({
            by:     ['queueName', 'status'],
            _count: { id: true },
        });

        // Detect stuck in_progress jobs: leaseUntil < now
        const stuckCount = await this.prisma.workerJob.count({
            where: {
                status:    'in_progress',
                leaseUntil: { lt: new Date() },
            },
        });

        const byQueue: Record<string, Record<string, number>> = {};
        for (const row of statusCounts) {
            byQueue[row.queueName]               ??= {};
            byQueue[row.queueName][row.status]     = row._count.id;
        }

        return { queues: byQueue, stuckJobs: stuckCount, reportedAt: new Date().toISOString() };
    }

    // ─── Schedules ───────────────────────────────────────────────────────────

    async listSchedules() {
        return this.prisma.workerSchedule.findMany({
            orderBy: { name: 'asc' },
        });
    }

    async getSchedule(name: string) {
        const schedule = await this.prisma.workerSchedule.findUnique({
            where: { name },
        });

        if (!schedule) {
            throw new NotFoundException({ code: 'SCHEDULE_NOT_FOUND' });
        }

        return schedule;
    }

    async runSchedule(name: string) {
        const schedule = await this.prisma.workerSchedule.findUnique({
            where: { name },
        });

        if (!schedule) {
            throw new NotFoundException({ code: 'SCHEDULE_NOT_FOUND' });
        }

        const job = await this.enqueueJob({
            jobType:            schedule.jobType,
            queueName:          schedule.queueName,
            priority:           schedule.priority,
            payload:            (schedule.payload as Record<string, unknown>) ?? {},
            createdByActorType: 'support',
            correlationId:      randomUUID(),
        });

        await this.prisma.workerSchedule.update({
            where: { name },
            data:  { lastRunAt: new Date() },
        });

        this.logger.log(
            JSON.stringify({ event: 'schedule_manual_run', name, jobId: job.id, ts: new Date().toISOString() }),
        );

        return { jobId: job.id };
    }

    // ─── Tenant-Facing Product Status Surface (§7 system-analytics) ─────────
    // Returns only product-visible job types with user-friendly labels.
    // Raw internals (payload, lastError, lease, actor) are never exposed.

    async getProductStatus(tenantId: string) {
        const since = new Date(Date.now() - STATUS_WINDOW_HOURS * 60 * 60 * 1000);

        const jobs = await this.prisma.workerJob.findMany({
            where: {
                tenantId,
                jobType: { in: TENANT_VISIBLE_JOB_TYPES },
                OR: [
                    { status: { in: ACTIVE_JOB_STATUSES } },
                    { finishedAt: { gte: since } },
                ],
            },
            orderBy: { queuedAt: 'desc' },
            take:    50,
            select: {
                id:            true,
                jobType:       true,
                status:        true,
                correlationId: true,
                queuedAt:      true,
                startedAt:     true,
                finishedAt:    true,
            },
        });

        return {
            items: jobs.map(j => ({
                jobId:         j.id,
                jobType:       j.jobType,
                productStatus: toProductStatus(j.jobType, j.status),
                correlationId: j.correlationId,
                since:         j.startedAt ?? j.queuedAt,
                finishedAt:    j.finishedAt,
            })),
        };
    }
}
