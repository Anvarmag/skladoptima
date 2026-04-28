/**
 * TASK_MARKETPLACE_ACCOUNTS_4 — list / detail / diagnostics + reportSyncRun.
 */
import { Test } from '@nestjs/testing';
import { Logger, NotFoundException } from '@nestjs/common';
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
    };
});

const TENANT = 't1';
const ACCOUNT = 'acc-1';

function makePrismaMock() {
    return {
        tenant: { findUnique: jest.fn().mockResolvedValue({ accessState: 'ACTIVE_PAID' }) },
        marketplaceAccount: {
            findFirst: jest.fn(),
            findMany: jest.fn().mockResolvedValue([]),
            update: jest.fn(),
        },
        marketplaceCredential: { create: jest.fn(), update: jest.fn() },
        marketplaceAccountEvent: {
            create: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([]),
        },
        $transaction: jest.fn().mockImplementation(async (fn: any) => fn(this)),
    } as any;
}

async function build(prisma: any) {
    const moduleRef = await Test.createTestingModule({
        providers: [
            MarketplaceAccountsService,
            CredentialsCipher,
            { provide: CredentialValidator, useValue: { validate: jest.fn() } },
            { provide: PrismaService, useValue: prisma },
        ],
    }).setLogger(new Logger()).compile();
    return moduleRef.get(MarketplaceAccountsService);
}

function makeAccount(overrides: any = {}) {
    return {
        id: ACCOUNT,
        tenantId: TENANT,
        marketplace: 'WB',
        label: 'WB Main',
        lifecycleStatus: 'ACTIVE',
        credentialStatus: 'VALID',
        syncHealthStatus: 'HEALTHY',
        syncHealthReason: null,
        lastValidatedAt: new Date('2026-04-25T10:00:00Z'),
        lastValidationErrorCode: null,
        lastValidationErrorMessage: null,
        lastSyncAt: new Date('2026-04-26T08:00:00Z'),
        lastSyncResult: 'SUCCESS',
        lastSyncErrorCode: null,
        lastSyncErrorMessage: null,
        deactivatedAt: null,
        deactivatedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        credential: {
            accountId: ACCOUNT,
            encryptionKeyVersion: 1,
            schemaVersion: 1,
            maskedPreview: { apiToken: '***7890', warehouseId: '1001' },
            rotatedAt: null,
        },
        ...overrides,
    };
}

describe('MarketplaceAccountsService.list / getById', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: MarketplaceAccountsService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
    });

    it('list возвращает компактный read-model и не утекает encryptedPayload', async () => {
        prisma.marketplaceAccount.findMany.mockResolvedValue([
            makeAccount(),
            makeAccount({ id: 'acc-2', marketplace: 'OZON', label: 'Ozon Main' }),
        ]);

        const res = await svc.list(TENANT);

        expect(res.count).toBe(2);
        expect(res.data).toHaveLength(2);
        // Полный шифр не возвращается, только masked preview.
        expect(JSON.stringify(res)).not.toContain('encryptedPayload');
        expect(res.data[0].credential).toMatchObject({
            maskedPreview: { apiToken: '***7890', warehouseId: '1001' },
        });
    });

    it('list прокидывает фильтры в where', async () => {
        prisma.marketplaceAccount.findMany.mockResolvedValue([]);

        await svc.list(TENANT, {
            marketplace: 'WB' as any,
            lifecycleStatus: 'INACTIVE' as any,
            credentialStatus: 'INVALID' as any,
        });

        expect(prisma.marketplaceAccount.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    tenantId: TENANT,
                    marketplace: 'WB',
                    lifecycleStatus: 'INACTIVE',
                    credentialStatus: 'INVALID',
                },
            }),
        );
    });

    it('getById возвращает карточку, NotFound для чужого', async () => {
        prisma.marketplaceAccount.findFirst.mockResolvedValueOnce(makeAccount());
        const res = await svc.getById(TENANT, ACCOUNT);
        expect(res.id).toBe(ACCOUNT);

        prisma.marketplaceAccount.findFirst.mockResolvedValueOnce(null);
        await expect(svc.getById(TENANT, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });
});

