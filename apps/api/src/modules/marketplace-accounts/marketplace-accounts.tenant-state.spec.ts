/**
 * TASK_MARKETPLACE_ACCOUNTS_5 — tenant-state guards и single-active policy.
 *
 * Покрывает §10 system-analytics:
 *   TRIAL_EXPIRED:
 *     - блок: validate / reactivate / credentials update / create / sync run
 *     - allow: PATCH label, deactivate
 *   SUSPENDED / CLOSED:
 *     - read-only diagnostic mode: все write блокируются.
 *
 * Также проверяет, что single-active rule соблюдается через DB partial UNIQUE
 * + application pre-check + P2002 catch.
 */
import { Test } from '@nestjs/testing';
import { Logger, ForbiddenException, ConflictException, NotFoundException } from '@nestjs/common';
import { MarketplaceAccountsService } from './marketplace-accounts.service';
import { CredentialsCipher } from './credentials-cipher.service';
import { CredentialValidator } from './credential-validator.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@prisma/client', () => {
    class PrismaClient {}
    return {
        PrismaClient,
        Prisma: { sql: function () { return { _sql: true }; } },
        MarketplaceType: { WB: 'WB', OZON: 'OZON' },
        MarketplaceLifecycleStatus: { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' },
        MarketplaceCredentialStatus: {
            VALIDATING: 'VALIDATING', VALID: 'VALID', INVALID: 'INVALID',
            NEEDS_RECONNECT: 'NEEDS_RECONNECT', UNKNOWN: 'UNKNOWN',
        },
        MarketplaceSyncHealthStatus: {
            HEALTHY: 'HEALTHY', DEGRADED: 'DEGRADED', PAUSED: 'PAUSED',
            ERROR: 'ERROR', UNKNOWN: 'UNKNOWN',
        },
        MarketplaceLastSyncStatus: {
            SUCCESS: 'SUCCESS', PARTIAL_SUCCESS: 'PARTIAL_SUCCESS', FAILED: 'FAILED',
        },
        AccessState: {
            EARLY_ACCESS: 'EARLY_ACCESS', TRIAL_ACTIVE: 'TRIAL_ACTIVE',
            TRIAL_EXPIRED: 'TRIAL_EXPIRED', ACTIVE_PAID: 'ACTIVE_PAID',
            GRACE_PERIOD: 'GRACE_PERIOD', SUSPENDED: 'SUSPENDED', CLOSED: 'CLOSED',
        },
    };
});

const TENANT = 't1';
const ACCOUNT = 'acc-1';
const ACTOR = 'user-42';

const VALID_WB = { apiToken: 'wb-token-1234567890', warehouseId: '1001' };

