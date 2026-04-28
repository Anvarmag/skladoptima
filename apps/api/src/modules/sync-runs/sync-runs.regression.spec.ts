/**
 * Регрессионная QA matrix для модуля 09-sync (TASK_SYNC_7).
 *
 * Покрывает §16 system-analytics test matrix:
 *  - Успешный manual sync.
 *  - Scheduled sync без ошибок.
 *  - Частичный sync с partial_success.
 *  - Retry после временной ошибки.
 *  - Rate-limit сценарий.
 *  - Duplicate external order event (idempotency через jobKey).
 *  - Конфликт после ручной inventory корректировки.
 *  - TRIAL_EXPIRED блокирует manual и scheduled sync без потери истории.
 *  - SUSPENDED/CLOSED блокируют любые внешние этапы run.
 *  - failed preflight переводит run в blocked, а не failed.
 *  - success items не создают лишнюю item-level трассу.
 *
 * Плюс observability-инварианты: каноничные event names, machine reason codes.
 */

import { Test } from '@nestjs/testing';
import { Logger, BadRequestException } from '@nestjs/common';
import { SyncRunsService } from './sync-runs.service';
import { SyncPreflightService } from './sync-preflight.service';
import { SyncDiagnosticsService } from './sync-diagnostics.service';
import { SyncRunWorker } from './sync-run-worker.service';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { adapterSuccess, adapterPartial, classifyHttpError } from './adapter-result';
import { SyncDiagnosticsService } from './sync-diagnostics.service';
import {
    SyncBlockedReason,
    SyncTypes,
    isActiveSyncRunStatus,
    isTerminalSyncRunStatus,
} from '../marketplace_sync/sync-run.contract';
import { SyncRunEventNames } from '../marketplace_sync/sync-run.events';

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: {},
    AccessState: {
        EARLY_ACCESS: 'EARLY_ACCESS', TRIAL_ACTIVE: 'TRIAL_ACTIVE',
        TRIAL_EXPIRED: 'TRIAL_EXPIRED', ACTIVE_PAID: 'ACTIVE_PAID',
        GRACE_PERIOD: 'GRACE_PERIOD', SUSPENDED: 'SUSPENDED', CLOSED: 'CLOSED',
    },
    MarketplaceLifecycleStatus: { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' },
    MarketplaceCredentialStatus: {
        VALIDATING: 'VALIDATING', VALID: 'VALID', INVALID: 'INVALID',
        NEEDS_RECONNECT: 'NEEDS_RECONNECT', UNKNOWN: 'UNKNOWN',
    },
    SyncRunStatus: {
        QUEUED: 'QUEUED', IN_PROGRESS: 'IN_PROGRESS',
        SUCCESS: 'SUCCESS', PARTIAL_SUCCESS: 'PARTIAL_SUCCESS',
        FAILED: 'FAILED', BLOCKED: 'BLOCKED', CANCELLED: 'CANCELLED',
    },
    SyncTriggerType: { MANUAL: 'MANUAL', SCHEDULED: 'SCHEDULED', RETRY: 'RETRY' },
    SyncTriggerScope: { ACCOUNT: 'ACCOUNT', TENANT_FULL: 'TENANT_FULL' },
    SyncRunItemStatus: {
        SUCCESS: 'SUCCESS', FAILED: 'FAILED', SKIPPED: 'SKIPPED',
        CONFLICT: 'CONFLICT', BLOCKED: 'BLOCKED',
    },
    SyncRunItemType: { STOCK: 'STOCK', ORDER: 'ORDER', PRODUCT: 'PRODUCT', WAREHOUSE: 'WAREHOUSE' },
    SyncRunItemStage: {
        PREFLIGHT: 'PREFLIGHT', PULL: 'PULL', TRANSFORM: 'TRANSFORM',
        APPLY: 'APPLY', PUSH: 'PUSH',
    },
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
        blockedReason: null,
        idempotencyKey: null,
        ...overrides,
    };
}

function makePrismaForWorker() {
    const updates: any[] = [];
    return {
        syncRun: {
            findUnique: jest.fn(),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            update: jest.fn().mockImplementation(async (args: any) => {
                updates.push(args);
                return { ...makeRun(), ...args.data };
            }),
        },
        _updates: updates,
    } as any;
}

