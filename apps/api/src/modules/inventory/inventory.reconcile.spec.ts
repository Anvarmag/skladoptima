import { Test } from '@nestjs/testing';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
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
const SOURCE_EVENT = 'wb-stocks-snapshot-2026-04-26T10:00:00Z';

function makePrismaMock() {
    const prisma = {
        product: { findFirst: jest.fn() },
        stockBalance: { findUnique: jest.fn() },
        stockMovement: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), count: jest.fn() },
        inventoryEffectLock: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
            upsert: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
            count: jest.fn(),
        },
        tenant: {
            findUnique: jest.fn().mockResolvedValue({ accessState: 'ACTIVE_PAID' }),
        },
        $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.inventoryEffectLock.upsert.mockResolvedValue({});
    prisma.inventoryEffectLock.update.mockResolvedValue({});
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

describe('InventoryService.reconcile', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: InventoryService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
    });

    it('NO_CONFLICT: внешний и локальный available совпадают, movement не пишется', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID, total: 10, reserved: 2 });
        prisma.stockBalance.findUnique.mockResolvedValue({ onHand: 10, reserved: 2, available: 8 });

        const res = await svc.reconcile(TENANT, SOURCE_EVENT, {
            productId: PRODUCT_ID,
            externalAvailable: 8,
        });

        expect(res).toMatchObject({
            status: 'NO_CONFLICT',
            idempotent: false,
            localAvailable: 8,
            externalAvailable: 8,
            diff: 0,
        });
        expect(prisma.stockMovement.create).not.toHaveBeenCalled();
        expect(prisma.inventoryEffectLock.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { status: 'APPLIED' } }),
        );
    });

    it('CONFLICT_LOGGED: расхождение → CONFLICT_DETECTED movement, остаток НЕ меняется', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID, total: 10, reserved: 2 });
        prisma.stockBalance.findUnique.mockResolvedValue({ onHand: 10, reserved: 2, available: 8 });
        prisma.stockMovement.create.mockResolvedValue({ id: 'mov-conflict' });

        const res = await svc.reconcile(TENANT, SOURCE_EVENT, {
            productId: PRODUCT_ID,
            externalAvailable: 5,
            warehouseId: 'fbs-1',
        });

        expect(res).toMatchObject({
            status: 'CONFLICT_LOGGED',
            diff: -3,
            localAvailable: 8,
            externalAvailable: 5,
            warehouseId: 'fbs-1',
            movementId: 'mov-conflict',
        });
        expect(prisma.stockMovement.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    movementType: 'CONFLICT_DETECTED',
                    delta: -3,
                    onHandBefore: 10,
                    onHandAfter: 10,
                    reservedBefore: 2,
                    reservedAfter: 2,
                    sourceEventId: SOURCE_EVENT,
                    reasonCode: 'RECONCILE_DIFF',
                    source: 'MARKETPLACE',
                }),
            }),
        );
    });

    it('IDEMPOTENT: APPLIED lock → возвращает кеш без новой записи', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue({ status: 'APPLIED' });
        prisma.stockMovement.findFirst.mockResolvedValue({ id: 'mov-prev' });
        prisma.stockBalance.findUnique.mockResolvedValue({ onHand: 10, reserved: 2, available: 8 });

        const res = await svc.reconcile(TENANT, SOURCE_EVENT, {
            productId: PRODUCT_ID,
            externalAvailable: 5,
        });

        expect(res).toMatchObject({ status: 'IDEMPOTENT', idempotent: true, movementId: 'mov-prev' });
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    });

    it('IGNORED_STALE: внешний event старее последнего marketplace movement → не пишет conflict', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        const externalAt = new Date('2026-04-26T10:00:00Z');
        const localLatest = new Date('2026-04-26T11:00:00Z');
        prisma.stockMovement.findFirst.mockResolvedValue({ createdAt: localLatest });
        prisma.stockBalance.findUnique.mockResolvedValue({ available: 8 });

        const res = await svc.reconcile(TENANT, SOURCE_EVENT, {
            productId: PRODUCT_ID,
            externalAvailable: 5,
            externalEventAt: externalAt,
        });

        expect(res.status).toBe('IGNORED_STALE');
        expect(res.staleAgainstAt).toEqual(localLatest);
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.stockMovement.create).not.toHaveBeenCalled();
        expect(prisma.inventoryEffectLock.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                update: { status: 'IGNORED' },
                create: expect.objectContaining({ status: 'IGNORED' }),
            }),
        );
    });

    it('NOT stale если externalEventAt новее локального — попадает в применение', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        const externalAt = new Date('2026-04-26T12:00:00Z');
        const localLatest = new Date('2026-04-26T10:00:00Z');
        prisma.stockMovement.findFirst.mockResolvedValueOnce({ createdAt: localLatest });
        prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID, total: 10, reserved: 2 });
        prisma.stockBalance.findUnique.mockResolvedValue({ onHand: 10, reserved: 2, available: 8 });
        prisma.stockMovement.create.mockResolvedValue({ id: 'mov-conf' });

        const res = await svc.reconcile(TENANT, SOURCE_EVENT, {
            productId: PRODUCT_ID,
            externalAvailable: 5,
            externalEventAt: externalAt,
        });

        expect(res.status).toBe('CONFLICT_LOGGED');
    });

    it('Fallback на Product.total/reserved если StockBalance ещё не существует', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID, total: 7, reserved: 0 });
        prisma.stockBalance.findUnique.mockResolvedValue(null);
        prisma.stockMovement.create.mockResolvedValue({ id: 'mov-fb' });

        const res = await svc.reconcile(TENANT, SOURCE_EVENT, {
            productId: PRODUCT_ID,
            externalAvailable: 4,
        });

        expect(res.localAvailable).toBe(7);
        expect(res.diff).toBe(-3);
    });

    it('PRODUCT_NOT_FOUND для отсутствующего товара', async () => {
        prisma.inventoryEffectLock.findUnique.mockResolvedValue(null);
        prisma.product.findFirst.mockResolvedValue(null);

        await expect(
            svc.reconcile(TENANT, SOURCE_EVENT, { productId: 'missing', externalAvailable: 5 }),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('валидация: externalAvailable >= 0 integer', async () => {
        await expect(
            svc.reconcile(TENANT, SOURCE_EVENT, { productId: PRODUCT_ID, externalAvailable: -1 }),
        ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'EXTERNAL_AVAILABLE_INVALID' }) });

        await expect(
            svc.reconcile(TENANT, SOURCE_EVENT, { productId: PRODUCT_ID, externalAvailable: 1.5 as any }),
        ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'EXTERNAL_AVAILABLE_INVALID' }) });
    });

    it('требует sourceEventId и productId', async () => {
        await expect(
            svc.reconcile(TENANT, '', { productId: PRODUCT_ID, externalAvailable: 5 }),
        ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'SOURCE_EVENT_ID_REQUIRED' }) });

        await expect(
            svc.reconcile(TENANT, SOURCE_EVENT, { productId: '', externalAvailable: 5 } as any),
        ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'SNAPSHOT_PRODUCT_ID_REQUIRED' }) });
    });
});

