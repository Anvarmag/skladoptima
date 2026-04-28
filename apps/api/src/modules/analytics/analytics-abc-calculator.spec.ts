/**
 * TASK_ANALYTICS_3 spec для `AnalyticsAbcCalculatorService` (pure function).
 *
 * Покрывает §14 + §16:
 *   - сортировка по revenue desc;
 *   - deterministic tie-breaker: при равной выручке — `sku asc`;
 *   - правило A=80% / B=15% / C=5% накопительной доли;
 *   - SKU с metricValue<=0 не классифицируется;
 *   - пустой вход → пустой результат, без exception;
 *   - результаты повторяемы (одинаковый вход → одинаковый rank/group).
 */

import { AnalyticsAbcCalculatorService } from './analytics-abc-calculator.service';

const calc = new AnalyticsAbcCalculatorService();

describe('AnalyticsAbcCalculatorService.calculate', () => {
    it('пустой вход → пустой результат', () => {
        const r = calc.calculate([]);
        expect(r.rows).toEqual([]);
        expect(r.totals.skuCount).toBe(0);
        expect(r.totals.totalMetric).toBe(0);
    });

    it('игнорирует SKU с metricValue<=0 (нулевая выручка не классифицируется)', () => {
        const r = calc.calculate([
            { productId: 'p1', sku: 'A', metricValue: 100 },
            { productId: 'p2', sku: 'B', metricValue: 0 },
            { productId: 'p3', sku: 'C', metricValue: -50 },
        ]);
        expect(r.totals.skuCount).toBe(1);
        expect(r.rows[0].sku).toBe('A');
    });

    it('сортирует по revenue desc и присваивает группы по 80/15/5', () => {
        // total = 1000; A первый (80%); B второй (15%); C третий (5%)
        const r = calc.calculate([
            { productId: 'p2', sku: 'B', metricValue: 150 },
            { productId: 'p1', sku: 'A', metricValue: 800 },
            { productId: 'p3', sku: 'C', metricValue: 50 },
        ]);
        expect(r.rows.map((x) => x.sku)).toEqual(['A', 'B', 'C']);
        expect(r.rows.map((x) => x.group)).toEqual(['A', 'B', 'C']);
        expect(r.rows[0].sharePct).toBe(80);
        expect(r.rows[0].cumulativeShare).toBe(80);
        expect(r.rows[1].cumulativeShare).toBe(95);
    });

    it('deterministic tie-breaker: при равной выручке — sku asc', () => {
        // Все равные → должно быть стабильно отсортировано по sku.
        const r = calc.calculate([
            { productId: 'p3', sku: 'Z', metricValue: 100 },
            { productId: 'p1', sku: 'A', metricValue: 100 },
            { productId: 'p2', sku: 'M', metricValue: 100 },
        ]);
        expect(r.rows.map((x) => x.sku)).toEqual(['A', 'M', 'Z']);
        expect(r.rows.map((x) => x.rank)).toEqual([1, 2, 3]);
    });

    it('повторяемость: одинаковый вход → одинаковый порядок и группы', () => {
        const input = [
            { productId: 'p1', sku: 'A', metricValue: 500 },
            { productId: 'p2', sku: 'B', metricValue: 300 },
            { productId: 'p3', sku: 'C', metricValue: 100 },
            { productId: 'p4', sku: 'D', metricValue: 50 },
            { productId: 'p5', sku: 'E', metricValue: 50 },
        ];
        const r1 = calc.calculate(input);
        const r2 = calc.calculate([...input].reverse()); // другой порядок входа
        expect(r1.rows).toEqual(r2.rows);
    });

    it('граница 80% включается в A (не съезжает в B из-за float)', () => {
        // 80% ровно — должна быть A.
        const r = calc.calculate([
            { productId: 'p1', sku: 'A', metricValue: 80 },
            { productId: 'p2', sku: 'B', metricValue: 15 },
            { productId: 'p3', sku: 'C', metricValue: 5 },
        ]);
        expect(r.rows[0].group).toBe('A');
        expect(r.rows[1].group).toBe('B');
        expect(r.rows[2].group).toBe('C');
    });

    it('totals.groupCounts корректны', () => {
        const r = calc.calculate([
            { productId: 'p1', sku: 'A', metricValue: 800 },
            { productId: 'p2', sku: 'B', metricValue: 80 },
            { productId: 'p3', sku: 'C', metricValue: 70 },
            { productId: 'p4', sku: 'D', metricValue: 50 },
        ]);
        expect(r.totals.groupCounts.A).toBe(1);
        expect(r.totals.groupCounts.A + r.totals.groupCounts.B + r.totals.groupCounts.C).toBe(4);
    });

    it('один SKU с любой выручкой → A', () => {
        const r = calc.calculate([{ productId: 'p1', sku: 'X', metricValue: 999 }]);
        expect(r.rows[0].group).toBe('A');
        expect(r.rows[0].cumulativeShare).toBe(100);
    });
});