function makePrismaForApi() {
    return {
        marketplaceAccount: { findFirst: jest.fn() },
        syncRun: {
            findUnique: jest.fn(),
            findFirst: jest.fn(),
            findMany: jest.fn(),
            count: jest.fn(),
            create: jest.fn(),
        },
    } as any;
}

function makePreflight(decision?: any) {
    return {
        runPreflight: jest.fn().mockResolvedValue(
            decision ?? { allowed: true, tenantAccessState: 'ACTIVE_PAID' },
        ),
    } as any;
}

function makeDiagnosticsMock() {
    return {
        recordItem: jest.fn().mockResolvedValue({ id: 'i' }),
        recordConflict: jest.fn().mockResolvedValue({ id: 'c' }),
        incrementProcessed: jest.fn(),
        incrementErrors: jest.fn(),
    } as any;
}

function makeAccountsMock() {
    return { reportSyncRun: jest.fn().mockResolvedValue({}) } as any;
}

async function buildWorker(prisma: any, opts: any = {}) {
    const ref = await Test.createTestingModule({
        providers: [
            SyncRunWorker,
            { provide: PrismaService, useValue: prisma },
            { provide: SyncPreflightService, useValue: opts.preflight ?? makePreflight() },
            { provide: SyncDiagnosticsService, useValue: opts.diagnostics ?? makeDiagnosticsMock() },
            { provide: MarketplaceAccountsService, useValue: opts.accounts ?? makeAccountsMock() },
        ],
    })
        .setLogger(new Logger())
        .compile();
    return ref.get(SyncRunWorker);
}