describe('InventoryService — diagnostics', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: InventoryService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
    });

    it('listEffectLocks возвращает данные с pagination и фильтрами', async () => {
        prisma.inventoryEffectLock.findMany.mockResolvedValue([{ id: 'l1' }, { id: 'l2' }]);
        prisma.inventoryEffectLock.count.mockResolvedValue(2);

        const res = await svc.listEffectLocks(TENANT, { status: 'FAILED' as any, page: 1, limit: 10 });

        expect(res.data).toHaveLength(2);
        expect(res.meta).toMatchObject({ total: 2, page: 1, lastPage: 1 });
        expect(prisma.inventoryEffectLock.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { tenantId: TENANT, status: 'FAILED' } }),
        );
    });

    it('getDiagnostics собирает счётчики locks/conflicts/failures за 24h', async () => {
        prisma.inventoryEffectLock.count
            .mockResolvedValueOnce(1)  // processing
            .mockResolvedValueOnce(2)  // failed
            .mockResolvedValueOnce(50) // applied
            .mockResolvedValueOnce(3)  // ignored
            .mockResolvedValueOnce(4)  // reserve/release failed last24h
            .mockResolvedValueOnce(1); // deduct failed last24h
        prisma.stockMovement.count.mockResolvedValue(7); // conflicts last24h

        const res = await svc.getDiagnostics(TENANT);

        expect(res.locks).toMatchObject({ processing: 1, applied: 50, ignored: 3, failed: 2 });
        expect(res.conflictsLast24h).toBe(7);
        expect(res.reserveReleaseFailedLast24h).toBe(4);
        expect(res.deductFailedLast24h).toBe(1);
        expect(res.window).toBe('24h');
    });
});
