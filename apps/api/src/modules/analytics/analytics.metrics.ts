/**
 * TASK_ANALYTICS_7: observability контракт для analytics domain.
 *
 * §19 system-analytics требует метрики:
 *   - `analytics_dashboard_opens` — counter: вызовы read API (dashboard).
 *   - `analytics_snapshot_build_duration` — histogram (label: target = daily / abc).
 *   - `analytics_abc_recompute_count` — counter: успешные ABC rebuild'ы.
 *   - `analytics_recommendations_generated` — counter: активированные сигналы
 *     при refresh (label: ruleKey).
 *   - `analytics_export_failures` — counter: неуспешные export-вызовы.
 *   - `analytics_stale_views` — counter: snapshot/dashboard, помеченные
 *     STALE / STALE_AND_INCOMPLETE при чтении.
 *   - `analytics_rebuild_blocked_by_tenant` — counter (TASK_ANALYTICS_5
 *     policy hits, label: reason = TRIAL_EXPIRED / SUSPENDED / CLOSED).
 *
 * Реализация — process-local in-memory counters + structured-логи (по
 * образцу `FinanceMetricsRegistry`). Не Prometheus client сознательно:
 * integration через log-based metrics в Loki/Datadog для MVP достаточно.
 */

import { Injectable, Logger } from '@nestjs/common';

export const AnalyticsMetricNames = {
    DASHBOARD_OPENS: 'analytics_dashboard_opens',
    SNAPSHOT_BUILD_DURATION: 'analytics_snapshot_build_duration',
    ABC_RECOMPUTE_COUNT: 'analytics_abc_recompute_count',
    RECOMMENDATIONS_GENERATED: 'analytics_recommendations_generated',
    RECOMMENDATIONS_DISMISSED: 'analytics_recommendations_dismissed',
    EXPORT_FAILURES: 'analytics_export_failures',
    EXPORT_SUCCESS: 'analytics_export_success',
    STALE_VIEWS: 'analytics_stale_views',
    REBUILD_BLOCKED_BY_TENANT: 'analytics_rebuild_blocked_by_tenant',
    DAILY_REBUILD_COUNT: 'analytics_daily_rebuild_count',
} as const;
export type AnalyticsMetricName =
    (typeof AnalyticsMetricNames)[keyof typeof AnalyticsMetricNames];

export interface AnalyticsMetricLabels {
    tenantId?: string;
    formulaVersion?: string;
    /** `daily` / `abc` / `recommendations` — какой pipeline. */
    target?: string;
    /** Человеко/машинно-читаемая причина (`TENANT_TRIAL_EXPIRED`,
     *  `STALE_AND_INCOMPLETE`, `EMPTY_PERIOD`, `LOW_STOCK_HIGH_DEMAND`...). */
    reason?: string;
    /** Опциональный rule_key для recommendations breakdown. */
    ruleKey?: string;
}

@Injectable()
export class AnalyticsMetricsRegistry {
    private readonly logger = new Logger('AnalyticsMetrics');

    private readonly counters = new Map<AnalyticsMetricName, number>();
    /** Окно последних N latency-замеров для p50/p95 без полной гистограммы. */
    private readonly latencyWindow: number[] = [];
    private readonly LATENCY_WINDOW_SIZE = 200;

    increment(
        name: AnalyticsMetricName,
        labels: AnalyticsMetricLabels = {},
        by: number = 1,
    ): void {
        const next = (this.counters.get(name) ?? 0) + by;
        this.counters.set(name, next);
        this.logger.log(
            JSON.stringify({
                metric: name,
                value: by,
                total: next,
                ...labels,
                ts: new Date().toISOString(),
            }),
        );
    }

    observeLatency(ms: number, labels: AnalyticsMetricLabels = {}): void {
        this.latencyWindow.push(ms);
        if (this.latencyWindow.length > this.LATENCY_WINDOW_SIZE) {
            this.latencyWindow.shift();
        }
        this.logger.log(
            JSON.stringify({
                metric: AnalyticsMetricNames.SNAPSHOT_BUILD_DURATION,
                value: ms,
                ...labels,
                ts: new Date().toISOString(),
            }),
        );
    }

    snapshot(): {
        counters: Record<string, number>;
        latency: { count: number; p50: number | null; p95: number | null };
    } {
        const counters: Record<string, number> = {};
        for (const [k, v] of this.counters.entries()) counters[k] = v;

        const sorted = [...this.latencyWindow].sort((a, b) => a - b);
        const p = (q: number) =>
            sorted.length === 0
                ? null
                : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];

        return {
            counters,
            latency: { count: sorted.length, p50: p(0.5), p95: p(0.95) },
        };
    }

    reset(): void {
        this.counters.clear();
        this.latencyWindow.length = 0;
    }
}
