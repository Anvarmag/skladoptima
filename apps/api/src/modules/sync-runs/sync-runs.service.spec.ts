import { Test } from '@nestjs/testing';
import {
    Logger,
    BadRequestException,
    ConflictException,
    NotFoundException,
} from '@nestjs/common';
import { SyncRunsService } from './sync-runs.service';
import { SyncPreflightService } from './sync-preflight.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@prisma/client', () => {
    class PrismaClient {}
    return {
        PrismaClient,
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
            VALIDATING: 'VALIDATING',
            VALID: 'VALID',
            INVALID: 'INVALID',
            NEEDS_RECONNECT: 'NEEDS_RECONNECT',
            UNKNOWN: 'UNKNOWN',
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
        SyncTriggerType: { MANUAL: 'MANUAL', SCHEDULED: 'SCHEDULED', RETRY: 'RETRY' },
        SyncTriggerScope: { ACCOUNT: 'ACCOUNT', TENANT_FULL: 'TENANT_FULL' },
    };
});

const TENANT = 't1';
const ACCOUNT = 'acc-1';

function makeAccount(overrides: any = {}) {
    return {
        id: ACCOUNT,
        marketplace: 'WB',
        lifecycleStatus: 'ACTIVE',
        credentialStatus: 'VALID',
        tenant: { accessState: 'ACTIVE_PAID' },
        ...overrides,
    };
}

function makePreflight(decision?: any) {
    const service: any = {
        runPreflight: jest.fn().mockResolvedValue(
            decision ?? { allowed: true, tenantAccessState: 'ACTIVE_PAID' },
        ),
    };
    return service as SyncPreflightService;
}

