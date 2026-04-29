import { TasksMetricNames, TasksMetricsRegistry } from './tasks.metrics';

describe('TasksMetricsRegistry', () => {
    let registry: TasksMetricsRegistry;

    beforeEach(() => {
        registry = new TasksMetricsRegistry();
    });

    it('increment накапливает counter и снапшот возвращает значения', () => {
        registry.increment(TasksMetricNames.CREATED, { tenantId: 't1', category: 'OTHER' });
        registry.increment(TasksMetricNames.CREATED);
        registry.increment(TasksMetricNames.COMPLETED);

        const snap = registry.snapshot();
        expect(snap.counters[TasksMetricNames.CREATED]).toBe(2);
        expect(snap.counters[TasksMetricNames.COMPLETED]).toBe(1);
    });

    it('increment с шагом by — накапливает кратно', () => {
        registry.increment(TasksMetricNames.NOTIFICATIONS_SENT, {}, 5);
        registry.increment(TasksMetricNames.NOTIFICATIONS_SENT, {}, 3);
        expect(registry.snapshot().counters[TasksMetricNames.NOTIFICATIONS_SENT]).toBe(8);
    });

    it('setGauge перезаписывает значение, не накапливает', () => {
        registry.setGauge(TasksMetricNames.OVERDUE_ACTIVE, 10);
        registry.setGauge(TasksMetricNames.OVERDUE_ACTIVE, 7);
        expect(registry.snapshot().gauges[TasksMetricNames.OVERDUE_ACTIVE]).toBe(7);
    });

    it('observeCompletion считает p50/p95 по скользящему окну', () => {
        for (let i = 1; i <= 100; i++) registry.observeCompletion(i);
        const snap = registry.snapshot();
        expect(snap.completion.count).toBe(100);
        expect(snap.completion.p50).toBeGreaterThanOrEqual(50);
        expect(snap.completion.p50).toBeLessThanOrEqual(51);
        expect(snap.completion.p95).toBeGreaterThanOrEqual(95);
    });

    it('completion-окно ограничено 200 — старые значения вытесняются', () => {
        for (let i = 0; i < 250; i++) registry.observeCompletion(i);
        const snap = registry.snapshot();
        expect(snap.completion.count).toBe(200);
    });

    it('reset() обнуляет всё состояние', () => {
        registry.increment(TasksMetricNames.CREATED);
        registry.setGauge(TasksMetricNames.OVERDUE_ACTIVE, 5);
        registry.observeCompletion(42);

        registry.reset();

        expect(registry.snapshot()).toEqual({
            counters: {},
            gauges: {},
            completion: { count: 0, p50: null, p95: null },
        });
    });
});
