import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

jest.mock('@prisma/client', () => {
    class PrismaClient {}
    return {
        PrismaClient,
        Prisma: { sql: function () { return { _sql: true }; } },
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
    };
});

const TENANT = 'tenant-1';
const PRODUCT_ID = 'prod-1';
const SOURCE_EVENT = 'wb-order-12345';
const BALANCE_ID = 'bal-1';

function makePrismaMock() {
    const prisma = {
        product: { findFirst: jest.fn(), update: jest.fn() },
        stockBalance: { upsert: jest.fn(), update: jest.fn() },
        stockMovement: { create: jest.fn() },
        inventoryEffectLock: {
            findUnique: jest.fn(),
            upsert: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
        },
        tenant: {
            findUnique: jest.fn().mockResolvedValue({ accessState: 'ACTIVE_PAID' }),
        },
        $transaction: jest.fn(),
        $queryRaw: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    return prisma;
}

function audit(): AuditService {
    return { logAction: jest.fn().mockResolvedValue({}) } as unknown as AuditService;
}

async function build(prisma: any) {
    const moduleRef = await Test.createTestingModule({
        providers: [
            InventoryService,
            { provide: PrismaService, useValue: prisma },
            { provide: AuditService, useValue: audit() },
        ],
    })
        .setLogger(new Logger())
        .compile();
    return moduleRef.get(InventoryService);
}

function setupBalance(prisma: any, onHand: number, reserved: number, isExternal = false) {
    prisma.product.findFirst.mockResolvedValue({ total: onHand });
    prisma.stockBalance.upsert.mockResolvedValue({ id: BALANCE_ID });
    prisma.$queryRaw.mockResolvedValue([{ id: BALANCE_ID, onHand, reserved, isExternal }]);
    prisma.stockBalance.update.mockResolvedValue({});
    prisma.stockMovement.create.mockImplementation(async (args: any) => ({
        id: 'mov-' + Math.random().toString(36).slice(2, 8),
        ...args.data,
    }));
    prisma.inventoryEffectLock.upsert.mockResolvedValue({});
    prisma.inventoryEffectLock.update.mockResolvedValue({});
}

describe('InventoryService — reserve', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: InventoryService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
    });

    it('создаёт reservation: reserved += qty, onHand не меняется, lock APPLIED', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        setupBalance(prisma, 10, 0);

        const res = await svc.reserve(TENANT, SOURCE_EVENT, [{ productId: PRODUCT_ID, qty: 3 }]);

        expect(res.status).toBe('APPLIED');
        expect(res.idempotent).toBe(false);
        expect(res.movements[0]).toMatchObject({ delta: 3, onHandAfter: 10, reservedAfter: 3 });
        expect(prisma.stockBalance.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { onHand: 10, reserved: 3 } }),
        );
        expect(prisma.stockMovement.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    movementType: 'ORDER_RESERVED',
                    source: 'MARKETPLACE',
                    sourceEventId: SOURCE_EVENT,
                    reasonCode: 'ORDER_RESERVED',
                    delta: 3,
                }),
            }),
        );
        expect(prisma.inventoryEffectLock.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { status: 'APPLIED' } }),
        );
    });

    it('идемпотентный replay для APPLIED lock — возвращает status=IGNORED без записи', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue({ status: 'APPLIED' });

        const res = await svc.reserve(TENANT, SOURCE_EVENT, [{ productId: PRODUCT_ID, qty: 5 }]);

        expect(res).toMatchObject({ status: 'IGNORED', idempotent: true, movements: [] });
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    });

    it('PROCESSING lock — бросает 409 INVENTORY_EFFECT_PROCESSING', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue({ status: 'PROCESSING' });

        await expect(
            svc.reserve(TENANT, SOURCE_EVENT, [{ productId: PRODUCT_ID, qty: 1 }]),
        ).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'INVENTORY_EFFECT_PROCESSING' }),
        });
    });

    it('FAILED lock — допускает retry (не идемпотентно, перезапускает PROCESSING)', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue({ status: 'FAILED' });
        setupBalance(prisma, 10, 0);

        const res = await svc.reserve(TENANT, SOURCE_EVENT, [{ productId: PRODUCT_ID, qty: 2 }]);
        expect(res.status).toBe('APPLIED');
        expect(prisma.inventoryEffectLock.upsert).toHaveBeenCalled();
    });

    it('блокирует reserve при недостаточном onHand для управляемого FBS', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        setupBalance(prisma, 5, 4);

        await expect(
            svc.reserve(TENANT, SOURCE_EVENT, [{ productId: PRODUCT_ID, qty: 3 }]),
        ).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'RESERVED_EXCEEDS_ONHAND' }),
        });

        expect(prisma.inventoryEffectLock.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: { status: 'FAILED' },
            }),
        );
    });

    it('пропускает превышение onHand для FBO (isExternal=true)', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        setupBalance(prisma, 5, 4, true);

        const res = await svc.reserve(TENANT, SOURCE_EVENT, [{ productId: PRODUCT_ID, qty: 10 }]);
        expect(res.status).toBe('APPLIED');
        expect(res.movements[0].reservedAfter).toBe(14);
    });

    it('требует sourceEventId', async () => {
        await expect(svc.reserve(TENANT, '', [{ productId: PRODUCT_ID, qty: 1 }])).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'SOURCE_EVENT_ID_REQUIRED' }),
        });
    });

    it('требует непустой items', async () => {
        await expect(svc.reserve(TENANT, SOURCE_EVENT, [])).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'ITEMS_REQUIRED' }),
        });
    });

    it('валидирует qty > 0 и integer', async () => {
        await expect(
            svc.reserve(TENANT, SOURCE_EVENT, [{ productId: PRODUCT_ID, qty: 0 }]),
        ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ITEM_QTY_INVALID' }) });

        await expect(
            svc.reserve(TENANT, SOURCE_EVENT, [{ productId: PRODUCT_ID, qty: -1 }]),
        ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ITEM_QTY_INVALID' }) });
    });

    it('атомарность: при падении на втором item первый не остаётся применённым (через $transaction rollback)', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        prisma.product.findFirst.mockResolvedValueOnce({ total: 10 });
        prisma.product.findFirst.mockResolvedValueOnce({ total: 1 });
        prisma.stockBalance.upsert.mockResolvedValueOnce({ id: 'b1' });
        prisma.stockBalance.upsert.mockResolvedValueOnce({ id: 'b2' });
        prisma.$queryRaw
            .mockResolvedValueOnce([{ id: 'b1', onHand: 10, reserved: 0, isExternal: false }])
            .mockResolvedValueOnce([{ id: 'b2', onHand: 1, reserved: 0, isExternal: false }]);
        prisma.stockBalance.update.mockResolvedValue({});
        prisma.stockMovement.create.mockResolvedValue({ id: 'mov' });

        // Транзакция в моке проксируется на тот же prisma — мы не можем смоделировать настоящий
        // rollback, но можем проверить, что исключение пробрасывается и lock=FAILED.
        await expect(
            svc.reserve(TENANT, SOURCE_EVENT, [
                { productId: 'p1', qty: 3 },
                { productId: 'p2', qty: 5 }, // > onHand=1, для FBS не проходит
            ]),
        ).rejects.toBeInstanceOf(ConflictException);

        expect(prisma.inventoryEffectLock.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ data: { status: 'FAILED' } }),
        );
    });

    it('PRODUCT_NOT_FOUND для отсутствующего товара', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        prisma.product.findFirst.mockResolvedValue(null);

        await expect(
            svc.reserve(TENANT, SOURCE_EVENT, [{ productId: 'missing', qty: 1 }]),
        ).rejects.toBeInstanceOf(NotFoundException);
    });
});