describe('MarketplaceAccountsService.getDiagnostics — effectiveRuntimeState', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: MarketplaceAccountsService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
    });

    it('OPERATIONAL: tenant ACTIVE_PAID, account ACTIVE+VALID+HEALTHY', async () => {
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'ACTIVE_PAID' });
        prisma.marketplaceAccount.findFirst.mockResolvedValue(makeAccount());

        const res = await svc.getDiagnostics(TENANT, ACCOUNT);

        expect(res.effectiveRuntimeState).toBe('OPERATIONAL');
        expect(res.effectiveRuntimeReason).toBeNull();
        expect(res.tenantAccessState).toBe('ACTIVE_PAID');
    });

    it.each(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED'])(
        'PAUSED_BY_TENANT для %s — перебивает credential/sync статусы',
        async (state) => {
            prisma.tenant.findUnique.mockResolvedValue({ accessState: state });
            prisma.marketplaceAccount.findFirst.mockResolvedValue(makeAccount({
                credentialStatus: 'INVALID',
                syncHealthStatus: 'ERROR',
            }));

            const res = await svc.getDiagnostics(TENANT, ACCOUNT);

            expect(res.effectiveRuntimeState).toBe('PAUSED_BY_TENANT');
            expect(res.effectiveRuntimeReason).toContain(state);
        },
    );

    it('INACTIVE: lifecycle перебивает credential/sync (даже если оба VALID/HEALTHY)', async () => {
        prisma.marketplaceAccount.findFirst.mockResolvedValue(makeAccount({
            lifecycleStatus: 'INACTIVE',
            credentialStatus: 'VALID',
            syncHealthStatus: 'HEALTHY',
        }));

        const res = await svc.getDiagnostics(TENANT, ACCOUNT);

        expect(res.effectiveRuntimeState).toBe('INACTIVE');
        expect(res.effectiveRuntimeReason).toBe('account_deactivated');
    });

    it('CREDENTIAL_BLOCKED: INVALID/NEEDS_RECONNECT блокируют, sync degraded не учитывается', async () => {
        prisma.marketplaceAccount.findFirst.mockResolvedValueOnce(makeAccount({
            credentialStatus: 'INVALID',
            syncHealthStatus: 'DEGRADED',
        }));

        let res = await svc.getDiagnostics(TENANT, ACCOUNT);
        expect(res.effectiveRuntimeState).toBe('CREDENTIAL_BLOCKED');
        expect(res.effectiveRuntimeReason).toContain('INVALID');

        prisma.marketplaceAccount.findFirst.mockResolvedValueOnce(makeAccount({
            credentialStatus: 'NEEDS_RECONNECT',
        }));

        res = await svc.getDiagnostics(TENANT, ACCOUNT);
        expect(res.effectiveRuntimeState).toBe('CREDENTIAL_BLOCKED');
        expect(res.effectiveRuntimeReason).toContain('NEEDS_RECONNECT');
    });

    it('SYNC_DEGRADED: credential VALID, sync ERROR → degraded', async () => {
        prisma.marketplaceAccount.findFirst.mockResolvedValue(makeAccount({
            credentialStatus: 'VALID',
            syncHealthStatus: 'ERROR',
        }));

        const res = await svc.getDiagnostics(TENANT, ACCOUNT);

        expect(res.effectiveRuntimeState).toBe('SYNC_DEGRADED');
        expect(res.effectiveRuntimeReason).toContain('ERROR');
    });

    it('VALIDATING/UNKNOWN credential — НЕ блокирует (OPERATIONAL по умолчанию)', async () => {
        prisma.marketplaceAccount.findFirst.mockResolvedValue(makeAccount({
            credentialStatus: 'VALIDATING',
        }));

        const res = await svc.getDiagnostics(TENANT, ACCOUNT);

        expect(res.effectiveRuntimeState).toBe('OPERATIONAL');
    });
});

describe('MarketplaceAccountsService.getDiagnostics — статус-слои и события', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: MarketplaceAccountsService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
    });

    it('возвращает три отдельных слоя статуса с error-полями', async () => {
        const account = makeAccount({
            credentialStatus: 'INVALID',
            lastValidationErrorCode: 'AUTH_UNAUTHORIZED',
            lastValidationErrorMessage: 'HTTP 401',
            syncHealthStatus: 'ERROR',
            syncHealthReason: 'RATE_LIMIT',
            lastSyncErrorCode: 'HTTP_429',
            lastSyncErrorMessage: 'rate limited',
            deactivatedAt: new Date('2026-04-20T10:00:00Z'),
            deactivatedBy: 'user-42',
            lifecycleStatus: 'INACTIVE',
        });
        prisma.marketplaceAccount.findFirst.mockResolvedValue(account);

        const res = await svc.getDiagnostics(TENANT, ACCOUNT);

        expect(res.statusLayers.lifecycle).toMatchObject({
            status: 'INACTIVE',
            deactivatedBy: 'user-42',
        });
        expect(res.statusLayers.credential).toMatchObject({
            status: 'INVALID',
            lastValidationErrorCode: 'AUTH_UNAUTHORIZED',
            lastValidationErrorMessage: 'HTTP 401',
        });
        expect(res.statusLayers.syncHealth).toMatchObject({
            status: 'ERROR',
            reason: 'RATE_LIMIT',
            lastSyncErrorCode: 'HTTP_429',
            lastSyncResult: 'SUCCESS',
        });
    });

    it('включает recent events с payload (но БЕЗ значений секретов)', async () => {
        prisma.marketplaceAccount.findFirst.mockResolvedValue(makeAccount());
        prisma.marketplaceAccountEvent.findMany.mockResolvedValue([
            {
                id: 'e1', eventType: 'marketplace_account_created',
                payload: { marketplace: 'WB', label: 'WB Main', keyVersion: 1 },
                createdAt: new Date('2026-04-20'),
            },
            {
                id: 'e2', eventType: 'marketplace_account_credentials_rotated',
                payload: { keyVersion: 1, fieldsRotated: ['apiToken'] },
                createdAt: new Date('2026-04-22'),
            },
            {
                id: 'e3', eventType: 'marketplace_account_validation_failed',
                payload: { ok: false, errorCode: 'AUTH_UNAUTHORIZED' },
                createdAt: new Date('2026-04-25'),
            },
        ]);

        const res = await svc.getDiagnostics(TENANT, ACCOUNT);

        expect(res.recentEvents).toHaveLength(3);
        // CREDENTIALS_ROTATED содержит ТОЛЬКО fieldsRotated имена, не значения.
        const rotated = res.recentEvents.find((e: any) => e.eventType === 'marketplace_account_credentials_rotated');
        expect(rotated?.payload).toEqual({ keyVersion: 1, fieldsRotated: ['apiToken'] });
        // Никаких полных значений секретов в diagnostics-response.
        const json = JSON.stringify(res);
        expect(json).not.toContain('apiToken_value_should_not_be_here');
    });

    it('credential.maskedPreview виден, encryptedPayload НЕ виден', async () => {
        prisma.marketplaceAccount.findFirst.mockResolvedValue(makeAccount());

        const res = await svc.getDiagnostics(TENANT, ACCOUNT);

        expect(res.credential).toMatchObject({
            maskedPreview: { apiToken: '***7890', warehouseId: '1001' },
        });
        expect(JSON.stringify(res)).not.toContain('encryptedPayload');
    });

    it('NotFound для чужого аккаунта', async () => {
        prisma.marketplaceAccount.findFirst.mockResolvedValue(null);
        await expect(svc.getDiagnostics(TENANT, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });
});

