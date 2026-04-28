import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

jest.mock('@prisma/client', () => {
    class PrismaClient {}
    return {
        PrismaClient,
        Prisma: {
            sql: function () { return { _sql: true }; },
        },
        StockMovementType: {
            MANUAL_ADD: 'MANUAL_ADD',
            MANUAL_REMOVE: 'MANUAL_REMOVE',
            ORDER_RESERVED: 'ORDER_RESERVED',
            ORDER_RELEASED: 'ORDER_RELEASED',
            ORDER_DEDUCTED: 'ORDER_DEDUCTED',
            INVENTORY_ADJUSTMENT: 'INVENTORY_ADJUSTMENT',
            RETURN_LOGGED: 'RETURN_LOGGED',
            CONFLICT_DETECTED: 'CONFLICT_DETECTED',
        },
        StockMovementSource: { USER: 'USER', SYSTEM: 'SYSTEM', MARKETPLACE: 'MARKETPLACE' },
        InventoryFulfillmentMode: { FBS: 'FBS', FBO: 'FBO' },
        ActionType: { STOCK_ADJUSTED: 'STOCK_ADJUSTED' },
        AccessState: {
            EARLY_ACCESS: 'EARLY_ACCESS',
            TRIAL_ACTIVE: 'TRIAL_ACTIVE',
            TRIAL_EXPIRED: 'TRIAL_EXPIRED',
            ACTIVE_PAID: 'ACTIVE_PAID',
            GRACE_PERIOD: 'GRACE_PERIOD',
            SUSPENDED: 'SUSPENDED',
            CLOSED: 'CLOSED',
        },
        InventoryEffectType: {
            ORDER_RESERVE: 'ORDER_RESERVE',
            ORDER_RELEASE: 'ORDER_RELEASE',
            ORDER_DEDUCT: 'ORDER_DEDUCT',
            SYNC_RECONCILE: 'SYNC_RECONCILE',
        },
        InventoryEffectStatus: {
            PROCESSING: 'PROCESSING',
            APPLIED: 'APPLIED',
            IGNORED: 'IGNORED',
            FAILED: 'FAILED',
        },
    };
});

const TENANT = 'tenant-1';
const ACTOR = 'admin@example.com';
const USER_ID = 'user-1';
const PRODUCT_ID = 'prod-1';
const BALANCE_ID = 'bal-1';

function makePrismaMock() {
    const prisma = {
        product: {
            findFirst: jest.fn(),
            findMany: jest.fn(),
            count: jest.fn(),
            update: jest.fn(),
        },
        stockBalance: {
            findMany: jest.fn(),
            upsert: jest.fn(),
            update: jest.fn(),
        },
        stockMovement: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            findMany: jest.fn(),
            count: jest.fn(),
            create: jest.fn(),
        },
        inventorySettings: {
            findUnique: jest.fn(),
            upsert: jest.fn(),
        },
        tenant: {
            findUnique: jest.fn().mockResolvedValue({ accessState: 'ACTIVE_PAID' }),
        },
        inventoryEffectLock: {
            upsert: jest.fn().mockResolvedValue({}),
        },
        $transaction: jest.fn(),
        $queryRaw: jest.fn(),
    };

    // По умолчанию $transaction прокидывает callback с самим prisma как tx
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));

    return prisma;
}

function makeAuditMock(): AuditService {
    return { logAction: jest.fn().mockResolvedValue({}) } as unknown as AuditService;
}

async function build(prisma: any, audit: AuditService) {
    const moduleRef = await Test.createTestingModule({
        providers: [
            InventoryService,
            { provide: PrismaService, useValue: prisma },
            { provide: AuditService, useValue: audit },
        ],
    })
        .setLogger(new Logger())
        .compile();
    return moduleRef.get(InventoryService);
}

