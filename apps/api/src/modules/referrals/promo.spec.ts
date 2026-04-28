/**
 * TASK_REFERRALS_4 spec для `PromoService`.
 *
 * Покрывает §14 + §16:
 *   validate:
 *     - код не найден → valid=false, PROMO_NOT_FOUND;
 *     - промокод неактивен → valid=false, PROMO_INACTIVE;
 *     - промокод истёк → valid=false, PROMO_EXPIRED;
 *     - исчерпан maxUses → valid=false, PROMO_MAX_USES_REACHED;
 *     - план не в списке → valid=false, PROMO_NOT_APPLICABLE;
 *     - EXCLUSIVE + bonusSpend > 0 → valid=false, PROMO_BONUS_STACK_NOT_ALLOWED;
 *     - применим ко всем планам (applicablePlanCodes=[]) → valid=true;
 *     - happy path PERCENT → valid=true, discountType=PERCENT;
 *     - happy path FIXED → valid=true, discountType=FIXED;
 *     - COMBINABLE_WITH_BONUS + bonusSpend > 0 → valid=true (стек разрешён).
 *   apply:
 *     - happy path → applied=true, alreadyApplied=false, redemptionId;
 *     - уже применял (existing redemption) → alreadyApplied=true, без transaction;
 *     - EXCLUSIVE + bonusSpend → ConflictException PROMO_BONUS_STACK_NOT_ALLOWED;
 *     - код не найден → NotFoundException PROMO_NOT_FOUND.
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: {},
}));

import { ConflictException, NotFoundException } from '@nestjs/common';
import { PromoService } from './promo.service';

const TENANT = 'tenant-abc';
const PROMO_ID = 'promo-1';
const REDEMPTION_ID = 'redemption-1';

function makeDecimal(n: number) {
    return { toNumber: () => n } as any;
}

function makePromo(overrides: any = {}) {
    return {
        id: PROMO_ID,
        code: 'SPRING10',
        discountType: 'PERCENT',
        discountValue: makeDecimal(10),
        stackPolicy: 'EXCLUSIVE',
        applicablePlanCodes: [],
        maxUses: null,
        usedCount: 0,
        expiresAt: null,
        isActive: true,
        ...overrides,
    };
}

function makePrisma(opts: {
    promo?: any | null;
    redemption?: any | null;
    transactionFn?: jest.Mock;
} = {}) {
    const prisma: any = {
        promoCode: {
            findUnique: jest.fn().mockResolvedValue(opts.promo !== undefined ? opts.promo : makePromo()),
            update: jest.fn().mockResolvedValue({}),
        },
        promoRedemption: {
            findUnique: jest.fn().mockResolvedValue(opts.redemption ?? null),
            create: jest.fn().mockResolvedValue({ id: REDEMPTION_ID }),
        },
    };
    prisma.$transaction = opts.transactionFn
        ?? jest.fn().mockImplementation(async (cb: any) => cb(prisma));
    return prisma;
}

// ── validate ─────────────────────────────────────────────────────────

describe('PromoService.validate', () => {
    it('код не найден → valid=false, PROMO_NOT_FOUND', async () => {
        const svc = new PromoService(makePrisma({ promo: null }));
        const r = await svc.validate({ code: 'NOCODE', planId: 'plan_pro' });
        expect(r.valid).toBe(false);
        if (!r.valid) expect(r.conflictCode).toBe('PROMO_NOT_FOUND');
    });

    it('промокод неактивен → valid=false, PROMO_INACTIVE', async () => {
        const svc = new PromoService(makePrisma({ promo: makePromo({ isActive: false }) }));
        const r = await svc.validate({ code: 'SPRING10', planId: 'plan_pro' });
        expect(r.valid).toBe(false);
        if (!r.valid) expect(r.conflictCode).toBe('PROMO_INACTIVE');
    });

    it('промокод истёк → valid=false, PROMO_EXPIRED', async () => {
        const expired = new Date(Date.now() - 86400_000);
        const svc = new PromoService(makePrisma({ promo: makePromo({ expiresAt: expired }) }));
        const r = await svc.validate({ code: 'SPRING10', planId: 'plan_pro' });
        expect(r.valid).toBe(false);
        if (!r.valid) expect(r.conflictCode).toBe('PROMO_EXPIRED');
    });

    it('isused out (usedCount >= maxUses) → valid=false, PROMO_MAX_USES_REACHED', async () => {
        const svc = new PromoService(makePrisma({ promo: makePromo({ maxUses: 5, usedCount: 5 }) }));
        const r = await svc.validate({ code: 'SPRING10', planId: 'plan_pro' });
        expect(r.valid).toBe(false);
        if (!r.valid) expect(r.conflictCode).toBe('PROMO_MAX_USES_REACHED');
    });

    it('план не в списке → valid=false, PROMO_NOT_APPLICABLE', async () => {
        const svc = new PromoService(
            makePrisma({ promo: makePromo({ applicablePlanCodes: ['plan_pro'] }) }),
        );
        const r = await svc.validate({ code: 'SPRING10', planId: 'plan_basic' });
        expect(r.valid).toBe(false);
        if (!r.valid) expect(r.conflictCode).toBe('PROMO_NOT_APPLICABLE');
    });

    it('EXCLUSIVE + bonusSpend > 0 → valid=false, PROMO_BONUS_STACK_NOT_ALLOWED', async () => {
        const svc = new PromoService(makePrisma({ promo: makePromo({ stackPolicy: 'EXCLUSIVE' }) }));
        const r = await svc.validate({ code: 'SPRING10', planId: 'plan_pro', bonusSpend: 100 });
        expect(r.valid).toBe(false);
        if (!r.valid) expect(r.conflictCode).toBe('PROMO_BONUS_STACK_NOT_ALLOWED');
    });

    it('пустой applicablePlanCodes → применим ко всем планам, valid=true', async () => {
        const svc = new PromoService(makePrisma({ promo: makePromo({ applicablePlanCodes: [] }) }));
        const r = await svc.validate({ code: 'SPRING10', planId: 'plan_unknown' });
        expect(r.valid).toBe(true);
    });

    it('happy path PERCENT → valid=true, discountType=PERCENT, discountValue=10', async () => {
        const svc = new PromoService(makePrisma());
        const r = await svc.validate({ code: 'SPRING10', planId: 'plan_pro' });
        expect(r.valid).toBe(true);
        if (r.valid) {
            expect(r.discountType).toBe('PERCENT');
            expect(r.discountValue).toBe(10);
            expect(r.promoId).toBe(PROMO_ID);
        }
    });

    it('happy path FIXED → valid=true, discountType=FIXED', async () => {
        const svc = new PromoService(
            makePrisma({ promo: makePromo({ discountType: 'FIXED', discountValue: makeDecimal(500) }) }),
        );
        const r = await svc.validate({ code: 'SPRING10', planId: 'plan_pro' });
        expect(r.valid).toBe(true);
        if (r.valid) expect(r.discountType).toBe('FIXED');
    });

    it('COMBINABLE_WITH_BONUS + bonusSpend > 0 → valid=true (стек разрешён)', async () => {
        const svc = new PromoService(
            makePrisma({ promo: makePromo({ stackPolicy: 'COMBINABLE_WITH_BONUS' }) }),
        );
        const r = await svc.validate({ code: 'SPRING10', planId: 'plan_pro', bonusSpend: 200 });
        expect(r.valid).toBe(true);
    });
});

// ── apply ─────────────────────────────────────────────────────────────

describe('PromoService.apply', () => {
    it('happy path → applied=true, alreadyApplied=false, redemptionId', async () => {
        const prisma = makePrisma();
        const svc = new PromoService(prisma);

        const r = await svc.apply({ code: 'SPRING10', planId: 'plan_pro', tenantId: TENANT });

        expect(r.applied).toBe(true);
        expect(r.alreadyApplied).toBe(false);
        expect(r.redemptionId).toBe(REDEMPTION_ID);
        expect(r.discountType).toBe('PERCENT');
        expect(r.discountValue).toBe(10);
        // $transaction должен быть вызван
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('уже применял (existing redemption) → alreadyApplied=true, без $transaction', async () => {
        const prisma = makePrisma({ redemption: { id: 'existing-redemption' } });
        const svc = new PromoService(prisma);

        const r = await svc.apply({ code: 'SPRING10', planId: 'plan_pro', tenantId: TENANT });

        expect(r.applied).toBe(true);
        expect(r.alreadyApplied).toBe(true);
        expect(r.redemptionId).toBe('existing-redemption');
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('EXCLUSIVE + bonusSpend > 0 → ConflictException PROMO_BONUS_STACK_NOT_ALLOWED', async () => {
        const svc = new PromoService(makePrisma());
        await expect(
            svc.apply({ code: 'SPRING10', planId: 'plan_pro', tenantId: TENANT, bonusSpend: 100 }),
        ).rejects.toBeInstanceOf(ConflictException);
        await expect(
            svc.apply({ code: 'SPRING10', planId: 'plan_pro', tenantId: TENANT, bonusSpend: 100 }),
        ).rejects.toMatchObject({ response: { code: 'PROMO_BONUS_STACK_NOT_ALLOWED' } });
    });

    it('код не найден → NotFoundException PROMO_NOT_FOUND', async () => {
        const svc = new PromoService(makePrisma({ promo: null }));
        await expect(
            svc.apply({ code: 'NOCODE', planId: 'plan_pro', tenantId: TENANT }),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('usedCount инкрементируется при успешном apply', async () => {
        const prisma = makePrisma();
        const svc = new PromoService(prisma);

        await svc.apply({ code: 'SPRING10', planId: 'plan_pro', tenantId: TENANT });

        // Обновление usedCount происходит внутри $transaction callback
        expect(prisma.promoCode.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: { usedCount: { increment: 1 } },
            }),
        );
    });
});