async function buildApi(prisma: any, preflight?: any) {
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

// ──────────────────────────────────────────────────────────────────────
// §16.1 Успешный manual sync
// ──────────────────────────────────────────────────────────────────────

describe('§16.1 Успешный manual sync', () => {
    test('manual run проходит admission → QUEUED, worker → SUCCESS, reportSyncRun(ok=true)', async () => {
        // Admission
        const apiPrisma = makePrismaForApi();
        apiPrisma.marketplaceAccount.findFirst.mockResolvedValue({ id: ACCOUNT });
        apiPrisma.syncRun.findUnique.mockResolvedValue(null);
        apiPrisma.syncRun.findFirst.mockResolvedValue(null);
        apiPrisma.syncRun.create.mockResolvedValue(makeRun({ status: 'QUEUED' }));
        const api = await buildApi(apiPrisma);
        const created = await api.createRun(TENANT, 'user-1', {
            accountId: ACCOUNT, syncTypes: ['PULL_STOCKS'] as any,
        });
        expect(created.status).toBe('QUEUED');

        // Worker pickup и SUCCESS
        const workerPrisma = makePrismaForWorker();
        workerPrisma.syncRun.findUnique.mockResolvedValue(makeRun({ status: 'QUEUED' }));
        const accounts = makeAccountsMock();
        const worker = await buildWorker(workerPrisma, { accounts });
        worker.registerRunner({
            syncType: 'PULL_STOCKS' as any, stage: 'PULL' as any,
            run: jest.fn().mockResolvedValue(adapterSuccess('PULL' as any, 100)),
        });
        await worker.processRun(RUN_ID);

        const finalStage = workerPrisma._updates[workerPrisma._updates.length - 1];
        expect(finalStage.data.status).toBe('SUCCESS');
        expect(finalStage.data.processedCount).toBe(100);
        expect(accounts.reportSyncRun).toHaveBeenCalledWith(
            TENANT, ACCOUNT, expect.objectContaining({ ok: true, partial: false }),
        );
    });
});

// ──────────────────────────────────────────────────────────────────────
// §16.2 Scheduled sync — purely lifecycle test (engine не различает trigger)
// ──────────────────────────────────────────────────────────────────────

describe('§16.2 Scheduled sync без ошибок', () => {
    test('SCHEDULED triggerType обрабатывается тем же engine, тот же результат', async () => {
        const prisma = makePrismaForWorker();
        prisma.syncRun.findUnique.mockResolvedValue(
            makeRun({ triggerType: 'SCHEDULED' }),
        );
        const worker = await buildWorker(prisma);
        worker.registerRunner({
            syncType: 'PULL_STOCKS' as any, stage: 'PULL' as any,
            run: jest.fn().mockResolvedValue(adapterSuccess('PULL' as any, 50)),
        });
        await worker.processRun(RUN_ID);
        const final = prisma._updates[prisma._updates.length - 1];
        expect(final.data.status).toBe('SUCCESS');
    });
});

// ──────────────────────────────────────────────────────────────────────
// §16.3 Частичный sync с partial_success
// ──────────────────────────────────────────────────────────────────────

describe('§16.3 PARTIAL_SUCCESS', () => {
    test('item failures → PARTIAL_SUCCESS, errorCount > 0, reportSyncRun(partial=true)', async () => {
        const prisma = makePrismaForWorker();
        prisma.syncRun.findUnique.mockResolvedValue(makeRun());
        const accounts = makeAccountsMock();
        const diagnostics = makeDiagnosticsMock();
        const worker = await buildWorker(prisma, { accounts, diagnostics });
        worker.registerRunner({
            syncType: 'PULL_STOCKS' as any, stage: 'PULL' as any,
            run: jest.fn().mockResolvedValue(adapterPartial('PULL' as any, 90, {
                itemFailures: [
                    { itemType: 'STOCK' as any, itemKey: 'sku-1', error: { code: 'TIMEOUT' } },
                    { itemType: 'STOCK' as any, itemKey: 'sku-2', error: { code: 'TIMEOUT' } },
                ],
            })),
        });
        await worker.processRun(RUN_ID);
        const final = prisma._updates[prisma._updates.length - 1];
        expect(final.data.status).toBe('PARTIAL_SUCCESS');
        expect(final.data.processedCount).toBe(90);
        expect(final.data.errorCount).toBe(2);
        expect(diagnostics.recordItem).toHaveBeenCalledTimes(2);
        expect(accounts.reportSyncRun).toHaveBeenCalledWith(
            TENANT, ACCOUNT, expect.objectContaining({ partial: true }),
        );
    });
});

// ──────────────────────────────────────────────────────────────────────
// §16.4 Retry после временной ошибки
// ──────────────────────────────────────────────────────────────────────

describe('§16.4 Retry после временной ошибки', () => {
    test('TECHNICAL_FAILURE при attempt=1 → FAILED + nextAttemptAt (retry-eligible)', async () => {
        const prisma = makePrismaForWorker();
        prisma.syncRun.findUnique.mockResolvedValue(makeRun({ attemptNumber: 1, maxAttempts: 3 }));
        const worker = await buildWorker(prisma);
        worker.registerRunner({
            syncType: 'PULL_STOCKS' as any, stage: 'PULL' as any,
            run: jest.fn().mockResolvedValue({
                outcome: 'TECHNICAL_FAILURE', stage: 'PULL', processedCount: 0,
                errorCode: 'EXTERNAL_TIMEOUT', errorMessage: 'timeout',
            }),
        });
        await worker.processRun(RUN_ID);
        const final = prisma._updates[prisma._updates.length - 1];
        expect(final.data.status).toBe('FAILED');
        expect(final.data.nextAttemptAt).toBeInstanceOf(Date);
        expect(final.data.errorCode).toBe('EXTERNAL_TIMEOUT');
    });

    test('manual retry от FAILED создаёт новый run с attempt=2 и originRunId', async () => {
        const apiPrisma = makePrismaForApi();
        const origin = makeRun({ status: 'FAILED', attemptNumber: 1, maxAttempts: 3 });
        apiPrisma.syncRun.findFirst
            .mockResolvedValueOnce(origin) // origin lookup
            .mockResolvedValueOnce(null);  // concurrency check
        apiPrisma.syncRun.create.mockResolvedValue(makeRun({
            id: 'r2', triggerType: 'RETRY', originRunId: RUN_ID,
            attemptNumber: 2, maxAttempts: 3,
        }));
        const api = await buildApi(apiPrisma);
        const retry = await api.retryRun(TENANT, RUN_ID, 'user-1');
        expect(retry.triggerType).toBe('RETRY');
        expect(retry.originRunId).toBe(RUN_ID);
        expect(retry.attemptNumber).toBe(2);
    });
});

// ──────────────────────────────────────────────────────────────────────
// §16.5 Rate-limit сценарий
// ──────────────────────────────────────────────────────────────────────

describe('§16.5 Rate-limit', () => {
    test('429 → RATE_LIMIT outcome → удвоенный backoff', async () => {
        const prisma = makePrismaForWorker();
        prisma.syncRun.findUnique.mockResolvedValue(makeRun({ attemptNumber: 1, maxAttempts: 3 }));
        const worker = await buildWorker(prisma);
        worker.registerRunner({
            syncType: 'PULL_STOCKS' as any, stage: 'PULL' as any,
            run: jest.fn().mockResolvedValue({
                outcome: 'RATE_LIMIT', stage: 'PULL', processedCount: 0,
                errorCode: 'EXTERNAL_RATE_LIMIT',
            }),
        });
        const before = Date.now();
        await worker.processRun(RUN_ID);
        const final = prisma._updates[prisma._updates.length - 1];
        // base 30s * 2 = 60s минимум
        const lag = final.data.nextAttemptAt.getTime() - before;
        expect(lag).toBeGreaterThan(50_000);
    });

    test('classifyHttpError(429) → outcome=RATE_LIMIT, errorCode=EXTERNAL_RATE_LIMIT', () => {
        const r = classifyHttpError('PULL' as any, { response: { status: 429 }, message: 'too many' });
        expect(r.outcome).toBe('RATE_LIMIT');
        expect(r.errorCode).toBe('EXTERNAL_RATE_LIMIT');
    });
});

// ──────────────────────────────────────────────────────────────────────
// §16.6 Duplicate external event (idempotency через jobKey)
// ──────────────────────────────────────────────────────────────────────

describe('§16.6 Duplicate external event / idempotency', () => {
    test('одинаковый idempotencyKey → возвращается существующий run без второго create', async () => {
        const prisma = makePrismaForApi();
        prisma.marketplaceAccount.findFirst.mockResolvedValue({ id: ACCOUNT });
        const existing = makeRun({ id: 'existing-run' });
        prisma.syncRun.findUnique.mockResolvedValue(existing);
        const api = await buildApi(prisma);
        const r = await api.createRun(TENANT, 'u', {
            accountId: ACCOUNT, syncTypes: ['PULL_STOCKS'] as any,
            idempotencyKey: 'dup-key',
        });
        expect(r.id).toBe('existing-run');
        expect(prisma.syncRun.create).not.toHaveBeenCalled();
    });

    test('P2002 race на create → не падает, возвращается уже созданный run', async () => {
        const prisma = makePrismaForApi();
        prisma.marketplaceAccount.findFirst.mockResolvedValue({ id: ACCOUNT });
        prisma.syncRun.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(makeRun({ id: 'race-resolved' }));
        prisma.syncRun.findFirst.mockResolvedValue(null);
        prisma.syncRun.create.mockRejectedValue({ code: 'P2002' });
        const api = await buildApi(prisma);
        const r = await api.createRun(TENANT, 'u', {
            accountId: ACCOUNT, syncTypes: ['PULL_STOCKS'] as any,
        });
        expect(r.id).toBe('race-resolved');
    });
});

// ──────────────────────────────────────────────────────────────────────
// §16.7 Конфликт после ручной inventory корректировки
// ──────────────────────────────────────────────────────────────────────

describe('§16.7 Конфликт inventory mismatch', () => {
    test('adapter возвращает conflict → recordConflict + run PARTIAL_SUCCESS', async () => {
        const prisma = makePrismaForWorker();
        prisma.syncRun.findUnique.mockResolvedValue(makeRun());
        const diagnostics = makeDiagnosticsMock();
        const worker = await buildWorker(prisma, { diagnostics });
        worker.registerRunner({
            syncType: 'PULL_STOCKS' as any, stage: 'PULL' as any,
            run: jest.fn().mockResolvedValue(adapterPartial('PULL' as any, 50, {
                conflicts: [{
                    entityType: 'stock', entityId: 'sku-1',
                    conflictType: 'INVENTORY_MISMATCH',
                    payload: { expected: 5, actual: 3 },
                }],
            })),
        });
        await worker.processRun(RUN_ID);
        expect(diagnostics.recordConflict).toHaveBeenCalledTimes(1);
        const final = prisma._updates[prisma._updates.length - 1];
        expect(final.data.status).toBe('PARTIAL_SUCCESS');
    });
});

// ──────────────────────────────────────────────────────────────────────
// §16.8-10 Tenant access state блокировки
// ──────────────────────────────────────────────────────────────────────

describe('§16.8 TRIAL_EXPIRED блокирует, но история сохраняется', () => {
    test('admission в TRIAL_EXPIRED → BLOCKED run в истории, не 403', async () => {
        const prisma = makePrismaForApi();
        prisma.marketplaceAccount.findFirst.mockResolvedValue({ id: ACCOUNT });
        prisma.syncRun.findUnique.mockResolvedValue(null);
        prisma.syncRun.create.mockResolvedValue(makeRun({
            status: 'BLOCKED', blockedReason: 'TENANT_TRIAL_EXPIRED',
        }));
        const preflight = makePreflight({
            allowed: false,
            reason: SyncBlockedReason.TENANT_TRIAL_EXPIRED,
            eventName: SyncRunEventNames.BLOCKED_BY_TENANT_STATE,
            tenantAccessState: 'TRIAL_EXPIRED',
        });
        const api = await buildApi(prisma, preflight);
        const r = await api.createRun(TENANT, 'u', {
            accountId: ACCOUNT, syncTypes: ['PULL_STOCKS'] as any,
        });
        expect(r.status).toBe('BLOCKED');
        expect(r.blockedReason).toBe('TENANT_TRIAL_EXPIRED');
        // Запись создана с finishedAt — terminal в моменте создания.
        const data = prisma.syncRun.create.mock.calls[0][0].data;
        expect(data.startedAt).toBeInstanceOf(Date);
        expect(data.finishedAt).toBeInstanceOf(Date);
    });
});

describe('§16.9 SUSPENDED/CLOSED блокируют любые внешние этапы', () => {
    test('SUSPENDED admission → BLOCKED', async () => {
        const prisma = makePrismaForApi();
        prisma.marketplaceAccount.findFirst.mockResolvedValue({ id: ACCOUNT });
        prisma.syncRun.findUnique.mockResolvedValue(null);
        prisma.syncRun.create.mockResolvedValue(makeRun({
            status: 'BLOCKED', blockedReason: 'TENANT_SUSPENDED',
        }));
        const preflight = makePreflight({
            allowed: false, reason: SyncBlockedReason.TENANT_SUSPENDED,
            eventName: SyncRunEventNames.BLOCKED_BY_TENANT_STATE,
            tenantAccessState: 'SUSPENDED',
        });
        const api = await buildApi(prisma, preflight);
        const r = await api.createRun(TENANT, 'u', {
            accountId: ACCOUNT, syncTypes: ['PULL_STOCKS'] as any,
        });
        expect(r.blockedReason).toBe('TENANT_SUSPENDED');
    });

    test('CLOSED admission → BLOCKED', async () => {
        const prisma = makePrismaForApi();
        prisma.marketplaceAccount.findFirst.mockResolvedValue({ id: ACCOUNT });
        prisma.syncRun.findUnique.mockResolvedValue(null);
        prisma.syncRun.create.mockResolvedValue(makeRun({
            status: 'BLOCKED', blockedReason: 'TENANT_CLOSED',
        }));
        const preflight = makePreflight({
            allowed: false, reason: SyncBlockedReason.TENANT_CLOSED,
            eventName: SyncRunEventNames.BLOCKED_BY_TENANT_STATE,
            tenantAccessState: 'CLOSED',
        });
        const api = await buildApi(prisma, preflight);
        const r = await api.createRun(TENANT, 'u', {
            accountId: ACCOUNT, syncTypes: ['PULL_STOCKS'] as any,
        });
        expect(r.blockedReason).toBe('TENANT_CLOSED');
    });

    test('runtime preflight отказывает (tenant state changed mid-flight) → run BLOCKED', async () => {
        const prisma = makePrismaForWorker();
        prisma.syncRun.findUnique.mockResolvedValue(makeRun());
        const preflight = makePreflight({
            allowed: false, reason: SyncBlockedReason.TENANT_SUSPENDED,
            eventName: SyncRunEventNames.BLOCKED_BY_TENANT_STATE,
            tenantAccessState: 'SUSPENDED',
        });
        const runner = {
            syncType: 'PULL_STOCKS' as any, stage: 'PULL' as any,
            run: jest.fn(),
        };
        const worker = await buildWorker(prisma, { preflight });
        worker.registerRunner(runner);
        await worker.processRun(RUN_ID);
        // runner НЕ вызывается — preflight отрезал ДО stages.
        expect(runner.run).not.toHaveBeenCalled();
        const final = prisma._updates[prisma._updates.length - 1];
        expect(final.data.status).toBe('BLOCKED');
        expect(final.data.blockedReason).toBe('TENANT_SUSPENDED');
    });
});

describe('§16.10 failed preflight → BLOCKED, не FAILED', () => {
    test('CREDENTIALS_INVALID на preflight → BLOCKED, blockedReason=CREDENTIALS_INVALID', async () => {
        const prisma = makePrismaForApi();
        prisma.marketplaceAccount.findFirst.mockResolvedValue({ id: ACCOUNT });
        prisma.syncRun.findUnique.mockResolvedValue(null);
        prisma.syncRun.create.mockResolvedValue(makeRun({
            status: 'BLOCKED', blockedReason: 'CREDENTIALS_INVALID',
        }));
        const preflight = makePreflight({
            allowed: false, reason: SyncBlockedReason.CREDENTIALS_INVALID,
            eventName: SyncRunEventNames.BLOCKED_BY_CREDENTIALS,
            tenantAccessState: 'ACTIVE_PAID',
        });
        const api = await buildApi(prisma, preflight);
        const r = await api.createRun(TENANT, 'u', {
            accountId: ACCOUNT, syncTypes: ['PULL_STOCKS'] as any,
        });
        // §20 invariant: blocked ≠ failed.
        expect(r.status).toBe('BLOCKED');
        expect(r.status).not.toBe('FAILED');
        expect(r.blockedReason).toBe('CREDENTIALS_INVALID');
    });
});

// ──────────────────────────────────────────────────────────────────────
// §16.11 Success items не создают item-level трассу (MVP §8 invariant)
// ──────────────────────────────────────────────────────────────────────

describe('§16.11 Success path хранится только агрегатами', () => {
    test('SUCCESS run без item failures → 0 SyncRunItem create вызовов', async () => {
        const prisma = makePrismaForWorker();
        prisma.syncRun.findUnique.mockResolvedValue(makeRun());
        const diagnostics = makeDiagnosticsMock();
        const worker = await buildWorker(prisma, { diagnostics });
        worker.registerRunner({
            syncType: 'PULL_STOCKS' as any, stage: 'PULL' as any,
            run: jest.fn().mockResolvedValue(adapterSuccess('PULL' as any, 100)),
        });
        await worker.processRun(RUN_ID);
        // Главный invariant §8.
        expect(diagnostics.recordItem).not.toHaveBeenCalled();
        expect(diagnostics.recordConflict).not.toHaveBeenCalled();
        // Aggregated в run.
        const final = prisma._updates[prisma._updates.length - 1];
        expect(final.data.processedCount).toBe(100);
        expect(final.data.status).toBe('SUCCESS');
    });

    test('diagnostics service отвергает SUCCESS item на write API', async () => {
        // Защита от writer'а, который попробует записать success — service-level invariant.
        const prisma: any = {
            syncRun: { findUnique: jest.fn().mockResolvedValue({ id: RUN_ID, tenantId: TENANT }) },
            syncRunItem: { create: jest.fn() },
        };
        const ref = await Test.createTestingModule({
            providers: [SyncDiagnosticsService, { provide: PrismaService, useValue: prisma }],
        }).setLogger(new Logger()).compile();
        const svc = ref.get(SyncDiagnosticsService);
        await expect(svc.recordItem({
            runId: RUN_ID, itemType: 'STOCK' as any, itemKey: 'k',
            stage: 'PUSH' as any, status: 'SUCCESS' as any,
        })).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.syncRunItem.create).not.toHaveBeenCalled();
    });
});

