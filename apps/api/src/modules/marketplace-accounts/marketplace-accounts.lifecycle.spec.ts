/**
 * TASK_MARKETPLACE_ACCOUNTS_3 — validate / deactivate / reactivate lifecycle.
 */
import { Test } from '@nestjs/testing';
import { Logger, ConflictException, NotFoundException } from '@nestjs/common';
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
        tenant: { findUnique: jest.fn().mockResolvedValue({ accessState: 'ACTIVE_PAID' }) },
        marketplaceAccount: {
            findFirst: jest.fn(),
            update: jest.fn(),
        },
        marketplaceCredential: {
            create: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
        },
        marketplaceAccountEvent: {
            create: jest.fn().mockResolvedValue({}),
        },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    return prisma;
}

function setupActiveAccount(prisma: any, cipher: CredentialsCipher) {
    const encrypted = cipher.encrypt(VALID_WB);
    prisma.marketplaceAccount.findFirst.mockResolvedValueOnce({
        id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', label: 'WB Main',
        lifecycleStatus: 'ACTIVE',
        credentialStatus: 'VALIDATING',
        credential: {
            accountId: ACCOUNT,
            encryptedPayload: encrypted,
            encryptionKeyVersion: 1,
            schemaVersion: 1,
            maskedPreview: { apiToken: '***7890', warehouseId: '1001' },
            rotatedAt: null,
        },
    }).mockResolvedValue(null);

    prisma.marketplaceAccount.update.mockImplementation(async (args: any) => ({
        id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', label: 'WB Main',
        ...args.data,
        credential: {
            accountId: ACCOUNT,
            encryptedPayload: encrypted,
            encryptionKeyVersion: 1,
            schemaVersion: 1,
            maskedPreview: { apiToken: '***7890', warehouseId: '1001' },
            rotatedAt: null,
        },
    }));
}

async function build(prisma: any, validatorImpl: Partial<CredentialValidator> = {}) {
    const validator: CredentialValidator = {
        validate: jest.fn().mockResolvedValue({ ok: true }),
        ...(validatorImpl as any),
    } as any;
    const moduleRef = await Test.createTestingModule({
        providers: [
            MarketplaceAccountsService,
            CredentialsCipher,
            { provide: CredentialValidator, useValue: validator },
            { provide: PrismaService, useValue: prisma },
        ],
    }).setLogger(new Logger()).compile();
    return {
        service: moduleRef.get(MarketplaceAccountsService),
        validator,
        cipher: moduleRef.get(CredentialsCipher),
    };
}

