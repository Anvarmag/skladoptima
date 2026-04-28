import { Injectable } from '@nestjs/common';
import { AnalyticsRecommendationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
    ANALYTICS_FORMULA_VERSION,
    ANALYTICS_STALE_SOURCE_WINDOW_HOURS,
} from './analytics.constants';
import {
    AnalyticsPolicyService,
    SnapshotFreshnessVerdict,
} from './analytics-policy.service';

/**
 * Status API (TASK_ANALYTICS_4): объясняет freshness, completeness и
 * rebuild state по всем витринам analytics.
 *
 * §19 правило: UI должен видеть «откуда дует ветер» в одном вызове —
 * без необходимости отдельно опрашивать daily layer / ABC / recommendations.
 *
 * НЕ инициирует rebuild и НЕ дёргает marketplace API. Это read-only
 * snapshot, доступный даже при `TRIAL_EXPIRED / SUSPENDED / CLOSED`.
 */

export interface AnalyticsStatusResponse {
    formulaVersion: string;
    sources: {
        orders: { lastEventAt: string | null; isStale: boolean; ageHours: number | null };
    };
    daily: {
        rowsCount: number;
        latestDate: string | null;
        oldestDate: string | null;
        statusBreakdown: Record<string, number>;
        freshness: SnapshotFreshnessVerdict;
    };
    abc: {
        snapshotsCount: number;
        latestGeneratedAt: string | null;
        latestPeriod: { from: string; to: string; metric: string } | null;
    };
    recommendations: {
        activeCount: number;
        dismissedCount: number;
        byPriority: { HIGH: number; MEDIUM: number; LOW: number };
        latestRefreshAt: string | null;
    };
}

@Injectable()
export class AnalyticsStatusService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly policy: AnalyticsPolicyService,
    ) {}

    async getStatus(tenantId: string): Promise<AnalyticsStatusResponse> {
        const [lastOrder, dailyAgg, dailyStatuses, latestAbc, abcCount, recAgg, latestRec] =
            await Promise.all([
                this.prisma.marketplaceOrder.findFirst({
                    where: { tenantId, NOT: { marketplaceCreatedAt: null } },
                    orderBy: { marketplaceCreatedAt: 'desc' },
                    select: { marketplaceCreatedAt: true },
                }),
                this.prisma.analyticsMaterializedDaily.aggregate({
                    where: { tenantId },
                    _count: { _all: true },
                    _max: { date: true },
                    _min: { date: true },
                }),
                this.prisma.analyticsMaterializedDaily.groupBy({
                    by: ['snapshotStatus'],
                    where: { tenantId },
                    _count: { _all: true },
                }),
                this.prisma.analyticsAbcSnapshot.findFirst({
                    where: { tenantId, formulaVersion: ANALYTICS_FORMULA_VERSION },
                    orderBy: { generatedAt: 'desc' },
                    select: { generatedAt: true, periodFrom: true, periodTo: true, metric: true },
                }),
                this.prisma.analyticsAbcSnapshot.count({ where: { tenantId } }),
                this.prisma.analyticsRecommendation.groupBy({
                    by: ['status', 'priority'],
                    where: { tenantId },
                    _count: { _all: true },
                }),
                this.prisma.analyticsRecommendation.findFirst({
                    where: { tenantId },
                    orderBy: { updatedAt: 'desc' },
                    select: { updatedAt: true },
                }),
            ]);

        const lastEventAt = lastOrder?.marketplaceCreatedAt ?? null;
        const ageHours = lastEventAt
            ? Math.round((Date.now() - lastEventAt.getTime()) / (60 * 60 * 1000))
            : null;
        const isStale =
            ageHours !== null && ageHours > ANALYTICS_STALE_SOURCE_WINDOW_HOURS;

        const statusBreakdown: Record<string, number> = {};
        for (const s of dailyStatuses) {
            statusBreakdown[s.snapshotStatus] = s._count._all;
        }
        // Verdict для daily витрины: смотрим на самый «болезненный» статус
        // в текущем срезе — STALE или INCOMPLETE доминирует над READY.
        const dominantStatus = statusBreakdown.FAILED
            ? 'FAILED'
            : statusBreakdown.STALE
              ? 'STALE'
              : statusBreakdown.INCOMPLETE
                ? 'INCOMPLETE'
                : 'READY';
        const freshnessVerdict = this.policy.evaluateStaleness({
            sourceFreshness: { orders: { isStale } },
            snapshotStatus: dominantStatus,
        });

        const byPriority = { HIGH: 0, MEDIUM: 0, LOW: 0 };
        let activeCount = 0;
        let dismissedCount = 0;
        for (const r of recAgg) {
            if (r.status === AnalyticsRecommendationStatus.ACTIVE) {
                activeCount += r._count._all;
                byPriority[r.priority] += r._count._all;
            } else if (r.status === AnalyticsRecommendationStatus.DISMISSED) {
                dismissedCount += r._count._all;
            }
        }

        return {
            formulaVersion: ANALYTICS_FORMULA_VERSION,
            sources: {
                orders: {
                    lastEventAt: lastEventAt ? lastEventAt.toISOString() : null,
                    isStale,
                    ageHours,
                },
            },
            daily: {
                rowsCount: dailyAgg._count._all,
                latestDate: dailyAgg._max.date
                    ? dailyAgg._max.date.toISOString().slice(0, 10)
                    : null,
                oldestDate: dailyAgg._min.date
                    ? dailyAgg._min.date.toISOString().slice(0, 10)
                    : null,
                statusBreakdown,
                freshness: freshnessVerdict,
            },
            abc: {
                snapshotsCount: abcCount,
                latestGeneratedAt: latestAbc?.generatedAt
                    ? latestAbc.generatedAt.toISOString()
                    : null,
                latestPeriod: latestAbc
                    ? {
                          from: latestAbc.periodFrom.toISOString().slice(0, 10),
                          to: latestAbc.periodTo.toISOString().slice(0, 10),
                          metric: latestAbc.metric,
                      }
                    : null,
            },
            recommendations: {
                activeCount,
                dismissedCount,
                byPriority,
                latestRefreshAt: latestRec?.updatedAt
                    ? latestRec.updatedAt.toISOString()
                    : null,
            },
        };
    }
}
