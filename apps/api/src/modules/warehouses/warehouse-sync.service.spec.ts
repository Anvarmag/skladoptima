import { Test } from '@nestjs/testing';
import { Logger, NotFoundException } from '@nestjs/common';
import { WarehouseSyncService } from './warehouse-sync.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@prisma/client', () => {
    class PrismaClient {}
    return {
        PrismaClient,
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
const ACCOUNT = 'acc-wb-1';
const ACCOUNT_OZON = 'acc-ozon-1';

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
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
    };
}

async function build(prisma: any) {
    const moduleRef = await Test.createTestingModule({
        providers: [
            WarehouseSyncService,
            { provide: PrismaService, useValue: prisma },
        ],
    }).setLogger(new Logger()).compile();
    return moduleRef.get(WarehouseSyncService);
}

describe('WarehouseSyncService — нормализация WB', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: WarehouseSyncService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
        (axios.get as jest.Mock).mockReset();
        (axios.post as jest.Mock).mockReset();
    });

    it('первичная загрузка: создаёт ACTIVE warehouse, fetched/created счётчики', async () => {
        prisma.marketplaceAccount.findUnique.mockResolvedValue({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', apiKey: 'key', clientId: null,
        });
        prisma.warehouse.findUnique.mockResolvedValue(null);
        (axios.get as jest.Mock).mockResolvedValue({ data: [
            { id: 1001, name: 'WB Коледино', address: 'Москва, Коледино, д.1' },
            { id: 1002, name: 'WB Электросталь', address: 'Электросталь' },
        ]});

        const res = await svc.syncForAccount(ACCOUNT);

        expect(res).toMatchObject({
            fetched: 2, created: 2, updated: 0, deactivated: 0, archived: 0, reactivated: 0,
            sourceMarketplace: 'WB',
        });
        expect(prisma.warehouse.create).toHaveBeenCalledTimes(2);
        expect(prisma.warehouse.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    tenantId: TENANT,
                    marketplaceAccountId: ACCOUNT,
                    externalWarehouseId: '1001',
                    name: 'WB Коледино',
                    city: 'Москва',
                    warehouseType: 'FBS',
                    sourceMarketplace: 'WB',
                    status: 'ACTIVE',
                }),
            }),
        );
        expect(prisma.marketplaceAccount.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ lastSyncStatus: 'ok' }) }),
        );
    });

    it('повторный sync: тот же набор → updated, не дублирует', async () => {
        prisma.marketplaceAccount.findUnique.mockResolvedValue({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', apiKey: 'key', clientId: null,
        });
        prisma.warehouse.findUnique.mockResolvedValue({
            id: 'w1', externalWarehouseId: '1001', name: 'Old', city: null,
            warehouseType: 'FBS', sourceMarketplace: 'WB', status: 'ACTIVE',
            aliasName: 'мой алиас', labels: ['main'],
        });
        (axios.get as jest.Mock).mockResolvedValue({ data: [
            { id: 1001, name: 'WB Коледино', address: 'Москва' },
        ]});

        const res = await svc.syncForAccount(ACCOUNT);

        expect(res.created).toBe(0);
        expect(res.updated).toBe(1);
        // ВАЖНО: aliasName и labels НЕ перезаписываются sync-логикой.
        expect(prisma.warehouse.update).toHaveBeenCalledWith({
            where: { id: 'w1' },
            data: expect.not.objectContaining({ aliasName: expect.anything() }),
        });
        expect(prisma.warehouse.update).toHaveBeenCalledWith({
            where: { id: 'w1' },
            data: expect.not.objectContaining({ labels: expect.anything() }),
        });
    });

    it('disappeared склад: ACTIVE → INACTIVE с inactiveSince и deactivationReason', async () => {
        prisma.marketplaceAccount.findUnique.mockResolvedValue({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', apiKey: 'key', clientId: null,
        });
        // API вернул только склад 1001
        (axios.get as jest.Mock).mockResolvedValue({ data: [
            { id: 1001, name: 'A', address: '' },
        ]});
        // findUnique для существующей записи 1001
        prisma.warehouse.findUnique.mockResolvedValue({
            id: 'w1', externalWarehouseId: '1001', warehouseType: 'FBS', sourceMarketplace: 'WB',
            status: 'ACTIVE', aliasName: null, labels: [],
        });
        // findMany для disappeared candidates: пришёл 1001, в базе ещё 1002
        prisma.warehouse.findMany.mockResolvedValue([
            { id: 'w2', externalWarehouseId: '1002' },
            { id: 'w1', externalWarehouseId: '1001' },
        ]);
        prisma.warehouse.updateMany.mockResolvedValue({ count: 1 });

        const res = await svc.syncForAccount(ACCOUNT);

        expect(res.deactivated).toBe(1);
        expect(prisma.warehouse.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ['w2'] } },
            data: expect.objectContaining({
                status: 'INACTIVE',
                deactivationReason: 'NOT_RETURNED_BY_API',
                inactiveSince: expect.any(Date),
            }),
        });
    });

    it('reactivation: возврат INACTIVE → ACTIVE обнуляет lifecycle поля', async () => {
        prisma.marketplaceAccount.findUnique.mockResolvedValue({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', apiKey: 'key', clientId: null,
        });
        prisma.warehouse.findUnique.mockResolvedValue({
            id: 'w1', externalWarehouseId: '1001', name: 'WB',
            warehouseType: 'FBS', sourceMarketplace: 'WB',
            status: 'INACTIVE', inactiveSince: new Date('2026-04-01'),
            deactivationReason: 'NOT_RETURNED_BY_API',
            aliasName: 'alias', labels: ['x'],
        });
        (axios.get as jest.Mock).mockResolvedValue({ data: [
            { id: 1001, name: 'WB-v2', address: 'Москва' },
        ]});

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
    });

    it('safe-window архивация: long-INACTIVE → ARCHIVED', async () => {
        prisma.marketplaceAccount.findUnique.mockResolvedValue({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', apiKey: 'key', clientId: null,
        });
        (axios.get as jest.Mock).mockResolvedValue({ data: [] });
        prisma.warehouse.findUnique.mockResolvedValue(null);

        // findMany первый раз для disappeared candidates ACTIVE — пусто
        prisma.warehouse.findMany.mockResolvedValueOnce([]);
        // findMany второй раз для archive candidates — найдена 1 long-INACTIVE
        prisma.warehouse.findMany.mockResolvedValueOnce([
            { id: 'w-old', externalWarehouseId: '999' },
        ]);
        prisma.warehouse.updateMany.mockResolvedValue({ count: 1 });

        const res = await svc.syncForAccount(ACCOUNT);

        expect(res.archived).toBe(1);
        // Второй updateMany — архивация
        expect(prisma.warehouse.updateMany).toHaveBeenLastCalledWith({
            where: { id: { in: ['w-old'] } },
            data: { status: 'ARCHIVED' },
        });
    });

    it('failed API: НЕ применяет lifecycle, не маркирует disappeared, lastSyncStatus НЕ ok', async () => {
        prisma.marketplaceAccount.findUnique.mockResolvedValue({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', apiKey: 'key', clientId: null,
        });
        (axios.get as jest.Mock).mockRejectedValue(new Error('Network down'));

        const res = await svc.syncForAccount(ACCOUNT);

        expect(res.error).toBeTruthy();
        expect(res.deactivated).toBe(0);
        expect(res.archived).toBe(0);
        expect(prisma.warehouse.updateMany).not.toHaveBeenCalled();
        expect(prisma.warehouse.create).not.toHaveBeenCalled();
        expect(prisma.warehouse.update).not.toHaveBeenCalled();
        // marketplaceAccount.update тоже не должен помечать ok при failed
        expect(prisma.marketplaceAccount.update).not.toHaveBeenCalled();
    });

    it('missing WB API key → error WB_API_KEY_MISSING без HTTP-вызова', async () => {
        prisma.marketplaceAccount.findUnique.mockResolvedValue({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', apiKey: null, clientId: null,
        });

        const res = await svc.syncForAccount(ACCOUNT);

        expect(res.error).toBe('WB_API_KEY_MISSING');
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('classification change: WB→OZON или FBS→FBO логирует CLASSIFICATION_CHANGED', async () => {
        prisma.marketplaceAccount.findUnique.mockResolvedValue({
            id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', apiKey: 'key', clientId: null,
        });
        prisma.warehouse.findUnique.mockResolvedValue({
            id: 'w1', externalWarehouseId: '1001', name: 'X',
            warehouseType: 'FBO', sourceMarketplace: 'WB', status: 'ACTIVE',
        });
        (axios.get as jest.Mock).mockResolvedValue({ data: [
            { id: 1001, name: 'X', address: '' },
        ]});
        const warnSpy = jest.spyOn(Logger.prototype, 'warn');

        await svc.syncForAccount(ACCOUNT);

        expect(warnSpy.mock.calls.some(c => String(c[0]).includes('warehouse_classification_changed'))).toBe(true);
        warnSpy.mockRestore();
    });
});