describe('MarketplaceAccountsService.validate', () => {
    it('успех → credentialStatus=VALID, VALIDATED event, lastValidationError=null', async () => {
        const prisma = makePrismaMock();
        const { service, validator, cipher } = await build(prisma);
        setupActiveAccount(prisma, cipher);

        const res = await service.validate(TENANT, ACCOUNT);

        expect(validator.validate).toHaveBeenCalledWith('WB', expect.objectContaining({ apiToken: 'wb-token-1234567890' }));
        // Сначала VALIDATING пишется до внешнего вызова, затем VALID.
        const updateCalls = prisma.marketplaceAccount.update.mock.calls;
        expect(updateCalls[0][0].data.credentialStatus).toBe('VALIDATING');
        expect(updateCalls[1][0].data.credentialStatus).toBe('VALID');
        expect(updateCalls[1][0].data.lastValidationErrorCode).toBeNull();
        expect(prisma.marketplaceAccountEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ eventType: 'marketplace_account_validated' }),
            }),
        );
        expect(res.credentialStatus).toBe('VALID');
        // Полное значение токена не утекает.
        expect(JSON.stringify(res)).not.toContain('wb-token-1234567890');
    });

    it('AUTH_UNAUTHORIZED → credentialStatus=INVALID, VALIDATION_FAILED event', async () => {
        const prisma = makePrismaMock();
        const { service, cipher } = await build(prisma, {
            validate: jest.fn().mockResolvedValue({
                ok: false, errorCode: 'AUTH_UNAUTHORIZED', errorMessage: 'HTTP 401',
            }),
        });
        setupActiveAccount(prisma, cipher);

        const res = await service.validate(TENANT, ACCOUNT);

        expect(res.credentialStatus).toBe('INVALID');
        expect(res.lastValidationErrorCode).toBe('AUTH_UNAUTHORIZED');
        expect(prisma.marketplaceAccountEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ eventType: 'marketplace_account_validation_failed' }),
            }),
        );
    });

    it('AUTH_FORBIDDEN с needsReconnect=true → credentialStatus=NEEDS_RECONNECT', async () => {
        const prisma = makePrismaMock();
        const { service, cipher } = await build(prisma, {
            validate: jest.fn().mockResolvedValue({
                ok: false, errorCode: 'AUTH_FORBIDDEN', errorMessage: 'HTTP 403', needsReconnect: true,
            }),
        });
        setupActiveAccount(prisma, cipher);

        const res = await service.validate(TENANT, ACCOUNT);

        expect(res.credentialStatus).toBe('NEEDS_RECONNECT');
    });

    it('NET_TIMEOUT → credentialStatus=UNKNOWN (сетевая проблема, credentials под вопросом)', async () => {
        const prisma = makePrismaMock();
        const { service, cipher } = await build(prisma, {
            validate: jest.fn().mockResolvedValue({
                ok: false, errorCode: 'NET_TIMEOUT', errorMessage: 'timeout',
            }),
        });
        setupActiveAccount(prisma, cipher);

        const res = await service.validate(TENANT, ACCOUNT);

        expect(res.credentialStatus).toBe('UNKNOWN');
        expect(res.lastValidationErrorCode).toBe('NET_TIMEOUT');
    });

    it('HTTP_5xx → credentialStatus=UNKNOWN (server-side, не credentials)', async () => {
        const prisma = makePrismaMock();
        const { service, cipher } = await build(prisma, {
            validate: jest.fn().mockResolvedValue({
                ok: false, errorCode: 'HTTP_503', errorMessage: 'Service Unavailable',
            }),
        });
        setupActiveAccount(prisma, cipher);

        const res = await service.validate(TENANT, ACCOUNT);

        expect(res.credentialStatus).toBe('UNKNOWN');
    });

    it('HTTP_400 (4xx, не auth) → credentialStatus=INVALID', async () => {
        const prisma = makePrismaMock();
        const { service, cipher } = await build(prisma, {
            validate: jest.fn().mockResolvedValue({
                ok: false, errorCode: 'HTTP_400', errorMessage: 'Bad Request',
            }),
        });
        setupActiveAccount(prisma, cipher);

        const res = await service.validate(TENANT, ACCOUNT);

        expect(res.credentialStatus).toBe('INVALID');
    });

    it('ACCOUNT_NOT_FOUND для чужого аккаунта', async () => {
        const prisma = makePrismaMock();
        const { service } = await build(prisma);
        prisma.marketplaceAccount.findFirst.mockResolvedValue(null);

        await expect(service.validate(TENANT, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ACCOUNT_INACTIVE для неактивного аккаунта (validate запрещена)', async () => {
        const prisma = makePrismaMock();
        const { service } = await build(prisma);
        prisma.marketplaceAccount.findFirst.mockResolvedValue({
            id: ACCOUNT, tenantId: TENANT, lifecycleStatus: 'INACTIVE',
            credential: { encryptedPayload: Buffer.from('x') },
        });

        await expect(service.validate(TENANT, ACCOUNT)).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'ACCOUNT_INACTIVE' }),
        });
    });

    it('ACCOUNT_HAS_NO_CREDENTIALS если credential отсутствует', async () => {
        const prisma = makePrismaMock();
        const { service } = await build(prisma);
        prisma.marketplaceAccount.findFirst.mockResolvedValue({
            id: ACCOUNT, tenantId: TENANT, lifecycleStatus: 'ACTIVE',
            credential: null,
        });

        await expect(service.validate(TENANT, ACCOUNT)).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'ACCOUNT_HAS_NO_CREDENTIALS' }),
        });
    });

    it('validator throws → credentialStatus=UNKNOWN с VALIDATOR_INTERNAL_ERROR', async () => {
        const prisma = makePrismaMock();
        const { service, cipher } = await build(prisma, {
            validate: jest.fn().mockRejectedValue(new Error('boom')),
        });
        setupActiveAccount(prisma, cipher);

        const res = await service.validate(TENANT, ACCOUNT);

        expect(res.credentialStatus).toBe('UNKNOWN');
        expect(res.lastValidationErrorCode).toBe('VALIDATOR_INTERNAL_ERROR');
    });
});

