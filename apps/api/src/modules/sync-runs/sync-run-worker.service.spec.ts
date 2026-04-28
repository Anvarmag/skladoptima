import { Test } from '@nestjs/testing';
import { Logger, NotFoundException } from '@nestjs/common';
import { SyncRunWorker, SyncStageRunner } from './sync-run-worker.service';
import { SyncPreflightService } from './sync-preflight.service';
import { SyncDiagnosticsService } from './sync-diagnostics.service';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { adapterSuccess, adapterPartial, classifyHttpError } from './adapter-result';

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: {},
    AccessState: {
        EARLY_ACCESS: 'EARLY_ACCESS',
        TRIAL_ACTIVE: 'TRIAL_ACTIVE',
        TRIAL_EXPIRED: 'TRIAL_EXPIRED',
        ACTIVE_PAID: 'ACTIVE_PAID',
        GRACE_PERIOD: 'GRACE_PERIOD',
        SUSPENDED: 'SUSPENDED',
        CLOSED: 'CLOSED',
    },
    MarketplaceLifecycleStatus: { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' },
    MarketplaceCredentialStatus: {
        VALIDATING: 'VALIDATING', VALID: 'VALID', INVALID: 'INVALID',
        NEEDS_RECONNECT: 'NEEDS_RECONNECT', UNKNOWN: 'UNKNOWN',
    },
    SyncRunStatus: {
        QUEUED: 'QUEUED',
        IN_PROGRESS: 'IN_PROGRESS',
        SUCCESS: 'SUCCESS',
        PARTIAL_SUCCESS: 'PARTIAL_SUCCESS',
        FAILED: 'FAILED',
        BLOCKED: 'BLOCKED',
        CANCELLED: 'CANCELLED',
    },
    SyncRunItemStage: {
        PREFLIGHT: 'PREFLIGHT',
        PULL: 'PULL',
        TRANSFORM: 'TRANSFORM',
        APPLY: 'APPLY',
        PUSH: 'PUSH',
    },
    SyncRunItemType: {
        STOCK: 'STOCK',
        ORDER: 'ORDER',
        PRODUCT: 'PRODUCT',
        WAREHOUSE: 'WAREHOUSE',
    },
    SyncRunItemStatus: {
        SUCCESS: 'SUCCESS',
        FAILED: 'FAILED',
        SKIPPED: 'SKIPPED',
        CONFLICT: 'CONFLICT',
        BLOCKED: 'BLOCKED',
    },
    SyncTriggerType: { MANUAL: 'MANUAL', SCHEDULED: 'SCHEDULED', RETRY: 'RETRY' },
    SyncTriggerScope: { ACCOUNT: 'ACCOUNT', TENANT_FULL: 'TENANT_FULL' },
}));

const TENANT = 't1';
const ACCOUNT = 'acc-1';
const RUN_ID = 'run-1';

function makeRun(overrides: any = {}) {
    return {
        id: RUN_ID,
        tenantId: TENANT,
        marketplaceAccountId: ACCOUNT,
        triggerType: 'MANUAL',
        triggerScope: 'ACCOUNT',
        syncTypes: ['PULL_STOCKS'],
        status: 'QUEUED',
        startedAt: null,
        finishedAt: null,
        durationMs: null,
        processedCount: 0,
        errorCount: 0,
        errorCode: null,
        errorMessage: null,
        attemptNumber: 1,
        maxAttempts: 3,
        nextAttemptAt: null,
        originRunId: null,
        ...overrides,
    };
}

function makePrisma() {
    const updates: any[] = [];
    const prisma: any = {
        syncRun: {
            findUnique: jest.fn(),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            update: jest.fn().mockImplementation(async (args: any) => {
                updates.push(args);
                return { ...makeRun(), ...args.data };
            }),
        },
        _updates: updates,
    };
    return prisma;
}

function makePreflight(decision?: any) {
    return {
        runPreflight: jest.fn().mockResolvedValue(
            decision ?? { allowed: true, tenantAccessState: 'ACTIVE_PAID' },
        ),
    } as unknown as SyncPreflightService;
}

