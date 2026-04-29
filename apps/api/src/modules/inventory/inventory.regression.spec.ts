/**
 * Регрессионная матрица §17 system-analytics для inventory модуля.
 *
 * Каждый describe-блок соответствует одной строке тестовой матрицы.
 * Цель — единый файл, который QA может пройти сценарий-за-сценарием и
 * увидеть, что все обязательные поведения покрыты регрессией. Дополнительно
 * проверены observability events из `inventory.events.ts` (§20).
 */
import { Test } from '@nestjs/testing';
import { Logger, NotFoundException, ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InventoryEvents } from './inventory.events';

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

const TENANT = 't1';
const ACTOR = 'a@b';
const USER_ID = 'u1';
const PRODUCT = 'p1';
const SOURCE_EVENT = 'order-001';

function makePrismaMock() {
    const prisma = {
        product: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), count: jest.fn() },
        stockBalance: {
            findUnique: jest.fn(),
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
        inventoryEffectLock: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
            upsert: jest.fn().mockResolvedValue({}),
            update: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({}),
            count: jest.fn(),
        },
        inventorySettings: { findUnique: jest.fn(), upsert: jest.fn() },
        tenant: { findUnique: jest.fn().mockResolvedValue({ accessState: 'ACTIVE_PAID' }) },
        $transaction: jest.fn(),
        $queryRaw: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    return prisma;
}