function makePrismaMock() {
    const prisma: any = {
        tenant: { findUnique: jest.fn() },
        marketplaceAccount: {
            findFirst: jest.fn(),
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn(),
            update: jest.fn(),
        },
        marketplaceCredential: {
            create: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
        },
        marketplaceAccountEvent: {
            create: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([]),
        },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    return prisma;
}

async function build(prisma: any) {
    const moduleRef = await Test.createTestingModule({
        providers: [
            MarketplaceAccountsService,
            CredentialsCipher,
            { provide: CredentialValidator, useValue: { validate: jest.fn().mockResolvedValue({ ok: true }) } },
            { provide: PrismaService, useValue: prisma },
        ],
    }).setLogger(new Logger()).compile();
    return moduleRef.get(MarketplaceAccountsService);
}

function makeAccountWithCredential(cipher: CredentialsCipher, overrides: any = {}) {
    const encrypted = cipher.encrypt(VALID_WB);
    return {
        id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', label: 'WB Main',
        lifecycleStatus: 'ACTIVE', credentialStatus: 'VALID',
        credential: {
            accountId: ACCOUNT,
            encryptedPayload: encrypted,
            encryptionKeyVersion: 1,
            schemaVersion: 1,
            maskedPreview: { apiToken: '***7890', warehouseId: '1001' },
            rotatedAt: null,
        },
        ...overrides,
    };
}

// ============================================================================
// TRIAL_EXPIRED — внешние API actions блокируются, внутренние — разрешены
// ============================================================================

describe('§10 TRIAL_EXPIRED — внешние API actions блокируются', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: MarketplaceAccountsService;
    let cipher: CredentialsCipher;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
        cipher = new CredentialsCipher();
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'TRIAL_EXPIRED' });
    });

    it('create → 403 ACCOUNT_ACTION_BLOCKED_BY_TENANT_STATE с action=create', async () => {
        await expect(
            svc.create(TENANT, { marketplace: 'WB', label: 'X', credentials: VALID_WB }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({
                code: 'ACCOUNT_ACTION_BLOCKED_BY_TENANT_STATE',
                action: 'create',
                accessState: 'TRIAL_EXPIRED',
            }),
        });
        expect(prisma.marketplaceAccount.create).not.toHaveBeenCalled();
    });

    it('validate → 403 + PAUSED_BY_TENANT_STATE event записан, без external API', async () => {
        const validator = { validate: jest.fn() };
        const moduleRef = await Test.createTestingModule({
            providers: [
                MarketplaceAccountsService,
                CredentialsCipher,
                { provide: CredentialValidator, useValue: validator },
                { provide: PrismaService, useValue: prisma },
            ],
        }).setLogger(new Logger()).compile();
        const localSvc = moduleRef.get(MarketplaceAccountsService);

        await expect(localSvc.validate(TENANT, ACCOUNT)).rejects.toBeInstanceOf(ForbiddenException);

        // validator не должен быть вызван — guard сработал до decrypt+API.
        expect(validator.validate).not.toHaveBeenCalled();
        // PAUSED_BY_TENANT_STATE event записан в audit chain.
        expect(prisma.marketplaceAccountEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    eventType: 'marketplace_account_paused_by_tenant_state',
                    payload: expect.objectContaining({ action: 'validate', accessState: 'TRIAL_EXPIRED' }),
                }),
            }),
        );
    });

    it('reactivate → 403 (триггерит re-validate, поэтому external)', async () => {
        await expect(svc.reactivate(TENANT, ACCOUNT, ACTOR)).rejects.toMatchObject({
            response: expect.objectContaining({ action: 'reactivate' }),
        });
    });

    it('update credentials → 403 (precursor к re-validate)', async () => {
        await expect(
            svc.update(TENANT, ACCOUNT, { credentials: { apiToken: 'new' } }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({ action: 'update_credentials' }),
        });
    });
});

describe('§10 TRIAL_EXPIRED — внутренние actions РАЗРЕШЕНЫ', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: MarketplaceAccountsService;
    let cipher: CredentialsCipher;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
        cipher = new CredentialsCipher();
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'TRIAL_EXPIRED' });
    });

    it('PATCH label (без credentials) → разрешён в TRIAL_EXPIRED', async () => {
        prisma.marketplaceAccount.findFirst
            .mockResolvedValueOnce(makeAccountWithCredential(cipher))
            .mockResolvedValue(null);
        prisma.marketplaceAccount.update.mockImplementation(async (args: any) => ({
            ...makeAccountWithCredential(cipher), ...args.data,
        }));

        const res = await svc.update(TENANT, ACCOUNT, { label: 'WB Renamed' });

        expect(res.label).toBe('WB Renamed');
        expect(prisma.marketplaceAccountEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ eventType: 'marketplace_account_label_updated' }),
            }),
        );
    });

    it('deactivate → разрешён в TRIAL_EXPIRED (внутреннее действие)', async () => {
        prisma.marketplaceAccount.findFirst.mockResolvedValue(
            makeAccountWithCredential(cipher, { lifecycleStatus: 'ACTIVE' }),
        );
        prisma.marketplaceAccount.update.mockImplementation(async (args: any) => ({
            ...makeAccountWithCredential(cipher), ...args.data,
        }));

        const res = await svc.deactivate(TENANT, ACCOUNT, ACTOR);

        expect(res.lifecycleStatus).toBe('INACTIVE');
        expect(prisma.marketplaceAccountEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ eventType: 'marketplace_account_deactivated' }),
            }),
        );
    });
});

// ============================================================================
// SUSPENDED / CLOSED — read-only diagnostic mode, все write блокируются
// ============================================================================

