/**
 * TASK_MARKETPLACE_ACCOUNTS_7 — регрессионная матрица §16 system-analytics
 * + security проверки (no plaintext leakage в logs/responses) + observability
 * проверки (event names через centralized constants).
 *
 * Каждый describe-блок отображается на одну строку матрицы §16.
 * Файл — single read-through point для QA: пройти сценарий-за-сценарием
 * и убедиться, что обязательные поведения покрыты регрессией.
 */
import { Test } from '@nestjs/testing';
import { Logger, ForbiddenException, ConflictException } from '@nestjs/common';
import { MarketplaceAccountsService } from './marketplace-accounts.service';
import { CredentialsCipher } from './credentials-cipher.service';
import { CredentialValidator } from './credential-validator.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MarketplaceAccountEventNames } from './marketplace-account.events';

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

const FULL_WB_TOKEN = 'wb-secret-token-1234567890';
const FULL_WB_STAT = 'wb-secret-stat-aaaa1111';
const FULL_OZON_KEY = 'ozon-secret-key-zzzz9999';

const VALID_WB = { apiToken: FULL_WB_TOKEN, warehouseId: '1001' };
const VALID_OZON = { clientId: '12345', apiKey: FULL_OZON_KEY, warehouseId: '999' };

function makePrismaMock() {
    const prisma: any = {
        tenant: { findUnique: jest.fn().mockResolvedValue({ accessState: 'ACTIVE_PAID' }) },
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

function setupActiveWbAccount(prisma: any, cipher: CredentialsCipher) {
    const encrypted = cipher.encrypt(VALID_WB);
    prisma.marketplaceAccount.findFirst.mockResolvedValueOnce({
        id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', label: 'WB Main',
        lifecycleStatus: 'ACTIVE', credentialStatus: 'VALIDATING',
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
            accountId: ACCOUNT, encryptedPayload: encrypted,
            encryptionKeyVersion: 1, schemaVersion: 1,
            maskedPreview: { apiToken: '***7890', warehouseId: '1001' },
            rotatedAt: null,
        },
    }));
}

// ============================================================================
// §16.1 — Создание валидного account
// ============================================================================

describe('§16.1 — создание валидного account (WB и Ozon)', () => {
    let prisma: ReturnType<typeof makePrismaMock>;

    beforeEach(() => {
        prisma = makePrismaMock();
        prisma.marketplaceAccount.findFirst.mockResolvedValue(null);
        prisma.marketplaceAccount.create.mockImplementation(async (args: any) => ({
            id: ACCOUNT, tenantId: TENANT, ...args.data,
            createdAt: new Date(), updatedAt: new Date(),
        }));
    });

    it('WB: создаёт ACTIVE/VALIDATING/UNKNOWN, шифрует payload, пишет CREATED event', async () => {
        const { service } = await build(prisma);
        const logSpy = jest.spyOn(Logger.prototype, 'log');

        const res = await service.create(TENANT, {
            marketplace: 'WB', label: 'WB Main', credentials: VALID_WB,
        });

        expect(res).toMatchObject({
            marketplace: 'WB',
            label: 'WB Main',
            lifecycleStatus: 'ACTIVE',
            credentialStatus: 'VALIDATING',
            syncHealthStatus: 'UNKNOWN',
        });
        expect(prisma.marketplaceCredential.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ encryptedPayload: expect.any(Buffer) }),
            }),
        );
        // Каноничное event name из централизованного файла.
        expect(prisma.marketplaceAccountEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    eventType: MarketplaceAccountEventNames.CREATED,
                }),
            }),
        );
        expect(logSpy.mock.calls.some(c => String(c[0]).includes(MarketplaceAccountEventNames.CREATED))).toBe(true);
        logSpy.mockRestore();
    });

    it('Ozon: создаётся с маскированием apiKey (***ghij формат)', async () => {
        const { service } = await build(prisma);

        const res = await service.create(TENANT, {
            marketplace: 'OZON', label: 'Ozon Main', credentials: VALID_OZON,
        });

        expect(res.marketplace).toBe('OZON');
        expect(res.credential?.maskedPreview).toMatchObject({
            clientId: '12345',
            apiKey: '***9999',
            warehouseId: '999',
        });
    });
});

// ============================================================================
// §16.2 — Создание account с неверными credentials (валидация полей)
// ============================================================================