function makeRun(overrides: any = {}) {
    return {
        id: 'run-' + Math.random().toString(36).slice(2, 8),
        tenantId: TENANT,
        marketplaceAccountId: ACCOUNT,
        triggerType: 'MANUAL',
        triggerScope: 'ACCOUNT',
        syncTypes: ['PULL_STOCKS'],
        status: 'QUEUED',
        originRunId: null,
        jobKey: 'manual:acc-1:PULL_STOCKS:abc',
        idempotencyKey: null,
        requestedBy: 'user-1',
        blockedReason: null,
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
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}

function makePrisma() {
    const prisma: any = {
        marketplaceAccount: { findFirst: jest.fn() },
        syncRun: {
            findUnique: jest.fn(),
            findFirst: jest.fn(),
            findMany: jest.fn(),
            count: jest.fn(),
            create: jest.fn(),
        },
    };
    return prisma;
}

async function build(prisma: any, preflight?: SyncPreflightService) {
    const ref = await Test.createTestingModule({
        providers: [
            SyncRunsService,
            { provide: PrismaService, useValue: prisma },
            { provide: SyncPreflightService, useValue: preflight ?? makePreflight() },
        ],
    })
        .setLogger(new Logger())
        .compile();
    return ref.get(SyncRunsService);
}

describe('SyncRunsService.createRun', () => {
    test('создаёт QUEUED run по happy path', async () => {
        const prisma = makePrisma();
        prisma.marketplaceAccount.findFirst.mockResolvedValue(makeAccount());
        prisma.syncRun.findUnique.mockResolvedValue(null);
        prisma.syncRun.findFirst.mockResolvedValue(null);
        prisma.syncRun.create.mockResolvedValue(makeRun());

        const service = await build(prisma);
        const result = await service.createRun(TENANT, 'user-1', {
            accountId: ACCOUNT,
            syncTypes: ['PULL_STOCKS'] as any,
        });

        expect(result.status).toBe('QUEUED');
        expect(result.triggerType).toBe('MANUAL');
        expect(prisma.syncRun.create).toHaveBeenCalledTimes(1);
        const data = prisma.syncRun.create.mock.calls[0][0].data;
        expect(data.status).toBe('QUEUED');
        expect(data.tenantId).toBe(TENANT);
        expect(data.marketplaceAccountId).toBe(ACCOUNT);
    });

    test('TRIAL_EXPIRED → BLOCKED, не FORBIDDEN', async () => {
        const prisma = makePrisma();
        prisma.marketplaceAccount.findFirst.mockResolvedValue(makeAccount());
        prisma.syncRun.findUnique.mockResolvedValue(null);
        prisma.syncRun.create.mockResolvedValue(
            makeRun({ status: 'BLOCKED', blockedReason: 'TENANT_TRIAL_EXPIRED' }),
        );
        const preflight = makePreflight({
            allowed: false,
            reason: 'TENANT_TRIAL_EXPIRED',
            eventName: 'sync_run_blocked_by_tenant_state',
            tenantAccessState: 'TRIAL_EXPIRED',
        });

        const service = await build(prisma, preflight);
        const result = await service.createRun(TENANT, 'user-1', {
            accountId: ACCOUNT,
            syncTypes: ['PULL_STOCKS'] as any,
        });

        expect(result.status).toBe('BLOCKED');
        expect(result.blockedReason).toBe('TENANT_TRIAL_EXPIRED');
        const data = prisma.syncRun.create.mock.calls[0][0].data;
        expect(data.status).toBe('BLOCKED');
        expect(data.startedAt).toBeInstanceOf(Date);
        expect(data.finishedAt).toBeInstanceOf(Date);
    });

    test('SUSPENDED → BLOCKED с TENANT_SUSPENDED', async () => {
        const prisma = makePrisma();
        prisma.marketplaceAccount.findFirst.mockResolvedValue(makeAccount());
        prisma.syncRun.findUnique.mockResolvedValue(null);
        prisma.syncRun.create.mockResolvedValue(
            makeRun({ status: 'BLOCKED', blockedReason: 'TENANT_SUSPENDED' }),
        );
        const preflight = makePreflight({
            allowed: false,
            reason: 'TENANT_SUSPENDED',
            eventName: 'sync_run_blocked_by_tenant_state',
            tenantAccessState: 'SUSPENDED',
        });

        const service = await build(prisma, preflight);
        const result = await service.createRun(TENANT, 'user-1', {
            accountId: ACCOUNT,
            syncTypes: ['PULL_STOCKS'] as any,
        });

        expect(result.blockedReason).toBe('TENANT_SUSPENDED');
    });

    test('account INACTIVE → BLOCKED с ACCOUNT_INACTIVE', async () => {
        const prisma = makePrisma();
        prisma.marketplaceAccount.findFirst.mockResolvedValue(makeAccount());
        prisma.syncRun.findUnique.mockResolvedValue(null);
        prisma.syncRun.create.mockResolvedValue(
            makeRun({ status: 'BLOCKED', blockedReason: 'ACCOUNT_INACTIVE' }),
        );
        const preflight = makePreflight({
            allowed: false,
            reason: 'ACCOUNT_INACTIVE',
            eventName: 'sync_run_blocked_by_account_state',
            tenantAccessState: 'ACTIVE_PAID',
        });

        const service = await build(prisma, preflight);
        const result = await service.createRun(TENANT, 'user-1', {
            accountId: ACCOUNT,
            syncTypes: ['PULL_STOCKS'] as any,
        });

        expect(result.blockedReason).toBe('ACCOUNT_INACTIVE');
    });

    test('credentials INVALID → BLOCKED с CREDENTIALS_INVALID', async () => {
        const prisma = makePrisma();
        prisma.marketplaceAccount.findFirst.mockResolvedValue(makeAccount());
        prisma.syncRun.findUnique.mockResolvedValue(null);
        prisma.syncRun.create.mockResolvedValue(
            makeRun({ status: 'BLOCKED', blockedReason: 'CREDENTIALS_INVALID' }),
        );
        const preflight = makePreflight({
            allowed: false,
            reason: 'CREDENTIALS_INVALID',
            eventName: 'sync_run_blocked_by_credentials',
            tenantAccessState: 'ACTIVE_PAID',
        });

        const service = await build(prisma, preflight);
        const result = await service.createRun(TENANT, 'user-1', {
            accountId: ACCOUNT,
            syncTypes: ['PULL_STOCKS'] as any,
        });

        expect(result.blockedReason).toBe('CREDENTIALS_INVALID');
    });

    test('NEEDS_RECONNECT → BLOCKED с CREDENTIALS_NEEDS_RECONNECT', async () => {
        const prisma = makePrisma();
        prisma.marketplaceAccount.findFirst.mockResolvedValue(makeAccount());
        prisma.syncRun.findUnique.mockResolvedValue(null);
        prisma.syncRun.create.mockResolvedValue(
            makeRun({ status: 'BLOCKED', blockedReason: 'CREDENTIALS_NEEDS_RECONNECT' }),
        );
        const preflight = makePreflight({
            allowed: false,
            reason: 'CREDENTIALS_NEEDS_RECONNECT',
            eventName: 'sync_run_blocked_by_credentials',
            tenantAccessState: 'ACTIVE_PAID',
        });

        const service = await build(prisma, preflight);
        const result = await service.createRun(TENANT, 'user-1', {
            accountId: ACCOUNT,
            syncTypes: ['PULL_STOCKS'] as any,
        });

        expect(result.blockedReason).toBe('CREDENTIALS_NEEDS_RECONNECT');
    });

    test('активный run на тот же account → BLOCKED с CONCURRENCY_GUARD', async () => {
        const prisma = makePrisma();
        prisma.marketplaceAccount.findFirst.mockResolvedValue(makeAccount());
        prisma.syncRun.findUnique.mockResolvedValue(null);
        prisma.syncRun.create.mockResolvedValue(
            makeRun({ status: 'BLOCKED', blockedReason: 'CONCURRENCY_GUARD' }),
        );
        const preflight = makePreflight({
            allowed: false,
            reason: 'CONCURRENCY_GUARD',
            eventName: 'sync_run_blocked_by_concurrency',
            tenantAccessState: 'ACTIVE_PAID',
            conflictingRunId: 'active-1',
        });

        const service = await build(prisma, preflight);
        const result = await service.createRun(TENANT, 'user-1', {
            accountId: ACCOUNT,
            syncTypes: ['PULL_STOCKS'] as any,
        });

        expect(result.blockedReason).toBe('CONCURRENCY_GUARD');
    });

    test('account другого tenant → 404', async () => {
        const prisma = makePrisma();
        prisma.marketplaceAccount.findFirst.mockResolvedValue(null);

        const service = await build(prisma);
        await expect(
            service.createRun(TENANT, 'user-1', {
                accountId: ACCOUNT,
                syncTypes: ['PULL_STOCKS'] as any,
            }),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    test('тот же idempotencyKey возвращает существующий run, не создавая нового', async () => {
        const prisma = makePrisma();
        prisma.marketplaceAccount.findFirst.mockResolvedValue(makeAccount());
        const existing = makeRun({ id: 'existing-run' });
        prisma.syncRun.findUnique.mockResolvedValue(existing);

        const service = await build(prisma);
        const result = await service.createRun(TENANT, 'user-1', {
            accountId: ACCOUNT,
            syncTypes: ['PULL_STOCKS'] as any,
            idempotencyKey: 'idem-1',
        });

        expect(result.id).toBe('existing-run');
        expect(prisma.syncRun.create).not.toHaveBeenCalled();
    });

    test('P2002 на create — возвращает уже созданный run, не падает', async () => {
        const prisma = makePrisma();
        prisma.marketplaceAccount.findFirst.mockResolvedValue(makeAccount());
        // findUnique до create вернул null (race), после P2002 — найден.
        prisma.syncRun.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(makeRun({ id: 'race-resolved' }));
        prisma.syncRun.findFirst.mockResolvedValue(null);
        prisma.syncRun.create.mockRejectedValue({ code: 'P2002' });

        const service = await build(prisma);
        const result = await service.createRun(TENANT, 'user-1', {
            accountId: ACCOUNT,
            syncTypes: ['PULL_STOCKS'] as any,
        });

        expect(result.id).toBe('race-resolved');
    });
});

describe('SyncRunsService.retryRun', () => {
    test('из FAILED создаёт новый run с triggerType=RETRY и originRunId', async () => {
        const prisma = makePrisma();
        const origin = makeRun({
            id: 'origin-1',
            status: 'FAILED',
            attemptNumber: 1,
            maxAttempts: 3,
        });
        prisma.syncRun.findFirst
            .mockResolvedValueOnce(origin) // findFirst поиск origin
            .mockResolvedValueOnce(null); // concurrency check
        prisma.syncRun.create.mockResolvedValue(
            makeRun({
                id: 'retry-1',
                triggerType: 'RETRY',
                originRunId: 'origin-1',
                attemptNumber: 2,
                maxAttempts: 3,
            }),
        );

        const service = await build(prisma);
        const result = await service.retryRun(TENANT, 'origin-1', 'user-2');

        expect(result.triggerType).toBe('RETRY');
        expect(result.originRunId).toBe('origin-1');
        expect(result.attemptNumber).toBe(2);
        const data = prisma.syncRun.create.mock.calls[0][0].data;
        expect(data.triggerType).toBe('RETRY');
        expect(data.originRunId).toBe('origin-1');
        expect(data.attemptNumber).toBe(2);
        expect(data.status).toBe('QUEUED');
    });

    test('из PARTIAL_SUCCESS retry допустим', async () => {
        const prisma = makePrisma();
        const origin = makeRun({
            id: 'origin-2',
            status: 'PARTIAL_SUCCESS',
            attemptNumber: 1,
            maxAttempts: 3,
        });
        prisma.syncRun.findFirst.mockResolvedValueOnce(origin).mockResolvedValueOnce(null);
        prisma.syncRun.create.mockResolvedValue(
            makeRun({
                id: 'retry-2',
                triggerType: 'RETRY',
                originRunId: 'origin-2',
                attemptNumber: 2,
            }),
        );

        const service = await build(prisma);
        const result = await service.retryRun(TENANT, 'origin-2', null);
        expect(result.triggerType).toBe('RETRY');
    });

    test('SUCCESS retry'+'ить нельзя → 400', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findFirst.mockResolvedValue(makeRun({ status: 'SUCCESS' }));
        const service = await build(prisma);
        await expect(service.retryRun(TENANT, 'origin', null)).rejects.toBeInstanceOf(
            BadRequestException,
        );
    });

    test('BLOCKED retry'+'ить нельзя — это политика, не сбой', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findFirst.mockResolvedValue(
            makeRun({ status: 'BLOCKED', blockedReason: 'TENANT_TRIAL_EXPIRED' }),
        );
        const service = await build(prisma);
        await expect(service.retryRun(TENANT, 'origin', null)).rejects.toBeInstanceOf(
            BadRequestException,
        );
    });

    test('CANCELLED retry'+'ить нельзя → 400', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findFirst.mockResolvedValue(makeRun({ status: 'CANCELLED' }));
        const service = await build(prisma);
        await expect(service.retryRun(TENANT, 'origin', null)).rejects.toBeInstanceOf(
            BadRequestException,
        );
    });

    test('активный run (QUEUED) retry'+'ить нельзя → 409', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findFirst.mockResolvedValue(makeRun({ status: 'QUEUED' }));
        const service = await build(prisma);
        await expect(service.retryRun(TENANT, 'origin', null)).rejects.toBeInstanceOf(
            ConflictException,
        );
    });

    test('attemptNumber >= maxAttempts → 400 RETRY_EXHAUSTED', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findFirst.mockResolvedValue(
            makeRun({ status: 'FAILED', attemptNumber: 3, maxAttempts: 3 }),
        );
        const service = await build(prisma);
        await expect(service.retryRun(TENANT, 'origin', null)).rejects.toBeInstanceOf(
            BadRequestException,
        );
    });

    test('активный run на том же account → 409 CONCURRENCY_CONFLICT', async () => {
        const prisma = makePrisma();
        const origin = makeRun({ status: 'FAILED', attemptNumber: 1, maxAttempts: 3 });
        prisma.syncRun.findFirst
            .mockResolvedValueOnce(origin)
            .mockResolvedValueOnce({ id: 'live-run' });
        const service = await build(prisma);
        await expect(service.retryRun(TENANT, 'origin', null)).rejects.toBeInstanceOf(
            ConflictException,
        );
    });

    test('run другого tenant → 404', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findFirst.mockResolvedValue(null);
        const service = await build(prisma);
        await expect(service.retryRun(TENANT, 'origin', null)).rejects.toBeInstanceOf(
            NotFoundException,
        );
    });
});