describe('§10 SUSPENDED/CLOSED — read-only mode, все write блокируются', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: MarketplaceAccountsService;
    let cipher: CredentialsCipher;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
        cipher = new CredentialsCipher();
    });

    it.each(['SUSPENDED', 'CLOSED'])(
        'create блокируется в %s',
        async (state) => {
            prisma.tenant.findUnique.mockResolvedValue({ accessState: state });
            await expect(
                svc.create(TENANT, { marketplace: 'WB', label: 'X', credentials: VALID_WB }),
            ).rejects.toBeInstanceOf(ForbiddenException);
        },
    );

    it.each(['SUSPENDED', 'CLOSED'])(
        'validate блокируется в %s',
        async (state) => {
            prisma.tenant.findUnique.mockResolvedValue({ accessState: state });
            await expect(svc.validate(TENANT, ACCOUNT)).rejects.toBeInstanceOf(ForbiddenException);
        },
    );

    it.each(['SUSPENDED', 'CLOSED'])(
        'reactivate блокируется в %s',
        async (state) => {
            prisma.tenant.findUnique.mockResolvedValue({ accessState: state });
            await expect(svc.reactivate(TENANT, ACCOUNT, ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
        },
    );

    it.each(['SUSPENDED', 'CLOSED'])(
        'update label блокируется в %s (read-only mode, отличается от TRIAL_EXPIRED)',
        async (state) => {
            prisma.tenant.findUnique.mockResolvedValue({ accessState: state });
            await expect(
                svc.update(TENANT, ACCOUNT, { label: 'X' }),
            ).rejects.toMatchObject({
                response: expect.objectContaining({
                    code: 'ACCOUNT_ACTION_BLOCKED_BY_TENANT_STATE',
                    action: 'update_label',
                    accessState: state,
                }),
            });
        },
    );

    it.each(['SUSPENDED', 'CLOSED'])(
        'update credentials блокируется в %s',
        async (state) => {
            prisma.tenant.findUnique.mockResolvedValue({ accessState: state });
            await expect(
                svc.update(TENANT, ACCOUNT, { credentials: { apiToken: 'new' } }),
            ).rejects.toBeInstanceOf(ForbiddenException);
        },
    );

    it.each(['SUSPENDED', 'CLOSED'])(
        'deactivate блокируется в %s (read-only mode)',
        async (state) => {
            prisma.tenant.findUnique.mockResolvedValue({ accessState: state });
            await expect(
                svc.deactivate(TENANT, ACCOUNT, ACTOR),
            ).rejects.toMatchObject({
                response: expect.objectContaining({
                    code: 'ACCOUNT_ACTION_BLOCKED_BY_TENANT_STATE',
                    action: 'deactivate',
                }),
            });
        },
    );

    it.each(['SUSPENDED', 'CLOSED', 'TRIAL_EXPIRED'])(
        'list / getById / diagnostics РАБОТАЮТ в %s (read-only diagnostic mode)',
        async (state) => {
            prisma.tenant.findUnique.mockResolvedValue({ accessState: state });
            prisma.marketplaceAccount.findMany.mockResolvedValue([]);
            prisma.marketplaceAccount.findFirst.mockResolvedValue(makeAccountWithCredential(cipher));

            // list
            await expect(svc.list(TENANT)).resolves.toBeDefined();
            // getById
            await expect(svc.getById(TENANT, ACCOUNT)).resolves.toBeDefined();
            // diagnostics
            await expect(svc.getDiagnostics(TENANT, ACCOUNT)).resolves.toBeDefined();
        },
    );
});

// ============================================================================
// reportSyncRun — paused tenant НЕ должен трогать health
// ============================================================================

