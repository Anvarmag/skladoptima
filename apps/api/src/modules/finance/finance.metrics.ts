/**
 * TASK_FINANCE_7: observability контракт для finance domain.
 *
 * §19 system-analytics требует метрики:
 *   - `finance_snapshots_generated` — успешные snapshot rebuild'ы;
 *   - `snapshot_generation_failures` — exception в pipeline (preflight,
 *     loader, calculator, persist);
 *   - `warning_incomplete_count` — gauge: текущее число INCOMPLETE
 *     snapshots; histogram распределения warning-типов;
 *   - `negative_margin_sku_count` — gauge: текущее число SKU с profit < 0;
 *   - `cost_profile_updates` — counter: успешные PATCH cost.
 *   - `finance_rebuild_blocked_by_tenant` — counter (TASK_FINANCE_5
 *     policy hits).
 *   - `manual_input_rejected` — counter: попытки bypass whitelist.
 *   - `finance_snapshot_build_latency_ms` — histogram.
 *
 * Реализация — process-local in-memory counters + structured-логи (по
 * образцу `OrdersMetricsRegistry` из 10-orders/TASK_ORDERS_7).
 * Не Prometheus client сознательно: integration через log-based metrics
 * в Loki/Datadog для MVP достаточно.
 */

import { Injectable, Logger } from '@nestjs/common';

export const FinanceMetricNames = {
    SNAPSHOTS_GENERATED: 'finance_snapshots_generated',
    SNAPSHOT_GENERATION_FAILURES: 'snapshot_generation_failures',
    WARNING_INCOMPLETE_COUNT: 'warning_incomplete_count',
    NEGATIVE_MARGIN_SKU_COUNT: 'negative_margin_sku_count',
    COST_PROFILE_UPDATES: 'cost_profile_updates',
    REBUILD_BLOCKED_BY_TENANT: 'finance_rebuild_blocked_by_tenant',
    MANUAL_INPUT_REJECTED: 'finance_manual_input_rejected',
    BUILD_LATENCY_MS: 'finance_snapshot_build_latency_ms',
} as const;
export type FinanceMetricName = typeof FinanceMetricNames[keyof typeof FinanceMetricNames];

export interface FinanceMetricLabels {
    tenantId?: string;
    formulaVersion?: string;
    /** Стабильный код причины (TENANT_TRIAL_EXPIRED, INCOMPLETE_BUT_FRESH etc). */
    reason?: string;
    /** Подкатегория для warning-распределения. */
    warningType?: string;
}

@Injectable()
export class FinanceMetricsRegistry {
    private readonly logger = new Logger('FinanceMetrics');

    private readonly counters = new Map<FinanceMetricName, number>();
    private readonly latencyWindow: number[] = [];
    private readonly LATENCY_WINDOW_SIZE = 200;

    increment(name: FinanceMetricName, labels: FinanceMetricLabels = {}, by: number = 1): void {
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

    observeLatency(ms: number, labels: FinanceMetricLabels = {}): void {
        this.latencyWindow.push(ms);
        if (this.latencyWindow.length > this.LATENCY_WINDOW_SIZE) {
            this.latencyWindow.shift();
        }
        this.logger.log(
            JSON.stringify({
                metric: FinanceMetricNames.BUILD_LATENCY_MS,
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
