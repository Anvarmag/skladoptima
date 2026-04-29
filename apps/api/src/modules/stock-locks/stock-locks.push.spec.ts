import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { SyncService } from '../marketplace_sync/sync.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SyncPreflightService } from '../sync-runs/sync-preflight.service';
import { OrdersIngestionService } from '../orders/orders-ingestion.service';
import { AuditService } from '../audit/audit.service';
import { StockLocksService } from './stock-locks.service';

jest.mock('@prisma/client', () => {
    class PrismaClient {}
    return {
        PrismaClient,
        StockLockType: { ZERO: 'ZERO', FIXED: 'FIXED', PAUSED: 'PAUSED' },
        MarketplaceType: { WB: 'WB', OZON: 'OZON' },
        OrderFulfillmentMode: { FBS: 'FBS', FBO: 'FBO' },
        // Нужен на уровне модуля в sync-preflight.service.ts (PAUSED_TENANT_STATES и др.)
        AccessState: {
            EARLY_ACCESS: 'EARLY_ACCESS', TRIAL_ACTIVE: 'TRIAL_ACTIVE',
            TRIAL_EXPIRED: 'TRIAL_EXPIRED', ACTIVE_PAID: 'ACTIVE_PAID',
            GRACE_PERIOD: 'GRACE_PERIOD', SUSPENDED: 'SUSPENDED', CLOSED: 'CLOSED',
        },
        MarketplaceLifecycleStatus: { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE', SUSPENDED: 'SUSPENDED' },
        MarketplaceCredentialStatus: { VALID: 'VALID', INVALID: 'INVALID', NEEDS_RECONNECT: 'NEEDS_RECONNECT' },
        SyncRunStatus: { QUEUED: 'QUEUED', IN_PROGRESS: 'IN_PROGRESS', COMPLETED: 'COMPLETED', FAILED: 'FAILED' },
        AuditActorType: { user: 'user', system: 'system', marketplace: 'marketplace' },
        AuditSource: { api: 'api', worker: 'worker', ui: 'ui' },
        OrderInternalStatus: { IMPORTED: 'IMPORTED', RESERVED: 'RESERVED', CANCELLED: 'CANCELLED', FULFILLED: 'FULFILLED' },
        OrderItemMatchStatus: { MATCHED: 'MATCHED', UNMATCHED: 'UNMATCHED' },
        OrderStockEffectStatus: { PENDING: 'PENDING', NOT_REQUIRED: 'NOT_REQUIRED', APPLIED: 'APPLIED' },
        Prisma: { sql: function () { return { _sql: true }; } },
    };
});

jest.mock('axios');
const axios = require('axios');

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TENANT = 'tenant-1';

function makeItem(id: string, amount: number) {
    return { id, sku: `SKU-${id}`, amount };
}

function makeLock(productId: string, lockType: string, fixedValue: number | null = null) {
    return {
        id: `lock-${productId}`,
        tenantId: TENANT,
        productId,
        marketplace: 'WB',
        lockType,
        fixedValue,
        note: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePrismaMock() {
    return {
        product: { findMany: jest.fn(), findUnique: jest.fn() },
        marketplaceAccount: { findFirst: jest.fn() },
        stockChannelLock: { findUnique: jest.fn() },
        $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    };
}

async function buildService(prisma: any, stockLocks: Partial<StockLocksService>) {
    const preflight = { runPreflight: jest.fn().mockResolvedValue({ allowed: true }) };
    const ordersIngestion = { ingest: jest.fn().mockResolvedValue({ outcome: 'CREATED' }) };
    const auditService = { writeEvent: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
        providers: [
            SyncService,
            { provide: PrismaService, useValue: prisma },
            { provide: SyncPreflightService, useValue: preflight },
            { provide: OrdersIngestionService, useValue: ordersIngestion },
            { provide: AuditService, useValue: auditService },
            { provide: StockLocksService, useValue: stockLocks },
        ],
    }).compile();

    return module.get(SyncService);
}

// ─── Suite: _applyStockLocks (через приватный доступ) ────────────────────────

describe('SyncService — _applyStockLocks', () => {
    let service: SyncService;
    let logSpy: jest.SpyInstance;

    beforeEach(async () => {
        const prisma = makePrismaMock();
        const stockLocks = { findByMarketplace: jest.fn().mockResolvedValue(new Map()) };
        service = await buildService(prisma, stockLocks);
        logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    });

    afterEach(() => jest.clearAllMocks());

    it('при ZERO-блокировке отправляет qty=0', () => {
        const items = [makeItem('prod-1', 50)];
        const lockMap = new Map([['prod-1', makeLock('prod-1', 'ZERO')]]);
        const ctx = { tenantId: TENANT, marketplace: 'WB' };

        const result = (service as any)._applyStockLocks(items, lockMap, ctx);

        expect(result).toHaveLength(1);
        expect(result[0].amount).toBe(0);
    });

    it('при FIXED(10)-блокировке отправляет qty=10', () => {
        const items = [makeItem('prod-1', 50)];
        const lockMap = new Map([['prod-1', makeLock('prod-1', 'FIXED', 10)]]);
        const ctx = { tenantId: TENANT, marketplace: 'WB' };

        const result = (service as any)._applyStockLocks(items, lockMap, ctx);

        expect(result).toHaveLength(1);
        expect(result[0].amount).toBe(10);
    });

    it('при PAUSED-блокировке товар исключается из payload', () => {
        const items = [makeItem('prod-1', 50), makeItem('prod-2', 30)];
        const lockMap = new Map([['prod-1', makeLock('prod-1', 'PAUSED')]]);
        const ctx = { tenantId: TENANT, marketplace: 'WB' };

        const result = (service as any)._applyStockLocks(items, lockMap, ctx);

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('prod-2');
    });

    it('без блокировки отправляет реальный баланс без изменений', () => {
        const items = [makeItem('prod-1', 42)];
        const lockMap = new Map<string, any>();
        const ctx = { tenantId: TENANT, marketplace: 'WB' };

        const result = (service as any)._applyStockLocks(items, lockMap, ctx);

        expect(result).toHaveLength(1);
        expect(result[0].amount).toBe(42);
    });

    it('после снятия блокировки (пустой lockMap) следующий push использует реальный остаток', () => {
        const items = [makeItem('prod-1', 25)];
        const emptyLockMap = new Map<string, any>();
        const ctx = { tenantId: TENANT, marketplace: 'WB' };

        const result = (service as any)._applyStockLocks(items, emptyLockMap, ctx);

        expect(result[0].amount).toBe(25);
    });

    it('логирует push_stocks_overridden_by_lock при ZERO-блокировке', () => {
        const items = [makeItem('prod-1', 50)];
        const lockMap = new Map([['prod-1', makeLock('prod-1', 'ZERO')]]);
        const ctx = { tenantId: TENANT, marketplace: 'WB' };

        (service as any)._applyStockLocks(items, lockMap, ctx);

        expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining('"metric":"push_stocks_overridden_by_lock"'),
        );
    });

    it('логирует push_stocks_skipped_by_lock при PAUSED-блокировке', () => {
        const items = [makeItem('prod-1', 50)];
        const lockMap = new Map([['prod-1', makeLock('prod-1', 'PAUSED')]]);
        const ctx = { tenantId: TENANT, marketplace: 'WB' };

        (service as any)._applyStockLocks(items, lockMap, ctx);

        expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining('"metric":"push_stocks_skipped_by_lock"'),
        );
    });

    it('обрабатывает смешанный batch: часть заблокировано, часть пропущено, часть без изменений', () => {
        const items = [
            makeItem('prod-zero', 100),
            makeItem('prod-fixed', 100),
            makeItem('prod-paused', 100),
            makeItem('prod-free', 100),
        ];
        const lockMap = new Map([
            ['prod-zero',  makeLock('prod-zero',  'ZERO')],
            ['prod-fixed', makeLock('prod-fixed', 'FIXED', 5)],
            ['prod-paused', makeLock('prod-paused', 'PAUSED')],
        ]);
        const ctx = { tenantId: TENANT, marketplace: 'WB' };

        const result = (service as any)._applyStockLocks(items, lockMap, ctx);

        expect(result).toHaveLength(3); // paused исключён
        expect(result.find((i: any) => i.id === 'prod-zero')?.amount).toBe(0);
        expect(result.find((i: any) => i.id === 'prod-fixed')?.amount).toBe(5);
        expect(result.find((i: any) => i.id === 'prod-free')?.amount).toBe(100);
        expect(result.find((i: any) => i.id === 'prod-paused')).toBeUndefined();
    });
});