describe('InventoryService — release', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: InventoryService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
    });

    it('release уменьшает reserved', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        setupBalance(prisma, 10, 5);

        const res = await svc.release(TENANT, SOURCE_EVENT, [{ productId: PRODUCT_ID, qty: 3 }]);
        expect(res.movements[0]).toMatchObject({ delta: -3, onHandAfter: 10, reservedAfter: 2 });
        expect(prisma.stockMovement.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ movementType: 'ORDER_RELEASED', delta: -3 }) }),
        );
    });

    it('блокирует release > reserved', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        setupBalance(prisma, 10, 2);

        await expect(
            svc.release(TENANT, SOURCE_EVENT, [{ productId: PRODUCT_ID, qty: 5 }]),
        ).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'RELEASE_EXCEEDS_RESERVED' }),
        });
    });
});

describe('InventoryService — deduct', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: InventoryService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
    });

    it('deduct после reserve: reserved -= qty, onHand -= qty, обновляет Product.total bridge', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        setupBalance(prisma, 10, 4);

        const res = await svc.deduct(TENANT, SOURCE_EVENT, [{ productId: PRODUCT_ID, qty: 4 }]);
        expect(res.movements[0]).toMatchObject({ delta: -4, onHandAfter: 6, reservedAfter: 0 });
        expect(prisma.product.update).toHaveBeenCalledWith({
            where: { id: PRODUCT_ID },
            data: { total: 6 },
        });
        expect(prisma.stockMovement.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ movementType: 'ORDER_DEDUCTED', delta: -4 }) }),
        );
    });

    it('immediate-deduct без предшествующего reserve: только onHand -= qty', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        setupBalance(prisma, 10, 0);

        const res = await svc.deduct(TENANT, SOURCE_EVENT, [{ productId: PRODUCT_ID, qty: 3 }]);
        expect(res.movements[0]).toMatchObject({ delta: -3, onHandAfter: 7, reservedAfter: 0 });
    });

    it('partial reserve: deduct=5, reserved=3 → reserved→0, onHand-=5', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        setupBalance(prisma, 10, 3);

        const res = await svc.deduct(TENANT, SOURCE_EVENT, [{ productId: PRODUCT_ID, qty: 5 }]);
        expect(res.movements[0]).toMatchObject({ onHandAfter: 5, reservedAfter: 0 });
    });

    it('блокирует deduct > onHand', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        setupBalance(prisma, 2, 0);

        await expect(
            svc.deduct(TENANT, SOURCE_EVENT, [{ productId: PRODUCT_ID, qty: 5 }]),
        ).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'NEGATIVE_STOCK_NOT_ALLOWED' }),
        });
    });

    it('идемпотентный replay deduct', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue({ status: 'APPLIED' });
        const res = await svc.deduct(TENANT, SOURCE_EVENT, [{ productId: PRODUCT_ID, qty: 1 }]);
        expect(res.idempotent).toBe(true);
        expect(prisma.product.update).not.toHaveBeenCalled();
    });
});