function makeDiagnostics() {
    return {
        recordItem: jest.fn().mockResolvedValue({ id: 'i' }),
        recordConflict: jest.fn().mockResolvedValue({ id: 'c' }),
        incrementProcessed: jest.fn().mockResolvedValue(undefined),
        incrementErrors: jest.fn().mockResolvedValue(undefined),
    } as unknown as SyncDiagnosticsService;
}

function makeAccounts() {
    return {
        reportSyncRun: jest.fn().mockResolvedValue({}),
    } as unknown as MarketplaceAccountsService;
}

async function build(prisma: any, opts: any = {}) {
    const ref = await Test.createTestingModule({
        providers: [
            SyncRunWorker,
            { provide: PrismaService, useValue: prisma },
            { provide: SyncPreflightService, useValue: opts.preflight ?? makePreflight() },
            { provide: SyncDiagnosticsService, useValue: opts.diagnostics ?? makeDiagnostics() },
            { provide: MarketplaceAccountsService, useValue: opts.accounts ?? makeAccounts() },
        ],
    })
        .setLogger(new Logger())
        .compile();
    return ref.get(SyncRunWorker);
}

function makeRunner(syncType: string, stage: string, result: any): SyncStageRunner {
    return {
        syncType: syncType as any,
        stage: stage as any,
        run: jest.fn().mockResolvedValue(result),
    };
}

describe('SyncRunWorker.processRun — happy path', () => {
    test('SUCCESS run: QUEUED → IN_PROGRESS → SUCCESS, reportSyncRun(ok=true)', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findUnique.mockResolvedValue(makeRun());
        const accounts = makeAccounts();
        const worker = await build(prisma, { accounts });
        worker.registerRunner(makeRunner('PULL_STOCKS', 'PULL', adapterSuccess('PULL', 42)));

        const result = await worker.processRun(RUN_ID);

        expect(prisma.syncRun.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: RUN_ID, status: 'QUEUED' },
                data: expect.objectContaining({ status: 'IN_PROGRESS' }),
            }),
        );
        // Финал — status: SUCCESS, processedCount: 42.
        const finalUpdate = prisma._updates[prisma._updates.length - 1];
        expect(finalUpdate.data.status).toBe('SUCCESS');
        expect(finalUpdate.data.processedCount).toBe(42);
        expect(finalUpdate.data.durationMs).toBeGreaterThanOrEqual(0);
        expect(accounts.reportSyncRun).toHaveBeenCalledWith(TENANT, ACCOUNT, expect.objectContaining({ ok: true, partial: false }));
    });

    test('PARTIAL_SUCCESS: были item failures → PARTIAL_SUCCESS, reportSyncRun(partial=true)', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findUnique.mockResolvedValue(makeRun());
        const accounts = makeAccounts();
        const diagnostics = makeDiagnostics();
        const worker = await build(prisma, { accounts, diagnostics });
        worker.registerRunner(makeRunner('PULL_STOCKS', 'PULL', adapterPartial('PULL', 10, {
            itemFailures: [
                { itemType: 'STOCK' as any, itemKey: 'sku-1', error: { code: 'X' } },
                { itemType: 'STOCK' as any, itemKey: 'sku-2', error: { code: 'Y' } },
            ],
        })));

        await worker.processRun(RUN_ID);

        expect(diagnostics.recordItem).toHaveBeenCalledTimes(2);
        const finalUpdate = prisma._updates[prisma._updates.length - 1];
        expect(finalUpdate.data.status).toBe('PARTIAL_SUCCESS');
        expect(finalUpdate.data.processedCount).toBe(10);
        expect(finalUpdate.data.errorCount).toBe(2);
        expect(accounts.reportSyncRun).toHaveBeenCalledWith(TENANT, ACCOUNT, expect.objectContaining({ ok: true, partial: true }));
    });

    test('конфликт записан → PARTIAL_SUCCESS', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findUnique.mockResolvedValue(makeRun());
        const diagnostics = makeDiagnostics();
        const worker = await build(prisma, { diagnostics });
        worker.registerRunner(makeRunner('PULL_STOCKS', 'PULL', adapterPartial('PULL', 5, {
            conflicts: [{ entityType: 'order', conflictType: 'INVENTORY_MISMATCH' }],
        })));

        await worker.processRun(RUN_ID);

        expect(diagnostics.recordConflict).toHaveBeenCalledTimes(1);
        const final = prisma._updates[prisma._updates.length - 1];
        expect(final.data.status).toBe('PARTIAL_SUCCESS');
    });
});

