import { Test } from '@nestjs/testing';
import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
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
const SOURCE_EVENT = 'evt-1';

function makePrismaMock() {
    const prisma = {
        product: { findFirst: jest.fn(), update: jest.fn() },
        stockBalance: { upsert: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
        stockMovement: { create: jest.fn(), findFirst: jest.fn() },
        inventoryEffectLock: {
            findUnique: jest.fn(),
            upsert: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({}),
        },
        inventorySettings: { upsert: jest.fn() },
        tenant: { findUnique: jest.fn() },
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

describe('InventoryService — tenant-state pause (manual writes)', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: InventoryService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
    });

    it.each(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED'])(
        'createAdjustment блокируется в %s',
        async (state) => {
            prisma.tenant.findUnique.mockResolvedValue({ accessState: state });

            await expect(
                svc.createAdjustment(TENANT, 'a@b', 'u1', {
                    productId: PRODUCT_ID,
                    delta: 1,
                    reasonCode: 'FOUND',
                }),
            ).rejects.toMatchObject({
                response: expect.objectContaining({
                    code: 'INVENTORY_WRITE_BLOCKED_BY_TENANT_STATE',
                    accessState: state,
                }),
            });

            expect(prisma.$transaction).not.toHaveBeenCalled();
            expect(prisma.stockMovement.create).not.toHaveBeenCalled();
        },
    );

    it.each(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED'])(
        'updateThreshold блокируется в %s',
        async (state) => {
            prisma.tenant.findUnique.mockResolvedValue({ accessState: state });

            await expect(svc.updateThreshold(TENANT, 5, 'a@b')).rejects.toBeInstanceOf(ForbiddenException);
            expect(prisma.inventorySettings.upsert).not.toHaveBeenCalled();
        },
    );

    it.each(['ACTIVE_PAID', 'TRIAL_ACTIVE', 'EARLY_ACCESS', 'GRACE_PERIOD'])(
        'manual writes разрешены в %s (без блокировки)',
        async (state) => {
            prisma.tenant.findUnique.mockResolvedValue({ accessState: state });
            prisma.inventorySettings.upsert.mockResolvedValue({ tenantId: TENANT, lowStockThreshold: 5 });

            await expect(svc.updateThreshold(TENANT, 5, 'a@b')).resolves.toBeDefined();
        },
    );

    it('createAdjustment бросает TENANT_NOT_FOUND если tenant не существует', async () => {
        prisma.tenant.findUnique.mockResolvedValue(null);
        await expect(
            svc.createAdjustment(TENANT, 'a@b', 'u1', { productId: PRODUCT_ID, delta: 1, reasonCode: 'FOUND' }),
        ).rejects.toBeInstanceOf(NotFoundException);
    });
});

describe('InventoryService — tenant-state pause (order side-effects)', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: InventoryService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
    });

    it.each(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED'])(
        'reserve в %s возвращает IGNORED, lock=IGNORED, без транзакции',
        async (state) => {
            prisma.tenant.findUnique.mockResolvedValue({ accessState: state });

            const res = await svc.reserve(TENANT, SOURCE_EVENT, [{ productId: PRODUCT_ID, qty: 1 }]);

            expect(res).toMatchObject({ status: 'IGNORED', idempotent: false, movements: [] });
            expect(prisma.$transaction).not.toHaveBeenCalled();
            expect(prisma.stockMovement.create).not.toHaveBeenCalled();
            expect(prisma.inventoryEffectLock.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    create: expect.objectContaining({ status: 'IGNORED' }),
                    update: { status: 'IGNORED' },
                }),
            );
        },
    );

    it('release/deduct в TRIAL_EXPIRED тоже IGNORED', async () => {
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'TRIAL_EXPIRED' });

        const r1 = await svc.release(TENANT, 'evt-r', [{ productId: PRODUCT_ID, qty: 1 }]);
        const r2 = await svc.deduct(TENANT, 'evt-d', [{ productId: PRODUCT_ID, qty: 1 }]);

        expect(r1.status).toBe('IGNORED');
        expect(r2.status).toBe('IGNORED');
        expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    });

    it('logReturn в SUSPENDED возвращает IGNORED', async () => {
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'SUSPENDED' });

        const res = await svc.logReturn(TENANT, 'evt-ret', [{ productId: PRODUCT_ID, qty: 1 }]);

        expect(res.status).toBe('IGNORED');
        expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    });

    it('reconcile в CLOSED возвращает IGNORED_STALE с локальным available', async () => {
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'CLOSED' });
        prisma.stockBalance.findUnique.mockResolvedValue({ available: 8 });

        const res = await svc.reconcile(TENANT, 'evt-rec', {
            productId: PRODUCT_ID,
            externalAvailable: 5,
        });

        expect(res.status).toBe('IGNORED_STALE');
        expect(res.localAvailable).toBe(8);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
});

