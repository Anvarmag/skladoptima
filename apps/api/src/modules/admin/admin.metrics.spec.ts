/**
 * TASK_ADMIN_7 spec для `AdminMetricsRegistry`.
 *
 * Покрывает §19 observability контракт:
 *   - increment накапливает counter, snapshot возвращает значения;
 *   - setBreadthGauge per support-user (override, не накапливается);
 *   - observeTenantCardLatency / observeActionDuration считают p50/p95;
 *   - окно ограничено 200 (sliding window);
 *   - reset() обнуляет всё состояние;
 *   - перечень метрик покрывает контракт §19.
 */

import { AdminMetricNames, AdminMetricsRegistry } from './admin.metrics';

describe('AdminMetricsRegistry', () => {
    let registry: AdminMetricsRegistry;

    beforeEach(() => {
        registry = new AdminMetricsRegistry();
    });

    it('increment накапливает counter и снапшот возвращает значения', () => {
        registry.increment(AdminMetricNames.ADMIN_SEARCHES, { supportUserId: 'su1' });
        registry.increment(AdminMetricNames.ADMIN_SEARCHES);
        registry.increment(AdminMetricNames.SUPPORT_ACTIONS_STARTED, {
            actionType: 'EXTEND_TRIAL',
        });

        const snap = registry.snapshot();
        expect(snap.counters[AdminMetricNames.ADMIN_SEARCHES]).toBe(2);
        expect(snap.counters[AdminMetricNames.SUPPORT_ACTIONS_STARTED]).toBe(1);
    });

    it('increment by N — кратно увеличивает counter', () => {
        registry.increment(AdminMetricNames.NOTES_CREATED, {}, 5);
        registry.increment(AdminMetricNames.NOTES_CREATED, {}, 3);
        expect(registry.snapshot().counters[AdminMetricNames.NOTES_CREATED]).toBe(8);
    });

    it('setBreadthGauge — per-support-user значение, override не накапливается', () => {
        registry.setBreadthGauge('su-1', 5);
        registry.setBreadthGauge('su-1', 12);
        registry.setBreadthGauge('su-2', 3);

        const snap = registry.snapshot();
        const k1 = `${AdminMetricNames.TENANT_ACCESS_BREADTH}|su-1`;
        const k2 = `${AdminMetricNames.TENANT_ACCESS_BREADTH}|su-2`;
        expect(snap.gauges[k1]).toBe(12);
        expect(snap.gauges[k2]).toBe(3);
    });

    it('observeTenantCardLatency считает p50/p95 по скользящему окну', () => {
        for (let i = 1; i <= 100; i++) registry.observeTenantCardLatency(i);
        const snap = registry.snapshot();
        expect(snap.tenantCard.count).toBe(100);
        expect(snap.tenantCard.p50).toBeGreaterThanOrEqual(50);
        expect(snap.tenantCard.p95).toBeGreaterThanOrEqual(95);
    });

    it('observeActionDuration считает p50/p95 по скользящему окну', () => {
        for (let i = 1; i <= 100; i++) registry.observeActionDuration(i);
        const snap = registry.snapshot();
        expect(snap.action.count).toBe(100);
        expect(snap.action.p50).toBeGreaterThanOrEqual(50);
        expect(snap.action.p95).toBeGreaterThanOrEqual(95);
    });

    it('latency-окно ограничено 200 (sliding window)', () => {
        for (let i = 0; i < 250; i++) {
            registry.observeTenantCardLatency(i);
            registry.observeActionDuration(i);
        }
        const snap = registry.snapshot();
        expect(snap.tenantCard.count).toBe(200);
        expect(snap.action.count).toBe(200);
    });

    it('reset() обнуляет всё состояние', () => {
        registry.increment(AdminMetricNames.ADMIN_SEARCHES);
        registry.setBreadthGauge('su-1', 7);
        registry.observeTenantCardLatency(42);
        registry.observeActionDuration(123);

        registry.reset();
        const snap = registry.snapshot();
        expect(snap.counters).toEqual({});
        expect(snap.gauges).toEqual({});
        expect(snap.tenantCard.count).toBe(0);
        expect(snap.action.count).toBe(0);
    });

    it('перечень AdminMetricNames покрывает §19 контракт', () => {
        // Регрессия: если кто-то удалит метрику из контракта — тест падает.
        const required = [
            'ADMIN_SEARCHES',
            'TENANT_CARDS_OPENED',
            'TENANT_CARD_LATENCY_MS',
            'SUPPORT_ACTIONS_STARTED',
            'SUPPORT_ACTIONS_SUCCEEDED',
            'SUPPORT_ACTIONS_FAILED',
            'REASON_MISSING_ATTEMPTS',
            'NOTES_CREATED',
            'DENIED_ATTEMPTS',
            'BILLING_OVERRIDE_BLOCKED',
            'RESTORE_BLOCKED_BY_RETENTION',
            'SUPPORT_ACTION_DURATION_MS',
            'TENANT_ACCESS_BREADTH',
        ];
        for (const k of required) {
            expect((AdminMetricNames as any)[k]).toBeDefined();
        }
    });
});