describe('InventoryService — adjustments', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let audit: AuditService;
    let svc: InventoryService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        audit = makeAuditMock();
        svc = await build(prisma, audit);
    });

    it('создаёт корректировку с положительным delta, пишет movement и обновляет Product.total bridge', async () => {
        prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID, sku: 'SKU-1', total: 10, reserved: 2 });
        prisma.stockBalance.upsert.mockResolvedValue({ id: BALANCE_ID });
        prisma.$queryRaw.mockResolvedValue([{ id: BALANCE_ID, onHand: 10, reserved: 2, isExternal: false }]);
        prisma.stockBalance.update.mockResolvedValue({});
        prisma.stockMovement.create.mockResolvedValue({ id: 'mov-1', delta: 5 });
        prisma.product.update.mockResolvedValue({});

        const result = await svc.createAdjustment(TENANT, ACTOR, USER_ID, {
            productId: PRODUCT_ID,
            delta: 5,
            reasonCode: 'FOUND',
        });

        expect(result.movementId).toBe('mov-1');
        expect(result.onHandBefore).toBe(10);
        expect(result.onHandAfter).toBe(15);
        expect(result.availableAfter).toBe(13);
        expect(prisma.stockMovement.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    movementType: 'MANUAL_ADD',
                    delta: 5,
                    reasonCode: 'FOUND',
                    onHandBefore: 10,
                    onHandAfter: 15,
                    source: 'USER',
                }),
            }),
        );
        expect(prisma.product.update).toHaveBeenCalledWith({ where: { id: PRODUCT_ID }, data: { total: 15 } });
        expect(audit.logAction).toHaveBeenCalledWith(
            expect.objectContaining({ actionType: 'STOCK_ADJUSTED', delta: 5, beforeTotal: 10, afterTotal: 15 }),
        );
    });

    it('переводит targetQuantity в delta и применяет', async () => {
        prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID, sku: 'SKU-1', total: 8, reserved: 0 });
        prisma.stockBalance.upsert.mockResolvedValue({ id: BALANCE_ID });
        prisma.$queryRaw.mockResolvedValue([{ id: BALANCE_ID, onHand: 8, reserved: 0, isExternal: false }]);
        prisma.stockMovement.create.mockResolvedValue({ id: 'mov-2', delta: -3 });

        const result = await svc.createAdjustment(TENANT, ACTOR, USER_ID, {
            productId: PRODUCT_ID,
            targetQuantity: 5,
            reasonCode: 'RECOUNT',
        });

        expect(result.onHandAfter).toBe(5);
        expect(prisma.stockMovement.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ movementType: 'MANUAL_REMOVE', delta: -3 }) }),
        );
    });

    it('блокирует уход в отрицательный onHand', async () => {
        prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID, sku: 'SKU-1', total: 2, reserved: 0 });
        prisma.stockBalance.upsert.mockResolvedValue({ id: BALANCE_ID });
        prisma.$queryRaw.mockResolvedValue([{ id: BALANCE_ID, onHand: 2, reserved: 0, isExternal: false }]);

        await expect(
            svc.createAdjustment(TENANT, ACTOR, USER_ID, { productId: PRODUCT_ID, delta: -5, reasonCode: 'LOSS' }),
        ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'NEGATIVE_STOCK_NOT_ALLOWED' }) });

        expect(prisma.stockMovement.create).not.toHaveBeenCalled();
        expect(audit.logAction).not.toHaveBeenCalled();
    });

    it('блокирует, если reserved превысил бы onHand для управляемого склада', async () => {
        prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID, sku: 'SKU-1', total: 10, reserved: 7 });
        prisma.stockBalance.upsert.mockResolvedValue({ id: BALANCE_ID });
        prisma.$queryRaw.mockResolvedValue([{ id: BALANCE_ID, onHand: 10, reserved: 7, isExternal: false }]);

        await expect(
            svc.createAdjustment(TENANT, ACTOR, USER_ID, { productId: PRODUCT_ID, delta: -5, reasonCode: 'LOSS' }),
        ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'RESERVED_EXCEEDS_ONHAND' }) });
    });

    it('требует delta или targetQuantity', async () => {
        await expect(
            svc.createAdjustment(TENANT, ACTOR, USER_ID, { productId: PRODUCT_ID, reasonCode: 'LOSS' } as any),
        ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ADJUSTMENT_MODE_REQUIRED' }) });
    });

    it('запрещает одновременно delta и targetQuantity', async () => {
        await expect(
            svc.createAdjustment(TENANT, ACTOR, USER_ID, {
                productId: PRODUCT_ID,
                delta: 1,
                targetQuantity: 5,
                reasonCode: 'LOSS',
            } as any),
        ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ADJUSTMENT_MODE_AMBIGUOUS' }) });
    });

    it('запрещает delta=0', async () => {
        await expect(
            svc.createAdjustment(TENANT, ACTOR, USER_ID, { productId: PRODUCT_ID, delta: 0, reasonCode: 'LOSS' }),
        ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ADJUSTMENT_DELTA_ZERO' }) });
    });

    it('запрещает no-op targetQuantity (target == current)', async () => {
        prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID, sku: 'SKU-1', total: 5, reserved: 0 });
        prisma.stockBalance.upsert.mockResolvedValue({ id: BALANCE_ID });
        prisma.$queryRaw.mockResolvedValue([{ id: BALANCE_ID, onHand: 5, reserved: 0, isExternal: false }]);

        await expect(
            svc.createAdjustment(TENANT, ACTOR, USER_ID, {
                productId: PRODUCT_ID,
                targetQuantity: 5,
                reasonCode: 'RECOUNT',
            }),
        ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ADJUSTMENT_NOOP' }) });
    });

    it('обрабатывает идемпотентный replay: возвращает существующий movement без новой записи', async () => {
        const existing = {
            id: 'mov-existing',
            onHandBefore: 10,
            onHandAfter: 12,
            reservedBefore: 0,
            reservedAfter: 0,
            reasonCode: 'FOUND',
        };
        prisma.stockMovement.findFirst.mockResolvedValue(existing);
        prisma.stockMovement.findUnique.mockResolvedValue(existing);

        const result = await svc.createAdjustment(TENANT, ACTOR, USER_ID, {
            productId: PRODUCT_ID,
            delta: 2,
            reasonCode: 'FOUND',
            idempotencyKey: 'idem-1',
        });

        expect(result).toMatchObject({ movementId: 'mov-existing', replayed: true });
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    });

    it('бросает PRODUCT_NOT_FOUND для удалённого/чужого продукта', async () => {
        prisma.product.findFirst.mockResolvedValue(null);

        await expect(
            svc.createAdjustment(TENANT, ACTOR, USER_ID, { productId: 'other', delta: 1, reasonCode: 'FOUND' }),
        ).rejects.toBeInstanceOf(NotFoundException);
    });
});

