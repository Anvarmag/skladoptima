import { Injectable, Logger } from '@nestjs/common';

export type MetricCounter =
    | 'events_created'
    | 'dispatch_sent'
    | 'dispatch_delivered'
    | 'dispatch_failed'
    | 'dispatch_skipped'
    | 'dedup_suppressed'
    | 'throttle_suppressed'
    | 'retry_scheduled';

export interface MetricsSnapshot {
    counters: Record<MetricCounter, number>;
    delivery_latency_ms: { p50: number | null; p95: number | null; p99: number | null; sample_size: number };
}

const LATENCY_SAMPLE_CAP = 10_000;

/**
 * In-process metric counters for the notifications pipeline.
 *
 * Complements the structured-JSON logs produced by the delivery worker and
 * policy engine (§19 system-analytics). Provides:
 *   - per-counter increments recordable at key pipeline points;
 *   - rolling delivery latency sample (event.createdAt → dispatch sentAt);
 *   - alert-level log when dispatch failure or dedup suppression exceeds threshold.
 *
 * getSnapshot() → consumed by GET /api/notifications/metrics (controller).
 * In-process only — resets on restart. For persistent metrics use structured
 * logs + Grafana/OpenTelemetry in a future observability phase.
 */
@Injectable()
export class NotificationsMetricsService {
    private readonly logger = new Logger('NotificationsMetrics');

    private readonly counters: Record<MetricCounter, number> = {
        events_created: 0,
        dispatch_sent: 0,
        dispatch_delivered: 0,
        dispatch_failed: 0,
        dispatch_skipped: 0,
        dedup_suppressed: 0,
        throttle_suppressed: 0,
        retry_scheduled: 0,
    };

    private readonly latencies: number[] = [];

    increment(counter: MetricCounter): void {
        this.counters[counter]++;
        this._maybeAlert(counter);
    }

    /**
     * Record time-to-delivery for a dispatch that just reached SENT/DELIVERED.
     * Logs ALERT when latency exceeds the p95 SLA of 60 s (§18).
     */
    recordDeliveryLatency(eventCreatedAt: Date): void {
        const latencyMs = Date.now() - eventCreatedAt.getTime();
        this.latencies.push(latencyMs);
        if (this.latencies.length > LATENCY_SAMPLE_CAP) {
            this.latencies.splice(0, Math.floor(LATENCY_SAMPLE_CAP / 10));
        }
        if (latencyMs > 60_000) {
            this.logger.error(JSON.stringify({
                alert: 'DELIVERY_LATENCY_HIGH',
                latencyMs,
                slaMs: 60_000,
                ts: new Date().toISOString(),
            }));
        }
    }

    getSnapshot(): MetricsSnapshot {
        const sorted = [...this.latencies].sort((a, b) => a - b);
        const pct = (p: number) =>
            sorted.length
                ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null
                : null;

        return {
            counters: { ...this.counters },
            delivery_latency_ms: {
                p50: pct(0.5),
                p95: pct(0.95),
                p99: pct(0.99),
                sample_size: sorted.length,
            },
        };
    }

    private _maybeAlert(counter: MetricCounter): void {
        const val = this.counters[counter];
        if (counter === 'dispatch_failed' && val > 0 && val % 10 === 0) {
            this.logger.error(JSON.stringify({
                alert: 'DISPATCH_FAILURE_SPIKE',
                total_failed: val,
                ts: new Date().toISOString(),
            }));
        }
        if (counter === 'dedup_suppressed' && val > 0 && val % 50 === 0) {
            this.logger.warn(JSON.stringify({
                alert: 'HIGH_DEDUP_SUPPRESSION',
                total_suppressed: val,
                ts: new Date().toISOString(),
            }));
        }
    }
}
