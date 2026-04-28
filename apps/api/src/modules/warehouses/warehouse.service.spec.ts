import { Test } from '@nestjs/testing';
import { Logger, NotFoundException } from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@prisma/client', () => {
    class PrismaClient {}
    return {
        PrismaClient,
        Prisma: { sql: function () { return { _sql: true }; } },
        WarehouseStatus: { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE', ARCHIVED: 'ARCHIVED' },
        WarehouseType: { FBS: 'FBS', FBO: 'FBO' },
        WarehouseSourceMarketplace: { WB: 'WB', OZON: 'OZON', YANDEX_MARKET: 'YANDEX_MARKET' },
    };
});

const TENANT = 't1';
const WH_ID = 'wh-1';

function makePrismaMock() {
    return {
        warehouse: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
        stockBalance: { findMany: jest.fn() },
    };
}

async function build(prisma: any) {
    const moduleRef = await Test.createTestingModule({
        providers: [
            WarehouseService,
            { provide: PrismaService, useValue: prisma },
        ],
    }).setLogger(new Logger()).compile();
    return moduleRef.get(WarehouseService);
}

describe('WarehouseService.list', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: WarehouseService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
    });

    it('возвращает список с pagination и read-model', async () => {
        prisma.warehouse.findMany.mockResolvedValue([
            {
                id: 'w1',
                tenantId: TENANT,
                marketplaceAccountId: 'acc-1',
                externalWarehouseId: '1001',
                name: 'WB Коледино',
                city: 'Москва',
                warehouseType: 'FBS',
                sourceMarketplace: 'WB',
                aliasName: 'main',
                labels: ['hub'],
                status: 'ACTIVE',
                deactivationReason: null,
                firstSeenAt: new Date(),
                lastSyncedAt: new Date(),
                inactiveSince: null,
                marketplaceAccount: { id: 'acc-1', name: 'WB Main', marketplace: 'WB' },
            },
        ]);
        prisma.warehouse.count.mockResolvedValue(1);

        const res = await svc.list(TENANT, { page: 1, limit: 50 });

        expect(res.meta).toMatchObject({ total: 1, page: 1, limit: 50, lastPage: 1 });
        expect(res.data[0]).toMatchObject({
            id: 'w1',
            externalWarehouseId: '1001',
            warehouseType: 'FBS',
            sourceMarketplace: 'WB',
            aliasName: 'main',
            labels: ['hub'],
            status: 'ACTIVE',
            marketplaceAccount: { id: 'acc-1', marketplace: 'WB' },
        });
    });

    it('фильтр по marketplaceAccountId, sourceMarketplace, type, status', async () => {
        prisma.warehouse.findMany.mockResolvedValue([]);
        prisma.warehouse.count.mockResolvedValue(0);

        await svc.list(TENANT, {
            marketplaceAccountId: 'acc-2',
            sourceMarketplace: 'WB' as any,
            warehouseType: 'FBS' as any,
            status: 'ACTIVE' as any,
        });

        expect(prisma.warehouse.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    tenantId: TENANT,
                    marketplaceAccountId: 'acc-2',
                    sourceMarketplace: 'WB',
                    warehouseType: 'FBS',
                    status: 'ACTIVE',
                },
            }),
        );
    });

    it('search ищет по name/aliasName/city case-insensitive', async () => {
        prisma.warehouse.findMany.mockResolvedValue([]);
        prisma.warehouse.count.mockResolvedValue(0);

        await svc.list(TENANT, { search: 'кол' });

        const call = prisma.warehouse.findMany.mock.calls[0][0];
        expect(call.where.OR).toEqual(
            expect.arrayContaining([
                { name: { contains: 'кол', mode: 'insensitive' } },
                { aliasName: { contains: 'кол', mode: 'insensitive' } },
                { city: { contains: 'кол', mode: 'insensitive' } },
            ]),
        );
    });

    it('limit clamp: > 200 → 50, отрицательный → 50', async () => {
        prisma.warehouse.findMany.mockResolvedValue([]);
        prisma.warehouse.count.mockResolvedValue(0);

        await svc.list(TENANT, { limit: 1000 });
        expect(prisma.warehouse.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));

        prisma.warehouse.findMany.mockClear();
        await svc.list(TENANT, { limit: -5 });
        expect(prisma.warehouse.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
    });

    it('по умолчанию возвращает все статусы (включая INACTIVE/ARCHIVED) для reference visibility', async () => {
        prisma.warehouse.findMany.mockResolvedValue([]);
        prisma.warehouse.count.mockResolvedValue(0);

        await svc.list(TENANT);

        const where = prisma.warehouse.findMany.mock.calls[0][0].where;
        expect(where).not.toHaveProperty('status');
    });
});