// ──────────────────────────────────────────────────────────────────────
// OBSERVABILITY: каноничные event names и machine codes
// ──────────────────────────────────────────────────────────────────────

describe('OBSERVABILITY: каноничные event names', () => {
    test('SyncRunEventNames содержит все 14 канонических имён', () => {
        const expected = [
            'QUEUED', 'STARTED', 'FINISHED', 'CANCELLED',
            'BLOCKED_BY_TENANT_STATE', 'BLOCKED_BY_ACCOUNT_STATE',
            'BLOCKED_BY_CONCURRENCY', 'BLOCKED_BY_CREDENTIALS',
            'RETRY_SCHEDULED', 'RETRY_EXHAUSTED',
            'STAGE_STARTED', 'STAGE_FINISHED',
            'EXTERNAL_RATE_LIMIT', 'EXTERNAL_ERROR',
            'CONFLICT_DETECTED',
        ];
        for (const k of expected) {
            expect(SyncRunEventNames).toHaveProperty(k);
        }
        // Каждое значение начинается с `sync_run_` или `sync_conflict_` —
        // grep'абельный namespace.
        for (const v of Object.values(SyncRunEventNames)) {
            expect(v).toMatch(/^sync_(run|conflict)_/);
        }
    });

    test('SyncBlockedReason содержит все 7 машинных кодов из §10', () => {
        const expected = [
            'TENANT_TRIAL_EXPIRED', 'TENANT_SUSPENDED', 'TENANT_CLOSED',
            'ACCOUNT_INACTIVE',
            'CREDENTIALS_INVALID', 'CREDENTIALS_NEEDS_RECONNECT',
            'CONCURRENCY_GUARD',
        ];
        for (const k of expected) {
            expect(SyncBlockedReason).toHaveProperty(k);
        }
    });

    test('isActiveSyncRunStatus / isTerminalSyncRunStatus покрывают все статусы', () => {
        expect(isActiveSyncRunStatus('QUEUED' as any)).toBe(true);
        expect(isActiveSyncRunStatus('IN_PROGRESS' as any)).toBe(true);
        expect(isActiveSyncRunStatus('SUCCESS' as any)).toBe(false);

        expect(isTerminalSyncRunStatus('SUCCESS' as any)).toBe(true);
        expect(isTerminalSyncRunStatus('PARTIAL_SUCCESS' as any)).toBe(true);
        expect(isTerminalSyncRunStatus('FAILED' as any)).toBe(true);
        expect(isTerminalSyncRunStatus('BLOCKED' as any)).toBe(true);
        expect(isTerminalSyncRunStatus('CANCELLED' as any)).toBe(true);
        expect(isTerminalSyncRunStatus('QUEUED' as any)).toBe(false);
    });

    test('SyncTypes — 5 канонических значений (FULL_SYNC включён)', () => {
        expect(SyncTypes.PULL_STOCKS).toBe('PULL_STOCKS');
        expect(SyncTypes.PUSH_STOCKS).toBe('PUSH_STOCKS');
        expect(SyncTypes.PULL_ORDERS).toBe('PULL_ORDERS');
        expect(SyncTypes.PULL_METADATA).toBe('PULL_METADATA');
        expect(SyncTypes.FULL_SYNC).toBe('FULL_SYNC');
    });
});

