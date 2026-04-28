import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsReadService } from './analytics-read.service';
import { AnalyticsAggregatorService } from './analytics-aggregator.service';
import { AnalyticsAbcService } from './analytics-abc.service';
import { AnalyticsAbcCalculatorService } from './analytics-abc-calculator.service';
import { AnalyticsRecommendationsService } from './analytics-recommendations.service';
import { AnalyticsStatusService } from './analytics-status.service';
import { AnalyticsExportService } from './analytics-export.service';
import { AnalyticsPolicyService } from './analytics-policy.service';
import { AnalyticsMetricsRegistry } from './analytics.metrics';

@Module({
    // Legacy `AnalyticsService` (geo + 14-day dynamics + on-the-fly recs) —
    // оставлен под /analytics/geo, /analytics/recommendations/legacy,
    // /analytics/revenue-dynamics/legacy.
    // TASK_ANALYTICS_2: AnalyticsAggregatorService + AnalyticsReadService.
    // TASK_ANALYTICS_3: AnalyticsAbcCalculatorService + AnalyticsAbcService.
    // TASK_ANALYTICS_4: AnalyticsRecommendationsService + Status + Export.
    // TASK_ANALYTICS_5: AnalyticsPolicyService — централизованный guard.
    // TASK_ANALYTICS_7: AnalyticsMetricsRegistry — observability counters,
    //                   latency p50/p95, recommendation distribution.
    providers: [
        AnalyticsService,
        AnalyticsReadService,
        AnalyticsAggregatorService,
        AnalyticsAbcCalculatorService,
        AnalyticsAbcService,
        AnalyticsRecommendationsService,
        AnalyticsStatusService,
        AnalyticsExportService,
        AnalyticsPolicyService,
        AnalyticsMetricsRegistry,
    ],
    controllers: [AnalyticsController],
    exports: [
        AnalyticsService,
        AnalyticsReadService,
        AnalyticsAggregatorService,
        AnalyticsAbcCalculatorService,
        AnalyticsAbcService,
        AnalyticsRecommendationsService,
        AnalyticsStatusService,
        AnalyticsExportService,
        AnalyticsPolicyService,
        AnalyticsMetricsRegistry,
    ],
})
export class AnalyticsModule {}