describe('WarehouseService.getById', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: WarehouseService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
    });

    it('возвращает карточку склада', async () => {
        prisma.warehouse.findFirst.mockResolvedValue({
            id: WH_ID, tenantId: TENANT, marketplaceAccountId: 'acc',
            externalWarehouseId: '999', name: 'X', city: null,
            warehouseType: 'FBS', sourceMarketplace: 'WB',
            aliasName: null, labels: [], status: 'INACTIVE',
            deactivationReason: 'NOT_RETURNED_BY_API',
            firstSeenAt: new Date(), lastSyncedAt: new Date(), inactiveSince: new Date(),
            marketplaceAccount: { id: 'acc', name: 'WB', marketplace: 'WB' },
        });

        const res = await svc.getById(TENANT, WH_ID);
        expect(res.id).toBe(WH_ID);
        expect(res.status).toBe('INACTIVE');
        expect(res.deactivationReason).toBe('NOT_RETURNED_BY_API');
    });

    it('бросает WAREHOUSE_NOT_FOUND для чужого/несуществующего склада', async () => {
        prisma.warehouse.findFirst.mockResolvedValue(null);
        await expect(svc.getById(TENANT, 'nope')).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'WAREHOUSE_NOT_FOUND' }),
        });
    });
});

describe('WarehouseService.getStocks', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: WarehouseService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
    });

    it('агрегирует балансы по externalWarehouseId (bridge с MVP), исключает удалённые продукты', async () => {
        prisma.warehouse.findFirst.mockResolvedValue({
            id: WH_ID, externalWarehouseId: '1001', name: 'WB-1',
            aliasName: null, warehouseType: 'FBS', sourceMarketplace: 'WB', status: 'ACTIVE',
        });
        prisma.stockBalance.findMany.mockResolvedValue([
            {
                productId: 'p1', warehouseId: '1001',
                onHand: 10, reserved: 2, available: 8,
                fulfillmentMode: 'FBS', isExternal: false,
                product: { id: 'p1', sku: 'A', name: 'A', deletedAt: null },
            },
            {
                productId: 'p2', warehouseId: '1001',
                onHand: 3, reserved: 0, available: 3,
                fulfillmentMode: 'FBS', isExternal: false,
                product: { id: 'p2', sku: 'B', name: 'B', deletedAt: new Date() }, // удалённый — фильтруется
            },
            {
                productId: 'p3', warehouseId: '1001',
                onHand: 5, reserved: 1, available: 4,
                fulfillmentMode: 'FBS', isExternal: false,
                product: { id: 'p3', sku: 'C', name: 'C', deletedAt: null },
            },
        ]);

        const res = await svc.getStocks(TENANT, WH_ID);

        expect(res.warehouse).toMatchObject({ id: WH_ID, externalWarehouseId: '1001' });
        expect(res.count).toBe(2);
        expect(res.totals).toEqual({ onHand: 15, reserved: 3, available: 12 });
        expect(prisma.stockBalance.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { tenantId: TENANT, warehouseId: '1001' },
            }),
        );
    });

    it('бросает WAREHOUSE_NOT_FOUND для чужого склада', async () => {
        prisma.warehouse.findFirst.mockResolvedValue(null);
        await expect(svc.getStocks(TENANT, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('пустой ответ для склада без балансов — totals=0', async () => {
        prisma.warehouse.findFirst.mockResolvedValue({
            id: WH_ID, externalWarehouseId: 'unmatched',
            name: 'X', aliasName: null,
            warehouseType: 'FBS', sourceMarketplace: 'WB', status: 'ACTIVE',
        });
        prisma.stockBalance.findMany.mockResolvedValue([]);

        const res = await svc.getStocks(TENANT, WH_ID);
        expect(res.count).toBe(0);
        expect(res.totals).toEqual({ onHand: 0, reserved: 0, available: 0 });
    });

    it('clamp negative available в totals', async () => {
        prisma.warehouse.findFirst.mockResolvedValue({
            id: WH_ID, externalWarehouseId: 'w', name: 'X', aliasName: null,
            warehouseType: 'FBS', sourceMarketplace: 'WB', status: 'ACTIVE',
        });
        prisma.stockBalance.findMany.mockResolvedValue([
            {
                productId: 'p1', warehouseId: 'w',
                onHand: 0, reserved: 0, available: -3, // не должно случиться, защита
                fulfillmentMode: 'FBS', isExternal: false,
                product: { id: 'p1', sku: 'X', name: 'X', deletedAt: null },
            },
        ]);

        const res = await svc.getStocks(TENANT, WH_ID);
        expect(res.totals.available).toBe(0);
    });
});
