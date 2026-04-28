/**
 * Регрессионная матрица §16 system-analytics для warehouse-модуля.
 *
 * Каждый describe-блок отображается на одну строку тестовой матрицы.
 * Этот файл — single read-through point для QA: пройти сценарий-за-сценарием
 * и убедиться, что обязательные поведения покрыты регрессией. Дополнительно
 * проверены observability events из `warehouse.events.ts` (§19) и audit
 * для alias/labels updates.
 */
import { Test } from '@nestjs/testing';
import { Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { WarehouseSyncService } from './warehouse-sync.service';
import { WarehouseService } from './warehouse.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WarehouseEvents } from './warehouse.events';

jest.mock('@prisma/client', () => {
    class PrismaClient {}
    return {
        PrismaClient,
        Prisma: { sql: function () { return { _sql: true }; } },
        AccessState: {
            EARLY_ACCESS: 'EARLY_ACCESS',
            TRIAL_ACTIVE: 'TRIAL_ACTIVE',
            TRIAL_EXPIRED: 'TRIAL_EXPIRED',
            ACTIVE_PAID: 'ACTIVE_PAID',
            GRACE_PERIOD: 'GRACE_PERIOD',
            SUSPENDED: 'SUSPENDED',
            CLOSED: 'CLOSED',
        },
        MarketplaceType: { WB: 'WB', OZON: 'OZON' },
        WarehouseStatus: { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE', ARCHIVED: 'ARCHIVED' },
        WarehouseType: { FBS: 'FBS', FBO: 'FBO' },
        WarehouseSourceMarketplace: { WB: 'WB', OZON: 'OZON', YANDEX_MARKET: 'YANDEX_MARKET' },
    };
});

jest.mock('axios', () => ({
    __esModule: true,
    default: { get: jest.fn(), post: jest.fn() },
}));

import axios from 'axios';

const TENANT = 't1';
const ACCOUNT = 'acc-1';

function makePrismaMock() {
    return {
        tenant: { findUnique: jest.fn().mockResolvedValue({ accessState: 'ACTIVE_PAID' }) },
        marketplaceAccount: {
            findUnique: jest.fn(),
            findMany: jest.fn().mockResolvedValue([]),
            update: jest.fn().mockResolvedValue({}),
        },
        warehouse: {
            findUnique: jest.fn(),
            findFirst: jest.fn(),
            findMany: jest.fn().mockResolvedValue([]),
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        stockBalance: { findMany: jest.fn().mockResolvedValue([]) },
    };
}

async function buildSync(prisma: any) {
    const moduleRef = await Test.createTestingModule({
        providers: [WarehouseSyncService, { provide: PrismaService, useValue: prisma }],
    }).setLogger(new Logger()).compile();
    return moduleRef.get(WarehouseSyncService);
}

async function buildRead(prisma: any) {
    const moduleRef = await Test.createTestingModule({
        providers: [WarehouseService, { provide: PrismaService, useValue: prisma }],
    }).setLogger(new Logger()).compile();
    return moduleRef.get(WarehouseService);
}

function setupAccount(prisma: any, marketplace: 'WB' | 'OZON' = 'WB') {
    prisma.marketplaceAccount.findUnique.mockResolvedValue({
        id: ACCOUNT,
        tenantId: TENANT,
        marketplace,
        apiKey: 'k',
        clientId: marketplace === 'OZON' ? 'cid' : null,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// §16.1: Первичная загрузка складов
// ─────────────────────────────────────────────────────────────────────────────
describe('§16.1 — первичная загрузка складов', () => {
    it('создаёт ACTIVE warehouse, фиксирует firstSeenAt/lastSyncedAt, эмитит UPSERT_CREATED + SYNC_COMPLETED', async () => {
        const prisma = makePrismaMock();
        const svc = await buildSync(prisma);
        setupAccount(prisma, 'WB');
        prisma.warehouse.findUnique.mockResolvedValue(null);
        (axios.get as jest.Mock).mockResolvedValue({ data: [
            { id: 1001, name: 'WB Коледино', address: 'Москва, Коледино, д.1' },
        ]});
        const logSpy = jest.spyOn(Logger.prototype, 'log');

        const res = await svc.syncForAccount(ACCOUNT);

        expect(res).toMatchObject({ fetched: 1, created: 1, updated: 0, deactivated: 0, archived: 0 });
        expect(prisma.warehouse.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    status: 'ACTIVE',
                    firstSeenAt: expect.any(Date),
                    lastSyncedAt: expect.any(Date),
                }),
            }),
        );
        expect(logSpy.mock.calls.some(c => String(c[0]).includes(WarehouseEvents.UPSERT_CREATED))).toBe(true);
        expect(logSpy.mock.calls.some(c => String(c[0]).includes(WarehouseEvents.SYNC_COMPLETED))).toBe(true);
        logSpy.mockRestore();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §16.2: Повторная синхронизация без дублей
// ─────────────────────────────────────────────────────────────────────────────
describe('§16.2 — повторный sync, без дублей', () => {
    it('тот же набор → updated, не создаёт новых записей', async () => {
        const prisma = makePrismaMock();
        const svc = await buildSync(prisma);
        setupAccount(prisma, 'WB');
        prisma.warehouse.findUnique.mockResolvedValue({
            id: 'w1', externalWarehouseId: '1001', name: 'old',
            warehouseType: 'FBS', sourceMarketplace: 'WB', status: 'ACTIVE',
            aliasName: null, labels: [],
        });
        (axios.get as jest.Mock).mockResolvedValue({ data: [
            { id: 1001, name: 'WB Коледино', address: 'Москва' },
        ]});

        const res = await svc.syncForAccount(ACCOUNT);

        expect(res.created).toBe(0);
        expect(res.updated).toBe(1);
        expect(prisma.warehouse.create).not.toHaveBeenCalled();
    });

    it('дубль одного external_id в ответе API схлопывается в одну запись (нормализатор)', async () => {
        const prisma = makePrismaMock();
        const svc = await buildSync(prisma);
        setupAccount(prisma, 'WB');
        prisma.warehouse.findUnique.mockResolvedValue(null);
        (axios.get as jest.Mock).mockResolvedValue({ data: [
            { id: 1001, name: 'WB А', address: 'X' },
            { id: 1001, name: 'WB А (дубль)', address: 'X' },
        ]});

        const res = await svc.syncForAccount(ACCOUNT);
        expect(res.fetched).toBe(1); // дедуп в нормализаторе
        expect(prisma.warehouse.create).toHaveBeenCalledTimes(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §16.3: Изменение названия склада во внешнем канале
// ─────────────────────────────────────────────────────────────────────────────
describe('§16.3 — внешнее переименование склада', () => {
    it('новое name/city применяется sync-ом, identity (externalWarehouseId) не меняется', async () => {
        const prisma = makePrismaMock();
        const svc = await buildSync(prisma);
        setupAccount(prisma, 'WB');
        prisma.warehouse.findUnique.mockResolvedValue({
            id: 'w1', externalWarehouseId: '1001', name: 'WB Старое',
            warehouseType: 'FBS', sourceMarketplace: 'WB', status: 'ACTIVE',
            aliasName: 'мой алиас', labels: ['hub'],
        });
        (axios.get as jest.Mock).mockResolvedValue({ data: [
            { id: 1001, name: 'WB Новое', address: 'Подольск' },
        ]});

        await svc.syncForAccount(ACCOUNT);

        const updateCall = prisma.warehouse.update.mock.calls[0][0];
        expect(updateCall.data.name).toBe('WB Новое');
        expect(updateCall.data.city).toBe('Подольск');
        // identity-поле НЕ меняется (его нет в data)
        expect(updateCall.data).not.toHaveProperty('externalWarehouseId');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §16.4: alias/labels не теряются после очередного sync
// ─────────────────────────────────────────────────────────────────────────────
describe('§16.4 — alias/labels не перетираются sync-ом', () => {
    it('повторный sync не упоминает aliasName/labels в update.data (защита tenant-local)', async () => {
        const prisma = makePrismaMock();
        const svc = await buildSync(prisma);
        setupAccount(prisma, 'WB');
        prisma.warehouse.findUnique.mockResolvedValue({
            id: 'w1', externalWarehouseId: '1001', name: 'WB',
            warehouseType: 'FBS', sourceMarketplace: 'WB', status: 'ACTIVE',
            aliasName: 'main', labels: ['hub', 'fast'],
        });
        (axios.get as jest.Mock).mockResolvedValue({ data: [
            { id: 1001, name: 'WB-v2', address: 'X' },
        ]});

        await svc.syncForAccount(ACCOUNT);

        const updateCall = prisma.warehouse.update.mock.calls[0][0];
        expect(updateCall.data).not.toHaveProperty('aliasName');
        expect(updateCall.data).not.toHaveProperty('labels');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §16.5: Исчезновение склада из API → INACTIVE
// ─────────────────────────────────────────────────────────────────────────────
describe('§16.5 — disappeared склад → INACTIVE', () => {
    it('был ACTIVE, не вернулся → INACTIVE с inactiveSince + reason, lifecycle event', async () => {
        const prisma = makePrismaMock();
        const svc = await buildSync(prisma);
        setupAccount(prisma, 'WB');
        prisma.warehouse.findUnique.mockResolvedValue({
            id: 'w1', externalWarehouseId: '1001',
            warehouseType: 'FBS', sourceMarketplace: 'WB',
            status: 'ACTIVE', aliasName: null, labels: [],
        });
        (axios.get as jest.Mock).mockResolvedValue({ data: [
            { id: 1001, name: 'A', address: '' },
        ]});
        prisma.warehouse.findMany.mockResolvedValue([
            { id: 'w-gone', externalWarehouseId: '999' },
            { id: 'w1', externalWarehouseId: '1001' },
        ]);
        prisma.warehouse.updateMany.mockResolvedValue({ count: 1 });
        const warnSpy = jest.spyOn(Logger.prototype, 'warn');

        const res = await svc.syncForAccount(ACCOUNT);

        expect(res.deactivated).toBe(1);
        expect(prisma.warehouse.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ['w-gone'] } },
            data: expect.objectContaining({
                status: 'INACTIVE',
                deactivationReason: 'NOT_RETURNED_BY_API',
                inactiveSince: expect.any(Date),
            }),
        });
        expect(warnSpy.mock.calls.some(c => String(c[0]).includes(WarehouseEvents.LIFECYCLE_INACTIVE))).toBe(true);
        warnSpy.mockRestore();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §16.6: FBS/FBO разделение (нормализация типа)
// ─────────────────────────────────────────────────────────────────────────────
describe('§16.6 — FBS/FBO нормализация', () => {
    it('Ozon /v1/warehouse/list → warehouseType=FBS, sourceMarketplace=OZON', async () => {
        const prisma = makePrismaMock();
        const svc = await buildSync(prisma);
        setupAccount(prisma, 'OZON');
        prisma.warehouse.findUnique.mockResolvedValue(null);
        (axios.post as jest.Mock).mockResolvedValue({ data: { result: [
            { warehouse_id: 200001, name: 'Ozon Хоругвино', city: 'Москва' },
        ]}});

        await svc.syncForAccount(ACCOUNT);

        expect(prisma.warehouse.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    warehouseType: 'FBS',
                    sourceMarketplace: 'OZON',
                }),
            }),
        );
    });

    it('classification change (existing FBO → FBS) логирует CLASSIFICATION_CHANGED warn', async () => {
        const prisma = makePrismaMock();
        const svc = await buildSync(prisma);
        setupAccount(prisma, 'WB');
        prisma.warehouse.findUnique.mockResolvedValue({
            id: 'w1', externalWarehouseId: '1001', name: 'X',
            warehouseType: 'FBO', sourceMarketplace: 'WB', status: 'ACTIVE',
        });
        (axios.get as jest.Mock).mockResolvedValue({ data: [
            { id: 1001, name: 'X', address: '' },
        ]});
        const warnSpy = jest.spyOn(Logger.prototype, 'warn');

        await svc.syncForAccount(ACCOUNT);

        expect(warnSpy.mock.calls.some(c => String(c[0]).includes(WarehouseEvents.CLASSIFICATION_CHANGED))).toBe(true);
        warnSpy.mockRestore();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §16.7: ACTIVE → INACTIVE → ARCHIVED transition
// ─────────────────────────────────────────────────────────────────────────────
describe('§16.7 — полный lifecycle ACTIVE → INACTIVE → ARCHIVED', () => {
    it('safe-window архивация: long-INACTIVE склад переводится в ARCHIVED', async () => {
        const prisma = makePrismaMock();
        const svc = await buildSync(prisma);
        setupAccount(prisma, 'WB');
        prisma.warehouse.findUnique.mockResolvedValue(null);
        (axios.get as jest.Mock).mockResolvedValue({ data: [] });
        prisma.warehouse.findMany
            .mockResolvedValueOnce([]) // disappeared candidates пусто
            .mockResolvedValueOnce([{ id: 'w-old', externalWarehouseId: '999' }]); // archive candidates
        prisma.warehouse.updateMany.mockResolvedValue({ count: 1 });
        const warnSpy = jest.spyOn(Logger.prototype, 'warn');

        const res = await svc.syncForAccount(ACCOUNT);

        expect(res.archived).toBe(1);
        expect(prisma.warehouse.updateMany).toHaveBeenLastCalledWith({
            where: { id: { in: ['w-old'] } },
            data: { status: 'ARCHIVED' },
        });
        expect(warnSpy.mock.calls.some(c => String(c[0]).includes(WarehouseEvents.LIFECYCLE_ARCHIVED))).toBe(true);
        warnSpy.mockRestore();
    });

    it('reactivation: возврат INACTIVE → ACTIVE обнуляет lifecycle поля', async () => {
        const prisma = makePrismaMock();
        const svc = await buildSync(prisma);
        setupAccount(prisma, 'WB');
        prisma.warehouse.findUnique.mockResolvedValue({
            id: 'w1', externalWarehouseId: '1001', name: 'WB',
            warehouseType: 'FBS', sourceMarketplace: 'WB',
            status: 'INACTIVE', inactiveSince: new Date('2026-04-01'),
            deactivationReason: 'NOT_RETURNED_BY_API',
        });
        (axios.get as jest.Mock).mockResolvedValue({ data: [
            { id: 1001, name: 'WB', address: '' },
        ]});
        const logSpy = jest.spyOn(Logger.prototype, 'log');

        const res = await svc.syncForAccount(ACCOUNT);

        expect(res.reactivated).toBe(1);
        expect(prisma.warehouse.update).toHaveBeenCalledWith({
            where: { id: 'w1' },
            data: expect.objectContaining({
                status: 'ACTIVE',
                inactiveSince: null,
                deactivationReason: null,
            }),
        });
        expect(logSpy.mock.calls.some(c => String(c[0]).includes(WarehouseEvents.LIFECYCLE_REACTIVATED))).toBe(true);
        logSpy.mockRestore();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §16.8-9: Tenant-state pause
// ─────────────────────────────────────────────────────────────────────────────
describe('§16.8-9 — manual refresh blocked в paused tenant', () => {
    it.each(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED'])(
        'syncAllForTenant в %s → paused=true, без HTTP, без БД-изменений',
        async (state) => {
            const prisma = makePrismaMock();
            prisma.tenant.findUnique.mockResolvedValue({ accessState: state });
            const svc = await buildSync(prisma);
            const warnSpy = jest.spyOn(Logger.prototype, 'warn');
            (axios.get as jest.Mock).mockReset();
            (axios.post as jest.Mock).mockReset();

            const res = await svc.syncAllForTenant(TENANT);

            expect(res.paused).toBe(true);
            expect(prisma.marketplaceAccount.findMany).not.toHaveBeenCalled();
            expect(axios.get).not.toHaveBeenCalled();
            expect(axios.post).not.toHaveBeenCalled();
            expect(warnSpy.mock.calls.some(c => String(c[0]).includes(WarehouseEvents.SYNC_PAUSED_BY_TENANT))).toBe(true);
            warnSpy.mockRestore();
        },
    );

    it.each(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED'])(
        'syncForAccount в %s → paused=true (service-level guard для прямых вызовов)',
        async (state) => {
            const prisma = makePrismaMock();
            const svc = await buildSync(prisma);
            setupAccount(prisma, 'WB');
            prisma.tenant.findUnique.mockResolvedValue({ accessState: state });
            (axios.get as jest.Mock).mockReset();
            (axios.post as jest.Mock).mockReset();

            const res = await svc.syncForAccount(ACCOUNT);

            expect(res.paused).toBe(true);
            expect(axios.get).not.toHaveBeenCalled();
            expect(axios.post).not.toHaveBeenCalled();
            expect(prisma.warehouse.create).not.toHaveBeenCalled();
            expect(prisma.warehouse.updateMany).not.toHaveBeenCalled();
        },
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// Account-related warehouse lifecycle (account перестал быть operational source)
// ─────────────────────────────────────────────────────────────────────────────
describe('Account-related lifecycle — account fail не теряет warehouse references', () => {
    it('failed API не маркирует disappeared, lastSyncStatus НЕ ok', async () => {
        const prisma = makePrismaMock();
        const svc = await buildSync(prisma);
        setupAccount(prisma, 'WB');
        (axios.get as jest.Mock).mockRejectedValue(new Error('Network down'));
        const warnSpy = jest.spyOn(Logger.prototype, 'warn');

        const res = await svc.syncForAccount(ACCOUNT);

        expect(res.error).toBeTruthy();
        expect(prisma.warehouse.create).not.toHaveBeenCalled();
        expect(prisma.warehouse.updateMany).not.toHaveBeenCalled();
        expect(prisma.marketplaceAccount.update).not.toHaveBeenCalled();
        expect(warnSpy.mock.calls.some(c => String(c[0]).includes(WarehouseEvents.SYNC_FAILED))).toBe(true);
        warnSpy.mockRestore();
    });

    it('missing API key для WB → graceful error, без удаления складов', async () => {
        const prisma = makePrismaMock();
        const svc = await buildSync(prisma);
        prisma.marketplaceAccount.findUnique.mockResolvedValue({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', apiKey: null, clientId: null,
        });

        const res = await svc.syncForAccount(ACCOUNT);

        expect(res.error).toBe('WB_API_KEY_MISSING');
        expect(prisma.warehouse.updateMany).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Audit для alias/labels updates
// ─────────────────────────────────────────────────────────────────────────────
describe('Audit для alias/labels updates', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: WarehouseService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await buildRead(prisma);
    });

    function makeWarehouse(overrides: any = {}) {
        return {
            id: 'w1', tenantId: TENANT, marketplaceAccountId: 'acc',
            externalWarehouseId: '1001', name: 'WB', city: null,
            warehouseType: 'FBS', sourceMarketplace: 'WB',
            aliasName: null, labels: [], status: 'ACTIVE',
            deactivationReason: null, firstSeenAt: new Date(),
            lastSyncedAt: new Date(), inactiveSince: null,
            marketplaceAccount: { id: 'acc', name: 'WB', marketplace: 'WB' },
            ...overrides,
        };
    }

    it('audit: metadataUpdatedAt + metadataUpdatedBy записываются в каждом успешном update', async () => {
        prisma.warehouse.findFirst.mockResolvedValue(makeWarehouse());
        prisma.warehouse.update.mockResolvedValue(makeWarehouse({ aliasName: 'main' }));

        await svc.updateMetadata(TENANT, 'w1', 'user-42', { aliasName: 'main' });

        expect(prisma.warehouse.update).toHaveBeenCalledWith({
            where: { id: 'w1' },
            data: expect.objectContaining({
                metadataUpdatedAt: expect.any(Date),
                metadataUpdatedBy: 'user-42',
            }),
            include: expect.any(Object),
        });
    });

    it('audit: эмитит METADATA_UPDATED event с aliasNameChanged/labelsChanged флагами', async () => {
        prisma.warehouse.findFirst.mockResolvedValue(makeWarehouse({ aliasName: 'old' }));
        prisma.warehouse.update.mockResolvedValue(makeWarehouse({ aliasName: 'new' }));
        const logSpy = jest.spyOn(Logger.prototype, 'log');

        await svc.updateMetadata(TENANT, 'w1', 'user-42', { aliasName: 'new', labels: ['hub'] });

        const matchingCall = logSpy.mock.calls.find(c => String(c[0]).includes(WarehouseEvents.METADATA_UPDATED));
        expect(matchingCall).toBeDefined();
        const payload = JSON.parse(String(matchingCall![0]));
        expect(payload).toMatchObject({
            event: WarehouseEvents.METADATA_UPDATED,
            tenantId: TENANT,
            warehouseId: 'w1',
            externalWarehouseId: '1001',
            actorUserId: 'user-42',
            aliasNameChanged: true,
            labelsChanged: true,
        });
        logSpy.mockRestore();
    });

    it('защита идентичности — попытка изменить identity-поле блокируется до БД-вызова', async () => {
        await expect(
            svc.updateMetadata(TENANT, 'w1', 'u', { aliasName: 'x', externalWarehouseId: 'attempt' } as any),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.warehouse.findFirst).not.toHaveBeenCalled();
        expect(prisma.warehouse.update).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reference visibility — historical склады остаются в read API
// ─────────────────────────────────────────────────────────────────────────────
describe('Reference visibility — historical склады не теряются', () => {
    it('list по умолчанию возвращает все статусы (ACTIVE + INACTIVE + ARCHIVED)', async () => {
        const prisma = makePrismaMock();
        const svc = await buildRead(prisma);
        prisma.warehouse.findMany.mockResolvedValue([]);
        prisma.warehouse.count.mockResolvedValue(0);

        await svc.list(TENANT);

        const where = prisma.warehouse.findMany.mock.calls[0][0].where;
        expect(where).not.toHaveProperty('status');
    });

    it('getById для INACTIVE склада возвращает запись с deactivationReason', async () => {
        const prisma = makePrismaMock();
        const svc = await buildRead(prisma);
        prisma.warehouse.findFirst.mockResolvedValue({
            id: 'w1', tenantId: TENANT, marketplaceAccountId: 'acc',
            externalWarehouseId: '999', name: 'X', city: null,
            warehouseType: 'FBS', sourceMarketplace: 'WB',
            aliasName: null, labels: [], status: 'INACTIVE',
            deactivationReason: 'NOT_RETURNED_BY_API',
            firstSeenAt: new Date(), lastSyncedAt: new Date(), inactiveSince: new Date(),
            marketplaceAccount: { id: 'acc', name: 'WB', marketplace: 'WB' },
        });

        const res = await svc.getById(TENANT, 'w1');
        expect(res.status).toBe('INACTIVE');
        expect(res.deactivationReason).toBe('NOT_RETURNED_BY_API');
    });
});