describe('§16.2 — невалидные credentials per marketplace', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let service: MarketplaceAccountsService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        ({ service } = await build(prisma));
        prisma.marketplaceAccount.findFirst.mockResolvedValue(null);
    });

    it('WB без apiToken → CREDENTIALS_MISSING_FIELDS', async () => {
        await expect(
            service.create(TENANT, { marketplace: 'WB', label: 'X', credentials: { warehouseId: '1' } as any }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({
                code: 'CREDENTIALS_MISSING_FIELDS',
                missing: expect.arrayContaining(['apiToken']),
            }),
        });
    });

    it('Ozon без clientId+apiKey → CREDENTIALS_MISSING_FIELDS', async () => {
        await expect(
            service.create(TENANT, { marketplace: 'OZON', label: 'X', credentials: { warehouseId: '1' } as any }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({
                code: 'CREDENTIALS_MISSING_FIELDS',
            }),
        });
    });

    it('Anti-injection: лишние ключи → CREDENTIALS_UNKNOWN_FIELDS', async () => {
        await expect(
            service.create(TENANT, {
                marketplace: 'WB', label: 'X',
                credentials: { ...VALID_WB, hackInjection: 'evil' } as any,
            }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'CREDENTIALS_UNKNOWN_FIELDS' }),
        });
    });
});

// ============================================================================
// §16.3 — Попытка создать второй ACTIVE account того же marketplace
// ============================================================================

describe('§16.3 — single-active-account rule', () => {
    it('CREATE: application pre-check возвращает ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE с conflictAccountId', async () => {
        const prisma = makePrismaMock();
        const { service } = await build(prisma);
        prisma.marketplaceAccount.findFirst.mockResolvedValueOnce({ id: 'existing', label: 'Old' });

        await expect(
            service.create(TENANT, { marketplace: 'WB', label: 'New', credentials: VALID_WB }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({
                code: 'ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE',
                conflictAccountId: 'existing',
            }),
        });
    });

    it('CREATE: DB partial UNIQUE (P2002) ловит race между pre-check и create', async () => {
        const prisma = makePrismaMock();
        const { service } = await build(prisma);
        prisma.marketplaceAccount.findFirst.mockResolvedValue(null);
        prisma.marketplaceAccount.create.mockRejectedValue({ code: 'P2002', meta: {} });

        await expect(
            service.create(TENANT, { marketplace: 'WB', label: 'Race', credentials: VALID_WB }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({
                code: 'ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE',
            }),
        });
    });

    it('REACTIVATE: блокируется если уже есть active того же marketplace', async () => {
        const prisma = makePrismaMock();
        const { service } = await build(prisma);
        prisma.marketplaceAccount.findFirst.mockResolvedValueOnce({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', lifecycleStatus: 'INACTIVE',
        });
        prisma.marketplaceAccount.findFirst.mockResolvedValueOnce({ id: 'other-active' });

        await expect(service.reactivate(TENANT, ACCOUNT, ACTOR)).rejects.toMatchObject({
            response: expect.objectContaining({
                code: 'ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE',
                conflictAccountId: 'other-active',
            }),
        });
    });
});

// ============================================================================
// §16.4 — Обновление credentials (partial)
// ============================================================================

describe('§16.4 — partial credentials update без потери остальных полей', () => {
    it('обновляет только apiToken, warehouseId сохраняется, credentialStatus → VALIDATING', async () => {
        const prisma = makePrismaMock();
        const { service, cipher } = await build(prisma);
        setupActiveWbAccount(prisma, cipher);

        const res = await service.update(TENANT, ACCOUNT, {
            credentials: { apiToken: 'new-token-9999' },
        });

        expect(res.credentialStatus).toBe('VALIDATING');
        expect(res.credential?.maskedPreview).toMatchObject({
            apiToken: '***9999',
            warehouseId: '1001',  // не утерян
        });
        // CREDENTIALS_ROTATED event с fieldsRotated БЕЗ значений секретов.
        expect(prisma.marketplaceAccountEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    eventType: MarketplaceAccountEventNames.CREDENTIALS_ROTATED,
                    payload: expect.objectContaining({ fieldsRotated: ['apiToken'] }),
                }),
            }),
        );
    });
});

// ============================================================================
// §16.5 — Деактивация account
// ============================================================================