// ─── Suite: batch SELECT оптимизация ─────────────────────────────────────────

describe('SyncService — batch SELECT оптимизация', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let stockLocks: { findByMarketplace: jest.Mock };
    let service: SyncService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        stockLocks = { findByMarketplace: jest.fn().mockResolvedValue(new Map()) };

        // Мок Ozon-аккаунта для getSettings
        prisma.marketplaceAccount.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValue({ id: 'acc-1', clientId: 'cid', apiKey: 'key', warehouseId: 'wh-1' });

        // 50 товаров с total > ozonFbs чтобы попасть в push batch
        const products = Array.from({ length: 50 }, (_, i) => ({
            id: `prod-${i}`,
            sku: `SKU-${i}`,
            total: 10,
            ozonFbs: 0,
        }));
        prisma.product.findMany.mockResolvedValue(products);

        // Mock axios.post для syncBatchToOzon
        axios.post = jest.fn().mockResolvedValue({ data: {} });

        service = await buildService(prisma, stockLocks);
        jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    });

    afterEach(() => jest.clearAllMocks());

    it('batch из 50 товаров делает ровно 1 вызов findByMarketplace (один SELECT на весь batch)', async () => {
        await service.syncAllToOzon(TENANT);

        expect(stockLocks.findByMarketplace).toHaveBeenCalledTimes(1);
        expect(stockLocks.findByMarketplace).toHaveBeenCalledWith(TENANT, 'OZON');
    });
});