describe('MarketplaceAccountsService.reportSyncRun', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: MarketplaceAccountsService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
        prisma.marketplaceAccount.findFirst.mockResolvedValue(makeAccount());
        prisma.marketplaceAccount.update.mockImplementation(async (args: any) => ({
            ...makeAccount(), ...args.data,
        }));
        prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    });

    it('ok=true → SUCCESS + HEALTHY, без SYNC_ERROR_DETECTED event', async () => {
        await svc.reportSyncRun(TENANT, ACCOUNT, { ok: true });

        const updateData = prisma.marketplaceAccount.update.mock.calls[0][0].data;
        expect(updateData).toMatchObject({
            lastSyncResult: 'SUCCESS',
            syncHealthStatus: 'HEALTHY',
            syncHealthReason: null,
            lastSyncErrorCode: null,
        });
        expect(prisma.marketplaceAccountEvent.create).not.toHaveBeenCalled();
    });

    it('ok=true + partial=true → PARTIAL_SUCCESS + DEGRADED + healthReason', async () => {
        await svc.reportSyncRun(TENANT, ACCOUNT, {
            ok: true, partial: true, healthReason: 'SOME_PRODUCTS_SKIPPED',
        });

        const updateData = prisma.marketplaceAccount.update.mock.calls[0][0].data;
        expect(updateData).toMatchObject({
            lastSyncResult: 'PARTIAL_SUCCESS',
            syncHealthStatus: 'DEGRADED',
            syncHealthReason: 'SOME_PRODUCTS_SKIPPED',
        });
    });

    it('ok=false → FAILED + ERROR + SYNC_ERROR_DETECTED event', async () => {
        await svc.reportSyncRun(TENANT, ACCOUNT, {
            ok: false,
            errorCode: 'HTTP_500',
            errorMessage: 'WB internal server error',
        });

        const updateData = prisma.marketplaceAccount.update.mock.calls[0][0].data;
        expect(updateData).toMatchObject({
            lastSyncResult: 'FAILED',
            syncHealthStatus: 'ERROR',
            syncHealthReason: 'HTTP_500',
            lastSyncErrorCode: 'HTTP_500',
            lastSyncErrorMessage: 'WB internal server error',
        });
        expect(prisma.marketplaceAccountEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    eventType: 'marketplace_account_sync_error_detected',
                    payload: expect.objectContaining({ errorCode: 'HTTP_500' }),
                }),
            }),
        );
    });

    it('reportSyncRun НЕ трогает credentialStatus / lastValidationError* (§20 invariant)', async () => {
        await svc.reportSyncRun(TENANT, ACCOUNT, { ok: false, errorCode: 'X' });

        const updateData = prisma.marketplaceAccount.update.mock.calls[0][0].data;
        expect(updateData).not.toHaveProperty('credentialStatus');
        expect(updateData).not.toHaveProperty('lastValidationErrorCode');
        expect(updateData).not.toHaveProperty('lastValidationErrorMessage');
        expect(updateData).not.toHaveProperty('lastValidatedAt');
    });

    it('NotFound для чужого аккаунта', async () => {
        prisma.marketplaceAccount.findFirst.mockResolvedValue(null);
        await expect(
            svc.reportSyncRun(TENANT, 'nope', { ok: true }),
        ).rejects.toBeInstanceOf(NotFoundException);
    });
});
