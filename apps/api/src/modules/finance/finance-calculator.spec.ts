/**
 * TASK_FINANCE_2 regression spec для `FinanceCalculatorService`.
 *
 * Покрывает §16 тестовую матрицу (часть про формулы и completeness):
 *   - полный расчёт при наличии всех данных;
 *   - расчёт без себестоимости (MISSING_COST → incomplete);
 *   - расчёт без marketplace fees (MISSING_FEES → incomplete);
 *   - расчёт без logistics (MISSING_LOGISTICS → incomplete);
 *   - missing ads/tax/returns → warning, но НЕ incomplete (§14 правило);
 *   - детерминированность (одинаковые входы → одинаковый результат);
 *   - formula version присутствует в output;
 *   - division by zero (revenue=0 → marginPct=null, cogs=0 → roiPct=null);
 *   - агрегация totals + snapshotStatus.
 */

jest.mock('@prisma/client', () => ({
    FinanceSnapshotStatus: {
        READY: 'READY',
        INCOMPLETE: 'INCOMPLETE',
        FAILED: 'FAILED',
    },
    FinanceWarningType: {
        MISSING_COST: 'MISSING_COST',
        MISSING_FEES: 'MISSING_FEES',
        MISSING_LOGISTICS: 'MISSING_LOGISTICS',
        MISSING_TAX: 'MISSING_TAX',
        MISSING_ADS_COST: 'MISSING_ADS_COST',
        MISSING_RETURNS_DATA: 'MISSING_RETURNS_DATA',
        STALE_FINANCIAL_SOURCE: 'STALE_FINANCIAL_SOURCE',
    },
    Prisma: {
        Decimal: class {
            constructor(public n: any) {}
            toString() { return String(this.n); }
        },
    },
}));

import {
    FinanceCalculatorService,
    FINANCE_FORMULA_VERSION,
    SkuFinanceInput,
} from './finance-calculator.service';

const svc = new FinanceCalculatorService();

function fullInput(over: Partial<SkuFinanceInput> = {}): SkuFinanceInput {
    return {
        productId: 'prod-1',
        sku: 'SKU-1',
        soldQty: 10,
        revenue: 12000,
        baseCost: 500,
        packagingCost: 50,
        additionalCost: 20,
        marketplaceFees: 1500,
        logistics: 600,
        adsCost: 200,
        returnsImpact: 100,
        taxImpact: 720,
        ...over,
    };
}

describe('FinanceCalculatorService.calculateSku — formula', () => {
    it('полный расчёт при наличии всех данных', () => {
        const r = svc.calculateSku(fullInput());

        // COGS = 10 * (500 + 50) = 5500
        expect(r.cogs).toBe(5500);
        // additionalCharges = 10 * 20 = 200
        expect(r.additionalCharges).toBe(200);
        // Profit = 12000 - 5500 - 1500 - 600 - 100 - 720 - 200 - 200 = 3180
        expect(r.profit).toBe(3180);
        // Margin = 3180/12000*100 = 26.5
        expect(r.marginPct).toBe(26.5);
        // ROI = 3180/5500*100 = 57.82 (округляется до 2 знаков)
        expect(r.roiPct).toBeCloseTo(57.82, 2);

        expect(r.isIncomplete).toBe(false);
        expect(r.warnings).toEqual([]);
    });

    it('детерминированность: одинаковые входы → одинаковый результат', () => {
        const r1 = svc.calculateSku(fullInput());
        const r2 = svc.calculateSku(fullInput());
        expect(r1).toEqual(r2);
    });
});

describe('FinanceCalculatorService.calculateSku — incomplete cases (§14 critical)', () => {
    it('missing baseCost → MISSING_COST + incomplete', () => {
        const r = svc.calculateSku(fullInput({ baseCost: null }));
        expect(r.warnings).toContain('MISSING_COST');
        expect(r.isIncomplete).toBe(true);
        // baseCost=0 → COGS=10*(0+50)=500
        expect(r.cogs).toBe(500);
    });

    it('missing marketplaceFees → MISSING_FEES + incomplete', () => {
        const r = svc.calculateSku(fullInput({ marketplaceFees: null }));
        expect(r.warnings).toContain('MISSING_FEES');
        expect(r.isIncomplete).toBe(true);
        expect(r.marketplaceFees).toBe(0);
    });

    it('missing logistics → MISSING_LOGISTICS + incomplete', () => {
        const r = svc.calculateSku(fullInput({ logistics: null }));
        expect(r.warnings).toContain('MISSING_LOGISTICS');
        expect(r.isIncomplete).toBe(true);
    });

    it('все три критичных missing → 3 warning + incomplete, но строка не исчезает', () => {
        const r = svc.calculateSku(fullInput({
            baseCost: null,
            marketplaceFees: null,
            logistics: null,
        }));
        expect(r.warnings).toEqual(
            expect.arrayContaining(['MISSING_COST', 'MISSING_FEES', 'MISSING_LOGISTICS']),
        );
        expect(r.isIncomplete).toBe(true);
        // Строка живёт: ads/returns/tax всё ещё применяются.
        // baseCost=null трактуется как 0, но packagingCost=50 остаётся:
        // COGS=10*(0+50)=500, additionalCharges=10*20=200.
        expect(r.profit).toBe(round2(12000 - 500 - 0 - 0 - 100 - 720 - 200 - 200));
    });
});

