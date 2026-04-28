import { FinanceMetricNames, FinanceMetricsRegistry } from './finance.metrics';

describe('FinanceMetricsRegistry', () => {
    let registry: FinanceMetricsRegistry;

    beforeEach(() => {
        registry = new FinanceMetricsRegistry();
    });

    it('increment накапливает counter и снапшот возвращает значения', () => {
        registry.increment(FinanceMetricNames.SNAPSHOTS_GENERATED, { tenantId: 't1' });
        registry.increment(FinanceMetricNames.SNAPSHOTS_GENERATED);
        registry.increment(FinanceMetricNames.COST_PROFILE_UPDATES);

        const snap = registry.snapshot();
        expect(snap.counters[FinanceMetricNames.SNAPSHOTS_GENERATED]).toBe(2);
        expect(snap.counters[FinanceMetricNames.COST_PROFILE_UPDATES]).toBe(1);
    });

    it('observeLatency считает p50/p95 по скользящему окну', () => {
        for (let i = 1; i <= 100; i++) registry.observeLatency(i);
        const snap = registry.snapshot();
        expect(snap.latency.count).toBe(100);
        expect(snap.latency.p50).toBeGreaterThanOrEqual(50);
        expect(snap.latency.p95).toBeGreaterThanOrEqual(95);
    });

    it('латентность ограничена окном 200', () => {
        for (let i = 0; i < 250; i++) registry.observeLatency(i);
        expect(registry.snapshot().latency.count).toBe(200);
    });

    it('reset() обнуляет всё состояние', () => {
        registry.increment(FinanceMetricNames.SNAPSHOTS_GENERATED);
        registry.observeLatency(42);
        registry.reset();
        expect(registry.snapshot()).toEqual({
            counters: {},
            latency: { count: 0, p50: null, p95: null },
        });
    });

    it('incremnt by N (не только 1)', () => {
        registry.increment(FinanceMetricNames.NEGATIVE_MARGIN_SKU_COUNT, {}, 5);
        expect(registry.snapshot().counters[FinanceMetricNames.NEGATIVE_MARGIN_SKU_COUNT]).toBe(5);
    });
});
