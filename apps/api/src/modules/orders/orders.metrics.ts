/**
 * TASK_ORDERS_7: observability контракт для orders domain.
 *
 * §19 system-analytics требует метрики:
 *   - `orders_ingested` — успешные ingestion'ы (новые + апдейты);
 *   - `duplicate_order_events` — отбитые UNIQUE/findUnique дубли;
 *   - `out_of_order_ignored` — устаревшие event'ы;
 *   - `status_mapping_failures` — unknown external статусы;
 *   - `unmatched_sku_orders` — заказы с UNRESOLVED items;
 *   - `order_side_effect_failures` — STOCK_EFFECT_FAILED исходы;
 *   - `order_ingest_blocked_by_tenant` — BLOCKED_BY_POLICY decisions;
 *   - `order_timeline_processing_latency_ms` — длительность ingestion
 *     handler'а от приёма event'а до записи в БД (см. §18 SLA).
 *
 * Реализация в MVP — process-local in-memory counters + structured
 * JSON-логи. Это сознательно не Prometheus client: integration с pull-
 * based scraper'ом и labels-cardinality control — отдельная инфра-задача.
 * Сейчас метрики:
 *   1. логируются один раз при каждом инкременте (для tail/log-based
 *      metrics в Loki/Datadog);
 *   2. доступны через `OrdersMetricsRegistry.snapshot()` — для health-
 *      endpoint'а или диагностики из admin-консоли (ещё не подключено к
 *      controller'у — будет в TASK на дашборды).
 *
 * Дизайн-принципы:
 *   - НЕ зависит от Prisma/Nest — чистый класс, проще тестировать;
 *   - labels — `{tenantId, marketplace}`, чтобы в логах сразу видеть
 *     scope, но мы НЕ агрегируем counters по labels локально (это
 *     задача scraper'а), храним только глобальный per-event-name;
 *   - имя метрики — стабильная константа `OrdersMetricNames`.
 */

import { Injectable, Logger } from '@nestjs/common';

export const OrdersMetricNames = {
    INGESTED: 'orders_ingested',
    DUPLICATE: 'duplicate_order_events',
    OUT_OF_ORDER: 'out_of_order_ignored',
    STATUS_MAPPING_FAILED: 'status_mapping_failures',
    UNMATCHED_SKU_ORDER: 'unmatched_sku_orders',
    SIDE_EFFECT_FAILED: 'order_side_effect_failures',
    INGEST_BLOCKED_BY_TENANT: 'order_ingest_blocked_by_tenant',
    PROCESSING_LATENCY_MS: 'order_timeline_processing_latency_ms',
    REPROCESS_INVOKED: 'order_reprocess_invoked',
} as const;
export type OrdersMetricName = typeof OrdersMetricNames[keyof typeof OrdersMetricNames];

export interface MetricLabels {
    tenantId?: string;
    marketplace?: string;
    fulfillmentMode?: string;
    /** Подкатегория (например, 'TENANT_TRIAL_EXPIRED' для blocked). */
    reason?: string;
    /** Сервис-источник для distributed tracing — 'ingestion' / 'reprocess' / 'effects'. */
    source?: string;
}

@Injectable()
export class OrdersMetricsRegistry {
    private readonly logger = new Logger('OrdersMetrics');

    /** Глобальные счётчики per metric name (без cardinality по labels). */
    private readonly counters = new Map<OrdersMetricName, number>();

    /** Скользящее окно последних N latency измерений для p50/p95 быстрых
     * health-чеков. Не Prometheus histogram — упрощение для MVP. */
    private readonly latencyWindow: number[] = [];
    private readonly LATENCY_WINDOW_SIZE = 200;

    /**
     * Инкрементирует counter и пишет structured-лог.
     * Логирование на каждом инкременте — компромисс: Loki/Datadog
     * умеют считать events в пайплайне, и нам не нужен отдельный
     * Prometheus exporter для MVP. Под высокой нагрузкой это может стать
     * spammy — тогда стоит перейти на batched flush, но сейчас orders
     * domain имеет умеренную пропускную способность.
     */
    increment(name: OrdersMetricName, labels: MetricLabels = {}, by: number = 1): void {
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

    /**
     * Записывает latency в скользящее окно и пишет одно structured-
     * событие. Sampling не применяется — orders domain не настолько
     * нагружен, чтобы мерить selective.
     */
    observeLatency(ms: number, labels: MetricLabels = {}): void {
        this.latencyWindow.push(ms);
        if (this.latencyWindow.length > this.LATENCY_WINDOW_SIZE) {
            this.latencyWindow.shift();
        }
        this.logger.log(
            JSON.stringify({
                metric: OrdersMetricNames.PROCESSING_LATENCY_MS,
                value: ms,
                ...labels,
                ts: new Date().toISOString(),
            }),
        );
    }

    /** Snapshot для health-эндпоинта или ручной диагностики. */
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

    /** Только для тестов — обнуляет всё состояние. */
    reset(): void {
        this.counters.clear();
        this.latencyWindow.length = 0;
    }
}
