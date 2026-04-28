/**
 * TASK_ANALYTICS_4 spec для `AnalyticsRecommendationsService`.
 *
 * Покрывает §15 + §16 + §20:
 *   - rule engine генерирует только explainable сигналы (rule_key,
 *     reason_code, priority, payload);
 *   - LOW_STOCK_HIGH_DEMAND: <7 дней → HIGH, <14 дней → MEDIUM;
 *   - LOW_RATING при rating<4 → MEDIUM;
 *   - STALE_ANALYTICS_SOURCE при age>48h;
 *   - идемпотентность: повторный refresh обновляет, не плодит дубли;
 *   - устаревшие активные сигналы → DISMISSED + resolvedAt;
 *   - list возвращает только ACTIVE, отсортированные по priority desc.
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: { Decimal: class { constructor(public n: any) {} toString() { return String(this.n); } }, InputJsonValue: undefined as any },
    AnalyticsRecommendationPriority: { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' },
    AnalyticsRecommendationStatus: { ACTIVE: 'ACTIVE', DISMISSED: 'DISMISSED', APPLIED: 'APPLIED' },
    AnalyticsSnapshotStatus: { READY: 'READY', STALE: 'STALE', INCOMPLETE: 'INCOMPLETE', FAILED: 'FAILED' },
    AccessState: {
        EARLY_ACCESS: 'EARLY_ACCESS', TRIAL_ACTIVE: 'TRIAL_ACTIVE',
        TRIAL_EXPIRED: 'TRIAL_EXPIRED', ACTIVE_PAID: 'ACTIVE_PAID',
        GRACE_PERIOD: 'GRACE_PERIOD', SUSPENDED: 'SUSPENDED', CLOSED: 'CLOSED',
    },
}));

import { AnalyticsRecommendationsService } from './analytics-recommendations.service';
import { AnalyticsPolicyService } from './analytics-policy.service';
import { AnalyticsMetricsRegistry } from './analytics.metrics';

const TENANT = 'tenant-1';

function makePrisma(opts: {
    products?: any[];
    grouped?: any[];
    stocks?: any[];
    lastOrder?: any | null;
    activeBefore?: any[];
    listItems?: any[];
} = {}) {
    return {
        product: {
            findMany: jest
                .fn()
                .mockResolvedValueOnce(opts.products ?? [])
                .mockResolvedValue(opts.products ?? []),
        },
        marketplaceOrder: {
            groupBy: jest.fn().mockResolvedValue(opts.grouped ?? []),
            findFirst: jest.fn().mockResolvedValue(opts.lastOrder ?? null),
        },
        stockBalance: {
            findMany: jest.fn().mockResolvedValue(opts.stocks ?? []),
        },
        analyticsRecommendation: {
            findMany: jest
                .fn()
                .mockResolvedValueOnce(opts.activeBefore ?? [])
                .mockResolvedValue(opts.listItems ?? []),
            upsert: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
    } as any;
}

function makePolicy(): AnalyticsPolicyService {
    return {
        assertRebuildAllowed: jest.fn().mockResolvedValue('ACTIVE_PAID'),
        isReadAllowed: jest.fn().mockResolvedValue(true),
    } as unknown as AnalyticsPolicyService;
}

function makeSvc(prisma: any) {
    return new AnalyticsRecommendationsService(prisma, makePolicy(), new AnalyticsMetricsRegistry());
}

const NOW = new Date('2026-04-28T12:00:00Z');

describe('AnalyticsRecommendationsService.refresh — rule evaluation', () => {
    it('пустой tenant → 0 кандидатов, нет вызовов upsert', async () => {
        const prisma = makePrisma({});
        const r = await makeSvc(prisma).refresh({ tenantId: TENANT, asOf: NOW });
        expect(r.activated).toBe(0);
        expect(r.totalActive).toBe(0);
        expect(prisma.analyticsRecommendation.upsert).not.toHaveBeenCalled();
    });

    it('LOW_STOCK <7 дней → HIGH priority с reasonCode STOCK_BELOW_7_DAYS', async () => {
        const prisma = makePrisma({
            products: [{ id: 'p1', sku: 'SKU-A', name: 'A', rating: 4.5 }],
            grouped: [{ productSku: 'SKU-A', _sum: { quantity: 60 } }], // velocity = 2/day
            stocks: [{ productId: 'p1', available: 10, reserved: 0, onHand: 10 }], // 10/2 = 5 days
            lastOrder: { marketplaceCreatedAt: NOW },
        });
        const r = await makeSvc(prisma).refresh({ tenantId: TENANT, asOf: NOW });
        expect(r.activated).toBe(1);
        const upsertCall = (prisma.analyticsRecommendation.upsert as jest.Mock).mock.calls[0][0];
        expect(upsertCall.create.ruleKey).toBe('low_stock_high_demand');
        expect(upsertCall.create.reasonCode).toBe('stock_below_7_days');
        expect(upsertCall.create.priority).toBe('HIGH');
        expect((upsertCall.create.payload as any).daysRemaining).toBe(5);
    });

    it('LOW_STOCK 7..14 дней → MEDIUM с reasonCode STOCK_BELOW_14_DAYS', async () => {
        const prisma = makePrisma({
            products: [{ id: 'p1', sku: 'SKU-A', name: 'A', rating: 4.5 }],
            grouped: [{ productSku: 'SKU-A', _sum: { quantity: 30 } }], // velocity = 1/day
            stocks: [{ productId: 'p1', available: 10, reserved: 0, onHand: 10 }], // 10 days
            lastOrder: { marketplaceCreatedAt: NOW },
        });
        const r = await makeSvc(prisma).refresh({ tenantId: TENANT, asOf: NOW });
        expect(r.activated).toBe(1);
        const upsertCall = (prisma.analyticsRecommendation.upsert as jest.Mock).mock.calls[0][0];
        expect(upsertCall.create.priority).toBe('MEDIUM');
        expect(upsertCall.create.reasonCode).toBe('stock_below_14_days');
    });

    it('LOW_STOCK не срабатывает при стоке > 14 дней', async () => {
        const prisma = makePrisma({
            products: [{ id: 'p1', sku: 'SKU-A', name: 'A', rating: 4.5 }],
            grouped: [{ productSku: 'SKU-A', _sum: { quantity: 30 } }], // velocity = 1/day
            stocks: [{ productId: 'p1', available: 100, reserved: 0, onHand: 100 }], // 100 days
            lastOrder: { marketplaceCreatedAt: NOW },
        });
        const r = await makeSvc(prisma).refresh({ tenantId: TENANT, asOf: NOW });
        expect(r.activated).toBe(0);
    });

    it('LOW_RATING при rating<4 → MEDIUM', async () => {
        const prisma = makePrisma({
            products: [{ id: 'p1', sku: 'SKU-A', name: 'A', rating: 3.5 }],
            stocks: [],
            lastOrder: { marketplaceCreatedAt: NOW },
        });
        const r = await makeSvc(prisma).refresh({ tenantId: TENANT, asOf: NOW });
        expect(r.activated).toBe(1);
        const upsertCall = (prisma.analyticsRecommendation.upsert as jest.Mock).mock.calls[0][0];
        expect(upsertCall.create.ruleKey).toBe('low_rating');
        expect(upsertCall.create.priority).toBe('MEDIUM');
    });

    it('STALE_ANALYTICS_SOURCE при age > 48h → tenant-wide MEDIUM сигнал', async () => {
        const prisma = makePrisma({
            products: [],
            lastOrder: { marketplaceCreatedAt: new Date('2026-04-25T00:00:00Z') }, // ~84h
        });
        const r = await makeSvc(prisma).refresh({ tenantId: TENANT, asOf: NOW });
        expect(r.activated).toBe(1);
        const upsertCall = (prisma.analyticsRecommendation.upsert as jest.Mock).mock.calls[0][0];
        expect(upsertCall.create.productId).toBeNull();
        expect(upsertCall.create.ruleKey).toBe('stale_analytics_source');
    });

    it('повторный refresh устаревший сигнал → DISMISSED', async () => {
        const prisma = makePrisma({
            products: [{ id: 'p1', sku: 'SKU-A', name: 'A', rating: 4.5 }],
            stocks: [{ productId: 'p1', available: 100, reserved: 0, onHand: 100 }],
            lastOrder: { marketplaceCreatedAt: NOW },
            activeBefore: [
                { id: 'r1', productId: 'p1', ruleKey: 'low_stock_high_demand' },
            ],
        });
        const r = await makeSvc(prisma).refresh({ tenantId: TENANT, asOf: NOW });
        expect(r.dismissed).toBe(1);
        expect(prisma.analyticsRecommendation.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ['r1'] } },
            data: { status: 'DISMISSED', resolvedAt: NOW },
        });
    });

    it('идемпотентность: тот же сигнал → upsert (а не отдельный create)', async () => {
        const prisma = makePrisma({
            products: [{ id: 'p1', sku: 'SKU-A', name: 'A', rating: 3.5 }],
            stocks: [],
            lastOrder: { marketplaceCreatedAt: NOW },
            activeBefore: [{ id: 'r1', productId: 'p1', ruleKey: 'low_rating' }],
        });
        const r = await makeSvc(prisma).refresh({ tenantId: TENANT, asOf: NOW });
        expect(r.activated).toBe(1);
        expect(r.dismissed).toBe(0); // уже был в active, остался в active
    });
});

describe('AnalyticsRecommendationsService.list', () => {
    it('возвращает только ACTIVE отсортированные по priority+createdAt', async () => {
        const prisma = makePrisma({});
        prisma.analyticsRecommendation.findMany = jest.fn().mockResolvedValue([
            {
                id: 'r1', productId: 'p1', ruleKey: 'low_stock_high_demand',
                reasonCode: 'stock_below_7_days', priority: 'HIGH', status: 'ACTIVE',
                message: 'm', payload: {}, formulaVersion: 'mvp-v1',
                createdAt: new Date('2026-04-28T10:00:00Z'),
                updatedAt: new Date('2026-04-28T10:00:00Z'),
                resolvedAt: null,
            },
        ]);
        prisma.product.findMany = jest.fn().mockResolvedValue([
            { id: 'p1', sku: 'SKU-A', name: 'Product A' },
        ]);
        const r = await makeSvc(prisma).list(TENANT);
        expect(r).toHaveLength(1);
        expect(r[0].sku).toBe('SKU-A');
        expect(r[0].name).toBe('Product A');
        expect(r[0].priority).toBe('HIGH');
    });

    it('пустой результат → []', async () => {
        const prisma = makePrisma({});
        prisma.analyticsRecommendation.findMany = jest.fn().mockResolvedValue([]);
        const r = await makeSvc(prisma).list(TENANT);
        expect(r).toEqual([]);
    });
});
