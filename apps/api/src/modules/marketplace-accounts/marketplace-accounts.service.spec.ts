import { Test } from '@nestjs/testing';
import { Logger, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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

function makePrismaMock() {
    const prisma: any = {
        tenant: { findUnique: jest.fn().mockResolvedValue({ accessState: 'ACTIVE_PAID' }) },
        marketplaceAccount: {
            findFirst: jest.fn(),
            create: jest.fn(),
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

async function build(prisma: any, validator?: CredentialValidator) {
    const moduleRef = await Test.createTestingModule({
        providers: [
            MarketplaceAccountsService,
            CredentialsCipher,
            { provide: CredentialValidator, useValue: validator ?? { validate: jest.fn().mockResolvedValue({ ok: true }) } },
            { provide: PrismaService, useValue: prisma },
        ],
    }).setLogger(new Logger()).compile();
    return moduleRef.get(MarketplaceAccountsService);
}

const VALID_WB = { apiToken: 'wb-token-1234567890', warehouseId: '1001' };
const VALID_OZON = { clientId: '12345', apiKey: 'ozon-key-abcdefghij', warehouseId: '999' };

describe('MarketplaceAccountsService.create — happy paths', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: MarketplaceAccountsService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
        prisma.marketplaceAccount.findFirst.mockResolvedValue(null);
        prisma.marketplaceAccount.create.mockImplementation(async (args: any) => ({
            id: 'acc-1', tenantId: TENANT, ...args.data,
            createdAt: new Date(), updatedAt: new Date(),
        }));
    });

    it('создаёт WB-аккаунт с шифрованием credentials и масками', async () => {
        const res = await svc.create(TENANT, {
            marketplace: 'WB',
            label: 'WB Main',
            credentials: VALID_WB,
        });

        expect(res).toMatchObject({
            id: 'acc-1',
            marketplace: 'WB',
            label: 'WB Main',
            lifecycleStatus: 'ACTIVE',
            credentialStatus: 'VALIDATING',
            syncHealthStatus: 'UNKNOWN',
        });
        // Маскированный preview: secret поля → ***xxxx, warehouseId без маски.
        expect(res.credential).toMatchObject({
            maskedPreview: { apiToken: '***7890', warehouseId: '1001' },
            schemaVersion: 1,
            encryptionKeyVersion: expect.any(Number),
        });
        // Полные секреты НЕ должны утечь.
        const json = JSON.stringify(res);
        expect(json).not.toContain('wb-token-1234567890');

        // Encrypted Buffer попадает в БД.
        expect(prisma.marketplaceCredential.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    accountId: 'acc-1',
                    encryptedPayload: expect.any(Buffer),
                    encryptionKeyVersion: expect.any(Number),
                    schemaVersion: 1,
                }),
            }),
        );

        // CREATED event записан.
        expect(prisma.marketplaceAccountEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ eventType: 'marketplace_account_created' }),
            }),
        );
    });

    it('создаёт Ozon-аккаунт', async () => {
        const res = await svc.create(TENANT, {
            marketplace: 'OZON',
            label: 'Ozon Main',
            credentials: VALID_OZON,
        });

        expect(res.marketplace).toBe('OZON');
        expect(res.credential?.maskedPreview).toMatchObject({
            clientId: '12345',
            apiKey: '***ghij',
            warehouseId: '999',
        });
    });
});