describe('WarehouseSyncService — нормализация Ozon', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: WarehouseSyncService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
        (axios.post as jest.Mock).mockReset();
    });

    it('Ozon /v1/warehouse/list: warehouse_id+name → upsert с sourceMarketplace=OZON', async () => {
        prisma.marketplaceAccount.findUnique.mockResolvedValue({
            id: ACCOUNT_OZON, tenantId: TENANT, marketplace: 'OZON', apiKey: 'k', clientId: 'cid',
        });
        prisma.warehouse.findUnique.mockResolvedValue(null);
        (axios.post as jest.Mock).mockResolvedValue({ data: { result: [
            { warehouse_id: 200001, name: 'Ozon Хоругвино', city: 'Москва', is_rfbs: true },
            { warehouse_id: 200002, name: 'Ozon Тверь' },
        ]}});

        const res = await svc.syncForAccount(ACCOUNT_OZON);

        expect(res.fetched).toBe(2);
        expect(res.created).toBe(2);
        expect(prisma.warehouse.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    sourceMarketplace: 'OZON',
                    warehouseType: 'FBS',
                    externalWarehouseId: '200001',
                    name: 'Ozon Хоругвино',
                    city: 'Москва',
                }),
            }),
        );
    });

    it('Ozon без credentials → error OZON_CREDENTIALS_MISSING без HTTP', async () => {
        prisma.marketplaceAccount.findUnique.mockResolvedValue({
            id: ACCOUNT_OZON, tenantId: TENANT, marketplace: 'OZON', apiKey: null, clientId: 'cid',
        });

        const res = await svc.syncForAccount(ACCOUNT_OZON);

        expect(res.error).toBe('OZON_CREDENTIALS_MISSING');
        expect(axios.post).not.toHaveBeenCalled();
    });
});

