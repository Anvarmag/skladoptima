/**
 * TASK_ANALYTICS_4 spec для `AnalyticsStatusService`.
 *
 * Покрывает §19:
 *   - status агрегирует freshness, daily layer, ABC и recommendations;
 *   - пустой tenant → пустой статус, без exception;
 *   - source isStale считается по окну 48h.
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    AnalyticsRecommendationStatus: { ACTIVE: 'ACTIVE', DISMISSED: 'DISMISSED', APPLIED: 'APPLIED' },
    AnalyticsSnapshotStatus: { READY: 'READY', STALE: 'STALE', INCOMPLETE: 'INCOMPLETE', FAILED: 'FAILED' },
    AccessState: {
        EARLY_ACCESS: 'EARLY_ACCESS', TRIAL_ACTIVE: 'TRIAL_ACTIVE',
        TRIAL_EXPIRED: 'TRIAL_EXPIRED', ACTIVE_PAID: 'ACTIVE_PAID',
        GRACE_PERIOD: 'GRACE_PERIOD', SUSPENDED: 'SUSPENDED', CLOSED: 'CLOSED',
    },
}));

import { AnalyticsStatusService } from './analytics-status.service';
import { AnalyticsPolicyService } from './analytics-policy.service';

function makePolicy(): AnalyticsPolicyService {
    return {
        evaluateStaleness: jest.fn().mockReturnValue({
            isStale: false, isIncomplete: false, classification: 'FRESH_AND_COMPLETE',
        }),
    } as unknown as AnalyticsPolicyService;
}

const TENANT = 'tenant-1';

function makePrisma(opts: any = {}) {
    return {
        marketplaceOrder: { findFirst: jest.fn().mockResolvedValue(opts.lastOrder ?? null) },
        analyticsMaterializedDaily: {
            aggregate: jest.fn().mockResolvedValue(opts.dailyAgg ?? { _count: { _all: 0 }, _max: { date: null }, _min: { date: null } }),
            groupBy: jest.fn().mockResolvedValue(opts.dailyStatuses ?? []),
        },
        analyticsAbcSnapshot: {
            findFirst: jest.fn().mockResolvedValue(opts.latestAbc ?? null),
            count: jest.fn().mockResolvedValue(opts.abcCount ?? 0),
        },
        analyticsRecommendation: {
            groupBy: jest.fn().mockResolvedValue(opts.recAgg ?? []),
            findFirst: jest.fn().mockResolvedValue(opts.latestRec ?? null),
        },
    } as any;
}

describe('AnalyticsStatusService.getStatus', () => {
    it('пустой tenant → null/0 значения, без exception', async () => {
        const r = await new AnalyticsStatusService(makePrisma({}), makePolicy()).getStatus(TENANT);
        expect(r.sources.orders.lastEventAt).toBeNull();
        expect(r.daily.rowsCount).toBe(0);
        expect(r.abc.snapshotsCount).toBe(0);
        expect(r.recommendations.activeCount).toBe(0);
    });

    it('агрегирует все витрины + считает stale флаг', async () => {
        const r = await new AnalyticsStatusService(
            makePrisma({
                lastOrder: { marketplaceCreatedAt: new Date('2025-01-01') }, // stale
                dailyAgg: { _count: { _all: 30 }, _max: { date: new Date('2026-04-28') }, _min: { date: new Date('2026-04-01') } },
                dailyStatuses: [
                    { snapshotStatus: 'READY', _count: { _all: 28 } },
                    { snapshotStatus: 'STALE', _count: { _all: 2 } },
                ],
                abcCount: 3,
                latestAbc: {
                    generatedAt: new Date('2026-04-28T10:00:00Z'),
                    periodFrom: new Date('2026-04-01'),
                    periodTo: new Date('2026-04-30'),
                    metric: 'REVENUE_NET',
                },
                recAgg: [
                    { status: 'ACTIVE', priority: 'HIGH', _count: { _all: 2 } },
                    { status: 'ACTIVE', priority: 'MEDIUM', _count: { _all: 5 } },
                    { status: 'DISMISSED', priority: 'LOW', _count: { _all: 1 } },
                ],
                latestRec: { updatedAt: new Date('2026-04-28T11:00:00Z') },
            }),
            makePolicy(),
        ).getStatus(TENANT);
        expect(r.sources.orders.isStale).toBe(true);
        expect(r.daily.statusBreakdown).toEqual({ READY: 28, STALE: 2 });
        expect(r.abc.latestPeriod?.metric).toBe('REVENUE_NET');
        expect(r.recommendations.activeCount).toBe(7);
        expect(r.recommendations.byPriority.HIGH).toBe(2);
        expect(r.recommendations.dismissedCount).toBe(1);
    });
});
