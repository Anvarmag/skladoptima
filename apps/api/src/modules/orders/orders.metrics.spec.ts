import { OrdersMetricNames, OrdersMetricsRegistry } from './orders.metrics';

describe('OrdersMetricsRegistry', () => {
    let registry: OrdersMetricsRegistry;

    beforeEach(() => {
        registry = new OrdersMetricsRegistry();
    });

    it('increment накапливает counter и снапшот возвращает значения', () => {
        registry.increment(OrdersMetricNames.INGESTED, { tenantId: 't1' });
        registry.increment(OrdersMetricNames.INGESTED);
        registry.increment(OrdersMetricNames.DUPLICATE);

        const snap = registry.snapshot();
        expect(snap.counters[OrdersMetricNames.INGESTED]).toBe(2);
        expect(snap.counters[OrdersMetricNames.DUPLICATE]).toBe(1);
    });

    it('observeLatency считает p50/p95 по скользящему окну', () => {
        for (let i = 1; i <= 100; i++) registry.observeLatency(i);
        const snap = registry.snapshot();
        expect(snap.latency.count).toBe(100);
        expect(snap.latency.p50).toBeGreaterThanOrEqual(50);
        expect(snap.latency.p50).toBeLessThanOrEqual(51);
        expect(snap.latency.p95).toBeGreaterThanOrEqual(95);
    });

    it('латентность ограничена окном 200 — старые значения вытесняются', () => {
        for (let i = 0; i < 250; i++) registry.observeLatency(i);
        const snap = registry.snapshot();
        expect(snap.latency.count).toBe(200);
    });

    it('reset() обнуляет всё состояние', () => {
        registry.increment(OrdersMetricNames.INGESTED);
        registry.observeLatency(42);
        registry.reset();
        expect(registry.snapshot()).toEqual({
            counters: {},
            latency: { count: 0, p50: null, p95: null },
        });
    });
});