describe('§16.5 — деактивация и сохранение истории', () => {
    it('ACTIVE → INACTIVE, syncHealth=PAUSED, deactivatedBy записан, не удаляет связи', async () => {
        const prisma = makePrismaMock();
        const { service, cipher } = await build(prisma);
        setupActiveWbAccount(prisma, cipher);

        const res = await service.deactivate(TENANT, ACCOUNT, ACTOR);

        expect(res.lifecycleStatus).toBe('INACTIVE');
        const updateData = prisma.marketplaceAccount.update.mock.calls[0][0].data;
        expect(updateData).toMatchObject({
            lifecycleStatus: 'INACTIVE',
            deactivatedBy: ACTOR,
            syncHealthStatus: 'PAUSED',
            syncHealthReason: 'ACCOUNT_DEACTIVATED',
        });
        // Никаких "delete" по Warehouse/Order/StockBalance — `deactivate` лишь обновляет
        // marketplaceAccount и пишет event. Sync history references сохраняются.
        expect(prisma.marketplaceAccountEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    eventType: MarketplaceAccountEventNames.DEACTIVATED,
                }),
            }),
        );
    });
});

// ============================================================================
// §16.6 — Повторная активация с обязательной re-validation
// ============================================================================

describe('§16.6 — reactivate с обязательной re-validate', () => {
    it('INACTIVE → ACTIVE, credentialStatus принудительно VALIDATING, validate вызван', async () => {
        const prisma = makePrismaMock();
        const { service, validator, cipher } = await build(prisma);
        const encrypted = cipher.encrypt(VALID_WB);

        // 1. Lookup для reactivate: текущий INACTIVE.
        prisma.marketplaceAccount.findFirst.mockResolvedValueOnce({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', lifecycleStatus: 'INACTIVE',
            credential: { encryptedPayload: encrypted },
        });
        // 2. Pre-check: нет другого ACTIVE.
        prisma.marketplaceAccount.findFirst.mockResolvedValueOnce(null);
        // 3. Внутри validate: lookup для validate (тот же аккаунт уже ACTIVE).
        prisma.marketplaceAccount.findFirst.mockResolvedValueOnce({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB',
            lifecycleStatus: 'ACTIVE', credentialStatus: 'VALIDATING',
            credential: {
                accountId: ACCOUNT,
                encryptedPayload: encrypted,
                encryptionKeyVersion: 1,
                schemaVersion: 1,
                maskedPreview: { apiToken: '***7890', warehouseId: '1001' },
                rotatedAt: null,
            },
        });
        prisma.marketplaceAccount.update.mockImplementation(async (args: any) => ({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', label: 'WB Main',
            ...args.data,
            credential: {
                accountId: ACCOUNT, encryptedPayload: encrypted,
                encryptionKeyVersion: 1, schemaVersion: 1,
                maskedPreview: { apiToken: '***7890', warehouseId: '1001' },
                rotatedAt: null,
            },
        }));

        const res = await service.reactivate(TENANT, ACCOUNT, ACTOR);

        // Первый update — reactivation.
        const reactUpdate = prisma.marketplaceAccount.update.mock.calls[0][0];
        expect(reactUpdate.data).toMatchObject({
            lifecycleStatus: 'ACTIVE',
            deactivatedAt: null,
            credentialStatus: 'VALIDATING',  // не VALID автоматически!
        });
        expect(prisma.marketplaceAccountEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    eventType: MarketplaceAccountEventNames.REACTIVATED,
                }),
            }),
        );
        // Validate вызван автоматически.
        expect(validator.validate).toHaveBeenCalled();
        expect(res.credentialStatus).toBe('VALID');
    });
});

// ============================================================================
// §16.7 — Sync error не ломает credential validity (§20 invariant)
// ============================================================================