describe('SyncRunWorker.processRun — non-pickup paths', () => {
    test('run не QUEUED → graceful skip без updateMany', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findUnique.mockResolvedValue(makeRun({ status: 'IN_PROGRESS' }));
        const worker = await build(prisma);
        const r = await worker.processRun(RUN_ID);
        expect(r.status).toBe('IN_PROGRESS');
        expect(prisma.syncRun.updateMany).not.toHaveBeenCalled();
    });

    test('updateMany count=0 (race с другим worker) → возвращаем актуальное состояние', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findUnique
            .mockResolvedValueOnce(makeRun())
            .mockResolvedValueOnce(makeRun({ status: 'IN_PROGRESS' }));
        prisma.syncRun.updateMany.mockResolvedValue({ count: 0 });
        const worker = await build(prisma);
        const r = await worker.processRun(RUN_ID);
        expect(r.status).toBe('IN_PROGRESS');
    });

    test('run не существует → NotFoundException', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findUnique.mockResolvedValue(null);
        const worker = await build(prisma);
        await expect(worker.processRun('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
});

describe('SyncRunWorker.processRun — preflight at runtime', () => {
    test('runtime preflight отказывает → BLOCKED, остальные stages пропускаются', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findUnique.mockResolvedValue(makeRun());
        const preflight = makePreflight({
            allowed: false,
            reason: 'TENANT_TRIAL_EXPIRED',
            eventName: 'sync_run_blocked_by_tenant_state',
            tenantAccessState: 'TRIAL_EXPIRED',
        });
        const runner = makeRunner('PULL_STOCKS', 'PULL', adapterSuccess('PULL', 10));
        const worker = await build(prisma, { preflight });
        worker.registerRunner(runner);

        await worker.processRun(RUN_ID);

        const final = prisma._updates[prisma._updates.length - 1];
        expect(final.data.status).toBe('BLOCKED');
        expect(final.data.blockedReason).toBe('TENANT_TRIAL_EXPIRED');
        expect(runner.run).not.toHaveBeenCalled();
    });

    test('runtime preflight checkConcurrency=false (worker сам "активный run")', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findUnique.mockResolvedValue(makeRun());
        const preflight = makePreflight();
        const worker = await build(prisma, { preflight });
        worker.registerRunner(makeRunner('PULL_STOCKS', 'PULL', adapterSuccess('PULL', 1)));

        await worker.processRun(RUN_ID);

        expect(preflight.runPreflight).toHaveBeenCalledWith(TENANT, ACCOUNT, expect.objectContaining({
            operation: 'worker_start',
            checkConcurrency: false,
        }));
    });
});