describe('MarketplaceAccountsService.deactivate', () => {
    it('ACTIVE → INACTIVE, deactivatedAt/By, syncHealth=PAUSED, DEACTIVATED event', async () => {
        const prisma = makePrismaMock();
        const { service, cipher } = await build(prisma);
        setupActiveAccount(prisma, cipher);

        const res = await service.deactivate(TENANT, ACCOUNT, ACTOR);

        const updateCall = prisma.marketplaceAccount.update.mock.calls[0][0];
        expect(updateCall.data).toMatchObject({
            lifecycleStatus: 'INACTIVE',
            deactivatedBy: ACTOR,
            syncHealthStatus: 'PAUSED',
            syncHealthReason: 'ACCOUNT_DEACTIVATED',
        });
        expect(updateCall.data.deactivatedAt).toBeInstanceOf(Date);
        expect(prisma.marketplaceAccountEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    eventType: 'marketplace_account_deactivated',
                    payload: { actorUserId: ACTOR },
                }),
            }),
        );
        expect(res.lifecycleStatus).toBe('INACTIVE');
    });

    it('ACCOUNT_ALREADY_INACTIVE для уже неактивного', async () => {
        const prisma = makePrismaMock();
        const { service } = await build(prisma);
        prisma.marketplaceAccount.findFirst.mockResolvedValue({
            id: ACCOUNT, tenantId: TENANT, lifecycleStatus: 'INACTIVE',
        });

        await expect(service.deactivate(TENANT, ACCOUNT, ACTOR)).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'ACCOUNT_ALREADY_INACTIVE' }),
        });
    });

    it('ACCOUNT_NOT_FOUND для чужого', async () => {
        const prisma = makePrismaMock();
        const { service } = await build(prisma);
        prisma.marketplaceAccount.findFirst.mockResolvedValue(null);

        await expect(service.deactivate(TENANT, 'nope', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    });
});

