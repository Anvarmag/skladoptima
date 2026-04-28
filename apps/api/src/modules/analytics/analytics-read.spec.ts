/**
 * TASK_ANALYTICS_2 spec для `AnalyticsReadService`.
 *
 * Покрывает §16 матрицы:
 *   - dashboard на пустом tenant → snapshotStatus=EMPTY, без exception;
 *   - dashboard на периоде с продажами → корректные KPI и top marketplace;
 *   - первый dashboard ограничен MVP набором KPI (нет gross в payload);
 *   - revenue dynamics возвращает ровно daily series из materialized;
 *   - top products фильтрует по marketplace и сортирует по revenue;
 *   - drill-down по неизвестному SKU → 404;
 *   - период > MAX_PERIOD_DAYS → 400;
 *   - period.to < period.from → 400.
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: {
        Decimal: class {
            constructor(public n: any) {}
            toString() {
                return String(this.n);
            }
        },
    },
    MarketplaceType: { WB: 'WB', OZON: 'OZON' },
    AnalyticsSnapshotStatus: {
        READY: 'READY',
        STALE: 'STALE',
        INCOMPLETE: 'INCOMPLETE',
        FAILED: 'FAILED',
    },
    AccessState: {
        EARLY_ACCESS: 'EARLY_ACCESS', TRIAL_ACTIVE: 'TRIAL_ACTIVE',
        TRIAL_EXPIRED: 'TRIAL_EXPIRED', ACTIVE_PAID: 'ACTIVE_PAID',
        GRACE_PERIOD: 'GRACE_PERIOD', SUSPENDED: 'SUSPENDED', CLOSED: 'CLOSED',
    },
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AnalyticsReadService } from './analytics-read.service';
import { AnalyticsPolicyService } from './analytics-policy.service';
import { AnalyticsMetricsRegistry } from './analytics.metrics';

const TENANT = 'tenant-1';

function makePrisma(opts: {
    daily?: any[];
    grouped?: any[];
    products?: any[];
    product?: any | null;
    orders?: any[];
} = {}) {
    return {
        analyticsMaterializedDaily: {
            findMany: jest.fn().mockResolvedValue(opts.daily ?? []),
        },
        marketplaceOrder: {
            groupBy: jest.fn().mockResolvedValue(opts.grouped ?? []),
            findMany: jest.fn().mockResolvedValue(opts.orders ?? []),
        },
        product: {
            findMany: jest.fn().mockResolvedValue(opts.products ?? []),
            findFirst: jest.fn().mockResolvedValue(opts.product ?? null),
        },
    } as any;
}

function makePolicy(): AnalyticsPolicyService {
    return {
        evaluateStaleness: jest.fn().mockReturnValue({
            isStale: false, isIncomplete: false, classification: 'FRESH_AND_COMPLETE',
        }),
    } as unknown as AnalyticsPolicyService;
}

function makeSvc(prisma: any) {
    return new AnalyticsReadService(prisma, makePolicy(), new AnalyticsMetricsRegistry());
}

const PERIOD = {
    periodFrom: new Date('2026-04-01'),
    periodTo: new Date('2026-04-30'),
};

describe('AnalyticsReadService.getDashboard', () => {
    it('пустой tenant → snapshotStatus=EMPTY, нулевые KPI без exception', async () => {
        const prisma = makePrisma({ daily: [] });
        const r = await makeSvc(prisma).getDashboard(TENANT, PERIOD);
        expect(r.snapshotStatus).toBe('EMPTY');
        expect(r.kpis.revenueNet).toBe(0);
        expect(r.kpis.topMarketplaceShare).toEqual({ marketplace: null, sharePct: 0 });
    });

    it('период с продажами → агрегированные KPI и top marketplace share', async () => {
        const prisma = makePrisma({
            daily: [
                {
                    date: new Date('2026-04-01'),
                    revenueNet: 1000,
                    ordersCount: 10,
                    unitsSold: 12,
                    returnsCount: 1,
                    byMarketplace: {
                        WB: { revenueGross: 800, revenueNet: 800, ordersCount: 8, unitsSold: 10 },
                        OZON: { revenueGross: 200, revenueNet: 200, ordersCount: 2, unitsSold: 2 },
                    },
                    snapshotStatus: 'READY',
                    sourceFreshness: { orders: { isStale: false } },
                },
                {
                    date: new Date('2026-04-02'),
                    revenueNet: 500,
                    ordersCount: 5,
                    unitsSold: 5,
                    returnsCount: 0,
                    byMarketplace: {
                        WB: { revenueGross: 400, revenueNet: 400, ordersCount: 4, unitsSold: 4 },
                        OZON: { revenueGross: 100, revenueNet: 100, ordersCount: 1, unitsSold: 1 },
                    },
                    snapshotStatus: 'READY',
                    sourceFreshness: { orders: { isStale: false } },
                },
            ],
        });
        const r = await makeSvc(prisma).getDashboard(TENANT, PERIOD);
        expect(r.kpis.revenueNet).toBe(1500);
        expect(r.kpis.ordersCount).toBe(15);
        expect(r.kpis.unitsSold).toBe(17);
        expect(r.kpis.returnsCount).toBe(1);
        expect(r.kpis.avgCheck).toBe(100);
        expect(r.kpis.topMarketplaceShare.marketplace).toBe('WB');
        expect(r.kpis.topMarketplaceShare.sharePct).toBe(80);
        expect(r.snapshotStatus).toBe('READY');
    });

    it('STALE среди дней → snapshotStatus=STALE на агрегате', async () => {
        const prisma = makePrisma({
            daily: [
                { date: new Date('2026-04-01'), revenueNet: 100, ordersCount: 1, unitsSold: 1, returnsCount: 0, byMarketplace: {}, snapshotStatus: 'READY', sourceFreshness: null },
                { date: new Date('2026-04-02'), revenueNet: 100, ordersCount: 1, unitsSold: 1, returnsCount: 0, byMarketplace: {}, snapshotStatus: 'STALE', sourceFreshness: null },
            ],
        });
        const r = await makeSvc(prisma).getDashboard(TENANT, PERIOD);
        expect(r.snapshotStatus).toBe('STALE');
    });

    it('первый dashboard ограничен MVP KPI — нет revenueGross в выдаче', async () => {
        const prisma = makePrisma({
            daily: [
                { date: new Date('2026-04-01'), revenueNet: 100, ordersCount: 1, unitsSold: 1, returnsCount: 0, byMarketplace: {}, snapshotStatus: 'READY', sourceFreshness: null },
            ],
        });
        const r = await makeSvc(prisma).getDashboard(TENANT, PERIOD);
        expect(r.kpis).not.toHaveProperty('revenueGross');
    });
});

describe('AnalyticsReadService.getRevenueDynamics', () => {
    it('возвращает daily series в ISO date', async () => {
        const prisma = makePrisma({
            daily: [
                { date: new Date('2026-04-01T00:00:00Z'), revenueNet: 100, ordersCount: 1, byMarketplace: {} },
                { date: new Date('2026-04-02T00:00:00Z'), revenueNet: 200, ordersCount: 2, byMarketplace: {} },
            ],
        });
        const r = await makeSvc(prisma).getRevenueDynamics(TENANT, PERIOD);
        expect(r.series).toHaveLength(2);
        expect(r.series[0].date).toBe('2026-04-01');
        expect(r.series[1].revenueNet).toBe(200);
    });
});

describe('AnalyticsReadService.getTopProducts', () => {
    it('сортирует по revenue, подтягивает product name по sku', async () => {
        const prisma = makePrisma({
            grouped: [
                { productSku: 'SKU-A', _sum: { totalAmount: 5000, quantity: 10 }, _count: { _all: 5 } },
                { productSku: 'SKU-B', _sum: { totalAmount: 3000, quantity: 6 }, _count: { _all: 3 } },
            ],
            products: [
                { id: 'p1', sku: 'SKU-A', name: 'Product A' },
                { id: 'p2', sku: 'SKU-B', name: 'Product B' },
            ],
        });
        const r = await makeSvc(prisma).getTopProducts(TENANT, { ...PERIOD, limit: 5 });
        expect(r.items).toHaveLength(2);
        expect(r.items[0].sku).toBe('SKU-A');
        expect(r.items[0].name).toBe('Product A');
        expect(r.items[0].revenueNet).toBe(5000);
    });

    it('limit clamp: > 100 ограничивается до 100', async () => {
        const prisma = makePrisma({ grouped: [], products: [] });
        await makeSvc(prisma).getTopProducts(TENANT, { ...PERIOD, limit: 9999 });
        const groupByCall = (prisma.marketplaceOrder.groupBy as jest.Mock).mock.calls[0][0];
        expect(groupByCall.take).toBe(100);
    });

    it('marketplace фильтр прокидывается в where', async () => {
        const prisma = makePrisma({ grouped: [], products: [] });
        await makeSvc(prisma).getTopProducts(TENANT, {
            ...PERIOD,
            marketplace: 'WB' as any,
        });
        const groupByCall = (prisma.marketplaceOrder.groupBy as jest.Mock).mock.calls[0][0];
        expect(groupByCall.where.marketplace).toBe('WB');
    });
});

describe('AnalyticsReadService.getProductDrillDown', () => {
    it('product не существует → 404 PRODUCT_ANALYTICS_NOT_FOUND', async () => {
        const prisma = makePrisma({ product: null });
        await expect(
            makeSvc(prisma).getProductDrillDown(TENANT, 'p-x', PERIOD),
        ).rejects.toThrow(NotFoundException);
    });

    it('возвращает KPI и recentOrders с возвратами вычитающими revenue', async () => {
        const prisma = makePrisma({
            product: { id: 'p1', sku: 'SKU-A', name: 'Product A' },
            orders: [
                { marketplace: 'WB', marketplaceOrderId: 'o1', marketplaceCreatedAt: new Date('2026-04-10'), quantity: 2, totalAmount: 1000, status: 'delivered' },
                { marketplace: 'OZON', marketplaceOrderId: 'o2', marketplaceCreatedAt: new Date('2026-04-12'), quantity: 1, totalAmount: 500, status: 'returned' },
            ],
        });
        const r = await makeSvc(prisma).getProductDrillDown(TENANT, 'p1', PERIOD);
        expect(r.kpis.revenueNet).toBe(500); // 1000 - 500
        expect(r.kpis.unitsSold).toBe(2);
        expect(r.kpis.ordersCount).toBe(1);
        expect(r.kpis.returnsCount).toBe(1);
        expect(r.recentOrders).toHaveLength(2);
    });
});

describe('AnalyticsReadService.validate period', () => {
    it('to < from → 400 ANALYTICS_PERIOD_INVALID', async () => {
        const prisma = makePrisma({});
        await expect(
            makeSvc(prisma).getDashboard(TENANT, {
                periodFrom: new Date('2026-04-30'),
                periodTo: new Date('2026-04-01'),
            }),
        ).rejects.toThrow(BadRequestException);
    });

    it('окно > 366 дней → 400 ANALYTICS_PERIOD_TOO_LARGE', async () => {
        const prisma = makePrisma({});
        await expect(
            makeSvc(prisma).getDashboard(TENANT, {
                periodFrom: new Date('2024-01-01'),
                periodTo: new Date('2026-01-01'),
            }),
        ).rejects.toThrow(BadRequestException);
    });
});