describe('InventoryService.computeEffectiveAvailable', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: InventoryService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
    });

    it('сумма по управляемым FBS-балансам, FBO исключены через include where', async () => {
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'ACTIVE_PAID' });
        prisma.product.findFirst.mockResolvedValue({
            id: PRODUCT_ID,
            total: 0,
            reserved: 0,
            stockBalances: [
                { warehouseId: 'fbs-1', fulfillmentMode: 'FBS', onHand: 10, reserved: 2, available: 8 },
                { warehouseId: 'fbs-2', fulfillmentMode: 'FBS', onHand: 5, reserved: 0, available: 5 },
            ],
        });

        const res = await svc.computeEffectiveAvailable(TENANT, PRODUCT_ID);

        expect(res).toMatchObject({
            productId: PRODUCT_ID,
            pushAllowed: true,
            pausedByTenantState: false,
            accessState: 'ACTIVE_PAID',
            totalAvailable: 13,
            source: 'balance',
        });
        expect(res.byWarehouse).toHaveLength(2);

        // Контракт: запрос балансов идёт с фильтром isExternal=false (FBO исключены).
        expect(prisma.product.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                select: expect.objectContaining({
                    stockBalances: expect.objectContaining({ where: { isExternal: false } }),
                }),
            }),
        );
    });

    it('фоллбек на Product.total - reserved при отсутствии StockBalance', async () => {
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'ACTIVE_PAID' });
        prisma.product.findFirst.mockResolvedValue({
            id: PRODUCT_ID,
            total: 7,
            reserved: 1,
            stockBalances: [],
        });

        const res = await svc.computeEffectiveAvailable(TENANT, PRODUCT_ID);

        expect(res).toMatchObject({
            totalAvailable: 6,
            source: 'product_fallback',
            pushAllowed: true,
        });
        expect(res.byWarehouse[0]).toMatchObject({ warehouseId: 'default', fulfillmentMode: 'FBS' });
    });

    it.each(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED'])(
        'pushAllowed=false и pausedByTenantState=true в %s',
        async (state) => {
            prisma.tenant.findUnique.mockResolvedValue({ accessState: state });
            prisma.product.findFirst.mockResolvedValue({
                id: PRODUCT_ID,
                total: 5,
                reserved: 0,
                stockBalances: [],
            });

            const res = await svc.computeEffectiveAvailable(TENANT, PRODUCT_ID);

            expect(res.pushAllowed).toBe(false);
            expect(res.pausedByTenantState).toBe(true);
            expect(res.accessState).toBe(state);
            // Сами числа должны корректно считаться, чтобы UI/diagnostics видели реальный остаток.
            expect(res.totalAvailable).toBe(5);
        },
    );

    it('PRODUCT_NOT_FOUND для отсутствующего товара', async () => {
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'ACTIVE_PAID' });
        prisma.product.findFirst.mockResolvedValue(null);

        await expect(
            svc.computeEffectiveAvailable(TENANT, 'missing'),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('TENANT_NOT_FOUND если tenant не существует', async () => {
        prisma.tenant.findUnique.mockResolvedValue(null);

        await expect(
            svc.computeEffectiveAvailable(TENANT, PRODUCT_ID),
        ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'TENANT_NOT_FOUND' }) });
    });

    it('available клампится в ноль если STORED GENERATED почему-то отрицательное (защитно)', async () => {
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'ACTIVE_PAID' });
        prisma.product.findFirst.mockResolvedValue({
            id: PRODUCT_ID,
            total: 0,
            reserved: 0,
            stockBalances: [
                { warehouseId: 'w', fulfillmentMode: 'FBS', onHand: 0, reserved: 0, available: -3 },
            ],
        });

        const res = await svc.computeEffectiveAvailable(TENANT, PRODUCT_ID);
        expect(res.totalAvailable).toBe(0);
        expect(res.byWarehouse[0].available).toBe(0);
    });
});
