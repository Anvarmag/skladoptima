/**
 * TASK_ANALYTICS_7 spec для `AnalyticsMetricsRegistry`.
 *
 * Покрывает §19 observability контракт:
 *   - increment накапливает counter, snapshot возвращает значения;
 *   - observeLatency считает p50/p95 по скользящему окну;
 *   - окно ограничено 200;
 *   - reset() обнуляет состояние;
 *   - increment by N (для recommendations batch).
 */

import { AnalyticsMetricNames, AnalyticsMetricsRegistry } from './analytics.metrics';

describe('AnalyticsMetricsRegistry', () => {
    let registry: AnalyticsMetricsRegistry;

    beforeEach(() => {
        registry = new AnalyticsMetricsRegistry();
    });

    it('increment накапливает counter и снапшот возвращает значения', () => {
        registry.increment(AnalyticsMetricNames.DASHBOARD_OPENS, { tenantId: 't1' });
        registry.increment(AnalyticsMetricNames.DASHBOARD_OPENS);
        registry.increment(AnalyticsMetricNames.ABC_RECOMPUTE_COUNT);

        const snap = registry.snapshot();
        expect(snap.counters[AnalyticsMetricNames.DASHBOARD_OPENS]).toBe(2);
        expect(snap.counters[AnalyticsMetricNames.ABC_RECOMPUTE_COUNT]).toBe(1);
    });

    it('observeLatency считает p50/p95 по скользящему окну', () => {
        for (let i = 1; i <= 100; i++) registry.observeLatency(i);
        const snap = registry.snapshot();
        expect(snap.latency.count).toBe(100);
        expect(snap.latency.p50).toBeGreaterThanOrEqual(50);
        expect(snap.latency.p95).toBeGreaterThanOrEqual(95);
    });

    it('латентность ограничена окном 200 (sliding window)', () => {
        for (let i = 0; i < 250; i++) registry.observeLatency(i);
        expect(registry.snapshot().latency.count).toBe(200);
    });

    it('reset() обнуляет всё состояние', () => {
        registry.increment(AnalyticsMetricNames.DASHBOARD_OPENS);
        registry.observeLatency(42);
        registry.reset();
        expect(registry.snapshot()).toEqual({
            counters: {},
            latency: { count: 0, p50: null, p95: null },
        });
    });

    it('increment by N (для recommendations batch)', () => {
        registry.increment(
            AnalyticsMetricNames.RECOMMENDATIONS_GENERATED,
            { ruleKey: 'low_stock_high_demand' },
            5,
        );
        expect(
            registry.snapshot().counters[AnalyticsMetricNames.RECOMMENDATIONS_GENERATED],
        ).toBe(5);
    });

    it('перечень AnalyticsMetricNames покрывает §19 контракт', () => {
        // Регрессия: если кто-то удалит метрику — тест падает.
        const required = [
            'DASHBOARD_OPENS',
            'SNAPSHOT_BUILD_DURATION',
            'ABC_RECOMPUTE_COUNT',
            'RECOMMENDATIONS_GENERATED',
            'EXPORT_FAILURES',
            'STALE_VIEWS',
            'REBUILD_BLOCKED_BY_TENANT',
        ];
        for (const k of required) {
            expect((AnalyticsMetricNames as any)[k]).toBeDefined();
        }
    });
});