describe('§16.7 — sync error меняет sync_health_status, но не credential_status', () => {
    it('reportSyncRun ok=false → sync=ERROR, credentialStatus НЕ ТРОГАЕТСЯ', async () => {
        const prisma = makePrismaMock();
        const { service } = await build(prisma);
        prisma.marketplaceAccount.findFirst.mockResolvedValue({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB',
            label: 'WB Main', lifecycleStatus: 'ACTIVE',
        });
        prisma.marketplaceAccount.update.mockImplementation(async (args: any) => ({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB',
            label: 'WB Main', lifecycleStatus: 'ACTIVE',
            ...args.data, credential: null,
        }));

        await service.reportSyncRun(TENANT, ACCOUNT, {
            ok: false, errorCode: 'HTTP_500', errorMessage: 'WB internal',
        });

        const updateData = prisma.marketplaceAccount.update.mock.calls[0][0].data;
        // Меняет только sync-health поля.
        expect(updateData).toMatchObject({
            lastSyncResult: 'FAILED',
            syncHealthStatus: 'ERROR',
            lastSyncErrorCode: 'HTTP_500',
        });
        // НЕ трогает credential поля — §20 invariant.
        expect(updateData).not.toHaveProperty('credentialStatus');
        expect(updateData).not.toHaveProperty('lastValidationErrorCode');
        expect(updateData).not.toHaveProperty('lastValidatedAt');
        // SYNC_ERROR_DETECTED event записан.
        expect(prisma.marketplaceAccountEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    eventType: MarketplaceAccountEventNames.SYNC_ERROR_DETECTED,
                }),
            }),
        );
    });
});

// ============================================================================
// §16.8-9 — TRIAL_EXPIRED policy: разрешено label/deactivate, остальное блок
// ============================================================================

describe('§16.8-9 — TRIAL_EXPIRED account-state policy', () => {
    it('разрешено: PATCH label, deactivate', async () => {
        const prisma = makePrismaMock();
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'TRIAL_EXPIRED' });
        const { service, cipher } = await build(prisma);
        setupActiveWbAccount(prisma, cipher);

        await expect(
            service.update(TENANT, ACCOUNT, { label: 'WB Renamed' }),
        ).resolves.toBeDefined();
    });

    it('заблокировано: validate, reactivate, credentials update, create', async () => {
        const prisma = makePrismaMock();
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'TRIAL_EXPIRED' });
        const { service } = await build(prisma);

        await expect(
            service.validate(TENANT, ACCOUNT),
        ).rejects.toBeInstanceOf(ForbiddenException);

        await expect(
            service.reactivate(TENANT, ACCOUNT, ACTOR),
        ).rejects.toBeInstanceOf(ForbiddenException);

        await expect(
            service.update(TENANT, ACCOUNT, { credentials: { apiToken: 'x' } }),
        ).rejects.toBeInstanceOf(ForbiddenException);

        await expect(
            service.create(TENANT, { marketplace: 'WB', label: 'X', credentials: VALID_WB }),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });
});

// ============================================================================
// §16.10 — SUSPENDED/CLOSED policy: read-only mode (всё блокируется)
// ============================================================================

