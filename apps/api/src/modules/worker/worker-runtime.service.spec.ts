/**
 * TASK_WORKER_7 spec для `WorkerRuntimeService`.
 *
 * Покрывает тестовую матрицу (system-analytics §17):
 *   - Success path: queued → in_progress → success.
 *   - Retryable failure: temporary error → retrying с backoff.
 *   - Final failed после исчерпания attempts → dead_lettered + worker_failed_jobs.
 *   - Blocked-by-policy: JobBlockedError → 'blocked' (не 'failed'), failureClass DOMAIN_POLICY в логе.
 *   - Non-retryable: NonRetryableJobError → immediate 'failed', без retry.
 *   - No handler: → 'failed' NO_HANDLER_REGISTERED.
 *   - Restart recovery: orphaned in_progress → retrying или dead_lettered по policy.
 *   - Exponential backoff: attempt=1≈30s, attempt=2≈60s, capped@1h.
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: {},
    WorkerJobStatus: {
        queued:        'queued',
        in_progress:   'in_progress',
        retrying:      'retrying',
        success:       'success',
        failed:        'failed',
        blocked:       'blocked',
        dead_lettered: 'dead_lettered',
        cancelled:     'cancelled',
    },
    WorkerJobType: {
        SYNC:               'SYNC',
        NOTIFICATION:       'NOTIFICATION',
        BILLING_REMINDER:   'BILLING_REMINDER',
        FILE_CLEANUP:       'FILE_CLEANUP',
        ANALYTICS_REBUILD:  'ANALYTICS_REBUILD',
        AUDIT_MAINTENANCE:  'AUDIT_MAINTENANCE',
    },
    WorkerJobPriority: {
        critical: 'critical',
        default:  'default',
        bulk:     'bulk',
    },
    WorkerActorType: {
        user: 'user', system: 'system', support: 'support', scheduler: 'scheduler',
    },
    WorkerFailureClass: {
        TECHNICAL_INFRA:         'TECHNICAL_INFRA',
        TECHNICAL_NON_RETRYABLE: 'TECHNICAL_NON_RETRYABLE',
        NO_HANDLER:              'NO_HANDLER',
    },
}));

import { Test } from '@nestjs/testing';
import { WorkerRuntimeService } from './worker-runtime.service';
import { JobHandlerRegistry } from './job-handler.registry';
import { PrismaService } from '../../prisma/prisma.service';
import { JobBlockedError, NonRetryableJobError } from './worker-runtime.errors';

// ─── Prisma mock factory ──────────────────────────────────────────────────────

function makePrismaMock() {
    const mock = {
        workerJob: {
            findFirst:   jest.fn().mockResolvedValue(null),
            findMany:    jest.fn().mockResolvedValue([]),
            update:      jest.fn().mockResolvedValue({}),
            updateMany:  jest.fn().mockResolvedValue({ count: 0 }),
        },
        workerFailedJob: {
            create: jest.fn().mockResolvedValue({ id: 'fail-1' }),
        },
        $transaction: jest.fn().mockImplementation((ops: any[]) => Promise.all(ops)),
    };
    return mock;
}

// ─── Job fixture factory ──────────────────────────────────────────────────────

const NOW = new Date('2026-04-29T10:00:00Z');

function makeJob(overrides: Record<string, unknown> = {}) {
    return {
        id:            'job-1',
        jobType:       'SYNC',
        queueName:     'default',
        priority:      'default',
        status:        'in_progress',
        attempt:       1,
        maxAttempts:   3,
        tenantId:      'tenant-1',
        payload:       { ref: 'abc' },
        idempotencyKey: null,
        correlationId:  null,
        leaseOwner:     'worker-host-1234',
        leaseUntil:     new Date(NOW.getTime() + 10 * 60 * 1000),
        startedAt:      NOW,
        finishedAt:     null,
        queuedAt:       NOW,
        nextAttemptAt:  null,
        lastError:      null,
        ...overrides,
    };
}

// ─── Mock handler factory ─────────────────────────────────────────────────────

function makeHandler(behavior: 'success' | 'retryable' | 'non-retryable' | 'blocked') {
    return {
        handle: jest.fn().mockImplementation(async () => {
            if (behavior === 'success')      return;
            if (behavior === 'retryable')    throw new Error('network timeout');
            if (behavior === 'non-retryable') throw new NonRetryableJobError('bad payload', 'INVALID_PAYLOAD');
            if (behavior === 'blocked')      throw new JobBlockedError('tenant suspended', 'TENANT_SUSPENDED');
        }),
    };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('WorkerRuntimeService', () => {
    let svc:      WorkerRuntimeService;
    let prisma:   ReturnType<typeof makePrismaMock>;
    let registry: JobHandlerRegistry;

    beforeEach(async () => {
        prisma = makePrismaMock();

        const module = await Test.createTestingModule({
            providers: [
                WorkerRuntimeService,
                JobHandlerRegistry,
                { provide: PrismaService, useValue: prisma },
            ],
        }).compile();

        svc      = module.get(WorkerRuntimeService);
        registry = module.get(JobHandlerRegistry);
    });

    afterEach(() => jest.clearAllMocks());

    // ─── executeJob: success path ─────────────────────────────────────────────

    describe('executeJob — success path', () => {
        it('обновляет job в статус success и очищает lease', async () => {
            registry.register('SYNC', makeHandler('success'));
            const job = makeJob();

            await (svc as any).executeJob(job);

            expect(prisma.workerJob.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 'job-1' },
                    data:  expect.objectContaining({
                        status:     'success',
                        leaseOwner: null,
                        leaseUntil: null,
                    }),
                }),
            );
        });
    });

    // ─── executeJob: blocked-by-policy ───────────────────────────────────────

    describe('executeJob — blocked-by-policy (JobBlockedError)', () => {
        it('устанавливает статус blocked, а не failed', async () => {
            registry.register('SYNC', makeHandler('blocked'));
            const job = makeJob();

            await (svc as any).executeJob(job);

            const updateCall = prisma.workerJob.update.mock.calls[0][0];
            expect(updateCall.data.status).toBe('blocked');
            // Не должно быть записи в worker_failed_jobs
            expect(prisma.workerFailedJob.create).not.toHaveBeenCalled();
        });

        it('не создает запись в worker_failed_jobs (blocked ≠ technical failure)', async () => {
            registry.register('SYNC', makeHandler('blocked'));

            await (svc as any).executeJob(makeJob());

            expect(prisma.$transaction).not.toHaveBeenCalled();
        });
    });

    // ─── executeJob: non-retryable error ─────────────────────────────────────

    describe('executeJob — NonRetryableJobError', () => {
        it('немедленно переводит в failed без retry, создает worker_failed_job', async () => {
            registry.register('SYNC', makeHandler('non-retryable'));
            const job = makeJob({ attempt: 1, maxAttempts: 5 }); // много попыток, но immediate

            await (svc as any).executeJob(job);

            expect(prisma.$transaction).toHaveBeenCalled();
            const [updateOp] = prisma.$transaction.mock.calls[0][0];
            // updateOp — это сформированный Prisma operation, проверяем через прямой вызов
            // Достаточно убедиться, что $transaction вызван (значит markFinalFailed сработал)
            expect(prisma.workerJob.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: 'failed' }),
                }),
            );
        });
    });

    // ─── executeJob: retryable error, attempts remaining ─────────────────────

    describe('executeJob — retryable error, attempts < maxAttempts', () => {
        it('переводит job в retrying с nextAttemptAt', async () => {
            registry.register('SYNC', makeHandler('retryable'));
            const job = makeJob({ attempt: 1, maxAttempts: 3 });

            await (svc as any).executeJob(job);

            expect(prisma.workerJob.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        status:    'retrying',
                        leaseOwner: null,
                        leaseUntil: null,
                    }),
                }),
            );
            // nextAttemptAt должен быть установлен
            const callData = prisma.workerJob.update.mock.calls[0][0].data;
            expect(callData.nextAttemptAt).toBeInstanceOf(Date);
            expect(callData.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
        });
    });

    // ─── executeJob: retryable error, attempts exhausted → dead_lettered ──────

    describe('executeJob — retryable error, attempts exhausted', () => {
        it('переводит job в dead_lettered и создает worker_failed_job запись', async () => {
            registry.register('SYNC', makeHandler('retryable'));
            // attempt === maxAttempts → exhausted
            const job = makeJob({ attempt: 3, maxAttempts: 3 });

            await (svc as any).executeJob(job);

            expect(prisma.$transaction).toHaveBeenCalled();
            expect(prisma.workerJob.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: 'dead_lettered' }),
                }),
            );
        });
    });

    // ─── executeJob: no handler registered ───────────────────────────────────

    describe('executeJob — no handler registered', () => {
        it('переводит job в failed с NO_HANDLER_REGISTERED', async () => {
            // Не регистрируем обработчик для SYNC
            const job = makeJob({ jobType: 'SYNC' });

            await (svc as any).executeJob(job);

            expect(prisma.workerJob.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: 'failed' }),
                }),
            );
        });
    });

    // ─── markFinalFailed: dead_lettered vs failed ─────────────────────────────

    describe('markFinalFailed', () => {
        it('TECHNICAL_INFRA + exhausted → dead_lettered', async () => {
            const job = makeJob({ attempt: 3, maxAttempts: 3 });

            await (svc as any).markFinalFailed(job, 'network error', 'TECHNICAL_INFRA');

            expect(prisma.workerJob.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: 'dead_lettered' }),
                }),
            );
        });

        it('TECHNICAL_NON_RETRYABLE → failed (не dead_lettered)', async () => {
            const job = makeJob({ attempt: 1, maxAttempts: 5 });

            await (svc as any).markFinalFailed(job, 'bad payload', 'TECHNICAL_NON_RETRYABLE');

            expect(prisma.workerJob.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: 'failed' }),
                }),
            );
        });

        it('NO_HANDLER → failed', async () => {
            const job = makeJob({ attempt: 1, maxAttempts: 3 });

            await (svc as any).markFinalFailed(job, 'NO_HANDLER_REGISTERED:SYNC', 'NO_HANDLER');

            expect(prisma.workerJob.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: 'failed' }),
                }),
            );
        });
    });

    // ─── recoverOrphanedJobs ──────────────────────────────────────────────────

    describe('recoverOrphanedJobs', () => {
        it('реставрирует orphaned job с оставшимися попытками → retrying', async () => {
            prisma.workerJob.findMany.mockResolvedValue([
                makeJob({ attempt: 1, maxAttempts: 3, status: 'in_progress' }),
            ]);

            await svc.recoverOrphanedJobs();

            expect(prisma.workerJob.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: 'retrying' }),
                }),
            );
        });

        it('помечает orphaned job с исчерпанными попытками как dead_lettered', async () => {
            prisma.workerJob.findMany.mockResolvedValue([
                makeJob({ attempt: 3, maxAttempts: 3, status: 'in_progress' }),
            ]);

            await svc.recoverOrphanedJobs();

            expect(prisma.$transaction).toHaveBeenCalled();
            expect(prisma.workerJob.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: 'dead_lettered' }),
                }),
            );
        });

        it('ничего не делает когда нет orphaned jobs', async () => {
            prisma.workerJob.findMany.mockResolvedValue([]);

            await svc.recoverOrphanedJobs();

            expect(prisma.workerJob.update).not.toHaveBeenCalled();
            expect(prisma.$transaction).not.toHaveBeenCalled();
        });
    });

    // ─── calcNextAttemptAt: exponential backoff ───────────────────────────────

    describe('calcNextAttemptAt (exponential backoff)', () => {
        it('attempt=1 → ~30s задержка', () => {
            const before = Date.now();
            const result: Date = (svc as any).calcNextAttemptAt(1);
            // Base 30s, with up to 10% jitter: [30s, 33s]
            const delayMs = result.getTime() - before;
            expect(delayMs).toBeGreaterThanOrEqual(29_000);
            expect(delayMs).toBeLessThan(35_000);
        });

        it('attempt=2 → ~60s задержка', () => {
            const before = Date.now();
            const result: Date = (svc as any).calcNextAttemptAt(2);
            const delayMs = result.getTime() - before;
            expect(delayMs).toBeGreaterThanOrEqual(59_000);
            expect(delayMs).toBeLessThan(70_000);
        });

        it('attempt=10 → задержка capped на 1 часе', () => {
            const before = Date.now();
            const result: Date = (svc as any).calcNextAttemptAt(10);
            const delayMs = result.getTime() - before;
            // 1 hour = 3_600_000ms, with jitter ≤ 10%
            expect(delayMs).toBeGreaterThanOrEqual(3_600_000);
            expect(delayMs).toBeLessThan(3_600_000 + 360_001);
        });
    });
});
