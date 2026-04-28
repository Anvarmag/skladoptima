/**
 * TASK_ORDERS_7: regression spec для `OrderInventoryEffectsService`.
 *
 * Проверяем §16 + §14 контракты:
 *   - FBS RESERVED → inventory.reserve;
 *   - FBS RESERVED→CANCELLED → inventory.release;
 *   - FBS RESERVED→FULFILLED → inventory.deduct;
 *   - FBS без warehouse scope → STOCK_EFFECT_FAILED + FAILED status,
 *     inventory НЕ вызывается (защита §14);
 *   - FBO → no-op, NOT_REQUIRED;
 *   - return → logReturn без auto-restock + RETURN_LOGGED event;
 *   - paused tenant (inventory вернул IGNORED+!idempotent) → BLOCKED.
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: { sql: () => ({ _sql: true }) },
    AccessState: {
        EARLY_ACCESS: 'EARLY_ACCESS',
        TRIAL_ACTIVE: 'TRIAL_ACTIVE',
        TRIAL_EXPIRED: 'TRIAL_EXPIRED',
        ACTIVE_PAID: 'ACTIVE_PAID',
        GRACE_PERIOD: 'GRACE_PERIOD',
        SUSPENDED: 'SUSPENDED',
        CLOSED: 'CLOSED',
    },
    StockMovementType: {
        ORDER_RESERVED: 'ORDER_RESERVED',
        ORDER_RELEASED: 'ORDER_RELEASED',
        ORDER_DEDUCTED: 'ORDER_DEDUCTED',
        RETURN_LOGGED: 'RETURN_LOGGED',
        CONFLICT_DETECTED: 'CONFLICT_DETECTED',
    },
    StockMovementSource: { USER: 'USER', SYSTEM: 'SYSTEM', MARKETPLACE: 'MARKETPLACE' },
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
    OrderEventType: {
        RECEIVED: 'RECEIVED',
        STATUS_CHANGED: 'STATUS_CHANGED',
        RESERVED: 'RESERVED',
        RESERVE_RELEASED: 'RESERVE_RELEASED',
        DEDUCTED: 'DEDUCTED',
        RETURN_LOGGED: 'RETURN_LOGGED',
        DUPLICATE_IGNORED: 'DUPLICATE_IGNORED',
        OUT_OF_ORDER_IGNORED: 'OUT_OF_ORDER_IGNORED',
        STOCK_EFFECT_FAILED: 'STOCK_EFFECT_FAILED',
    },
    OrderFulfillmentMode: { FBS: 'FBS', FBO: 'FBO' },
    OrderInternalStatus: {
        IMPORTED: 'IMPORTED',
        RESERVED: 'RESERVED',
        CANCELLED: 'CANCELLED',
        FULFILLED: 'FULFILLED',
        DISPLAY_ONLY_FBO: 'DISPLAY_ONLY_FBO',
        UNRESOLVED: 'UNRESOLVED',
    },
    OrderItemMatchStatus: { MATCHED: 'MATCHED', UNMATCHED: 'UNMATCHED' },
    OrderStockEffectStatus: {
        NOT_REQUIRED: 'NOT_REQUIRED',
        PENDING: 'PENDING',
        APPLIED: 'APPLIED',
        BLOCKED: 'BLOCKED',
        FAILED: 'FAILED',
    },
}));

import { OrderInventoryEffectsService } from './order-inventory-effects.service';

const TENANT = 'tenant-1';
const ACCOUNT = 'acc-1';
const ORDER_ID = 'ord-1';

function makeMocks(itemsOverride?: any[]) {
    const items = itemsOverride ?? [
        {
            productId: 'prod-1',
            warehouseId: 'wh-1',
            matchStatus: 'MATCHED',
            quantity: 2,
            sku: 'SKU-1',
        },
    ];
    const prisma: any = {
        orderItem: { findMany: jest.fn().mockResolvedValue(items) },
        orderEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const inventory: any = {
        reserve: jest.fn().mockResolvedValue({ status: 'APPLIED', idempotent: false, movements: [] }),
        release: jest.fn().mockResolvedValue({ status: 'APPLIED', idempotent: false, movements: [] }),
        deduct: jest.fn().mockResolvedValue({ status: 'APPLIED', idempotent: false, movements: [] }),
        logReturn: jest.fn().mockResolvedValue({ status: 'APPLIED', idempotent: false, movements: [] }),
    };
    return { prisma, inventory };
}

function makeSvc(mocks: ReturnType<typeof makeMocks>) {
    return new OrderInventoryEffectsService(mocks.prisma, mocks.inventory);
}

describe('OrderInventoryEffectsService.applyTransitionEffect', () => {
    const baseArgs = {
        tenantId: TENANT,
        orderId: ORDER_ID,
        marketplaceAccountId: ACCOUNT,
        fulfillmentMode: 'FBS' as any,
        currentStockEffectStatus: 'PENDING' as any,
    };

    it('FBS to=RESERVED → inventory.reserve со стабильным sourceEventId', async () => {
        const m = makeMocks();
        const svc = makeSvc(m);

        const status = await svc.applyTransitionEffect({
            ...baseArgs,
            transitionFrom: 'IMPORTED' as any,
            transitionTo: 'RESERVED' as any,
        });

        expect(status).toBe('APPLIED');
        expect(m.inventory.reserve).toHaveBeenCalledWith(
            TENANT,
            `order:${ORDER_ID}:reserve`,
            expect.arrayContaining([
                expect.objectContaining({ productId: 'prod-1', warehouseId: 'wh-1', qty: 2 }),
            ]),
        );
        expect(m.prisma.orderEvent.create).not.toHaveBeenCalled();
    });

    it('FBS RESERVED→CANCELLED → inventory.release', async () => {
        const m = makeMocks();
        const svc = makeSvc(m);

        const status = await svc.applyTransitionEffect({
            ...baseArgs,
            transitionFrom: 'RESERVED' as any,
            transitionTo: 'CANCELLED' as any,
        });

        expect(status).toBe('APPLIED');
        expect(m.inventory.release).toHaveBeenCalledWith(
            TENANT,
            `order:${ORDER_ID}:release`,
            expect.any(Array),
        );
        expect(m.inventory.reserve).not.toHaveBeenCalled();
    });

    it('FBS IMPORTED→CANCELLED (без резерва) → NOT_REQUIRED, release НЕ вызывается', async () => {
        const m = makeMocks();
        const svc = makeSvc(m);

        const status = await svc.applyTransitionEffect({
            ...baseArgs,
            transitionFrom: 'IMPORTED' as any,
            transitionTo: 'CANCELLED' as any,
        });

        expect(status).toBe('NOT_REQUIRED');
        expect(m.inventory.release).not.toHaveBeenCalled();
    });

    it('FBS RESERVED→FULFILLED → inventory.deduct', async () => {
        const m = makeMocks();
        const svc = makeSvc(m);

        const status = await svc.applyTransitionEffect({
            ...baseArgs,
            transitionFrom: 'RESERVED' as any,
            transitionTo: 'FULFILLED' as any,
        });

        expect(status).toBe('APPLIED');
        expect(m.inventory.deduct).toHaveBeenCalledWith(
            TENANT,
            `order:${ORDER_ID}:deduct`,
            expect.any(Array),
        );
    });

    it('FBO → NOT_REQUIRED, никаких inventory вызовов (§9 шаг 9)', async () => {
        const m = makeMocks();
        const svc = makeSvc(m);

        const status = await svc.applyTransitionEffect({
            ...baseArgs,
            fulfillmentMode: 'FBO' as any,
            transitionFrom: 'IMPORTED' as any,
            transitionTo: 'RESERVED' as any,  // даже если caller просит RESERVED
        });

        expect(status).toBe('NOT_REQUIRED');
        expect(m.inventory.reserve).not.toHaveBeenCalled();
        expect(m.prisma.orderItem.findMany).not.toHaveBeenCalled();
    });

    it('FBS без warehouseId → STOCK_EFFECT_FAILED event + FAILED, inventory НЕ вызывается (§14)', async () => {
        const m = makeMocks([
            { productId: 'prod-1', warehouseId: null, matchStatus: 'MATCHED', quantity: 2, sku: 'SKU-1' },
        ]);
        const svc = makeSvc(m);

        const status = await svc.applyTransitionEffect({
            ...baseArgs,
            transitionFrom: 'IMPORTED' as any,
            transitionTo: 'RESERVED' as any,
        });

        expect(status).toBe('FAILED');
        expect(m.inventory.reserve).not.toHaveBeenCalled();
        expect(m.prisma.orderEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    eventType: 'STOCK_EFFECT_FAILED',
                    payload: expect.objectContaining({ reason: 'UNRESOLVED_SCOPE' }),
                }),
            }),
        );
    });

    it('FBS с unmatched (productId=null) → STOCK_EFFECT_FAILED + FAILED', async () => {
        const m = makeMocks([
            { productId: null, warehouseId: 'wh-1', matchStatus: 'UNMATCHED', quantity: 1, sku: 'X' },
        ]);
        const svc = makeSvc(m);

        const status = await svc.applyTransitionEffect({
            ...baseArgs,
            transitionFrom: 'IMPORTED' as any,
            transitionTo: 'RESERVED' as any,
        });

        expect(status).toBe('FAILED');
        expect(m.inventory.reserve).not.toHaveBeenCalled();
    });

    it('inventory вернул IGNORED+!idempotent (paused) → BLOCKED', async () => {
        const m = makeMocks();
        m.inventory.reserve.mockResolvedValue({ status: 'IGNORED', idempotent: false, movements: [] });
        const svc = makeSvc(m);

        const status = await svc.applyTransitionEffect({
            ...baseArgs,
            transitionFrom: 'IMPORTED' as any,
            transitionTo: 'RESERVED' as any,
        });

        expect(status).toBe('BLOCKED');
    });

    it('inventory вернул IGNORED+idempotent (повтор) → APPLIED', async () => {
        const m = makeMocks();
        m.inventory.reserve.mockResolvedValue({ status: 'IGNORED', idempotent: true, movements: [] });
        const svc = makeSvc(m);

        const status = await svc.applyTransitionEffect({
            ...baseArgs,
            transitionFrom: 'IMPORTED' as any,
            transitionTo: 'RESERVED' as any,
        });

        expect(status).toBe('APPLIED');
    });

    it('inventory exception → STOCK_EFFECT_FAILED event + FAILED', async () => {
        const m = makeMocks();
        m.inventory.reserve.mockRejectedValue(new Error('db locked'));
        const svc = makeSvc(m);

        const status = await svc.applyTransitionEffect({
            ...baseArgs,
            transitionFrom: 'IMPORTED' as any,
            transitionTo: 'RESERVED' as any,
        });

        expect(status).toBe('FAILED');
        expect(m.prisma.orderEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    eventType: 'STOCK_EFFECT_FAILED',
                    payload: expect.objectContaining({ reason: 'INVENTORY_EXCEPTION' }),
                }),
            }),
        );
    });
});

describe('OrderInventoryEffectsService.logReturn (§10 + §15: no auto-restock)', () => {
    it('FBS return → inventory.logReturn + RETURN_LOGGED event с autoRestock:false', async () => {
        const m = makeMocks();
        const svc = makeSvc(m);

        await svc.logReturn({
            tenantId: TENANT,
            orderId: ORDER_ID,
            marketplaceAccountId: ACCOUNT,
            externalEventId: 'evt-x',
            fulfillmentMode: 'FBS' as any,
        });

        expect(m.inventory.logReturn).toHaveBeenCalledWith(
            TENANT,
            `order:${ORDER_ID}:return`,
            expect.arrayContaining([
                expect.objectContaining({ productId: 'prod-1', qty: 2 }),
            ]),
            'RETURN',
        );
        expect(m.prisma.orderEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    eventType: 'RETURN_LOGGED',
                    payload: expect.objectContaining({ autoRestock: false }),
                }),
            }),
        );
    });

    it('FBO return → no-op (не отслеживаем как stock event в MVP)', async () => {
        const m = makeMocks();
        const svc = makeSvc(m);

        await svc.logReturn({
            tenantId: TENANT,
            orderId: ORDER_ID,
            marketplaceAccountId: ACCOUNT,
            externalEventId: 'evt-x',
            fulfillmentMode: 'FBO' as any,
        });

        expect(m.inventory.logReturn).not.toHaveBeenCalled();
        expect(m.prisma.orderEvent.create).not.toHaveBeenCalled();
    });
});