describe('MarketplaceAccountsService.create — конфликты и валидация', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: MarketplaceAccountsService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
    });

    it('ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE: уже есть active аккаунт', async () => {
        prisma.marketplaceAccount.findFirst.mockResolvedValueOnce({ id: 'old', label: 'Old' });

        await expect(
            svc.create(TENANT, { marketplace: 'WB', label: 'New', credentials: VALID_WB }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({
                code: 'ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE',
                conflictAccountId: 'old',
            }),
        });
        expect(prisma.marketplaceAccount.create).not.toHaveBeenCalled();
    });

    it('ACCOUNT_LABEL_ALREADY_EXISTS: label занят (даже среди INACTIVE)', async () => {
        // 1-й findFirst: ищем active — не найдено. 2-й: ищем по label — найдено.
        prisma.marketplaceAccount.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'inactive-old' });

        await expect(
            svc.create(TENANT, { marketplace: 'WB', label: 'Reused', credentials: VALID_WB }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'ACCOUNT_LABEL_ALREADY_EXISTS' }),
        });
        expect(prisma.marketplaceAccount.create).not.toHaveBeenCalled();
    });

    it('CREDENTIALS_MISSING_FIELDS для WB без apiToken', async () => {
        prisma.marketplaceAccount.findFirst.mockResolvedValue(null);
        await expect(
            svc.create(TENANT, {
                marketplace: 'WB',
                label: 'X',
                credentials: { warehouseId: '1' } as any,
            }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({
                code: 'CREDENTIALS_MISSING_FIELDS',
                missing: expect.arrayContaining(['apiToken']),
            }),
        });
    });

    it('CREDENTIALS_UNKNOWN_FIELDS для лишних ключей', async () => {
        prisma.marketplaceAccount.findFirst.mockResolvedValue(null);
        await expect(
            svc.create(TENANT, {
                marketplace: 'WB',
                label: 'X',
                credentials: { ...VALID_WB, hackField: 'evil' } as any,
            }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({
                code: 'CREDENTIALS_UNKNOWN_FIELDS',
                unknown: ['hackField'],
            }),
        });
    });

    it('CREDENTIALS_FIELD_INVALID_TYPE для не-строкового значения', async () => {
        prisma.marketplaceAccount.findFirst.mockResolvedValue(null);
        await expect(
            svc.create(TENANT, {
                marketplace: 'WB',
                label: 'X',
                credentials: { apiToken: 123, warehouseId: '1' } as any,
            }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'CREDENTIALS_FIELD_INVALID_TYPE' }),
        });
    });

    it('CREDENTIALS_FIELD_TOO_LONG для значения >1024', async () => {
        prisma.marketplaceAccount.findFirst.mockResolvedValue(null);
        await expect(
            svc.create(TENANT, {
                marketplace: 'WB',
                label: 'X',
                credentials: { apiToken: 'x'.repeat(1025), warehouseId: '1' },
            }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'CREDENTIALS_FIELD_TOO_LONG', max: 1024 }),
        });
    });

    it('LABEL_REQUIRED при пустой/whitespace-only label', async () => {
        await expect(
            svc.create(TENANT, { marketplace: 'WB', label: '   ', credentials: VALID_WB }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'LABEL_REQUIRED' }),
        });
    });

    it('MARKETPLACE_NOT_SUPPORTED для неподдерживаемого marketplace', async () => {
        await expect(
            svc.create(TENANT, { marketplace: 'YANDEX_MARKET' as any, label: 'X', credentials: {} }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'MARKETPLACE_NOT_SUPPORTED' }),
        });
    });

    it('P2002 race с partial UNIQUE → ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE', async () => {
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
});