describe('WarehouseSyncService — tenant-state pause', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: WarehouseSyncService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
        (axios.get as jest.Mock).mockReset();
        (axios.post as jest.Mock).mockReset();
    });

    it.each(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED'])(
        'syncAllForTenant в %s → paused=true, ни одного аккаунта не дёргает',
        async (state) => {
            prisma.tenant.findUnique.mockResolvedValue({ accessState: state });
            const warnSpy = jest.spyOn(Logger.prototype, 'warn');

            const res = await svc.syncAllForTenant(TENANT);

            expect(res.paused).toBe(true);
            expect(res.results).toEqual([]);
            expect(prisma.marketplaceAccount.findMany).not.toHaveBeenCalled();
            expect(axios.get).not.toHaveBeenCalled();
            expect(axios.post).not.toHaveBeenCalled();
            expect(warnSpy.mock.calls.some(c => String(c[0]).includes('warehouse_sync_paused_by_tenant_state'))).toBe(true);
            warnSpy.mockRestore();
        },
    );

    it('syncAllForTenant в ACTIVE_PAID → итерирует accounts', async () => {
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'ACTIVE_PAID' });
        prisma.marketplaceAccount.findMany.mockResolvedValue([
            { id: 'a1', tenantId: TENANT, marketplace: 'WB', apiKey: null, clientId: null },
        ]);
        prisma.marketplaceAccount.findUnique.mockResolvedValue({
            id: 'a1', tenantId: TENANT, marketplace: 'WB', apiKey: null, clientId: null,
        });

        const res = await svc.syncAllForTenant(TENANT);

        expect(res.paused).toBe(false);
        expect(res.results).toHaveLength(1);
        expect(res.results[0].error).toBe('WB_API_KEY_MISSING');
    });

    it('TENANT_NOT_FOUND для несуществующего tenant', async () => {
        prisma.tenant.findUnique.mockResolvedValue(null);
        await expect(svc.syncAllForTenant(TENANT)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('MARKETPLACE_ACCOUNT_NOT_FOUND для отсутствующего account', async () => {
        prisma.marketplaceAccount.findUnique.mockResolvedValue(null);
        await expect(svc.syncForAccount('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
});