describe('FinanceCalculatorService.calculateSku — optional inputs (§14: warning без incomplete)', () => {
    it('missing adsCost → MISSING_ADS_COST warning, isIncomplete=false', () => {
        const r = svc.calculateSku(fullInput({ adsCost: null }));
        expect(r.warnings).toContain('MISSING_ADS_COST');
        expect(r.isIncomplete).toBe(false);
        expect(r.adsCost).toBe(0);
    });

    it('missing taxImpact → MISSING_TAX warning, isIncomplete=false', () => {
        const r = svc.calculateSku(fullInput({ taxImpact: null }));
        expect(r.warnings).toContain('MISSING_TAX');
        expect(r.isIncomplete).toBe(false);
    });

    it('missing returnsImpact → MISSING_RETURNS_DATA warning, isIncomplete=false', () => {
        const r = svc.calculateSku(fullInput({ returnsImpact: null }));
        expect(r.warnings).toContain('MISSING_RETURNS_DATA');
        expect(r.isIncomplete).toBe(false);
    });

    it('все three optional missing — 3 warnings, всё ещё isIncomplete=false', () => {
        const r = svc.calculateSku(fullInput({
            adsCost: null,
            taxImpact: null,
            returnsImpact: null,
        }));
        expect(r.warnings).toEqual(
            expect.arrayContaining(['MISSING_ADS_COST', 'MISSING_TAX', 'MISSING_RETURNS_DATA']),
        );
        expect(r.isIncomplete).toBe(false);
    });
});

describe('FinanceCalculatorService.calculateSku — division-by-zero guards', () => {
    it('revenue=0 → marginPct=null, не Infinity/NaN', () => {
        const r = svc.calculateSku(fullInput({ revenue: 0, soldQty: 0 }));
        expect(r.marginPct).toBeNull();
    });

    it('cogs=0 (нет soldQty) → roiPct=null', () => {
        const r = svc.calculateSku(fullInput({ soldQty: 0, baseCost: 500, packagingCost: 50 }));
        expect(r.cogs).toBe(0);
        expect(r.roiPct).toBeNull();
    });
});

describe('FinanceCalculatorService.calculatePeriod — aggregation', () => {
    it('пустой набор → snapshotStatus=FAILED', () => {
        const out = svc.calculatePeriod([]);
        expect(out.snapshotStatus).toBe('FAILED');
        expect(out.items).toEqual([]);
        expect(out.totals.skuCount).toBe(0);
    });

    it('все строки полные → snapshotStatus=READY, totals корректны', () => {
        const out = svc.calculatePeriod([
            fullInput(),
            fullInput({ productId: 'prod-2', sku: 'SKU-2', soldQty: 5, revenue: 6000 }),
        ]);
        expect(out.snapshotStatus).toBe('READY');
        expect(out.totals.skuCount).toBe(2);
        expect(out.totals.incompleteSkuCount).toBe(0);
        expect(out.totals.revenue).toBe(18000);
        // Profit row1 = 3180, row2 пересчитаем: cogs=5*(550)=2750, profit=6000-2750-1500-600-100-720-200-100=30
        // Точно проверим именно агрегацию
        expect(out.totals.profit).toBe(out.items[0].profit + out.items[1].profit);
        expect(out.totals.marginPct).toBe(round2(out.totals.profit / out.totals.revenue * 100));
        expect(out.aggregatedWarnings).toEqual([]);
    });

    it('хоть одна строка incomplete → snapshotStatus=INCOMPLETE', () => {
        const out = svc.calculatePeriod([
            fullInput(),
            fullInput({ productId: 'prod-2', sku: 'SKU-2', baseCost: null }),
        ]);
        expect(out.snapshotStatus).toBe('INCOMPLETE');
        expect(out.totals.incompleteSkuCount).toBe(1);
        expect(out.aggregatedWarnings).toContain('MISSING_COST');
    });
});

describe('FinanceCalculatorService — formula versioning (§12 DoD reproducibility)', () => {
    it('formulaVersion присутствует и стабилен', () => {
        expect(svc.formulaVersion).toBe(FINANCE_FORMULA_VERSION);
        expect(svc.formulaVersion).toBe('mvp-v1');
    });

    it('output содержит formulaVersion для записи в snapshot', () => {
        const out = svc.calculatePeriod([fullInput()]);
        expect(out.formulaVersion).toBe('mvp-v1');
    });
});

describe('FinanceCalculatorService.decimalToNumber', () => {
    it('null/undefined → null', () => {
        expect(FinanceCalculatorService.decimalToNumber(null)).toBeNull();
        expect(FinanceCalculatorService.decimalToNumber(undefined)).toBeNull();
    });
    it('number → number', () => {
        expect(FinanceCalculatorService.decimalToNumber(42.5)).toBe(42.5);
    });
    it('Decimal-like → number через toString', () => {
        const d = { toString: () => '99.99' } as any;
        expect(FinanceCalculatorService.decimalToNumber(d)).toBe(99.99);
    });
});

function round2(n: number): number {
    return parseFloat(n.toFixed(2));
}