describe('MarketplaceAccountsService.update — partial credential update', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: MarketplaceAccountsService;
    let cipher: CredentialsCipher;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
        cipher = new CredentialsCipher();
    });

    function setupExisting(partial?: Record<string, string>) {
        const existingPayload = { ...VALID_WB, ...(partial ?? {}) };
        const encrypted = cipher.encrypt(existingPayload);
        prisma.marketplaceAccount.findFirst
            .mockResolvedValueOnce({
                id: 'acc-1', tenantId: TENANT, marketplace: 'WB', label: 'WB Main',
                lifecycleStatus: 'ACTIVE', credentialStatus: 'VALID',
                credential: {
                    accountId: 'acc-1',
                    encryptedPayload: encrypted,
                    encryptionKeyVersion: 1,
                    schemaVersion: 1,
                    maskedPreview: { apiToken: '***7890', warehouseId: '1001' },
                    rotatedAt: null,
                },
            })
            // По умолчанию для последующих вызовов (label uniqueness check) — не найдено.
            .mockResolvedValue(null);
        prisma.marketplaceAccount.update.mockImplementation(async (args: any) => ({
            id: 'acc-1', tenantId: TENANT, marketplace: 'WB', label: 'WB Main',
            lifecycleStatus: 'ACTIVE', credentialStatus: 'VALIDATING',
            ...args.data,
        }));
    }

    it('обновляет только apiToken, warehouseId сохраняется (merge с existing)', async () => {
        setupExisting();

        const res = await svc.update(TENANT, 'acc-1', {
            credentials: { apiToken: 'new-wb-token-9999' },
        });

        expect(res.credentialStatus).toBe('VALIDATING');
        expect(res.credential?.maskedPreview).toMatchObject({
            apiToken: '***9999',
            warehouseId: '1001',
        });
        expect(prisma.marketplaceCredential.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { accountId: 'acc-1' },
                data: expect.objectContaining({
                    encryptedPayload: expect.any(Buffer),
                    rotatedAt: expect.any(Date),
                }),
            }),
        );
        // Полное новое значение НЕ возвращается в response.
        const json = JSON.stringify(res);
        expect(json).not.toContain('new-wb-token-9999');
        // CREDENTIALS_ROTATED event записан.
        expect(prisma.marketplaceAccountEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    eventType: 'marketplace_account_credentials_rotated',
                    payload: expect.objectContaining({ fieldsRotated: ['apiToken'] }),
                }),
            }),
        );
    });

    it('credentialStatus сбрасывается в VALIDATING + lastValidationError* в null', async () => {
        setupExisting();

        await svc.update(TENANT, 'acc-1', {
            credentials: { apiToken: 'x'.repeat(20) },
        });

        const updateCall = prisma.marketplaceAccount.update.mock.calls[0][0];
        expect(updateCall.data.credentialStatus).toBe('VALIDATING');
        expect(updateCall.data.lastValidatedAt).toBeNull();
        expect(updateCall.data.lastValidationErrorCode).toBeNull();
        expect(updateCall.data.lastValidationErrorMessage).toBeNull();
    });

    it('переименование label пишет LABEL_UPDATED event', async () => {
        setupExisting();

        await svc.update(TENANT, 'acc-1', { label: 'WB Renamed' });

        expect(prisma.marketplaceAccountEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    eventType: 'marketplace_account_label_updated',
                    payload: { from: 'WB Main', to: 'WB Renamed' },
                }),
            }),
        );
    });

    it('ACCOUNT_LABEL_ALREADY_EXISTS если новый label занят другим аккаунтом', async () => {
        setupExisting();
        // setupExisting кладёт первый mockResolvedValueOnce + дефолт null. Перебиваем дефолт:
        // следующий findFirst (label uniqueness) → найден другой аккаунт с этим label.
        prisma.marketplaceAccount.findFirst.mockResolvedValueOnce({ id: 'other' });

        await expect(
            svc.update(TENANT, 'acc-1', { label: 'Different Name' }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'ACCOUNT_LABEL_ALREADY_EXISTS' }),
        });
    });

    it('ACCOUNT_NOT_FOUND для чужого аккаунта', async () => {
        prisma.marketplaceAccount.findFirst.mockResolvedValue(null);
        await expect(
            svc.update(TENANT, 'nope', { label: 'X' }),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('UPDATE_EMPTY если ни label, ни credentials не переданы', async () => {
        await expect(
            svc.update(TENANT, 'acc-1', {} as any),
        ).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'UPDATE_EMPTY' }),
        });
    });

    it('LABEL_REQUIRED при пустой/whitespace-only label', async () => {
        prisma.marketplaceAccount.findFirst.mockResolvedValue({
            id: 'acc-1', tenantId: TENANT, marketplace: 'WB', label: 'WB Main',
            credential: null,
        });
        await expect(
            svc.update(TENANT, 'acc-1', { label: '   ' }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'LABEL_REQUIRED' }),
        });
    });
});

describe('CredentialsCipher', () => {
    const cipher = new CredentialsCipher();

    it('encrypt → decrypt roundtrip возвращает исходный объект', () => {
        const payload = { apiToken: 'secret-12345', warehouseId: '999' };
        const blob = cipher.encrypt(payload);
        expect(Buffer.isBuffer(blob)).toBe(true);
        expect(blob.length).toBeGreaterThan(28); // IV + tag + ct
        const decrypted = cipher.decrypt(blob);
        expect(decrypted).toEqual(payload);
    });

    it('ciphertext отличается даже для одинакового plaintext (IV randomization)', () => {
        const a = cipher.encrypt({ x: 'same' });
        const b = cipher.encrypt({ x: 'same' });
        expect(a.equals(b)).toBe(false);
    });

    it('повреждённый ciphertext бросает MARKETPLACE_CREDENTIALS_DECRYPT_FAILED', () => {
        const blob = cipher.encrypt({ x: 'a' });
        blob[blob.length - 1] ^= 0xff; // повреждаем последний байт
        expect(() => cipher.decrypt(blob)).toThrow();
    });

    it('maskValue: длинная строка → ***xxxx, короткая → ***', () => {
        expect(cipher.maskValue('1234567890')).toBe('***7890');
        expect(cipher.maskValue('abcd')).toBe('***');
        expect(cipher.maskValue('')).toBeNull();
        expect(cipher.maskValue(null)).toBeNull();
        expect(cipher.maskValue(undefined)).toBeNull();
    });
});