describe('SyncRunWorker.processRun — failure taxonomy', () => {
    test('AUTH_FAILURE → FAILED, retry NOT scheduled (бесполезно без credentials)', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findUnique.mockResolvedValue(makeRun({ attemptNumber: 1, maxAttempts: 3 }));
        const accounts = makeAccounts();
        const worker = await build(prisma, { accounts });
        worker.registerRunner({
            syncType: 'PULL_STOCKS' as any,
            stage: 'PULL' as any,
            run: jest.fn().mockResolvedValue({
                outcome: 'AUTH_FAILURE',
                stage: 'PULL',
                processedCount: 0,
                errorCode: 'EXTERNAL_AUTH_FAILED',
                errorMessage: 'invalid token',
            }),
        });

        await worker.processRun(RUN_ID);

        const final = prisma._updates[prisma._updates.length - 1];
        expect(final.data.status).toBe('FAILED');
        expect(final.data.errorCode).toBe('EXTERNAL_AUTH_FAILED');
        // AUTH_FAILURE не получает retry даже если attempt < maxAttempts.
        expect(final.data.nextAttemptAt).toBeNull();
        expect(accounts.reportSyncRun).toHaveBeenCalledWith(TENANT, ACCOUNT, expect.objectContaining({ ok: false }));
    });

    test('TECHNICAL_FAILURE + attempt < max → FAILED с nextAttemptAt (retry-eligible)', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findUnique.mockResolvedValue(makeRun({ attemptNumber: 1, maxAttempts: 3 }));
        const worker = await build(prisma);
        worker.registerRunner({
            syncType: 'PULL_STOCKS' as any,
            stage: 'PULL' as any,
            run: jest.fn().mockResolvedValue({
                outcome: 'TECHNICAL_FAILURE',
                stage: 'PULL',
                processedCount: 0,
                errorCode: 'EXTERNAL_TIMEOUT',
                errorMessage: 'timeout',
            }),
        });

        await worker.processRun(RUN_ID);

        const final = prisma._updates[prisma._updates.length - 1];
        expect(final.data.status).toBe('FAILED');
        expect(final.data.nextAttemptAt).toBeInstanceOf(Date);
        expect(final.data.errorCode).toBe('EXTERNAL_TIMEOUT');
    });

    test('TECHNICAL_FAILURE при attempt == max → exhausted (nextAttemptAt = null)', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findUnique.mockResolvedValue(makeRun({ attemptNumber: 3, maxAttempts: 3 }));
        const worker = await build(prisma);
        worker.registerRunner({
            syncType: 'PULL_STOCKS' as any,
            stage: 'PULL' as any,
            run: jest.fn().mockResolvedValue({
                outcome: 'TECHNICAL_FAILURE',
                stage: 'PULL',
                processedCount: 0,
                errorCode: 'EXTERNAL_5XX',
            }),
        });

        await worker.processRun(RUN_ID);

        const final = prisma._updates[prisma._updates.length - 1];
        expect(final.data.status).toBe('FAILED');
        expect(final.data.nextAttemptAt).toBeNull();
    });

    test('RATE_LIMIT → retry-eligible с удвоенным backoff', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findUnique.mockResolvedValue(makeRun({ attemptNumber: 1, maxAttempts: 3 }));
        const worker = await build(prisma);
        worker.registerRunner({
            syncType: 'PULL_STOCKS' as any,
            stage: 'PULL' as any,
            run: jest.fn().mockResolvedValue({
                outcome: 'RATE_LIMIT',
                stage: 'PULL',
                processedCount: 0,
                errorCode: 'EXTERNAL_RATE_LIMIT',
            }),
        });
        const before = Date.now();

        await worker.processRun(RUN_ID);

        const final = prisma._updates[prisma._updates.length - 1];
        expect(final.data.nextAttemptAt).toBeInstanceOf(Date);
        // Базовый backoff[0] = 30s; rate_limit удваивает до 60s.
        const lag = final.data.nextAttemptAt.getTime() - before;
        expect(lag).toBeGreaterThan(50_000);
    });

    test('runner threw → нормализуется как INTERNAL_ERROR, run НЕ остаётся IN_PROGRESS', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findUnique.mockResolvedValue(makeRun());
        const worker = await build(prisma);
        worker.registerRunner({
            syncType: 'PULL_STOCKS' as any,
            stage: 'PULL' as any,
            run: jest.fn().mockRejectedValue(new Error('unexpected')),
        });

        await worker.processRun(RUN_ID);

        const final = prisma._updates[prisma._updates.length - 1];
        expect(final.data.status).toBe('FAILED');
        expect(final.data.errorCode).toBe('INTERNAL_ERROR');
    });
});

