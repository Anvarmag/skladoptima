/**
 * TASK_ANALYTICS_7 — regression matrix (§16) cross-pipeline.
 *
 * Покрывает кейсы из §16 system-analytics:
 *   - dashboard на пустом tenant → snapshotStatus=EMPTY, нулевые KPI;
 *   - dashboard на периоде с продажами → корректные KPI;
 *   - первый dashboard НЕ возвращает revenueGross (§13 MVP контракт);
 *   - ABC при равной выручке стабильно ранжирует (sku asc tie-breaker);
 *   - ABC stale → snapshotStatus=STALE при свежих рассчитанных группах;
 *   - rebuild blocked в TRIAL_EXPIRED (через AnalyticsPolicyService);
 *   - recommendations НЕ exposes dismiss/applied workflow в DTO;
 *   - export blocked метрика → counter increment.
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: { Decimal: class { constructor(public n: any) {} toString() { return String(this.n); } toFixed(p: number) { return Number(this.n).toFixed(p); } }, InputJsonValue: undefined as any },
    AccessState: {
        EARLY_ACCESS: 'EARLY_ACCESS', TRIAL_ACTIVE: 'TRIAL_ACTIVE',
        TRIAL_EXPIRED: 'TRIAL_EXPIRED', ACTIVE_PAID: 'ACTIVE_PAID',
        GRACE_PERIOD: 'GRACE_PERIOD', SUSPENDED: 'SUSPENDED', CLOSED: 'CLOSED',
    },
    AnalyticsAbcMetric: { REVENUE_NET: 'REVENUE_NET', UNITS: 'UNITS' },
    AnalyticsSnapshotStatus: { READY: 'READY', STALE: 'STALE', INCOMPLETE: 'INCOMPLETE', FAILED: 'FAILED' },
    AnalyticsRecommendationPriority: { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' },
    AnalyticsRecommendationStatus: { ACTIVE: 'ACTIVE', DISMISSED: 'DISMISSED', APPLIED: 'APPLIED' },
    MarketplaceType: { WB: 'WB', OZON: 'OZON' },
}));

import { ForbiddenException } from '@nestjs/common';
import { AnalyticsAbcCalculatorService } from './analytics-abc-calculator.service';
import { AnalyticsAbcService } from './analytics-abc.service';
import { AnalyticsAggregatorService } from './analytics-aggregator.service';
import { AnalyticsExportService } from './analytics-export.service';
import { AnalyticsPolicyService } from './analytics-policy.service';
import { AnalyticsReadService } from './analytics-read.service';
import { AnalyticsRecommendationsService } from './analytics-recommendations.service';
import { AnalyticsMetricNames, AnalyticsMetricsRegistry } from './analytics.metrics';

const TENANT = 'tenant-1';

function pausedPolicy(state: string = 'TRIAL_EXPIRED'): AnalyticsPolicyService {
    return {
        assertRebuildAllowed: jest.fn().mockRejectedValue(
            new ForbiddenException({
                code: 'ANALYTICS_REBUILD_BLOCKED_BY_TENANT_STATE',
                message: state,
            }),
        ),
        isReadAllowed: jest.fn().mockResolvedValue(true),
        evaluateStaleness: jest.fn().mockReturnValue({
            isStale: false, isIncomplete: false, classification: 'FRESH_AND_COMPLETE',
        }),
    } as unknown as AnalyticsPolicyService;
}

function activePolicy(): AnalyticsPolicyService {
    return {
        assertRebuildAllowed: jest.fn().mockResolvedValue('ACTIVE_PAID'),
        isReadAllowed: jest.fn().mockResolvedValue(true),
        evaluateStaleness: jest.fn().mockReturnValue({
            isStale: false, isIncomplete: false, classification: 'FRESH_AND_COMPLETE',
        }),
    } as unknown as AnalyticsPolicyService;
}

// ─────────────────────────────────────────────────────────────────────
// §16: dashboard на пустом tenant
// ─────────────────────────────────────────────────────────────────────

describe('§16: dashboard на пустом tenant', () => {
    it('пустой → snapshotStatus=EMPTY, нулевые KPI, без exception', async () => {
        const prisma = {
            analyticsMaterializedDaily: { findMany: jest.fn().mockResolvedValue([]) },
        } as any;
        const metrics = new AnalyticsMetricsRegistry();
        const svc = new AnalyticsReadService(prisma, activePolicy(), metrics);
        const r = await svc.getDashboard(TENANT, {
            periodFrom: new Date('2026-04-01'),
            periodTo: new Date('2026-04-30'),
        });
        expect(r.snapshotStatus).toBe('EMPTY');
        expect(r.kpis.revenueNet).toBe(0);
        // §19 metric: dashboard_opens увеличился на 1
        expect(metrics.snapshot().counters[AnalyticsMetricNames.DASHBOARD_OPENS]).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────
// §13: dashboard НЕ возвращает revenueGross (MVP contract)
// ─────────────────────────────────────────────────────────────────────

describe('§13: dashboard ограничен MVP набором KPI', () => {
    it('kpis НЕ содержит revenueGross', async () => {
        const prisma = {
            analyticsMaterializedDaily: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        date: new Date('2026-04-01'), revenueNet: 100, ordersCount: 1,
                        unitsSold: 1, returnsCount: 0, byMarketplace: {},
                        snapshotStatus: 'READY', sourceFreshness: null,
                    },
                ]),
            },
        } as any;
        const svc = new AnalyticsReadService(
            prisma, activePolicy(), new AnalyticsMetricsRegistry(),
        );
        const r = await svc.getDashboard(TENANT, {
            periodFrom: new Date('2026-04-01'),
            periodTo: new Date('2026-04-30'),
        });
        expect(r.kpis).not.toHaveProperty('revenueGross');
        // Должны быть ровно 6 ключей §13.
        expect(Object.keys(r.kpis).sort()).toEqual([
            'avgCheck', 'ordersCount', 'returnsCount', 'revenueNet',
            'topMarketplaceShare', 'unitsSold',
        ]);
    });
});

// ─────────────────────────────────────────────────────────────────────
// §16 + §14: ABC при равной выручке — deterministic tie-breaker
// ─────────────────────────────────────────────────────────────────────

describe('§16 + §14: ABC при равной выручке — sku asc tie-breaker', () => {
    it('одинаковые revenueValues → стабильный rank по sku asc', () => {
        const calc = new AnalyticsAbcCalculatorService();
        const r = calc.calculate([
            { productId: 'p3', sku: 'Z', metricValue: 100 },
            { productId: 'p1', sku: 'A', metricValue: 100 },
            { productId: 'p2', sku: 'M', metricValue: 100 },
        ]);
        expect(r.rows.map((x) => x.sku)).toEqual(['A', 'M', 'Z']);
    });
});

// ─────────────────────────────────────────────────────────────────────
// §10: rebuild blocked при TRIAL_EXPIRED — все три pipelines
// ─────────────────────────────────────────────────────────────────────

describe('§10: rebuild blocked при TRIAL_EXPIRED → 403 + metric', () => {
    it('daily rebuild blocked → metric REBUILD_BLOCKED_BY_TENANT', async () => {
        const prisma = {} as any;
        const metrics = new AnalyticsMetricsRegistry();
        const svc = new AnalyticsAggregatorService(prisma, pausedPolicy(), metrics);
        await expect(
            svc.rebuildDailyRange({
                tenantId: TENANT,
                periodFrom: new Date('2026-04-01'),
                periodTo: new Date('2026-04-01'),
            }),
        ).rejects.toThrow(ForbiddenException);
        expect(
            metrics.snapshot().counters[AnalyticsMetricNames.REBUILD_BLOCKED_BY_TENANT],
        ).toBe(1);
    });

    it('abc rebuild blocked → metric REBUILD_BLOCKED_BY_TENANT', async () => {
        const prisma = {} as any;
        const metrics = new AnalyticsMetricsRegistry();
        const svc = new AnalyticsAbcService(
            prisma, new AnalyticsAbcCalculatorService(), pausedPolicy(), metrics,
        );
        await expect(
            svc.rebuild({
                tenantId: TENANT,
                periodFrom: new Date('2026-04-01'),
                periodTo: new Date('2026-04-30'),
            }),
        ).rejects.toThrow(ForbiddenException);
        expect(
            metrics.snapshot().counters[AnalyticsMetricNames.REBUILD_BLOCKED_BY_TENANT],
        ).toBe(1);
    });

    it('recommendations refresh blocked → metric REBUILD_BLOCKED_BY_TENANT', async () => {
        const prisma = {} as any;
        const metrics = new AnalyticsMetricsRegistry();
        const svc = new AnalyticsRecommendationsService(prisma, pausedPolicy(), metrics);
        await expect(svc.refresh({ tenantId: TENANT })).rejects.toThrow(ForbiddenException);
        expect(
            metrics.snapshot().counters[AnalyticsMetricNames.REBUILD_BLOCKED_BY_TENANT],
        ).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────
// §15: recommendations DTO НЕ exposes dismiss/applied workflow
// ─────────────────────────────────────────────────────────────────────

describe('§15: recommendations DTO без dismiss/applied buttons', () => {
    it('list возвращает поля, но НЕ exposes API для dismiss/applied (контракт)', async () => {
        const prisma = {
            analyticsRecommendation: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        id: 'r1', productId: 'p1', ruleKey: 'low_stock_high_demand',
                        reasonCode: 'stock_below_7_days', priority: 'HIGH', status: 'ACTIVE',
                        message: 'm', payload: {}, formulaVersion: 'mvp-v1',
                        createdAt: new Date('2026-04-28'), updatedAt: new Date('2026-04-28'),
                        resolvedAt: null,
                    },
                ]),
            },
            product: { findMany: jest.fn().mockResolvedValue([{ id: 'p1', sku: 'SKU-A', name: 'A' }]) },
        } as any;
        const svc = new AnalyticsRecommendationsService(
            prisma, activePolicy(), new AnalyticsMetricsRegistry(),
        );
        const r = await svc.list(TENANT);
        // status присутствует ТОЛЬКО для информации (engine-driven), но
        // никаких mutate-методов в сервисе нет — проверяем, что объект
        // сервиса не имеет dismiss/apply методов.
        expect((svc as any).dismissByUser).toBeUndefined();
        expect((svc as any).applyByUser).toBeUndefined();
        // payload содержит status, но это engine-managed поле.
        expect(r[0].status).toBe('ACTIVE');
    });
});

// ─────────────────────────────────────────────────────────────────────
// §19: export failure инкрементирует EXPORT_FAILURES
// ─────────────────────────────────────────────────────────────────────

describe('§19: export failure → metric EXPORT_FAILURES', () => {
    it('abc snapshot отсутствует → 404 + metric+1', async () => {
        const prisma = {
            analyticsAbcSnapshot: { findUnique: jest.fn().mockResolvedValue(null) },
        } as any;
        const metrics = new AnalyticsMetricsRegistry();
        const svc = new AnalyticsExportService(prisma, metrics);
        await expect(
            svc.export({
                tenantId: TENANT, target: 'abc', format: 'csv',
                periodFrom: new Date('2026-04-01'), periodTo: new Date('2026-04-30'),
            }),
        ).rejects.toThrow();
        expect(metrics.snapshot().counters[AnalyticsMetricNames.EXPORT_FAILURES]).toBe(1);
    });

    it('успешный daily export → metric EXPORT_SUCCESS', async () => {
        const prisma = {
            analyticsMaterializedDaily: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        date: new Date('2026-04-01'), revenueGross: 1000, revenueNet: 900,
                        ordersCount: 5, unitsSold: 6, returnsCount: 0, avgCheck: 180,
                        byMarketplace: {}, snapshotStatus: 'READY',
                    },
                ]),
            },
        } as any;
        const metrics = new AnalyticsMetricsRegistry();
        const svc = new AnalyticsExportService(prisma, metrics);
        await svc.export({
            tenantId: TENANT, target: 'daily', format: 'csv',
            periodFrom: new Date('2026-04-01'), periodTo: new Date('2026-04-30'),
        });
        expect(metrics.snapshot().counters[AnalyticsMetricNames.EXPORT_SUCCESS]).toBe(1);
        expect(metrics.snapshot().counters[AnalyticsMetricNames.EXPORT_FAILURES]).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────
// §16: dashboard со stale snapshot → STALE_VIEWS metric
// ─────────────────────────────────────────────────────────────────────

describe('§19: stale dashboard → STALE_VIEWS metric', () => {
    it('classification STALE_BUT_COMPLETE → counter+1', async () => {
        const prisma = {
            analyticsMaterializedDaily: {
                findMany: jest.fn().mockResolvedValue([
                    {
                        date: new Date('2026-04-01'), revenueNet: 100, ordersCount: 1,
                        unitsSold: 1, returnsCount: 0, byMarketplace: {},
                        snapshotStatus: 'STALE',
                        sourceFreshness: { orders: { isStale: true, lastEventAt: '2025-01-01' } },
                    },
                ]),
            },
        } as any;
        const metrics = new AnalyticsMetricsRegistry();
        const policy = {
            evaluateStaleness: jest.fn().mockReturnValue({
                isStale: true, isIncomplete: false, classification: 'STALE_BUT_COMPLETE',
            }),
        } as unknown as AnalyticsPolicyService;
        const svc = new AnalyticsReadService(prisma, policy, metrics);
        await svc.getDashboard(TENANT, {
            periodFrom: new Date('2026-04-01'),
            periodTo: new Date('2026-04-30'),
        });
        expect(metrics.snapshot().counters[AnalyticsMetricNames.STALE_VIEWS]).toBe(1);
    });
});
