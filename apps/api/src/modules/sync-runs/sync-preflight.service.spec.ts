import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { SyncPreflightService } from './sync-preflight.service';
import { PrismaService } from '../../prisma/prisma.service';

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
}));

const TENANT = 't1';
const ACCOUNT = 'acc-1';

function makePrisma() {
    return {
        tenant: { findUnique: jest.fn() },
        marketplaceAccount: { findFirst: jest.fn() },
        syncRun: { findFirst: jest.fn() },
    };
}

async function build(prisma: any) {
    const ref = await Test.createTestingModule({
        providers: [SyncPreflightService, { provide: PrismaService, useValue: prisma }],
    })
        .setLogger(new Logger())
        .compile();
    return ref.get(SyncPreflightService);
}

describe('SyncPreflightService.runPreflight', () => {
    test('happy path для ACTIVE_PAID + ACTIVE account + VALID creds', async () => {
        const prisma = makePrisma();
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'ACTIVE_PAID' });
        prisma.marketplaceAccount.findFirst.mockResolvedValue({
            id: ACCOUNT,
            lifecycleStatus: 'ACTIVE',
            credentialStatus: 'VALID',
        });
        prisma.syncRun.findFirst.mockResolvedValue(null);

        const svc = await build(prisma);
        const r = await svc.runPreflight(TENANT, ACCOUNT, { operation: 'test' });
        expect(r.allowed).toBe(true);
    });

    test('TRIAL_EXPIRED → reason TENANT_TRIAL_EXPIRED', async () => {
        const prisma = makePrisma();
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'TRIAL_EXPIRED' });
        const svc = await build(prisma);
        const r = await svc.runPreflight(TENANT, ACCOUNT, { operation: 'test' });
        expect(r.allowed).toBe(false);
        expect((r as any).reason).toBe('TENANT_TRIAL_EXPIRED');
        expect((r as any).eventName).toBe('sync_run_blocked_by_tenant_state');
    });

    test('SUSPENDED → TENANT_SUSPENDED', async () => {
        const prisma = makePrisma();
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'SUSPENDED' });
        const svc = await build(prisma);
        const r = await svc.runPreflight(TENANT, ACCOUNT, { operation: 'test' });
        expect((r as any).reason).toBe('TENANT_SUSPENDED');
    });

    test('CLOSED → TENANT_CLOSED', async () => {
        const prisma = makePrisma();
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'CLOSED' });
        const svc = await build(prisma);
        const r = await svc.runPreflight(TENANT, ACCOUNT, { operation: 'test' });
        expect((r as any).reason).toBe('TENANT_CLOSED');
    });

    test('tenant не найден → TENANT_CLOSED (consistent fail-closed)', async () => {
        const prisma = makePrisma();
        prisma.tenant.findUnique.mockResolvedValue(null);
        const svc = await build(prisma);
        const r = await svc.runPreflight(TENANT, ACCOUNT, { operation: 'test' });
        expect(r.allowed).toBe(false);
        expect((r as any).reason).toBe('TENANT_CLOSED');
    });

    test('account INACTIVE → ACCOUNT_INACTIVE', async () => {
        const prisma = makePrisma();
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'ACTIVE_PAID' });
        prisma.marketplaceAccount.findFirst.mockResolvedValue({
            id: ACCOUNT,
            lifecycleStatus: 'INACTIVE',
            credentialStatus: 'VALID',
        });
        const svc = await build(prisma);
        const r = await svc.runPreflight(TENANT, ACCOUNT, { operation: 'test' });
        expect((r as any).reason).toBe('ACCOUNT_INACTIVE');
    });

    test('account не найден → ACCOUNT_INACTIVE', async () => {
        const prisma = makePrisma();
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'ACTIVE_PAID' });
        prisma.marketplaceAccount.findFirst.mockResolvedValue(null);
        const svc = await build(prisma);
        const r = await svc.runPreflight(TENANT, ACCOUNT, { operation: 'test' });
        expect((r as any).reason).toBe('ACCOUNT_INACTIVE');
    });

    test('credentials INVALID → CREDENTIALS_INVALID', async () => {
        const prisma = makePrisma();
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'ACTIVE_PAID' });
        prisma.marketplaceAccount.findFirst.mockResolvedValue({
            id: ACCOUNT,
            lifecycleStatus: 'ACTIVE',
            credentialStatus: 'INVALID',
        });
        const svc = await build(prisma);
        const r = await svc.runPreflight(TENANT, ACCOUNT, { operation: 'test' });
        expect((r as any).reason).toBe('CREDENTIALS_INVALID');
    });

    test('credentials NEEDS_RECONNECT → CREDENTIALS_NEEDS_RECONNECT', async () => {
        const prisma = makePrisma();
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'ACTIVE_PAID' });
        prisma.marketplaceAccount.findFirst.mockResolvedValue({
            id: ACCOUNT,
            lifecycleStatus: 'ACTIVE',
            credentialStatus: 'NEEDS_RECONNECT',
        });
        const svc = await build(prisma);
        const r = await svc.runPreflight(TENANT, ACCOUNT, { operation: 'test' });
        expect((r as any).reason).toBe('CREDENTIALS_NEEDS_RECONNECT');
    });

    test('UNKNOWN/VALIDATING credentials НЕ блокируют (worker сам ре-валидирует)', async () => {
        const prisma = makePrisma();
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'ACTIVE_PAID' });
        prisma.marketplaceAccount.findFirst.mockResolvedValue({
            id: ACCOUNT,
            lifecycleStatus: 'ACTIVE',
            credentialStatus: 'UNKNOWN',
        });
        prisma.syncRun.findFirst.mockResolvedValue(null);
        const svc = await build(prisma);
        const r = await svc.runPreflight(TENANT, ACCOUNT, { operation: 'test' });
        expect(r.allowed).toBe(true);
    });

    test('активный run на account → CONCURRENCY_GUARD с conflictingRunId', async () => {
        const prisma = makePrisma();
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'ACTIVE_PAID' });
        prisma.marketplaceAccount.findFirst.mockResolvedValue({
            id: ACCOUNT,
            lifecycleStatus: 'ACTIVE',
            credentialStatus: 'VALID',
        });
        prisma.syncRun.findFirst.mockResolvedValue({ id: 'live-1' });
        const svc = await build(prisma);
        const r = await svc.runPreflight(TENANT, ACCOUNT, { operation: 'test' });
        expect((r as any).reason).toBe('CONCURRENCY_GUARD');
        expect((r as any).conflictingRunId).toBe('live-1');
    });

    test('checkConcurrency=false пропускает concurrency check (worker runtime)', async () => {
        const prisma = makePrisma();
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'ACTIVE_PAID' });
        prisma.marketplaceAccount.findFirst.mockResolvedValue({
            id: ACCOUNT,
            lifecycleStatus: 'ACTIVE',
            credentialStatus: 'VALID',
        });
        const svc = await build(prisma);
        const r = await svc.runPreflight(TENANT, ACCOUNT, {
            operation: 'worker_stage',
            checkConcurrency: false,
        });
        expect(r.allowed).toBe(true);
        // syncRun.findFirst НЕ должен вызываться при отключённом concurrency
        expect(prisma.syncRun.findFirst).not.toHaveBeenCalled();
    });

    test('accountId=null — проверяется только tenant state', async () => {
        const prisma = makePrisma();
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'ACTIVE_PAID' });
        const svc = await build(prisma);
        const r = await svc.runPreflight(TENANT, null, { operation: 'tenant_full' });
        expect(r.allowed).toBe(true);
        expect(prisma.marketplaceAccount.findFirst).not.toHaveBeenCalled();
    });

    test('accountId=null + paused tenant → blocked', async () => {
        const prisma = makePrisma();
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'SUSPENDED' });
        const svc = await build(prisma);
        const r = await svc.runPreflight(TENANT, null, { operation: 'tenant_full' });
        expect((r as any).reason).toBe('TENANT_SUSPENDED');
    });
});
