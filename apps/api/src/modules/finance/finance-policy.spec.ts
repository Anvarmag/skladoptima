/**
 * TASK_FINANCE_5 spec для `FinancePolicyService`.
 *
 * Покрывает:
 *   - tenant guard на rebuild (TRIAL_EXPIRED/SUSPENDED/CLOSED → 403);
 *   - read доступен для всех существующих tenant'ов (включая paused);
 *   - manual whitelist enforcement (revenue/marketplaceFees → 403);
 *   - stale vs incomplete classification (4 кейса);
 *   - regression: whitelist остаётся узким (3 cost-поля + currency).
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    AccessState: {
        EARLY_ACCESS: 'EARLY_ACCESS',
        TRIAL_ACTIVE: 'TRIAL_ACTIVE',
        TRIAL_EXPIRED: 'TRIAL_EXPIRED',
        ACTIVE_PAID: 'ACTIVE_PAID',
        GRACE_PERIOD: 'GRACE_PERIOD',
        SUSPENDED: 'SUSPENDED',
        CLOSED: 'CLOSED',
    },
}));

import { ForbiddenException } from '@nestjs/common';
import {
    FinancePolicyService,
    MANUAL_COST_FIELDS_WHITELIST,
    FINANCE_SOURCE_OF_TRUTH,
    STALE_SOURCE_WINDOW_HOURS,
} from './finance-policy.service';

function makePrisma(accessState?: string | null, tenantExists = true) {
    return {
        tenant: {
            findUnique: jest.fn().mockResolvedValue(
                tenantExists
                    ? accessState ? { accessState, id: 'tenant-1' } : { accessState: 'TRIAL_ACTIVE', id: 'tenant-1' }
                    : null,
            ),
        },
    } as any;
}

describe('FinancePolicyService.assertRebuildAllowed', () => {
    it('TRIAL_ACTIVE / ACTIVE_PAID / EARLY_ACCESS / GRACE_PERIOD пропускают', async () => {
        for (const state of ['TRIAL_ACTIVE', 'ACTIVE_PAID', 'EARLY_ACCESS', 'GRACE_PERIOD']) {
            const svc = new FinancePolicyService(makePrisma(state));
            await expect(svc.assertRebuildAllowed('tenant-1')).resolves.toBe(state);
        }
    });

    it('TRIAL_EXPIRED → ForbiddenException FINANCE_REBUILD_BLOCKED_BY_TENANT_STATE', async () => {
        const svc = new FinancePolicyService(makePrisma('TRIAL_EXPIRED'));
        await expect(svc.assertRebuildAllowed('tenant-1')).rejects.toThrow(ForbiddenException);
    });

    it('SUSPENDED тоже блокирует', async () => {
        const svc = new FinancePolicyService(makePrisma('SUSPENDED'));
        await expect(svc.assertRebuildAllowed('tenant-1')).rejects.toThrow(ForbiddenException);
    });

    it('CLOSED тоже блокирует', async () => {
        const svc = new FinancePolicyService(makePrisma('CLOSED'));
        await expect(svc.assertRebuildAllowed('tenant-1')).rejects.toThrow(ForbiddenException);
    });

    it('tenant не существует → ForbiddenException', async () => {
        const svc = new FinancePolicyService(makePrisma(null, false));
        await expect(svc.assertRebuildAllowed('tenant-x')).rejects.toThrow(ForbiddenException);
    });
});

describe('FinancePolicyService.isReadAllowed (§4 read доступен при paused)', () => {
    it('TRIAL_EXPIRED тоже разрешает read (история read-only)', async () => {
        const svc = new FinancePolicyService(makePrisma('TRIAL_EXPIRED'));
        await expect(svc.isReadAllowed('tenant-1')).resolves.toBe(true);
    });

    it('CLOSED тоже разрешает read', async () => {
        const svc = new FinancePolicyService(makePrisma('CLOSED'));
        await expect(svc.isReadAllowed('tenant-1')).resolves.toBe(true);
    });

    it('несуществующий tenant → false (без exception)', async () => {
        const svc = new FinancePolicyService(makePrisma(null, false));
        await expect(svc.isReadAllowed('tenant-x')).resolves.toBe(false);
    });
});

describe('FinancePolicyService.assertManualCostInputAllowed (§13 source-of-truth)', () => {
    const svc = new FinancePolicyService(makePrisma('ACTIVE_PAID'));

    it('baseCost / packagingCost / additionalCost / costCurrency разрешены', () => {
        for (const f of ['baseCost', 'packagingCost', 'additionalCost', 'costCurrency']) {
            expect(() => svc.assertManualCostInputAllowed(f)).not.toThrow();
        }
    });

    it('revenue → ForbiddenException MANUAL_INPUT_NOT_ALLOWED (§13)', () => {
        expect(() => svc.assertManualCostInputAllowed('revenue')).toThrow(ForbiddenException);
    });

    it('marketplaceFees → ForbiddenException (нельзя подменять marketplace fees вручную)', () => {
        expect(() => svc.assertManualCostInputAllowed('marketplaceFees')).toThrow(ForbiddenException);
    });

    it('logistics / soldQty / adsCost / taxImpact → все запрещены', () => {
        for (const f of ['logistics', 'soldQty', 'adsCost', 'taxImpact', 'returnsImpact']) {
            expect(() => svc.assertManualCostInputAllowed(f)).toThrow(ForbiddenException);
        }
    });

    it('arbitrary unknown field → ForbiddenException', () => {
        expect(() => svc.assertManualCostInputAllowed('foo')).toThrow(ForbiddenException);
    });
});

describe('FinancePolicyService.evaluateStaleness — stale vs incomplete distinction (§128)', () => {
    const svc = new FinancePolicyService(makePrisma('ACTIVE_PAID'));

    it('FRESH_AND_COMPLETE — нет stale, status READY', () => {
        const v = svc.evaluateStaleness({
            sourceFreshness: { orders: { isStale: false }, fees: { isStale: false } },
            snapshotStatus: 'READY',
        });
        expect(v).toEqual({ isStale: false, isIncomplete: false, classification: 'FRESH_AND_COMPLETE' });
    });

    it('STALE_BUT_COMPLETE — fees stale, status READY', () => {
        const v = svc.evaluateStaleness({
            sourceFreshness: { orders: { isStale: false }, fees: { isStale: true } },
            snapshotStatus: 'READY',
        });
        expect(v.classification).toBe('STALE_BUT_COMPLETE');
        expect(v.isStale).toBe(true);
        expect(v.isIncomplete).toBe(false);
    });

    it('INCOMPLETE_BUT_FRESH — нет stale, status INCOMPLETE', () => {
        const v = svc.evaluateStaleness({
            sourceFreshness: { orders: { isStale: false }, fees: { isStale: false } },
            snapshotStatus: 'INCOMPLETE',
        });
        expect(v.classification).toBe('INCOMPLETE_BUT_FRESH');
        expect(v.isStale).toBe(false);
        expect(v.isIncomplete).toBe(true);
    });

    it('STALE_AND_INCOMPLETE — обе оси проблемные', () => {
        const v = svc.evaluateStaleness({
            sourceFreshness: { orders: { isStale: true }, fees: { isStale: true } },
            snapshotStatus: 'INCOMPLETE',
        });
        expect(v.classification).toBe('STALE_AND_INCOMPLETE');
    });

    it('null sourceFreshness → не stale', () => {
        const v = svc.evaluateStaleness({ sourceFreshness: null, snapshotStatus: 'READY' });
        expect(v.isStale).toBe(false);
    });
});

describe('Source-of-truth regression invariants', () => {
    /**
     * Если кто-то расширит whitelist (например, добавит 'marketplaceFees'),
     * тест упадёт — это намеренно. Расширение whitelist = bypass §13
     * правила и должно проходить через явный design-review.
     */
    it('MANUAL_COST_FIELDS_WHITELIST не должен расширяться без code review', () => {
        expect(MANUAL_COST_FIELDS_WHITELIST).toEqual([
            'baseCost', 'packagingCost', 'additionalCost', 'costCurrency',
        ]);
    });

    it('FINANCE_SOURCE_OF_TRUTH перечисляет все обязательные категории', () => {
        for (const key of [
            'revenue', 'soldQty', 'marketplaceFees', 'logistics', 'returnsImpact',
            'baseCost', 'packagingCost', 'additionalCost', 'taxImpact', 'adsCost',
        ]) {
            expect((FINANCE_SOURCE_OF_TRUTH as any)[key]).toBeDefined();
        }
    });

    it('STALE_SOURCE_WINDOW_HOURS = 48 (§14)', () => {
        expect(STALE_SOURCE_WINDOW_HOURS).toBe(48);
    });
});