describe('SyncRunWorker.processRun — staging', () => {
    test('FULL_SYNC раскрывается в канонический порядок stages', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findUnique.mockResolvedValue(makeRun({ syncTypes: ['FULL_SYNC'] }));
        const worker = await build(prisma);
        const calls: string[] = [];
        const make = (t: string, s: string) => ({
            syncType: t as any, stage: s as any,
            run: jest.fn().mockImplementation(async () => {
                calls.push(t);
                return adapterSuccess(s as any, 1);
            }),
        });
        worker.registerRunner(make('PULL_METADATA', 'PULL'));
        worker.registerRunner(make('PULL_ORDERS', 'PULL'));
        worker.registerRunner(make('PULL_STOCKS', 'PULL'));
        worker.registerRunner(make('PUSH_STOCKS', 'PUSH'));

        await worker.processRun(RUN_ID);

        expect(calls).toEqual(['PULL_METADATA', 'PULL_ORDERS', 'PULL_STOCKS', 'PUSH_STOCKS']);
        const final = prisma._updates[prisma._updates.length - 1];
        expect(final.data.status).toBe('SUCCESS');
        expect(final.data.processedCount).toBe(4);
    });

    test('runner отсутствует — stage пропускается, run продолжается', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findUnique.mockResolvedValue(makeRun({
            syncTypes: ['PULL_METADATA', 'PULL_STOCKS'],
        }));
        const worker = await build(prisma);
        // только PULL_STOCKS зарегистрирован
        worker.registerRunner(makeRunner('PULL_STOCKS', 'PULL', adapterSuccess('PULL', 7)));
        await worker.processRun(RUN_ID);
        const final = prisma._updates[prisma._updates.length - 1];
        expect(final.data.status).toBe('SUCCESS');
        expect(final.data.processedCount).toBe(7);
    });

    test('после FAILURE остальные stages не выполняются', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findUnique.mockResolvedValue(makeRun({
            syncTypes: ['PULL_ORDERS', 'PULL_STOCKS', 'PUSH_STOCKS'],
        }));
        const worker = await build(prisma);
        const second = makeRunner('PULL_STOCKS', 'PULL', adapterSuccess('PULL', 1));
        const third = makeRunner('PUSH_STOCKS', 'PUSH', adapterSuccess('PUSH', 1));
        worker.registerRunner(makeRunner('PULL_ORDERS', 'PULL', {
            outcome: 'TECHNICAL_FAILURE', stage: 'PULL', processedCount: 0,
            errorCode: 'EXTERNAL_5XX',
        }));
        worker.registerRunner(second);
        worker.registerRunner(third);

        await worker.processRun(RUN_ID);

        expect(second.run).not.toHaveBeenCalled();
        expect(third.run).not.toHaveBeenCalled();
        const final = prisma._updates[prisma._updates.length - 1];
        expect(final.data.status).toBe('FAILED');
    });
});

describe('classifyHttpError', () => {
    test('401 → AUTH_FAILURE', () => {
        const r = classifyHttpError('PULL' as any, { response: { status: 401 }, message: 'unauth' });
        expect(r.outcome).toBe('AUTH_FAILURE');
        expect(r.errorCode).toBe('EXTERNAL_AUTH_FAILED');
    });
    test('403 → AUTH_FAILURE', () => {
        const r = classifyHttpError('PULL' as any, { response: { status: 403 }, message: '' });
        expect(r.outcome).toBe('AUTH_FAILURE');
    });
    test('429 → RATE_LIMIT', () => {
        const r = classifyHttpError('PULL' as any, { response: { status: 429 }, message: '' });
        expect(r.outcome).toBe('RATE_LIMIT');
    });
    test('5xx → TECHNICAL_FAILURE/EXTERNAL_5XX', () => {
        const r = classifyHttpError('PULL' as any, { response: { status: 503 }, message: '' });
        expect(r.outcome).toBe('TECHNICAL_FAILURE');
        expect(r.errorCode).toBe('EXTERNAL_5XX');
    });
    test('ETIMEDOUT → TECHNICAL_FAILURE/EXTERNAL_TIMEOUT', () => {
        const r = classifyHttpError('PULL' as any, { code: 'ETIMEDOUT', message: '' });
        expect(r.outcome).toBe('TECHNICAL_FAILURE');
        expect(r.errorCode).toBe('EXTERNAL_TIMEOUT');
    });
    test('неизвестная ошибка → TECHNICAL_FAILURE/INTERNAL_ERROR', () => {
        const r = classifyHttpError('PULL' as any, { message: 'unknown' });
        expect(r.errorCode).toBe('INTERNAL_ERROR');
    });
});