describe('§10 reportSyncRun в paused tenant', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: MarketplaceAccountsService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
    });

    it.each(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED'])(
        'в %s: паузит без записи health, эмитит PAUSED_BY_TENANT_STATE event',
        async (state) => {
            prisma.tenant.findUnique.mockResolvedValue({ accessState: state });
            prisma.marketplaceAccount.findFirst.mockResolvedValue({
                id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', label: 'X',
                lifecycleStatus: 'ACTIVE',
            });

            const res: any = await svc.reportSyncRun(TENANT, ACCOUNT, { ok: false, errorCode: 'X' });

            expect(res.paused).toBe(true);
            // НЕ обновляет marketplaceAccount.* — health поля не трогаются.
            expect(prisma.marketplaceAccount.update).not.toHaveBeenCalled();
            // PAUSED_BY_TENANT_STATE event эмитится в audit chain.
            expect(prisma.marketplaceAccountEvent.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        eventType: 'marketplace_account_paused_by_tenant_state',
                        payload: expect.objectContaining({ action: 'sync_run', accessState: state }),
                    }),
                }),
            );
        },
    );

    it('в ACTIVE_PAID: нормально пишет health', async () => {
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'ACTIVE_PAID' });
        prisma.marketplaceAccount.findFirst.mockResolvedValue({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', label: 'X', lifecycleStatus: 'ACTIVE',
        });
        prisma.marketplaceAccount.update.mockImplementation(async (args: any) => ({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', label: 'X', lifecycleStatus: 'ACTIVE',
            ...args.data, credential: null,
        }));

        const res: any = await svc.reportSyncRun(TENANT, ACCOUNT, { ok: true });

        expect(res.paused).toBeUndefined();
        expect(prisma.marketplaceAccount.update).toHaveBeenCalled();
    });
});

// ============================================================================
// Single-active rule
// ============================================================================

describe('§10 Single-active-account rule', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: MarketplaceAccountsService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'ACTIVE_PAID' });
    });

    it('create запрещает второй ACTIVE того же marketplace через application pre-check', async () => {
        prisma.marketplaceAccount.findFirst.mockResolvedValueOnce({ id: 'existing-active', label: 'Old' });

        await expect(
            svc.create(TENANT, { marketplace: 'WB', label: 'New', credentials: VALID_WB }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({
                code: 'ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE',
                conflictAccountId: 'existing-active',
            }),
        });
        expect(prisma.marketplaceAccount.create).not.toHaveBeenCalled();
    });

    it('reactivate запрещает второй ACTIVE через application pre-check', async () => {
        prisma.marketplaceAccount.findFirst.mockResolvedValueOnce({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', lifecycleStatus: 'INACTIVE',
        });
        prisma.marketplaceAccount.findFirst.mockResolvedValueOnce({
            id: 'other-active', label: 'Other Active',
        });

        await expect(svc.reactivate(TENANT, ACCOUNT, ACTOR)).rejects.toMatchObject({
            response: expect.objectContaining({
                code: 'ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE',
                conflictAccountId: 'other-active',
            }),
        });
    });

    it('DB partial UNIQUE (P2002) ловит race в create', async () => {
        prisma.marketplaceAccount.findFirst.mockResolvedValue(null);
        prisma.marketplaceAccount.create.mockRejectedValue({ code: 'P2002', meta: {} });

        await expect(
            svc.create(TENANT, { marketplace: 'WB', label: 'Race', credentials: VALID_WB }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({
                code: 'ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE',
            }),
        });
    });

    it('DB partial UNIQUE (P2002) ловит race в reactivate', async () => {
        prisma.marketplaceAccount.findFirst.mockResolvedValueOnce({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', lifecycleStatus: 'INACTIVE',
        });
        prisma.marketplaceAccount.findFirst.mockResolvedValueOnce(null);
        prisma.marketplaceAccount.update.mockRejectedValue({ code: 'P2002', meta: {} });

        await expect(svc.reactivate(TENANT, ACCOUNT, ACTOR)).rejects.toMatchObject({
            response: expect.objectContaining({
                code: 'ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE',
            }),
        });
    });
});

// ============================================================================
// TENANT_NOT_FOUND
// ============================================================================

describe('TENANT_NOT_FOUND для несуществующего tenant', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: MarketplaceAccountsService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
        prisma.tenant.findUnique.mockResolvedValue(null);
    });

    it('validate → TENANT_NOT_FOUND', async () => {
        await expect(svc.validate(TENANT, ACCOUNT)).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'TENANT_NOT_FOUND' }),
        });
    });

    it('deactivate → TENANT_NOT_FOUND', async () => {
        await expect(svc.deactivate(TENANT, ACCOUNT, ACTOR)).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'TENANT_NOT_FOUND' }),
        });
    });
});