describe('SyncRunsService.list / getById', () => {
    test('list возвращает paginated payload', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findMany.mockResolvedValue([makeRun(), makeRun()]);
        prisma.syncRun.count.mockResolvedValue(2);
        const service = await build(prisma);
        const r = await service.list(TENANT, { page: 1, limit: 20 } as any);
        expect(r.data).toHaveLength(2);
        expect(r.meta).toEqual({ total: 2, page: 1, limit: 20, lastPage: 1 });
    });

    test('list по умолчанию: page=1, limit=20', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findMany.mockResolvedValue([]);
        prisma.syncRun.count.mockResolvedValue(0);
        const service = await build(prisma);
        const r = await service.list(TENANT, {} as any);
        expect(r.meta.page).toBe(1);
        expect(r.meta.limit).toBe(20);
    });

    test('getById включает items, conflicts и originRun', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findFirst.mockResolvedValue({
            ...makeRun(),
            items: [
                {
                    id: 'i1',
                    itemType: 'STOCK',
                    itemKey: 'sku-1',
                    stage: 'PUSH',
                    status: 'FAILED',
                    externalEventId: null,
                    payload: null,
                    error: { code: 'TIMEOUT' },
                    createdAt: new Date(),
                },
            ],
            conflicts: [],
            originRun: { id: 'orig', status: 'FAILED', attemptNumber: 1 },
        });
        const service = await build(prisma);
        const r = await service.getById(TENANT, 'run-1');
        expect(r.items).toHaveLength(1);
        expect(r.items[0].status).toBe('FAILED');
        expect(r.originRun?.id).toBe('orig');
    });

    test('getById чужого tenant → 404', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findFirst.mockResolvedValue(null);
        const service = await build(prisma);
        await expect(service.getById(TENANT, 'x')).rejects.toBeInstanceOf(NotFoundException);
    });
});