describe('MarketplaceAccountsService.reactivate', () => {
    function setupInactive(prisma: any, cipher: CredentialsCipher) {
        const encrypted = cipher.encrypt(VALID_WB);
        prisma.marketplaceAccount.findFirst
            // 1-й findFirst: текущий аккаунт INACTIVE
            .mockResolvedValueOnce({
                id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', label: 'WB Main',
                lifecycleStatus: 'INACTIVE',
                credential: {
                    accountId: ACCOUNT,
                    encryptedPayload: encrypted,
                    encryptionKeyVersion: 1,
                    schemaVersion: 1,
                    maskedPreview: { apiToken: '***7890', warehouseId: '1001' },
                    rotatedAt: null,
                },
            });
        // 2-й findFirst: проверка single-active — нет другого active.
        prisma.marketplaceAccount.findFirst.mockResolvedValueOnce(null);
        // 3-й findFirst: внутри validate — снова находит наш аккаунт уже ACTIVE.
        prisma.marketplaceAccount.findFirst.mockResolvedValueOnce({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', label: 'WB Main',
            lifecycleStatus: 'ACTIVE',
            credentialStatus: 'VALIDATING',
            credential: {
                accountId: ACCOUNT,
                encryptedPayload: encrypted,
                encryptionKeyVersion: 1,
                schemaVersion: 1,
                maskedPreview: { apiToken: '***7890', warehouseId: '1001' },
                rotatedAt: null,
            },
        });
        prisma.marketplaceAccount.findFirst.mockResolvedValue(null);

        prisma.marketplaceAccount.update.mockImplementation(async (args: any) => ({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', label: 'WB Main',
            ...args.data,
            credential: {
                accountId: ACCOUNT,
                encryptedPayload: encrypted,
                encryptionKeyVersion: 1,
                schemaVersion: 1,
                maskedPreview: { apiToken: '***7890', warehouseId: '1001' },
                rotatedAt: null,
            },
        }));
    }

    it('INACTIVE → ACTIVE с обнулением deactivation полей + auto re-validate', async () => {
        const prisma = makePrismaMock();
        const { service, validator, cipher } = await build(prisma);
        setupInactive(prisma, cipher);

        const res = await service.reactivate(TENANT, ACCOUNT, ACTOR);

        // Первый update — reactivation (lifecycleStatus + обнуления).
        const reactivateUpdate = prisma.marketplaceAccount.update.mock.calls[0][0];
        expect(reactivateUpdate.data).toMatchObject({
            lifecycleStatus: 'ACTIVE',
            deactivatedAt: null,
            deactivatedBy: null,
            // КРИТИЧНО §10: НЕ автоматически VALID, обязательно re-validate.
            credentialStatus: 'VALIDATING',
            lastValidatedAt: null,
            lastValidationErrorCode: null,
            syncHealthStatus: 'UNKNOWN',
            syncHealthReason: null,
        });
        // REACTIVATED event записан.
        expect(prisma.marketplaceAccountEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ eventType: 'marketplace_account_reactivated' }),
            }),
        );
        // Validate был вызван автоматически после reactivation.
        expect(validator.validate).toHaveBeenCalled();
        // После validate финальный credentialStatus=VALID (default mock возвращает ok=true).
        expect(res.credentialStatus).toBe('VALID');
    });

    it('ACCOUNT_ALREADY_ACTIVE для уже активного', async () => {
        const prisma = makePrismaMock();
        const { service } = await build(prisma);
        prisma.marketplaceAccount.findFirst.mockResolvedValue({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', lifecycleStatus: 'ACTIVE',
        });

        await expect(service.reactivate(TENANT, ACCOUNT, ACTOR)).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'ACCOUNT_ALREADY_ACTIVE' }),
        });
    });

    it('ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE: нельзя reactivate, пока есть другой active', async () => {
        const prisma = makePrismaMock();
        const { service } = await build(prisma);
        // Текущий — INACTIVE.
        prisma.marketplaceAccount.findFirst.mockResolvedValueOnce({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', lifecycleStatus: 'INACTIVE',
        });
        // Pre-check single-active нашёл другой ACTIVE.
        prisma.marketplaceAccount.findFirst.mockResolvedValueOnce({
            id: 'other-active', label: 'Other',
        });

        await expect(service.reactivate(TENANT, ACCOUNT, ACTOR)).rejects.toMatchObject({
            response: expect.objectContaining({
                code: 'ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE',
                conflictAccountId: 'other-active',
            }),
        });
    });

    it('P2002 race с partial UNIQUE → ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE', async () => {
        const prisma = makePrismaMock();
        const { service, cipher } = await build(prisma);
        const encrypted = cipher.encrypt(VALID_WB);
        prisma.marketplaceAccount.findFirst.mockResolvedValueOnce({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', lifecycleStatus: 'INACTIVE',
            credential: { encryptedPayload: encrypted },
        });
        prisma.marketplaceAccount.findFirst.mockResolvedValueOnce(null);
        prisma.marketplaceAccount.update.mockRejectedValue({ code: 'P2002', meta: {} });

        await expect(service.reactivate(TENANT, ACCOUNT, ACTOR)).rejects.toMatchObject({
            response: expect.objectContaining({
                code: 'ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE',
            }),
        });
    });

    it('ACCOUNT_NOT_FOUND для чужого', async () => {
        const prisma = makePrismaMock();
        const { service } = await build(prisma);
        prisma.marketplaceAccount.findFirst.mockResolvedValue(null);

        await expect(service.reactivate(TENANT, 'nope', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    });
});

describe('Lifecycle invariant — credential validity ≠ sync health', () => {
    it('validate меняет ТОЛЬКО credentialStatus + lastValidationError*, НЕ syncHealthStatus', async () => {
        const prisma = makePrismaMock();
        const { service, cipher } = await build(prisma);
        setupActiveAccount(prisma, cipher);

        await service.validate(TENANT, ACCOUNT);

        const finalUpdate = prisma.marketplaceAccount.update.mock.calls[1][0];
        expect(finalUpdate.data).not.toHaveProperty('syncHealthStatus');
        expect(finalUpdate.data).not.toHaveProperty('syncHealthReason');
        expect(finalUpdate.data).not.toHaveProperty('lastSyncResult');
    });
});
