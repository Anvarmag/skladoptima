/**
 * TASK_FINANCE_3 spec для `FinanceSnapshotService`.
 *
 * Покрывает §16 (часть про snapshot/rebuild):
 *   - rebuild при наличии всех данных → READY snapshot;
 *   - rebuild без cost profile → INCOMPLETE + MISSING_COST warning;
 *   - идемпотентность: повторный rebuild того же периода → upsert
 *     (wasReplaced=true), не дубль;
 *   - paused tenant блокирует rebuild → ForbiddenException
 *     FINANCE_REBUILD_BLOCKED_BY_TENANT_STATE;
 *   - invalid period (from > to) → BadRequestException;
 *   - custom period > 366 дней → BadRequestException;
 *   - stale source → STALE_FINANCIAL_SOURCE warning + sourceFreshness
 *     diagnostic;
 *   - rebuild не дёргает sync (никаких inventory/sync-вызовов в spec).
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: {
        Decimal: class {
            constructor(public n: any) {}
            toString() { return String(this.n); }
        },
    },
    AccessState: {
        EARLY_ACCESS: 'EARLY_ACCESS',
        TRIAL_ACTIVE: 'TRIAL_ACTIVE',
        TRIAL_EXPIRED: 'TRIAL_EXPIRED',
        ACTIVE_PAID: 'ACTIVE_PAID',
        GRACE_PERIOD: 'GRACE_PERIOD',
        SUSPENDED: 'SUSPENDED',
        CLOSED: 'CLOSED',
    },
    FinanceSnapshotPeriodType: { WEEK: 'WEEK', MONTH: 'MONTH', CUSTOM: 'CUSTOM' },
    FinanceSnapshotStatus: { READY: 'READY', INCOMPLETE: 'INCOMPLETE', FAILED: 'FAILED' },
    FinanceWarningType: {
        MISSING_COST: 'MISSING_COST',
        MISSING_FEES: 'MISSING_FEES',
        MISSING_LOGISTICS: 'MISSING_LOGISTICS',
        MISSING_TAX: 'MISSING_TAX',
        MISSING_ADS_COST: 'MISSING_ADS_COST',
        MISSING_RETURNS_DATA: 'MISSING_RETURNS_DATA',
        STALE_FINANCIAL_SOURCE: 'STALE_FINANCIAL_SOURCE',
    },
}));

import { FinanceSnapshotService } from './finance-snapshot.service';
import { FinanceCalculatorService } from './finance-calculator.service';
import { FinancePolicyService } from './finance-policy.service';
import { FinanceMetricsRegistry } from './finance.metrics';
import { ForbiddenException, BadRequestException } from '@nestjs/common';

const TENANT = 'tenant-1';

function makePrisma(opts: {
    accessState?: string;
    orders?: any[];
    profiles?: any[];
    reports?: any[];
    lastOrderAt?: Date | null;
    lastReportAt?: Date | null;
    lastProfileAt?: Date | null;
    existingSnapshot?: { id: string } | null;
}) {
    const prisma: any = {
        tenant: {
            findUnique: jest.fn().mockResolvedValue(
                opts.accessState
                    ? { accessState: opts.accessState }
                    : { accessState: 'TRIAL_ACTIVE' },
            ),
        },
        order: {
            findMany: jest.fn().mockResolvedValue(opts.orders ?? []),
            findFirst: jest.fn().mockResolvedValue(
                opts.lastOrderAt !== undefined
                    ? opts.lastOrderAt ? { processedAt: opts.lastOrderAt } : null
                    : { processedAt: new Date() },
            ),
        },
        productFinanceProfile: {
            findMany: jest.fn().mockResolvedValue(opts.profiles ?? []),
            findFirst: jest.fn().mockResolvedValue(
                opts.lastProfileAt !== undefined
                    ? opts.lastProfileAt ? { updatedAt: opts.lastProfileAt } : null
                    : { updatedAt: new Date() },
            ),
        },
        marketplaceReport: {
            findMany: jest.fn().mockResolvedValue(opts.reports ?? []),
            findFirst: jest.fn().mockResolvedValue(
                opts.lastReportAt !== undefined
                    ? opts.lastReportAt ? { createdAt: opts.lastReportAt } : null
                    : { createdAt: new Date() },
            ),
        },
        financeSnapshot: {
            findUnique: jest.fn().mockResolvedValue(opts.existingSnapshot ?? null),
            findFirst: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({ id: 'snap-new-1' }),
        },
        financeDataWarning: {
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            createMany: jest.fn().mockResolvedValue({ count: 0 }),
            count: jest.fn().mockResolvedValue(0),
        },
        $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    return prisma;
}

function makeSvc(prisma: any) {
    return new FinanceSnapshotService(
        prisma,
        new FinanceCalculatorService(),
        new FinancePolicyService(prisma),
        new FinanceMetricsRegistry(),
    );
}

const PERIOD_FROM = new Date('2026-04-01');
const PERIOD_TO = new Date('2026-04-30');

function buildOrder(overrides: { items?: any[] } = {}) {
    return {
        items: overrides.items ?? [
            { productId: 'prod-1', sku: 'SKU-1', quantity: 10, price: { toString: () => '1200' } },
        ],
    };
}

describe('FinanceSnapshotService.rebuild — happy path', () => {
    it('full data → READY snapshot, upsert called once', async () => {
        const prisma = makePrisma({
            orders: [buildOrder()],
            profiles: [{ productId: 'prod-1', baseCost: { toString: () => '500' }, packagingCost: { toString: () => '50' }, additionalCost: { toString: () => '20' } }],
            reports: [{ commissionAmount: 1500, logisticsAmount: 600, returnsAmount: 100 }],
        });
        const svc = makeSvc(prisma);

        const r = await svc.rebuild({
            tenantId: TENANT,
            periodFrom: PERIOD_FROM,
            periodTo: PERIOD_TO,
            periodType: 'MONTH' as any,
        });

        expect(r.snapshotStatus).toBe('READY');
        expect(r.formulaVersion).toBe('mvp-v1');
        expect(r.skuCount).toBe(1);
        expect(r.incompleteSkuCount).toBe(0);
        expect(r.wasReplaced).toBe(false);
        expect(prisma.financeSnapshot.upsert).toHaveBeenCalledTimes(1);
    });

    it('idempotency: existing snapshot → upsert + wasReplaced=true', async () => {
        const prisma = makePrisma({
            orders: [buildOrder()],
            profiles: [{ productId: 'prod-1', baseCost: { toString: () => '500' }, packagingCost: null, additionalCost: null }],
            reports: [{ commissionAmount: 100, logisticsAmount: 50, returnsAmount: 0 }],
            existingSnapshot: { id: 'snap-existing' },
        });
        const svc = makeSvc(prisma);

        const r = await svc.rebuild({
            tenantId: TENANT,
            periodFrom: PERIOD_FROM,
            periodTo: PERIOD_TO,
            periodType: 'MONTH' as any,
        });

        expect(r.wasReplaced).toBe(true);
    });
});

describe('FinanceSnapshotService.rebuild — incomplete cases', () => {
    it('no cost profile → INCOMPLETE + MISSING_COST warning, snapshot всё же сохранён', async () => {
        const prisma = makePrisma({
            orders: [buildOrder()],
            profiles: [], // нет профиля → baseCost=null
            reports: [{ commissionAmount: 100, logisticsAmount: 50, returnsAmount: 0 }],
        });
        const svc = makeSvc(prisma);

        const r = await svc.rebuild({
            tenantId: TENANT,
            periodFrom: PERIOD_FROM,
            periodTo: PERIOD_TO,
            periodType: 'MONTH' as any,
        });

        expect(r.snapshotStatus).toBe('INCOMPLETE');
        expect(r.incompleteSkuCount).toBe(1);
        expect(r.aggregatedWarnings).toContain('MISSING_COST');
        // Warnings были записаны в БД
        expect(prisma.financeDataWarning.createMany).toHaveBeenCalled();
    });

    it('no marketplace reports → MISSING_FEES + MISSING_LOGISTICS', async () => {
        const prisma = makePrisma({
            orders: [buildOrder()],
            profiles: [{ productId: 'prod-1', baseCost: { toString: () => '500' }, packagingCost: null, additionalCost: null }],
            reports: [],
        });
        const svc = makeSvc(prisma);

        const r = await svc.rebuild({
            tenantId: TENANT,
            periodFrom: PERIOD_FROM,
            periodTo: PERIOD_TO,
            periodType: 'MONTH' as any,
        });

        expect(r.snapshotStatus).toBe('INCOMPLETE');
        expect(r.aggregatedWarnings).toEqual(
            expect.arrayContaining(['MISSING_FEES', 'MISSING_LOGISTICS']),
        );
    });

    it('пустой набор orders → snapshotStatus=FAILED', async () => {
        const prisma = makePrisma({ orders: [], profiles: [], reports: [] });
        const svc = makeSvc(prisma);

        const r = await svc.rebuild({
            tenantId: TENANT,
            periodFrom: PERIOD_FROM,
            periodTo: PERIOD_TO,
            periodType: 'MONTH' as any,
        });

        expect(r.snapshotStatus).toBe('FAILED');
        expect(r.skuCount).toBe(0);
    });
});

describe('FinanceSnapshotService.rebuild — stale source detection (§14)', () => {
    it('последний report 5 дней назад (>48ч) → STALE_FINANCIAL_SOURCE warning', async () => {
        const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 3600 * 1000);
        const prisma = makePrisma({
            orders: [buildOrder()],
            profiles: [{ productId: 'prod-1', baseCost: { toString: () => '500' }, packagingCost: null, additionalCost: null }],
            reports: [{ commissionAmount: 100, logisticsAmount: 50, returnsAmount: 0 }],
            lastReportAt: fiveDaysAgo,
        });
        const svc = makeSvc(prisma);

        const r = await svc.rebuild({
            tenantId: TENANT,
            periodFrom: PERIOD_FROM,
            periodTo: PERIOD_TO,
            periodType: 'MONTH' as any,
        });

        expect(r.aggregatedWarnings).toContain('STALE_FINANCIAL_SOURCE');
        expect(r.sourceFreshness.fees.isStale).toBe(true);
    });
});

describe('FinanceSnapshotService.rebuild — tenant state guards (§10)', () => {
    it('TRIAL_EXPIRED → ForbiddenException FINANCE_REBUILD_BLOCKED_BY_TENANT_STATE', async () => {
        const prisma = makePrisma({ accessState: 'TRIAL_EXPIRED' });
        const svc = makeSvc(prisma);

        await expect(svc.rebuild({
            tenantId: TENANT,
            periodFrom: PERIOD_FROM,
            periodTo: PERIOD_TO,
            periodType: 'MONTH' as any,
        })).rejects.toThrow(ForbiddenException);

        // upsert НЕ вызывался
        expect(prisma.financeSnapshot.upsert).not.toHaveBeenCalled();
    });

    it('SUSPENDED тоже блокирует', async () => {
        const prisma = makePrisma({ accessState: 'SUSPENDED' });
        const svc = makeSvc(prisma);

        await expect(svc.rebuild({
            tenantId: TENANT,
            periodFrom: PERIOD_FROM,
            periodTo: PERIOD_TO,
            periodType: 'MONTH' as any,
        })).rejects.toThrow(ForbiddenException);
    });

    it('CLOSED тоже блокирует', async () => {
        const prisma = makePrisma({ accessState: 'CLOSED' });
        const svc = makeSvc(prisma);

        await expect(svc.rebuild({
            tenantId: TENANT,
            periodFrom: PERIOD_FROM,
            periodTo: PERIOD_TO,
            periodType: 'MONTH' as any,
        })).rejects.toThrow(ForbiddenException);
    });

    it('tenant не существует → ForbiddenException', async () => {
        const prisma = makePrisma({});
        prisma.tenant.findUnique.mockResolvedValue(null);
        const svc = makeSvc(prisma);

        await expect(svc.rebuild({
            tenantId: TENANT,
            periodFrom: PERIOD_FROM,
            periodTo: PERIOD_TO,
            periodType: 'MONTH' as any,
        })).rejects.toThrow(ForbiddenException);
    });
});

describe('FinanceSnapshotService.rebuild — period validation', () => {
    it('periodFrom > periodTo → BadRequestException INVALID_PERIOD', async () => {
        const prisma = makePrisma({});
        const svc = makeSvc(prisma);

        await expect(svc.rebuild({
            tenantId: TENANT,
            periodFrom: PERIOD_TO,
            periodTo: PERIOD_FROM,  // reversed
            periodType: 'CUSTOM' as any,
        })).rejects.toThrow(BadRequestException);

        // Tenant вообще не запрашивался — валидация раньше.
        expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    });

    it('CUSTOM > 366 дней → BadRequestException', async () => {
        const prisma = makePrisma({});
        const svc = makeSvc(prisma);

        await expect(svc.rebuild({
            tenantId: TENANT,
            periodFrom: new Date('2024-01-01'),
            periodTo: new Date('2026-01-01'),
            periodType: 'CUSTOM' as any,
        })).rejects.toThrow(BadRequestException);
    });
});

describe('FinanceSnapshotService.getStatus', () => {
    it('возвращает последний snapshot + active warnings count + currentFormulaVersion', async () => {
        const prisma = makePrisma({});
        prisma.financeSnapshot.findFirst.mockResolvedValue({
            id: 'snap-1',
            periodFrom: new Date('2026-04-01'),
            periodTo: new Date('2026-04-30'),
            periodType: 'MONTH',
            formulaVersion: 'mvp-v1',
            snapshotStatus: 'READY',
            sourceFreshness: { orders: { lastEventAt: null, isStale: false } },
            generatedAt: new Date('2026-04-30T20:00:00Z'),
            generatedBy: 'usr-1',
        });
        prisma.financeDataWarning.count.mockResolvedValue(3);
        const svc = makeSvc(prisma);

        const r = await svc.getStatus(TENANT);

        expect(r.latestSnapshot?.id).toBe('snap-1');
        expect(r.latestSnapshot?.periodFrom).toBe('2026-04-01');
        expect(r.activeWarnings).toBe(3);
        expect(r.currentFormulaVersion).toBe('mvp-v1');
    });

    it('нет snapshot → latestSnapshot=null, без падения', async () => {
        const prisma = makePrisma({});
        prisma.financeSnapshot.findFirst.mockResolvedValue(null);
        const svc = makeSvc(prisma);

        const r = await svc.getStatus(TENANT);

        expect(r.latestSnapshot).toBeNull();
    });
});