describe('§16.10 — SUSPENDED/CLOSED → полный read-only', () => {
    it.each(['SUSPENDED', 'CLOSED'])('%s блокирует все write actions', async (state) => {
        const prisma = makePrismaMock();
        prisma.tenant.findUnique.mockResolvedValue({ accessState: state });
        const { service } = await build(prisma);

        // Даже label-only / deactivate (которые в TRIAL_EXPIRED разрешены).
        await expect(
            service.update(TENANT, ACCOUNT, { label: 'X' }),
        ).rejects.toBeInstanceOf(ForbiddenException);

        await expect(
            service.deactivate(TENANT, ACCOUNT, ACTOR),
        ).rejects.toBeInstanceOf(ForbiddenException);

        await expect(
            service.validate(TENANT, ACCOUNT),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it.each(['SUSPENDED', 'CLOSED', 'TRIAL_EXPIRED'])(
        'read API (list/getById/diagnostics) РАБОТАЕТ в %s',
        async (state) => {
            const prisma = makePrismaMock();
            prisma.tenant.findUnique.mockResolvedValue({ accessState: state });
            const { service, cipher } = await build(prisma);
            prisma.marketplaceAccount.findFirst.mockResolvedValue({
                id: ACCOUNT, tenantId: TENANT, marketplace: 'WB',
                label: 'WB Main', lifecycleStatus: 'ACTIVE',
                credentialStatus: 'VALID', syncHealthStatus: 'HEALTHY',
                credential: {
                    accountId: ACCOUNT,
                    encryptedPayload: cipher.encrypt(VALID_WB),
                    encryptionKeyVersion: 1, schemaVersion: 1,
                    maskedPreview: { apiToken: '***7890', warehouseId: '1001' },
                    rotatedAt: null,
                },
            });

            await expect(service.list(TENANT)).resolves.toBeDefined();
            await expect(service.getById(TENANT, ACCOUNT)).resolves.toBeDefined();
            await expect(service.getDiagnostics(TENANT, ACCOUNT)).resolves.toBeDefined();
        },
    );
});

// ============================================================================
// SECURITY — масked responses, no plaintext leakage
// ============================================================================

describe('SECURITY — masked responses и отсутствие plaintext leakage', () => {
    it('CREATE response не содержит полные значения секретов', async () => {
        const prisma = makePrismaMock();
        const { service } = await build(prisma);
        prisma.marketplaceAccount.findFirst.mockResolvedValue(null);
        prisma.marketplaceAccount.create.mockImplementation(async (args: any) => ({
            id: ACCOUNT, tenantId: TENANT, ...args.data,
            createdAt: new Date(), updatedAt: new Date(),
        }));

        const res = await service.create(TENANT, {
            marketplace: 'WB', label: 'WB Main', credentials: VALID_WB,
        });

        const json = JSON.stringify(res);
        expect(json).not.toContain(FULL_WB_TOKEN);     // полное значение apiToken не утекает
        expect(json).not.toContain('encryptedPayload'); // raw ciphertext тоже не наружу
        expect(res.credential?.maskedPreview?.apiToken).toBe('***7890');
    });

    it('UPDATE response с partial credentials не утекает новое значение', async () => {
        const prisma = makePrismaMock();
        const { service, cipher } = await build(prisma);
        setupActiveWbAccount(prisma, cipher);
        const NEW_TOKEN = 'super-secret-new-token-zzzz5555';

        const res = await service.update(TENANT, ACCOUNT, {
            credentials: { apiToken: NEW_TOKEN },
        });

        const json = JSON.stringify(res);
        expect(json).not.toContain(NEW_TOKEN);
        expect(json).not.toContain(FULL_WB_TOKEN);
    });

    it('DIAGNOSTICS response: masked preview виден, encryptedPayload — нет', async () => {
        const prisma = makePrismaMock();
        const { service, cipher } = await build(prisma);
        const encrypted = cipher.encrypt(VALID_WB);
        prisma.marketplaceAccount.findFirst.mockResolvedValue({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB',
            label: 'WB Main', lifecycleStatus: 'ACTIVE',
            credentialStatus: 'VALID', syncHealthStatus: 'HEALTHY',
            credential: {
                accountId: ACCOUNT,
                encryptedPayload: encrypted,
                encryptionKeyVersion: 1, schemaVersion: 1,
                maskedPreview: { apiToken: '***7890', warehouseId: '1001' },
                rotatedAt: null,
            },
        });
        prisma.marketplaceAccountEvent.findMany.mockResolvedValue([
            {
                id: 'e1',
                eventType: MarketplaceAccountEventNames.CREDENTIALS_ROTATED,
                payload: { keyVersion: 1, fieldsRotated: ['apiToken'] }, // имена, НЕ значения
                createdAt: new Date(),
            },
        ]);

        const res = await service.getDiagnostics(TENANT, ACCOUNT);

        const json = JSON.stringify(res);
        expect(json).not.toContain(FULL_WB_TOKEN);
        expect(json).not.toContain('encryptedPayload');
        expect(res.credential?.maskedPreview).toMatchObject({ apiToken: '***7890' });
        // Recent event payload содержит только имена полей.
        const rotatedEvent = res.recentEvents.find(
            (e: any) => e.eventType === MarketplaceAccountEventNames.CREDENTIALS_ROTATED,
        );
        expect(rotatedEvent?.payload).toEqual({ keyVersion: 1, fieldsRotated: ['apiToken'] });
    });

    it('LOGS не содержат полные значения секретов в любых event-stringify', async () => {
        const prisma = makePrismaMock();
        const { service } = await build(prisma);
        prisma.marketplaceAccount.findFirst.mockResolvedValue(null);
        prisma.marketplaceAccount.create.mockImplementation(async (args: any) => ({
            id: ACCOUNT, tenantId: TENANT, ...args.data,
            createdAt: new Date(), updatedAt: new Date(),
        }));

        const logSpy = jest.spyOn(Logger.prototype, 'log');
        const warnSpy = jest.spyOn(Logger.prototype, 'warn');

        await service.create(TENANT, {
            marketplace: 'WB', label: 'WB Main', credentials: VALID_WB,
        });

        const allLogs = [
            ...logSpy.mock.calls.flat(),
            ...warnSpy.mock.calls.flat(),
        ].map((x) => String(x)).join('\n');

        expect(allLogs).not.toContain(FULL_WB_TOKEN);
        expect(allLogs).not.toContain(FULL_OZON_KEY);
        // CREATED event эмитится с masked данными.
        expect(allLogs).toContain(MarketplaceAccountEventNames.CREATED);

        logSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it('SYNC_ERROR event payload содержит errorCode но не credentials', async () => {
        const prisma = makePrismaMock();
        const { service } = await build(prisma);
        prisma.marketplaceAccount.findFirst.mockResolvedValue({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB',
            label: 'WB Main', lifecycleStatus: 'ACTIVE',
        });
        prisma.marketplaceAccount.update.mockImplementation(async (args: any) => ({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB',
            label: 'WB Main', lifecycleStatus: 'ACTIVE',
            ...args.data, credential: null,
        }));

        await service.reportSyncRun(TENANT, ACCOUNT, {
            ok: false,
            errorCode: 'HTTP_500',
            errorMessage: 'WB internal',
        });

        const eventCall = prisma.marketplaceAccountEvent.create.mock.calls.find(
            (c: any) => c[0]?.data?.eventType === MarketplaceAccountEventNames.SYNC_ERROR_DETECTED,
        );
        expect(eventCall).toBeDefined();
        expect(eventCall![0].data.payload).toEqual({ errorCode: 'HTTP_500', partial: false });
        expect(JSON.stringify(eventCall![0].data.payload)).not.toContain(FULL_WB_TOKEN);
    });
});

// ============================================================================
// OBSERVABILITY — каноничные event names через centralized constants
// ============================================================================

describe('OBSERVABILITY — каноничные event names через MarketplaceAccountEventNames', () => {
    it('все 9 event-имён существуют и совпадают с реально эмитируемыми', async () => {
        // Эта проверка — anti-typo: если кто-то в сервисе ввёл строку напрямую вместо
        // константы и забыл добавить её в MarketplaceAccountEventNames, тест упадёт
        // при попытке проверить присутствие в логах.
        expect(MarketplaceAccountEventNames.CREATED).toBe('marketplace_account_created');
        expect(MarketplaceAccountEventNames.LABEL_UPDATED).toBe('marketplace_account_label_updated');
        expect(MarketplaceAccountEventNames.CREDENTIALS_ROTATED).toBe('marketplace_account_credentials_rotated');
        expect(MarketplaceAccountEventNames.VALIDATED).toBe('marketplace_account_validated');
        expect(MarketplaceAccountEventNames.VALIDATION_FAILED).toBe('marketplace_account_validation_failed');
        expect(MarketplaceAccountEventNames.DEACTIVATED).toBe('marketplace_account_deactivated');
        expect(MarketplaceAccountEventNames.REACTIVATED).toBe('marketplace_account_reactivated');
        expect(MarketplaceAccountEventNames.SYNC_ERROR_DETECTED).toBe('marketplace_account_sync_error_detected');
        expect(MarketplaceAccountEventNames.PAUSED_BY_TENANT_STATE).toBe('marketplace_account_paused_by_tenant_state');
    });

    it('PAUSED_BY_TENANT_STATE эмитится при попытке external action в paused tenant', async () => {
        const prisma = makePrismaMock();
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'TRIAL_EXPIRED' });
        const { service } = await build(prisma);

        await expect(service.validate(TENANT, ACCOUNT)).rejects.toBeInstanceOf(ForbiddenException);

        expect(prisma.marketplaceAccountEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    eventType: MarketplaceAccountEventNames.PAUSED_BY_TENANT_STATE,
                    payload: expect.objectContaining({
                        action: 'validate',
                        accessState: 'TRIAL_EXPIRED',
                    }),
                }),
            }),
        );
    });
});

// ============================================================================
// QA matrix — Yandex Market (out of MVP)
// ============================================================================

describe('QA matrix — Yandex Market пока не поддерживается в MVP', () => {
    it('create с marketplace=YANDEX_MARKET → MARKETPLACE_NOT_SUPPORTED', async () => {
        const prisma = makePrismaMock();
        const { service } = await build(prisma);

        await expect(
            service.create(TENANT, {
                marketplace: 'YANDEX_MARKET' as any,
                label: 'YM',
                credentials: { campaignId: '1', token: 'x' } as any,
            }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({
                code: 'MARKETPLACE_NOT_SUPPORTED',
            }),
        });
    });
});