describe('InventoryService — listings', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: InventoryService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma, makeAuditMock());
    });

    it('listStocks — фоллбек на Product.total если StockBalance пуст', async () => {
        prisma.product.findMany.mockResolvedValue([
            { id: 'p1', sku: 'S1', name: 'P1', photo: null, total: 7, reserved: 2, stockBalances: [] },
        ]);
        prisma.product.count.mockResolvedValue(1);

        const res = await svc.listStocks(TENANT);
        expect(res.data[0]).toMatchObject({
            productId: 'p1',
            onHand: 7,
            reserved: 2,
            available: 5,
        });
        expect(res.data[0].balances).toHaveLength(1);
        expect(res.data[0].balances[0]).toMatchObject({ warehouseId: 'default', isExternal: false });
    });

    it('listStocks — агрегирует по управляемым (не external) балансам', async () => {
        prisma.product.findMany.mockResolvedValue([
            {
                id: 'p1',
                sku: 'S1',
                name: 'P1',
                photo: null,
                total: 0,
                reserved: 0,
                stockBalances: [
                    { warehouseId: 'fbs1', fulfillmentMode: 'FBS', isExternal: false, onHand: 5, reserved: 1, available: 4 },
                    { warehouseId: 'fbs2', fulfillmentMode: 'FBS', isExternal: false, onHand: 3, reserved: 0, available: 3 },
                    { warehouseId: 'fbo1', fulfillmentMode: 'FBO', isExternal: true, onHand: 100, reserved: 0, available: 100 },
                ],
            },
        ]);
        prisma.product.count.mockResolvedValue(1);

        const res = await svc.listStocks(TENANT);
        expect(res.data[0]).toMatchObject({ onHand: 8, reserved: 1, available: 7 });
        expect(res.data[0].balances).toHaveLength(3);
    });

    it('listLowStock — собирает из StockBalance + фоллбек по продуктам без баланса', async () => {
        prisma.inventorySettings.findUnique.mockResolvedValue({ tenantId: TENANT, lowStockThreshold: 5 });
        prisma.stockBalance.findMany.mockResolvedValue([
            {
                productId: 'p1',
                warehouseId: 'fbs1',
                onHand: 3,
                reserved: 0,
                available: 3,
                product: { id: 'p1', sku: 'S1', name: 'P1', deletedAt: null },
            },
        ]);
        prisma.product.findMany.mockResolvedValue([
            { id: 'p2', sku: 'S2', name: 'P2', total: 2, reserved: 0 }, // тоже low
            { id: 'p3', sku: 'S3', name: 'P3', total: 50, reserved: 0 }, // выше порога
        ]);

        const res = await svc.listLowStock(TENANT);
        expect(res.threshold).toBe(5);
        expect(res.items).toHaveLength(2);
        expect(res.items.find((i) => i.productId === 'p1')?.source).toBe('balance');
        expect(res.items.find((i) => i.productId === 'p2')?.source).toBe('product_fallback');
    });

    it('listLowStock — override threshold', async () => {
        prisma.inventorySettings.findUnique.mockResolvedValue({ tenantId: TENANT, lowStockThreshold: 5 });
        prisma.stockBalance.findMany.mockResolvedValue([]);
        prisma.product.findMany.mockResolvedValue([{ id: 'p1', sku: 'S1', name: 'P1', total: 1, reserved: 0 }]);

        const res = await svc.listLowStock(TENANT, 0);
        expect(res.threshold).toBe(0);
        // p1 имеет available=1 > 0 → не попадает
        expect(res.items).toHaveLength(0);
    });

    it('updateThreshold — upsert и валидация', async () => {
        prisma.inventorySettings.upsert.mockResolvedValue({ tenantId: TENANT, lowStockThreshold: 10 });

        const res = await svc.updateThreshold(TENANT, 10, ACTOR);
        expect(res.lowStockThreshold).toBe(10);

        await expect(svc.updateThreshold(TENANT, -1, ACTOR)).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'THRESHOLD_NEGATIVE' }),
        });
    });

    it('getStockDetail — бросает NotFound для чужого продукта', async () => {
        prisma.product.findFirst.mockResolvedValue(null);
        await expect(svc.getStockDetail(TENANT, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });
});
