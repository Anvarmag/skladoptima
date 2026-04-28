/**
 * TASK_ANALYTICS_3 spec для `AnalyticsAbcService` (orchestrator).
 *
 * Покрывает §15 + §13 + §16:
 *   - идемпотентный rebuild через upsert на UNIQUE(tenant, period,
 *     metric, formulaVersion);
 *   - возвраты учитываются с минусом (как в aggregator'е);
 *   - SKU без активного product пропускаются;
 *   - getSnapshot отсутствует → snapshot=null без exception;
 *   - INCOMPLETE статус при пустом результате;
 *   - STALE статус при устаревшем источнике;
 *   - period.to < from → 400; > 366 дней → 400.
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: { Decimal: class { constructor(public n: any) {} toString() { return String(this.n); } }, InputJsonValue: undefined as any },
    AnalyticsAbcMetric: { REVENUE_NET: 'REVENUE_NET', UNITS: 'UNITS' },
    AnalyticsSnapshotStatus: { READY: 'READY', STALE: 'STALE', INCOMPLETE: 'INCOMPLETE', FAILED: 'FAILED' },
    AccessState: {
        EARLY_ACCESS: 'EARLY_ACCESS', TRIAL_ACTIVE: 'TRIAL_ACTIVE',
        TRIAL_EXPIRED: 'TRIAL_EXPIRED', ACTIVE_PAID: 'ACTIVE_PAID',
        GRACE_PERIOD: 'GRACE_PERIOD', SUSPENDED: 'SUSPENDED', CLOSED: 'CLOSED',
    },
}));

import { BadRequestException } from '@nestjs/common';
import { AnalyticsAbcService } from './analytics-abc.service';
import { AnalyticsAbcCalculatorService } from './analytics-abc-calculator.service';
import { AnalyticsPolicyService } from './analytics-policy.service';
import { AnalyticsMetricsRegistry } from './analytics.metrics';

const TENANT = 'tenant-1';
const PERIOD = { periodFrom: new Date('2026-04-01'), periodTo: new Date('2026-04-30') };

function makePrisma(opts: {
    orders?: any[];
    products?: any[];
    existing?: any | null;
    snapshot?: any | null;
    lastOrder?: any | null;
} = {}) {
    return {
        marketplaceOrder: {
            findMany: jest.fn().mockResolvedValue(opts.orders ?? []),
            findFirst: jest.fn().mockResolvedValue(opts.lastOrder ?? null),
        },
        product: {
            findMany: jest.fn().mockResolvedValue(opts.products ?? []),
        },
        analyticsAbcSnapshot: {
            findUnique: jest
                .fn()
                .mockResolvedValueOnce(opts.existing ?? null)
                .mockResolvedValue(opts.snapshot ?? null),
            upsert: jest.fn().mockResolvedValue({ id: 'abc-1' }),
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
    return new AnalyticsAbcService(
        prisma,
        new AnalyticsAbcCalculatorService(),
        makePolicy(),
        new AnalyticsMetricsRegistry(),
    );
}

describe('AnalyticsAbcService.rebuild', () => {
    it('пустые orders → INCOMPLETE snapshot, skuCount=0', async () => {
        const prisma = makePrisma({});
        const r = await makeSvc(prisma).rebuild({ tenantId: TENANT, ...PERIOD });
        expect(r.snapshotStatus).toBe('INCOMPLETE');
        expect(r.skuCount).toBe(0);
        expect(r.wasReplaced).toBe(false);
        expect(prisma.analyticsAbcSnapshot.upsert).toHaveBeenCalled();
    });

    it('happy path: 3 SKU → READY snapshot, корректные группы', async () => {
        const prisma = makePrisma({
            orders: [
                { productSku: 'SKU-A', quantity: 10, totalAmount: 800, status: 'delivered' },
                { productSku: 'SKU-B', quantity: 5, totalAmount: 150, status: 'delivered' },
                { productSku: 'SKU-C', quantity: 1, totalAmount: 50, status: 'delivered' },
            ],
            products: [
                { id: 'p1', sku: 'SKU-A' },
                { id: 'p2', sku: 'SKU-B' },
                { id: 'p3', sku: 'SKU-C' },
            ],
            lastOrder: { marketplaceCreatedAt: new Date() },
        });
        const r = await makeSvc(prisma).rebuild({ tenantId: TENANT, ...PERIOD });
        expect(r.snapshotStatus).toBe('READY');
        expect(r.skuCount).toBe(3);
        expect(r.groupCounts).toEqual({ A: 1, B: 1, C: 1 });
    });

    it('возврат вычитается из per-SKU выручки', async () => {
        const prisma = makePrisma({
            orders: [
                { productSku: 'SKU-A', quantity: 10, totalAmount: 1000, status: 'delivered' },
                { productSku: 'SKU-A', quantity: 1, totalAmount: 200, status: 'returned' },
            ],
            products: [{ id: 'p1', sku: 'SKU-A' }],
            lastOrder: { marketplaceCreatedAt: new Date() },
        });
        await makeSvc(prisma).rebuild({ tenantId: TENANT, ...PERIOD });
        const upsertCall = (prisma.analyticsAbcSnapshot.upsert as jest.Mock).mock.calls[0][0];
        const items = upsertCall.create.payload.items;
        expect(items[0].metricValue).toBe(800); // 1000 - 200
    });

    it('SKU без активного product пропускается', async () => {
        const prisma = makePrisma({
            orders: [
                { productSku: 'SKU-A', quantity: 1, totalAmount: 500, status: 'delivered' },
                { productSku: 'SKU-DELETED', quantity: 1, totalAmount: 500, status: 'delivered' },
            ],
            products: [{ id: 'p1', sku: 'SKU-A' }], // SKU-DELETED отсутствует
            lastOrder: { marketplaceCreatedAt: new Date() },
        });
        const r = await makeSvc(prisma).rebuild({ tenantId: TENANT, ...PERIOD });
        expect(r.skuCount).toBe(1);
    });

    it('STALE источник → snapshotStatus=STALE', async () => {
        const prisma = makePrisma({
            orders: [{ productSku: 'SKU-A', quantity: 1, totalAmount: 100, status: 'ok' }],
            products: [{ id: 'p1', sku: 'SKU-A' }],
            lastOrder: { marketplaceCreatedAt: new Date('2025-01-01') }, // > 48h
        });
        const r = await makeSvc(prisma).rebuild({ tenantId: TENANT, ...PERIOD });
        expect(r.snapshotStatus).toBe('STALE');
    });

    it('повторный rebuild → wasReplaced=true', async () => {
        const prisma = makePrisma({
            orders: [{ productSku: 'SKU-A', quantity: 1, totalAmount: 100, status: 'ok' }],
            products: [{ id: 'p1', sku: 'SKU-A' }],
            existing: { id: 'old-snap' },
            lastOrder: { marketplaceCreatedAt: new Date() },
        });
        const r = await makeSvc(prisma).rebuild({ tenantId: TENANT, ...PERIOD });
        expect(r.wasReplaced).toBe(true);
    });
});

describe('AnalyticsAbcService.getSnapshot', () => {
    it('snapshot отсутствует → snapshot=null без exception', async () => {
        const prisma = makePrisma({});
        // findUnique returns null on first call, set both
        prisma.analyticsAbcSnapshot.findUnique = jest.fn().mockResolvedValue(null);
        const r = await makeSvc(prisma).getSnapshot(TENANT, PERIOD.periodFrom, PERIOD.periodTo);
        expect(r.snapshot).toBeNull();
    });

    it('snapshot есть → возвращает payload + meta', async () => {
        const prisma = makePrisma({});
        prisma.analyticsAbcSnapshot.findUnique = jest.fn().mockResolvedValue({
            id: 'abc-1',
            metric: 'REVENUE_NET',
            formulaVersion: 'mvp-v1',
            snapshotStatus: 'READY',
            sourceFreshness: { orders: { isStale: false } },
            generatedAt: new Date('2026-04-30T20:00:00Z'),
            payload: { totals: { skuCount: 3 }, items: [] },
        });
        const r = await makeSvc(prisma).getSnapshot(TENANT, PERIOD.periodFrom, PERIOD.periodTo);
        expect(r.snapshot?.id).toBe('abc-1');
        expect(r.snapshot?.formulaVersion).toBe('mvp-v1');
    });
});

describe('AnalyticsAbcService — period validation', () => {
    it('to < from → 400', async () => {
        const prisma = makePrisma({});
        await expect(
            makeSvc(prisma).rebuild({
                tenantId: TENANT,
                periodFrom: new Date('2026-04-30'),
                periodTo: new Date('2026-04-01'),
            }),
        ).rejects.toThrow(BadRequestException);
    });

    it('окно > 366 дней → 400', async () => {
        const prisma = makePrisma({});
        await expect(
            makeSvc(prisma).rebuild({
                tenantId: TENANT,
                periodFrom: new Date('2024-01-01'),
                periodTo: new Date('2026-01-01'),
            }),
        ).rejects.toThrow(BadRequestException);
    });
});
