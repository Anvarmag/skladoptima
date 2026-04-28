/**
 * TASK_ANALYTICS_2 spec для `AnalyticsAggregatorService`.
 *
 * Покрывает §15 + §13:
 *   - идемпотентность daily aggregation: upsert по (tenantId, date);
 *   - возвраты не увеличивают revenueGross, но уменьшают revenueNet;
 *   - дни без заказов всё равно создают строку с нулями (revenue dynamics
 *     рисует непрерывную ось X);
 *   - per-marketplace breakdown пишется в byMarketplace;
 *   - period.to < period.from → 400;
 *   - period > MAX_PERIOD_DAYS → 400.
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: {
        Decimal: class {
            constructor(public n: any) {}
            toString() { return String(this.n); }
            toFixed(p: number) { return Number(this.n).toFixed(p); }
        },
        InputJsonValue: undefined as any,
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

import { BadRequestException } from '@nestjs/common';
import { AnalyticsAggregatorService } from './analytics-aggregator.service';
import { AnalyticsPolicyService } from './analytics-policy.service';
import { AnalyticsMetricsRegistry } from './analytics.metrics';

const TENANT = 'tenant-1';

function makePrisma(opts: { orders?: any[]; lastOrder?: any | null } = {}) {
    return {
        marketplaceOrder: {
            findMany: jest
                .fn()
                .mockImplementationOnce(async () => opts.orders ?? [])
                .mockImplementation(async () => opts.orders ?? []),
            findFirst: jest.fn().mockResolvedValue(opts.lastOrder ?? null),
        },
        analyticsMaterializedDaily: {
            upsert: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
    } as any;
}

function makePolicy(): AnalyticsPolicyService {
    return {
        assertRebuildAllowed: jest.fn().mockResolvedValue('ACTIVE_PAID'),
        isReadAllowed: jest.fn().mockResolvedValue(true),
        evaluateStaleness: jest.fn().mockReturnValue({
            isStale: false, isIncomplete: false, classification: 'FRESH_AND_COMPLETE',
        }),
    } as unknown as AnalyticsPolicyService;
}

function makeSvc(prisma: any) {
    return new AnalyticsAggregatorService(prisma, makePolicy(), new AnalyticsMetricsRegistry());
}

describe('AnalyticsAggregatorService.rebuildDailyRange — happy path', () => {
    it('создаёт строки для всех дней, включая дни без заказов', async () => {
        const prisma = makePrisma({
            orders: [
                { marketplace: 'WB', marketplaceCreatedAt: new Date('2026-04-01T10:00:00Z'), quantity: 2, totalAmount: 1000, status: 'delivered', productSku: 'SKU-A' },
                { marketplace: 'OZON', marketplaceCreatedAt: new Date('2026-04-03T15:00:00Z'), quantity: 1, totalAmount: 500, status: 'delivered', productSku: 'SKU-B' },
            ],
            lastOrder: { marketplaceCreatedAt: new Date() },
        });
        const r = await makeSvc(prisma).rebuildDailyRange({
            tenantId: TENANT,
            periodFrom: new Date('2026-04-01'),
            periodTo: new Date('2026-04-03'),
        });
        expect(r.daysProcessed).toBe(3);
        expect(r.rowsUpserted).toBe(3);
        expect(prisma.analyticsMaterializedDaily.upsert).toHaveBeenCalledTimes(3);
    });

    it('возврат не увеличивает gross, но уменьшает net', async () => {
        const prisma = makePrisma({
            orders: [
                { marketplace: 'WB', marketplaceCreatedAt: new Date('2026-04-01T10:00:00Z'), quantity: 2, totalAmount: 1000, status: 'delivered', productSku: 'SKU-A' },
                { marketplace: 'WB', marketplaceCreatedAt: new Date('2026-04-01T11:00:00Z'), quantity: 1, totalAmount: 300, status: 'returned', productSku: 'SKU-A' },
            ],
            lastOrder: { marketplaceCreatedAt: new Date() },
        });
        await makeSvc(prisma).rebuildDailyRange({
            tenantId: TENANT,
            periodFrom: new Date('2026-04-01'),
            periodTo: new Date('2026-04-01'),
        });
        const upsertCall = (prisma.analyticsMaterializedDaily.upsert as jest.Mock).mock.calls[0][0];
        expect(upsertCall.create.revenueGross.toString()).toBe('1000.00');
        expect(upsertCall.create.revenueNet.toString()).toBe('700.00'); // 1000 - 300
        expect(upsertCall.create.returnsCount).toBe(1);
        expect(upsertCall.create.ordersCount).toBe(1); // возврат не считается заказом
    });

    it('byMarketplace разбивка корректна', async () => {
        const prisma = makePrisma({
            orders: [
                { marketplace: 'WB', marketplaceCreatedAt: new Date('2026-04-01T10:00:00Z'), quantity: 1, totalAmount: 1000, status: 'delivered', productSku: 'a' },
                { marketplace: 'OZON', marketplaceCreatedAt: new Date('2026-04-01T11:00:00Z'), quantity: 2, totalAmount: 500, status: 'delivered', productSku: 'b' },
            ],
            lastOrder: { marketplaceCreatedAt: new Date() },
        });
        await makeSvc(prisma).rebuildDailyRange({
            tenantId: TENANT,
            periodFrom: new Date('2026-04-01'),
            periodTo: new Date('2026-04-01'),
        });
        const upsertCall = (prisma.analyticsMaterializedDaily.upsert as jest.Mock).mock.calls[0][0];
        const byMp = upsertCall.create.byMarketplace as any;
        expect(byMp.WB.revenueNet).toBe(1000);
        expect(byMp.OZON.revenueNet).toBe(500);
        expect(byMp.WB.unitsSold).toBe(1);
        expect(byMp.OZON.unitsSold).toBe(2);
    });

    it('source freshness STALE прокидывается через updateMany', async () => {
        const prisma = makePrisma({
            orders: [{ marketplace: 'WB', marketplaceCreatedAt: new Date('2026-04-01T10:00:00Z'), quantity: 1, totalAmount: 100, status: 'ok', productSku: 'a' }],
            lastOrder: { marketplaceCreatedAt: new Date('2025-01-01') }, // > 48h ago
        });
        const r = await makeSvc(prisma).rebuildDailyRange({
            tenantId: TENANT,
            periodFrom: new Date('2026-04-01'),
            periodTo: new Date('2026-04-01'),
        });
        expect(r.snapshotStatus).toBe('STALE');
        expect(r.sourceFreshness.orders.isStale).toBe(true);
        expect(prisma.analyticsMaterializedDaily.updateMany).toHaveBeenCalled();
    });
});

describe('AnalyticsAggregatorService — validation', () => {
    it('to < from → 400', async () => {
        const prisma = makePrisma({});
        await expect(
            makeSvc(prisma).rebuildDailyRange({
                tenantId: TENANT,
                periodFrom: new Date('2026-04-30'),
                periodTo: new Date('2026-04-01'),
            }),
        ).rejects.toThrow(BadRequestException);
    });

    it('окно > 366 дней → 400', async () => {
        const prisma = makePrisma({});
        await expect(
            makeSvc(prisma).rebuildDailyRange({
                tenantId: TENANT,
                periodFrom: new Date('2024-01-01'),
                periodTo: new Date('2026-01-01'),
            }),
        ).rejects.toThrow(BadRequestException);
    });
});