function audit(): AuditService {
    return { writeEvent: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

async function build(prisma: any) {
    const moduleRef = await Test.createTestingModule({
        providers: [
            InventoryService,
            { provide: PrismaService, useValue: prisma },
            { provide: AuditService, useValue: audit() },
        ],
    }).setLogger(new Logger()).compile();
    return moduleRef.get(InventoryService);
}

function setupBalance(prisma: any, onHand: number, reserved: number, isExternal = false, balanceId = 'bal-1') {
    prisma.product.findFirst.mockResolvedValue({ id: PRODUCT, sku: 'SKU-1', total: onHand, reserved, stockBalances: [] });
    prisma.stockBalance.upsert.mockResolvedValue({ id: balanceId });
    prisma.$queryRaw.mockResolvedValue([{ id: balanceId, onHand, reserved, isExternal }]);
    prisma.stockMovement.create.mockImplementation(async (args: any) => ({ id: 'mov-' + Math.random(), ...args.data }));
    prisma.stockBalance.update.mockResolvedValue({});
    prisma.product.update.mockResolvedValue({});
}

// ─────────────────────────────────────────────────────────────────────────────
// §17.1: Ручное увеличение остатка
// ─────────────────────────────────────────────────────────────────────────────
describe('§17.1 — ручное увеличение остатка', () => {
    it('применяется, эмитит ADJUSTMENT_APPLIED, пишет MANUAL_ADD movement', async () => {
        const prisma = makePrismaMock();
        const svc = await build(prisma);
        setupBalance(prisma, 10, 0);
        const logSpy = jest.spyOn(Logger.prototype, 'log');

        const res = await svc.createAdjustment(TENANT, ACTOR, USER_ID, {
            productId: PRODUCT,
            delta: 5,
            reasonCode: 'FOUND',
        });

        expect(res.onHandAfter).toBe(15);
        expect(prisma.stockMovement.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ movementType: 'MANUAL_ADD', delta: 5 }) }),
        );
        expect(logSpy.mock.calls.some(c => String(c[0]).includes(InventoryEvents.ADJUSTMENT_APPLIED))).toBe(true);
        logSpy.mockRestore();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §17.2: Ручное уменьшение остатка ДО НУЛЯ
// ─────────────────────────────────────────────────────────────────────────────
describe('§17.2 — ручное уменьшение до нуля', () => {
    it('targetQuantity=0 при onHand>0 — корректно списывает', async () => {
        const prisma = makePrismaMock();
        const svc = await build(prisma);
        setupBalance(prisma, 4, 0);

        const res = await svc.createAdjustment(TENANT, ACTOR, USER_ID, {
            productId: PRODUCT,
            targetQuantity: 0,
            reasonCode: 'LOSS',
        });

        expect(res.onHandAfter).toBe(0);
        expect(prisma.stockMovement.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ movementType: 'MANUAL_REMOVE', delta: -4 }) }),
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §17.3: Попытка уменьшить НИЖЕ нуля
// ─────────────────────────────────────────────────────────────────────────────
describe('§17.3 — попытка уйти ниже нуля', () => {
    it('блокируется NEGATIVE_STOCK_NOT_ALLOWED, движение не пишется', async () => {
        const prisma = makePrismaMock();
        const svc = await build(prisma);
        setupBalance(prisma, 2, 0);

        await expect(
            svc.createAdjustment(TENANT, ACTOR, USER_ID, { productId: PRODUCT, delta: -5, reasonCode: 'LOSS' }),
        ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'NEGATIVE_STOCK_NOT_ALLOWED' }) });

        expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §17.4: Reserve двух заказов подряд
// ─────────────────────────────────────────────────────────────────────────────
describe('§17.4 — два последовательных reserve по одному товару', () => {
    it('накапливает reserved через два независимых sourceEventId', async () => {
        const prisma = makePrismaMock();
        const svc = await build(prisma);

        // Первый reserve: 0 → 3
        prisma.inventoryEffectLock.findUnique.mockResolvedValueOnce(null);
        prisma.product.findFirst.mockResolvedValueOnce({ total: 10 });
        prisma.stockBalance.upsert.mockResolvedValueOnce({ id: 'b' });
        prisma.$queryRaw.mockResolvedValueOnce([{ id: 'b', onHand: 10, reserved: 0, isExternal: false }]);
        prisma.stockMovement.create.mockImplementation(async (a: any) => ({ id: 'm', ...a.data }));

        const r1 = await svc.reserve(TENANT, 'order-A', [{ productId: PRODUCT, qty: 3 }]);
        expect(r1.movements[0].reservedAfter).toBe(3);

        // Второй reserve приходит после первого, видит reserved=3, добавляет ещё 2 → 5
        prisma.inventoryEffectLock.findUnique.mockResolvedValueOnce(null);
        prisma.product.findFirst.mockResolvedValueOnce({ total: 10 });
        prisma.stockBalance.upsert.mockResolvedValueOnce({ id: 'b' });
        prisma.$queryRaw.mockResolvedValueOnce([{ id: 'b', onHand: 10, reserved: 3, isExternal: false }]);

        const r2 = await svc.reserve(TENANT, 'order-B', [{ productId: PRODUCT, qty: 2 }]);
        expect(r2.movements[0].reservedAfter).toBe(5);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §17.5: Повторный reserve того же source_event_id (idempotent replay)
// ─────────────────────────────────────────────────────────────────────────────
describe('§17.5 — повтор того же source_event_id', () => {
    it('замок APPLIED → возвращает IGNORED без новых движений и без транзакции', async () => {
        const prisma = makePrismaMock();
        const svc = await build(prisma);
        prisma.inventoryEffectLock.findUnique.mockResolvedValue({ status: 'APPLIED' });
        const logSpy = jest.spyOn(Logger.prototype, 'log');

        const res = await svc.reserve(TENANT, SOURCE_EVENT, [{ productId: PRODUCT, qty: 1 }]);

        expect(res).toMatchObject({ status: 'IGNORED', idempotent: true });
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.stockMovement.create).not.toHaveBeenCalled();
        expect(logSpy.mock.calls.some(c => String(c[0]).includes(InventoryEvents.ORDER_EFFECT_IDEMPOTENT_REPLAY))).toBe(true);
        logSpy.mockRestore();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §17.6: Cancel после reserve (release)
// ─────────────────────────────────────────────────────────────────────────────
describe('§17.6 — cancel после reserve', () => {
    it('release уменьшает reserved до 0, onHand остаётся, ORDER_RELEASED movement', async () => {
        const prisma = makePrismaMock();
        const svc = await build(prisma);
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        setupBalance(prisma, 10, 3);

        const res = await svc.release(TENANT, 'cancel-001', [{ productId: PRODUCT, qty: 3 }]);

        expect(res.movements[0]).toMatchObject({ delta: -3, onHandAfter: 10, reservedAfter: 0 });
        expect(prisma.stockMovement.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ movementType: 'ORDER_RELEASED', delta: -3 }) }),
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §17.7: Fulfill после reserve (deduct)
// ─────────────────────────────────────────────────────────────────────────────
describe('§17.7 — fulfill после reserve', () => {
    it('deduct снимает reserved и onHand вместе, обновляет Product.total bridge', async () => {
        const prisma = makePrismaMock();
        const svc = await build(prisma);
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        setupBalance(prisma, 10, 3);

        const res = await svc.deduct(TENANT, 'fulfill-001', [{ productId: PRODUCT, qty: 3 }]);

        expect(res.movements[0]).toMatchObject({ delta: -3, onHandAfter: 7, reservedAfter: 0 });
        expect(prisma.product.update).toHaveBeenCalledWith({ where: { id: PRODUCT }, data: { total: 7 } });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §17.8: Конфликт ручной корректировки и устаревшего внешнего события (stale)
// ─────────────────────────────────────────────────────────────────────────────
describe('§17.8 — устаревшее внешнее событие после ручной корректировки', () => {
    it('reconcile с externalEventAt < локального движения → IGNORED_STALE, движение не пишется', async () => {
        const prisma = makePrismaMock();
        const svc = await build(prisma);
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        const externalAt = new Date('2026-04-26T09:00:00Z');
        const localManualAt = new Date('2026-04-26T11:30:00Z'); // ручная adjustment'а позже
        prisma.stockMovement.findFirst.mockResolvedValue({ createdAt: localManualAt });
        prisma.stockBalance.findUnique.mockResolvedValue({ available: 8 });
        const warnSpy = jest.spyOn(Logger.prototype, 'warn');

        const res = await svc.reconcile(TENANT, 'wb-stocks-old-snapshot', {
            productId: PRODUCT,
            externalAvailable: 3,
            externalEventAt: externalAt,
        });

        expect(res.status).toBe('IGNORED_STALE');
        expect(res.staleAgainstAt).toEqual(localManualAt);
        expect(prisma.stockMovement.create).not.toHaveBeenCalled();
        expect(warnSpy.mock.calls.some(c => String(c[0]).includes(InventoryEvents.RECONCILE_STALE_EVENT_IGNORED))).toBe(true);
        warnSpy.mockRestore();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// §17.9-§17.10: Manual adjust в TRIAL_EXPIRED / SUSPENDED / CLOSED
// ─────────────────────────────────────────────────────────────────────────────
describe('§17.9-10 — manual adjust в paused tenant state', () => {
    it.each(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED'])('блокируется в %s через service-level guard', async (state) => {
        const prisma = makePrismaMock();
        prisma.tenant.findUnique.mockResolvedValue({ accessState: state });
        const svc = await build(prisma);
        const warnSpy = jest.spyOn(Logger.prototype, 'warn');

        await expect(
            svc.createAdjustment(TENANT, ACTOR, USER_ID, { productId: PRODUCT, delta: 1, reasonCode: 'FOUND' }),
        ).rejects.toBeInstanceOf(ForbiddenException);

        expect(warnSpy.mock.calls.some(c => String(c[0]).includes(InventoryEvents.MANUAL_WRITE_BLOCKED_BY_TENANT))).toBe(true);
        warnSpy.mockRestore();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Дополнительно: Order side-effect в paused state → IGNORED
// ─────────────────────────────────────────────────────────────────────────────
describe('§16+17 — order side-effect в paused state', () => {
    it('reserve в TRIAL_EXPIRED → IGNORED, lock переводится в IGNORED, warn-event эмитится', async () => {
        const prisma = makePrismaMock();
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'TRIAL_EXPIRED' });
        const svc = await build(prisma);
        const warnSpy = jest.spyOn(Logger.prototype, 'warn');

        const res = await svc.reserve(TENANT, SOURCE_EVENT, [{ productId: PRODUCT, qty: 1 }]);

        expect(res).toMatchObject({ status: 'IGNORED', idempotent: false });
        expect(prisma.inventoryEffectLock.upsert).toHaveBeenCalledWith(
            expect.objectContaining({ update: { status: 'IGNORED' } }),
        );
        expect(warnSpy.mock.calls.some(c => String(c[0]).includes(InventoryEvents.ORDER_EFFECT_PAUSED_BY_TENANT))).toBe(true);
        warnSpy.mockRestore();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Return logging — без auto-restock
// ─────────────────────────────────────────────────────────────────────────────
describe('Return logging — no auto-restock policy §17', () => {
    it('logReturn пишет RETURN_LOGGED движение БЕЗ изменения onHand/reserved', async () => {
        const prisma = makePrismaMock();
        const svc = await build(prisma);
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        setupBalance(prisma, 7, 1);
        const logSpy = jest.spyOn(Logger.prototype, 'log');

        const res = await svc.logReturn(TENANT, 'return-001', [{ productId: PRODUCT, qty: 2 }], 'CUSTOMER_REFUSE');

        expect(res.status).toBe('APPLIED');
        expect(res.movements[0]).toMatchObject({ delta: 0, onHandAfter: 7, reservedAfter: 1 });
        expect(prisma.stockBalance.update).not.toHaveBeenCalled();
        expect(prisma.product.update).not.toHaveBeenCalled();
        expect(logSpy.mock.calls.some(c => String(c[0]).includes(InventoryEvents.RETURN_LOGGED))).toBe(true);
        logSpy.mockRestore();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reconcile-conflict: расхождение пишет CONFLICT_DETECTED + emit event
// ─────────────────────────────────────────────────────────────────────────────
describe('Reconciliation — CONFLICT_DETECTED без silent overwrite', () => {
    it('расхождение local vs external → CONFLICT_DETECTED movement и warn-event', async () => {
        const prisma = makePrismaMock();
        const svc = await build(prisma);
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        prisma.product.findFirst.mockResolvedValue({ id: PRODUCT, total: 10, reserved: 2 });
        prisma.stockBalance.findUnique.mockResolvedValue({ onHand: 10, reserved: 2, available: 8 });
        prisma.stockMovement.create.mockResolvedValue({ id: 'mov-conf' });
        const warnSpy = jest.spyOn(Logger.prototype, 'warn');

        const res = await svc.reconcile(TENANT, 'sync-snap-1', { productId: PRODUCT, externalAvailable: 3 });

        expect(res.status).toBe('CONFLICT_LOGGED');
        expect(res.diff).toBe(-5);
        expect(prisma.stockMovement.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ movementType: 'CONFLICT_DETECTED' }) }),
        );
        // Остаток НЕ меняется — main invariant.
        expect(prisma.stockBalance.update).not.toHaveBeenCalled();
        expect(warnSpy.mock.calls.some(c => String(c[0]).includes(InventoryEvents.RECONCILE_CONFLICT_DETECTED))).toBe(true);
        warnSpy.mockRestore();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// FBO bypass — внешний контур не ломает push-инварианты
// ─────────────────────────────────────────────────────────────────────────────
describe('FBS/FBO boundary §14 — FBO не участвует в push-проверках', () => {
    it('reserve может превышать onHand для isExternal=true (FBO информационный)', async () => {
        const prisma = makePrismaMock();
        const svc = await build(prisma);
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        setupBalance(prisma, 5, 4, true);

        const res = await svc.reserve(TENANT, 'fbo-evt', [{ productId: PRODUCT, qty: 10 }]);
        expect(res.status).toBe('APPLIED');
        expect(res.movements[0].reservedAfter).toBe(14);
    });

    it('computeEffectiveAvailable исключает FBO из push-суммы', async () => {
        const prisma = makePrismaMock();
        const svc = await build(prisma);
        prisma.product.findFirst.mockResolvedValue({
            id: PRODUCT,
            total: 0,
            reserved: 0,
            stockBalances: [
                { warehouseId: 'fbs1', fulfillmentMode: 'FBS', onHand: 5, reserved: 0, available: 5 },
                { warehouseId: 'fbs2', fulfillmentMode: 'FBS', onHand: 3, reserved: 0, available: 3 },
                // FBO физически не попадает в выборку, потому что service передаёт where: { isExternal: false }.
            ],
        });

        const res = await svc.computeEffectiveAvailable(TENANT, PRODUCT);
        expect(res.totalAvailable).toBe(8);
        expect(prisma.product.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                select: expect.objectContaining({
                    stockBalances: expect.objectContaining({ where: { isExternal: false } }),
                }),
            }),
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostics rollup для observability §20
// ─────────────────────────────────────────────────────────────────────────────
describe('§20 Observability — diagnostics rollup за 24h', () => {
    it('возвращает все 5 ключевых метрик: locks/conflicts/reserve_release_fail/deduct_fail', async () => {
        const prisma = makePrismaMock();
        const svc = await build(prisma);
        prisma.inventoryEffectLock.count
            .mockResolvedValueOnce(0)   // processing
            .mockResolvedValueOnce(3)   // failed
            .mockResolvedValueOnce(40)  // applied
            .mockResolvedValueOnce(2)   // ignored (paused/replays)
            .mockResolvedValueOnce(1)   // reserve/release fail 24h
            .mockResolvedValueOnce(2);  // deduct fail 24h
        prisma.stockMovement.count.mockResolvedValue(5); // conflicts 24h

        const res = await svc.getDiagnostics(TENANT);

        expect(res.locks).toMatchObject({ processing: 0, failed: 3, applied: 40, ignored: 2 });
        expect(res.conflictsLast24h).toBe(5);
        expect(res.reserveReleaseFailedLast24h).toBe(1);
        expect(res.deductFailedLast24h).toBe(2);
        expect(res.window).toBe('24h');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Low-stock contract для notifications
// ─────────────────────────────────────────────────────────────────────────────
describe('Low-stock contract для notifications', () => {
    it('возвращает {threshold, count, items[]} с source-флагом для каждой записи', async () => {
        const prisma = makePrismaMock();
        const svc = await build(prisma);
        prisma.inventorySettings.findUnique.mockResolvedValue({ tenantId: TENANT, lowStockThreshold: 5 });
        prisma.stockBalance.findMany.mockResolvedValue([
            {
                productId: 'pA',
                warehouseId: 'w',
                onHand: 2,
                reserved: 0,
                available: 2,
                product: { id: 'pA', sku: 'A', name: 'A', deletedAt: null },
            },
        ]);
        prisma.product.findMany.mockResolvedValue([{ id: 'pB', sku: 'B', name: 'B', total: 1, reserved: 0 }]);

        const res = await svc.listLowStock(TENANT);

        expect(res.threshold).toBe(5);
        expect(res.count).toBe(2);
        expect(res.items.find(i => i.productId === 'pA')?.source).toBe('balance');
        expect(res.items.find(i => i.productId === 'pB')?.source).toBe('product_fallback');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation matrix
// ─────────────────────────────────────────────────────────────────────────────
describe('Validation matrix', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: InventoryService;
    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
    });

    it('createAdjustment без delta и без targetQuantity → ADJUSTMENT_MODE_REQUIRED', async () => {
        await expect(
            svc.createAdjustment(TENANT, ACTOR, USER_ID, { productId: PRODUCT, reasonCode: 'X' } as any),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('reserve без sourceEventId → SOURCE_EVENT_ID_REQUIRED', async () => {
        await expect(svc.reserve(TENANT, '', [{ productId: PRODUCT, qty: 1 }])).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'SOURCE_EVENT_ID_REQUIRED' }),
        });
    });

    it('reserve qty=0 → ITEM_QTY_INVALID', async () => {
        await expect(
            svc.reserve(TENANT, SOURCE_EVENT, [{ productId: PRODUCT, qty: 0 }]),
        ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ITEM_QTY_INVALID' }) });
    });

    it('release > reserved → RELEASE_EXCEEDS_RESERVED (ConflictException)', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        setupBalance(prisma, 10, 1);
        await expect(
            svc.release(TENANT, SOURCE_EVENT, [{ productId: PRODUCT, qty: 5 }]),
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it('reconcile externalAvailable=-1 → EXTERNAL_AVAILABLE_INVALID', async () => {
        await expect(
            svc.reconcile(TENANT, 'evt', { productId: PRODUCT, externalAvailable: -1 }),
        ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'EXTERNAL_AVAILABLE_INVALID' }) });
    });

    it('createAdjustment для несуществующего товара → NotFoundException', async () => {
        prisma.product.findFirst.mockResolvedValue(null);
        await expect(
            svc.createAdjustment(TENANT, ACTOR, USER_ID, { productId: 'missing', delta: 1, reasonCode: 'F' }),
        ).rejects.toBeInstanceOf(NotFoundException);
    });
});