describe('InventoryService — logReturn', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: InventoryService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
    });

    it('return пишет RETURN_LOGGED БЕЗ изменения onHand/reserved (no auto-restock)', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        setupBalance(prisma, 7, 1);

        const res = await svc.logReturn(TENANT, SOURCE_EVENT, [{ productId: PRODUCT_ID, qty: 2 }], 'CUSTOMER_REFUSE');

        expect(res.status).toBe('APPLIED');
        expect(res.movements[0]).toMatchObject({ delta: 0, onHandAfter: 7, reservedAfter: 1 });
        // Главная проверка MVP-policy §10/§17: stockBalance.update НЕ вызывается.
        expect(prisma.stockBalance.update).not.toHaveBeenCalled();
        expect(prisma.product.update).not.toHaveBeenCalled();
        expect(prisma.stockMovement.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    movementType: 'RETURN_LOGGED',
                    delta: 0,
                    onHandBefore: 7,
                    onHandAfter: 7,
                    reservedBefore: 1,
                    reservedAfter: 1,
                    reasonCode: 'CUSTOMER_REFUSE',
                    sourceEventId: SOURCE_EVENT,
                }),
            }),
        );
    });

    it('идемпотентный replay return', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue({ status: 'APPLIED' });

        const res = await svc.logReturn(TENANT, SOURCE_EVENT, [{ productId: PRODUCT_ID, qty: 1 }]);
        expect(res).toMatchObject({ status: 'IGNORED', idempotent: true });
        expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    });

    it('default reasonCode = RETURN если не передан', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        setupBalance(prisma, 5, 0);

        await svc.logReturn(TENANT, SOURCE_EVENT, [{ productId: PRODUCT_ID, qty: 1 }]);

        expect(prisma.stockMovement.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ reasonCode: 'RETURN' }) }),
        );
    });
});
