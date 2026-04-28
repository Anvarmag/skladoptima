/**
 * TASK_FINANCE_7 spec для `FinanceReadService`.
 *
 * Покрывает §16 read scenarios:
 *   - list возвращает items + snapshot meta;
 *   - filters (search/incompleteOnly) работают на payload-уровне;
 *   - detail без snapshot → 404 NO_SNAPSHOT;
 *   - dashboard собирает totals + top profitable + negative margin;
 *   - read остаётся пустым, если snapshot отсутствует (без exception);
 *   - listActiveWarnings возвращает только isActive=true.
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: { Decimal: class { constructor(public n: any) {} toString() { return String(this.n); } } },
    AccessState: {
        EARLY_ACCESS: 'EARLY_ACCESS', TRIAL_ACTIVE: 'TRIAL_ACTIVE',
        TRIAL_EXPIRED: 'TRIAL_EXPIRED', ACTIVE_PAID: 'ACTIVE_PAID',
        GRACE_PERIOD: 'GRACE_PERIOD', SUSPENDED: 'SUSPENDED', CLOSED: 'CLOSED',
    },
    FinanceSnapshotStatus: { READY: 'READY', INCOMPLETE: 'INCOMPLETE', FAILED: 'FAILED' },
    FinanceWarningType: {
        MISSING_COST: 'MISSING_COST', MISSING_FEES: 'MISSING_FEES',
        MISSING_LOGISTICS: 'MISSING_LOGISTICS', MISSING_TAX: 'MISSING_TAX',
        MISSING_ADS_COST: 'MISSING_ADS_COST', MISSING_RETURNS_DATA: 'MISSING_RETURNS_DATA',
        STALE_FINANCIAL_SOURCE: 'STALE_FINANCIAL_SOURCE',
    },
}));

import { NotFoundException } from '@nestjs/common';
import { FinanceReadService } from './finance-read.service';
import { FinanceCalculatorService } from './finance-calculator.service';

const TENANT = 'tenant-1';

function buildSnapshot(items: any[], totals: any = {}, warnings: string[] = []) {
    return {
        id: 'snap-1',
        periodFrom: new Date('2026-04-01'),
        periodTo: new Date('2026-04-30'),
        periodType: 'MONTH',
        formulaVersion: 'mvp-v1',
        snapshotStatus: 'READY',
        sourceFreshness: { orders: { isStale: false }, fees: { isStale: false } },
        generatedAt: new Date('2026-04-30T20:00:00Z'),
        payload: {
            items, totals: {
                revenue: 12000, cogs: 5500, marketplaceFees: 1500, logistics: 600,
                adsCost: 200, returnsImpact: 100, taxImpact: 720, additionalCharges: 200,
                profit: 3180, marginPct: 26.5, roiPct: 57.82,
                skuCount: items.length, incompleteSkuCount: 0, ...totals,
            },
            aggregatedWarnings: warnings,
        },
    };
}

function makePrisma(snapshot: any | null, warnings: any[] = []) {
    return {
        financeSnapshot: { findFirst: jest.fn().mockResolvedValue(snapshot) },
        productFinanceProfile: { findUnique: jest.fn().mockResolvedValue(null) },
        financeDataWarning: { findMany: jest.fn().mockResolvedValue(warnings) },
    } as any;
}

function makeSvc(prisma: any) {
    return new FinanceReadService(prisma, new FinanceCalculatorService());
}

const ITEM_OK = {
    productId: 'prod-1', sku: 'SKU-1', soldQty: 10, revenue: 12000,
    cogs: 5500, marketplaceFees: 1500, logistics: 600, adsCost: 200,
    returnsImpact: 100, taxImpact: 720, additionalCharges: 200,
    profit: 3180, marginPct: 26.5, roiPct: 57.82,
    isIncomplete: false, warnings: [],
};
const ITEM_INCOMPLETE = {
    ...ITEM_OK, productId: 'prod-2', sku: 'SKU-2',
    isIncomplete: true, warnings: ['MISSING_COST'],
};
const ITEM_NEGATIVE = {
    ...ITEM_OK, productId: 'prod-3', sku: 'SKU-3', profit: -500, marginPct: -10,
};

describe('FinanceReadService.listUnitEconomics', () => {
    it('snapshot есть → items + meta', async () => {
        const prisma = makePrisma(buildSnapshot([ITEM_OK]));
        const svc = makeSvc(prisma);
        const r = await svc.listUnitEconomics(TENANT);
        expect(r.items).toHaveLength(1);
        expect(r.snapshot?.formulaVersion).toBe('mvp-v1');
    });

    it('snapshot отсутствует → пустой items + null snapshot, без exception', async () => {
        const prisma = makePrisma(null);
        const svc = makeSvc(prisma);
        const r = await svc.listUnitEconomics(TENANT);
        expect(r.items).toEqual([]);
        expect(r.snapshot).toBeNull();
    });

    it('search фильтрует по sku', async () => {
        const prisma = makePrisma(buildSnapshot([ITEM_OK, ITEM_INCOMPLETE]));
        const svc = makeSvc(prisma);
        const r = await svc.listUnitEconomics(TENANT, { search: 'SKU-2' });
        expect(r.items).toHaveLength(1);
        expect(r.items[0].sku).toBe('SKU-2');
    });

    it('incompleteOnly фильтрует только incomplete строки', async () => {
        const prisma = makePrisma(buildSnapshot([ITEM_OK, ITEM_INCOMPLETE]));
        const svc = makeSvc(prisma);
        const r = await svc.listUnitEconomics(TENANT, { incompleteOnly: true });
        expect(r.items).toHaveLength(1);
        expect(r.items[0].productId).toBe('prod-2');
    });
});

describe('FinanceReadService.getProductDetail', () => {
    it('snapshot есть, sku в payload → item + snapshot meta', async () => {
        const prisma = makePrisma(buildSnapshot([ITEM_OK]));
        const svc = makeSvc(prisma);
        const r = await svc.getProductDetail(TENANT, 'prod-1');
        expect(r.item.sku).toBe('SKU-1');
        expect(r.snapshot.formulaVersion).toBe('mvp-v1');
        expect(r.productProfile).toBeNull();
    });

    it('snapshot отсутствует → 404 NO_SNAPSHOT', async () => {
        const prisma = makePrisma(null);
        const svc = makeSvc(prisma);
        await expect(svc.getProductDetail(TENANT, 'prod-1')).rejects.toThrow(NotFoundException);
    });

    it('sku не в payload → 404 PRODUCT_NOT_FOUND', async () => {
        const prisma = makePrisma(buildSnapshot([ITEM_OK]));
        const svc = makeSvc(prisma);
        await expect(svc.getProductDetail(TENANT, 'prod-unknown')).rejects.toThrow(NotFoundException);
    });

    it('productProfile подгружается отдельно (Decimal → string)', async () => {
        const prisma = makePrisma(buildSnapshot([ITEM_OK]));
        prisma.productFinanceProfile.findUnique.mockResolvedValue({
            baseCost: { toString: () => '500' },
            packagingCost: null,
            additionalCost: null,
            costCurrency: 'RUB',
            isCostManual: true,
            updatedAt: new Date('2026-04-28'),
        });
        const svc = makeSvc(prisma);
        const r = await svc.getProductDetail(TENANT, 'prod-1');
        expect(r.productProfile?.baseCost).toBe('500');
        expect(r.productProfile?.packagingCost).toBeNull();
    });
});

describe('FinanceReadService.getDashboard', () => {
    it('snapshot есть → totals + topProfitable + negativeMarginSkus', async () => {
        const prisma = makePrisma(buildSnapshot([ITEM_OK, ITEM_NEGATIVE]));
        const svc = makeSvc(prisma);
        const r = await svc.getDashboard(TENANT);
        expect(r.totals.revenue).toBe(12000);
        expect(r.topProfitable).toHaveLength(1);
        expect(r.topProfitable[0].sku).toBe('SKU-1');
        expect(r.negativeMarginSkus).toHaveLength(1);
        expect(r.negativeMarginSkus[0].sku).toBe('SKU-3');
    });

    it('snapshot отсутствует → empty totals, без exception', async () => {
        const prisma = makePrisma(null);
        const svc = makeSvc(prisma);
        const r = await svc.getDashboard(TENANT);
        expect(r.snapshot).toBeNull();
        expect(r.totals.skuCount).toBe(0);
        expect(r.topProfitable).toEqual([]);
    });

    it('aggregatedWarnings проброшен из payload', async () => {
        const prisma = makePrisma(buildSnapshot([ITEM_INCOMPLETE], {}, ['MISSING_COST', 'STALE_FINANCIAL_SOURCE']));
        const svc = makeSvc(prisma);
        const r = await svc.getDashboard(TENANT);
        expect(r.aggregatedWarnings).toEqual(['MISSING_COST', 'STALE_FINANCIAL_SOURCE']);
    });
});

describe('FinanceReadService.listActiveWarnings', () => {
    it('возвращает все active warnings, преобразует createdAt в ISO', async () => {
        const prisma = makePrisma(null, [
            { id: 'w1', productId: 'prod-1', snapshotId: 'snap-1', warningType: 'MISSING_COST',
                details: {}, createdAt: new Date('2026-04-28T10:00:00Z') },
            { id: 'w2', productId: null, snapshotId: 'snap-1', warningType: 'STALE_FINANCIAL_SOURCE',
                details: {}, createdAt: new Date('2026-04-28T10:01:00Z') },
        ]);
        const svc = makeSvc(prisma);
        const r = await svc.listActiveWarnings(TENANT);
        expect(r).toHaveLength(2);
        expect(r[0].createdAt).toBe('2026-04-28T10:00:00.000Z');
    });
});