describe('OBSERVABILITY: блок vs ошибка не смешиваются (§20 invariant)', () => {
    test('AUTH_FAILURE → status FAILED (не BLOCKED), nextAttemptAt=null', async () => {
        const prisma = makePrismaForWorker();
        prisma.syncRun.findUnique.mockResolvedValue(makeRun({ attemptNumber: 1, maxAttempts: 3 }));
        const worker = await buildWorker(prisma);
        worker.registerRunner({
            syncType: 'PULL_STOCKS' as any, stage: 'PULL' as any,
            run: jest.fn().mockResolvedValue({
                outcome: 'AUTH_FAILURE', stage: 'PULL', processedCount: 0,
                errorCode: 'EXTERNAL_AUTH_FAILED',
            }),
        });
        await worker.processRun(RUN_ID);
        const final = prisma._updates[prisma._updates.length - 1];
        // Ошибка адаптера ≠ политическая блокировка.
        expect(final.data.status).toBe('FAILED');
        expect(final.data.status).not.toBe('BLOCKED');
        expect(final.data.nextAttemptAt).toBeNull();
    });

    test('TENANT_SUSPENDED preflight → status BLOCKED (не FAILED)', async () => {
        const prisma = makePrismaForWorker();
        prisma.syncRun.findUnique.mockResolvedValue(makeRun());
        const preflight = makePreflight({
            allowed: false, reason: SyncBlockedReason.TENANT_SUSPENDED,
            eventName: SyncRunEventNames.BLOCKED_BY_TENANT_STATE,
            tenantAccessState: 'SUSPENDED',
        });
        const worker = await buildWorker(prisma, { preflight });
        worker.registerRunner({
            syncType: 'PULL_STOCKS' as any, stage: 'PULL' as any,
            run: jest.fn(),
        });
        await worker.processRun(RUN_ID);
        const final = prisma._updates[prisma._updates.length - 1];
        expect(final.data.status).toBe('BLOCKED');
        expect(final.data.status).not.toBe('FAILED');
    });
});
