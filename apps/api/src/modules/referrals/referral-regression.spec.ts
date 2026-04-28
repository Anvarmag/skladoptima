/**
 * TASK_REFERRALS_7 — Regression тесты реферального модуля.
 *
 * Покрывает QA-матрицу MVP growth policy (§16 + §9 + §10 + §14):
 *
 *   FLOW-1: полный lifecycle ATTRIBUTED → PAID → REWARDED (reward + wallet вместе);
 *   FLOW-2: дублированный first-payment webhook — alreadyRewarded, без мутаций;
 *   FLOW-3: self-referral → REJECTED → reward skipped (цепочка через attribution);
 *   FLOW-4: любой paid план триггерит reward (plan_basic / plan_pro / plan_enterprise);
 *   FLOW-5: REFERRAL_REWARD_RUB env управляет суммой бонуса;
 *   PROMO-1: promo maxUses граница — usedCount=maxUses−1 valid, usedCount=maxUses invalid;
 *   PROMO-2: promo с неограниченным maxUses (null) — всегда valid;
 *   PROMO-3: stack rule EXCLUSIVE блокирует и validate, и apply при bonusSpend > 0;
 *   PROMO-4: promo с expiresAt в будущем valid, в прошлом — PROMO_EXPIRED;
 *   LEDGER-1: credit(500) → debit(200) — деньги списываются, not-enough → INSUFFICIENT;
 *   LEDGER-2: повторный credit (P2002) не дублирует баланс — alreadyCredited=true;
 *   ATTRIB-1: captureRegistration нормализует код к upper-case;
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: {},
    ReferralAttributionStatus: {
        ATTRIBUTED: 'ATTRIBUTED',
        PAID: 'PAID',
        REWARDED: 'REWARDED',
        REJECTED: 'REJECTED',
        FRAUD_REVIEW: 'FRAUD_REVIEW',
    },
}));

import { ConflictException } from '@nestjs/common';
import { BonusWalletService } from './bonus-wallet.service';
import { FraudGuardService } from './fraud-guard.service';
import { PromoService } from './promo.service';
import { ReferralAuditService } from './referral-audit.service';
import { ReferralAttributionService } from './referral-attribution.service';
import { ReferralLinkService } from './referral-link.service';
import { ReferralRewardService } from './referral-reward.service';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeDecimal(n: number) {
    return { toNumber: () => n } as any;
}

function makeFraudSvc(suspicious = false): FraudGuardService {
    return {
        evaluate: jest.fn().mockResolvedValue({
            suspicious,
            ruleId: suspicious ? 'IP_OVERUSE_PER_CODE' : null,
            severity: suspicious ? 'HIGH' : null,
            details: null,
        }),
    } as unknown as FraudGuardService;
}

function makeAuditSvc(): ReferralAuditService {
    return { log: jest.fn().mockResolvedValue(undefined) } as unknown as ReferralAuditService;
}

function makeLinkSvc(link: any | null = {
    id: 'rl-1', code: 'CODE1234',
    ownerUserId: 'owner-1', tenantId: 'tenant-owner', isActive: true,
}): ReferralLinkService {
    return {
        findActiveByCode: jest.fn().mockResolvedValue(link),
    } as unknown as ReferralLinkService;
}

/** Prisma-мок для тестов ReferralRewardService + BonusWalletService вместе. */
function makeSharedRewardPrisma(opts: {
    attribution: any | null;
    walletBalance?: number;
    alreadyCreditedP2002?: boolean;
}) {
    const walletId = 'wallet-shared';
    const balance = opts.walletBalance ?? 0;

    const prisma: any = {
        referralAttribution: {
            findUnique: jest.fn().mockResolvedValue(opts.attribution),
            update: jest.fn().mockResolvedValue({}),
        },
        bonusWallet: {
            findUnique: jest.fn().mockResolvedValue(
                balance > 0 ? { id: walletId, balance: makeDecimal(balance) } : null,
            ),
            upsert: jest.fn().mockResolvedValue({ id: walletId, balance: makeDecimal(500) }),
            update: jest.fn().mockResolvedValue({ id: walletId }),
        },
        bonusTransaction: {
            findMany: jest.fn().mockResolvedValue([]),
            create: opts.alreadyCreditedP2002
                ? jest.fn().mockRejectedValue({ code: 'P2002' })
                : jest.fn().mockResolvedValue({
                      id: 'txn-1',
                      type: 'CREDIT',
                      amount: makeDecimal(500),
                      reasonCode: 'REFERRAL_REWARD',
                      referredTenantId: 'tenant-ref-1',
                      metadata: null,
                      createdAt: new Date(),
                  }),
        },
    };
    prisma.$transaction = jest.fn().mockImplementation(async (cb: any) => cb(prisma));
    return prisma;
}

/** Prisma-мок для wallet ledger тестов (с отслеживанием состояния). */
function makeWalletPrisma(initialBalance: number) {
    let balance = initialBalance;
    const walletId = 'wallet-1';

    const prisma: any = {
        bonusWallet: {
            findUnique: jest.fn().mockImplementation(async () =>
                balance >= 0 ? { id: walletId, balance: makeDecimal(balance) } : null,
            ),
            upsert: jest.fn().mockImplementation(async ({ create, update }: any) => {
                if (balance === 0) {
                    balance = create.balance;
                } else {
                    balance += update.balance.increment ?? 0;
                }
                return { id: walletId, balance: makeDecimal(balance) };
            }),
            update: jest.fn().mockImplementation(async ({ data }: any) => {
                balance -= data.balance.decrement ?? 0;
                return { id: walletId, balance: makeDecimal(balance) };
            }),
        },
        bonusTransaction: {
            create: jest.fn().mockImplementation(async ({ data }: any) => ({
                id: `txn-${Math.random().toString(36).slice(2)}`,
                type: data.type,
                amount: makeDecimal(typeof data.amount === 'number' ? data.amount : 0),
                reasonCode: data.reasonCode,
                referredTenantId: data.referredTenantId ?? null,
                metadata: null,
                createdAt: new Date(),
            })),
            findMany: jest.fn().mockResolvedValue([]),
        },
    };
    prisma.$transaction = jest.fn().mockImplementation(async (cb: any) => cb(prisma));
    return { prisma, getBalance: () => balance };
}

function makePromo(overrides: any = {}) {
    return {
        id: 'promo-1',
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

function makePromoPrisma(promo: any | null, redemption: any | null = null) {
    const prisma: any = {
        promoCode: {
            findUnique: jest.fn().mockResolvedValue(promo),
            update: jest.fn().mockResolvedValue({}),
        },
        promoRedemption: {
            findUnique: jest.fn().mockResolvedValue(redemption),
            create: jest.fn().mockResolvedValue({ id: 'redemption-1' }),
        },
    };
    prisma.$transaction = jest.fn().mockImplementation(async (cb: any) => cb(prisma));
    return prisma;
}

// ── FLOW tests ─────────────────────────────────────────────────────────────

describe('FLOW-1: полный lifecycle ATTRIBUTED → REWARDED (reward + wallet)', () => {
    it('happy path — wallet upsert создаёт новый кошелёк, attribution переходит в REWARDED', async () => {
        const prisma = makeSharedRewardPrisma({
            attribution: {
                id: 'attr-1',
                status: 'ATTRIBUTED',
                referralLinkId: 'rl-1',
                referredTenantId: 'tenant-ref-1',
                referralLink: { ownerUserId: 'owner-1' },
            },
        });
        const walletSvc = new BonusWalletService(prisma);
        const rewardSvc = new ReferralRewardService(prisma, walletSvc);

        const r = await rewardSvc.processFirstPayment({
            referredTenantId: 'tenant-ref-1',
            planId: 'plan_pro',
            amountPaid: 9990,
            currency: 'RUB',
            eventId: 'evt-001',
        });

        expect(r.skipped).toBe(false);
        if (!r.skipped && !r.alreadyRewarded) {
            expect(r.rewarded).toBe(true);
            expect(r.alreadyCredited).toBe(false);
        }
        // Wallet upsert вызван — кошелёк создан/обновлён
        expect(prisma.bonusWallet.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { ownerUserId: 'owner-1' },
                create: expect.objectContaining({ ownerUserId: 'owner-1' }),
            }),
        );
        // Attribution обновлена до REWARDED
        const lastUpdate = prisma.referralAttribution.update.mock.calls.at(-1)[0];
        expect(lastUpdate.data).toEqual({ status: 'REWARDED' });
    });
});

describe('FLOW-2: дублированный first-payment webhook — idempotency', () => {
    it('второй вызов с тем же referredTenantId → alreadyRewarded=true, update и credit не вызываются', async () => {
        const prisma = makeSharedRewardPrisma({
            attribution: {
                id: 'attr-1',
                status: 'REWARDED',
                referralLinkId: 'rl-1',
                referredTenantId: 'tenant-ref-1',
                referralLink: { ownerUserId: 'owner-1' },
            },
        });
        const walletSvc = new BonusWalletService(prisma);
        const rewardSvc = new ReferralRewardService(prisma, walletSvc);

        const r = await rewardSvc.processFirstPayment({
            referredTenantId: 'tenant-ref-1',
            planId: 'plan_pro',
            amountPaid: 9990,
            currency: 'RUB',
            eventId: 'evt-dup-001',
        });

        expect(r.skipped).toBe(false);
        if (!r.skipped) expect(r.alreadyRewarded).toBe(true);
        // Ни update, ни upsert не должны вызываться
        expect(prisma.referralAttribution.update).not.toHaveBeenCalled();
        expect(prisma.bonusWallet.upsert).not.toHaveBeenCalled();
    });

    it('повторный credit (P2002) всё равно переходит в REWARDED', async () => {
        const prisma = makeSharedRewardPrisma({
            attribution: {
                id: 'attr-1',
                status: 'ATTRIBUTED',
                referralLinkId: 'rl-1',
                referredTenantId: 'tenant-ref-1',
                referralLink: { ownerUserId: 'owner-1' },
            },
            alreadyCreditedP2002: true,
        });
        const walletSvc = new BonusWalletService(prisma);
        const rewardSvc = new ReferralRewardService(prisma, walletSvc);

        const r = await rewardSvc.processFirstPayment({
            referredTenantId: 'tenant-ref-1',
            planId: 'plan_pro',
            amountPaid: 9990,
            currency: 'RUB',
            eventId: 'evt-retry-001',
        });

        expect(r.skipped).toBe(false);
        if (!r.skipped && !r.alreadyRewarded) {
            expect(r.alreadyCredited).toBe(true);
            expect(r.rewarded).toBe(true);
        }
        // Attribution всё равно доходит до REWARDED
        const lastUpdate = prisma.referralAttribution.update.mock.calls.at(-1)[0];
        expect(lastUpdate.data).toEqual({ status: 'REWARDED' });
    });
});

describe('FLOW-3: self-referral → reward skipped', () => {
    it('self-referral → lock возвращает REJECTED → processFirstPayment → ATTRIBUTION_REJECTED', async () => {
        // Step 1: captureRegistration — успешно
        const attrPrisma: any = {
            referralAttribution: {
                create: jest.fn().mockResolvedValue({ id: 'attr-self' }),
                findUnique: jest.fn().mockResolvedValue(null),
                update: jest.fn().mockImplementation(async ({ data }: any) => ({
                    id: 'attr-self',
                    status: data.status ?? 'REJECTED',
                    rejectionReason: data.rejectionReason ?? null,
                })),
                groupBy: jest.fn().mockResolvedValue([]),
            },
            membership: { findFirst: jest.fn().mockResolvedValue(null) },
            referralLink: { findUnique: jest.fn().mockResolvedValue(null) },
        };

        const SELF_USER = 'user-self';
        const svc = new ReferralAttributionService(
            attrPrisma,
            makeLinkSvc({ id: 'rl-1', code: 'SELFC0DE', ownerUserId: SELF_USER, tenantId: 't-owner', isActive: true }),
            makeFraudSvc(),
            makeAuditSvc(),
        );

        const capture = await svc.captureRegistration({ referralCode: 'SELFC0DE', referredUserId: SELF_USER });
        expect(capture.captured).toBe(true);

        // Step 2: lockOnTenantCreation — attribution locked (attrPrisma.findUnique возвращает attribution)
        attrPrisma.referralAttribution.findUnique = jest.fn().mockResolvedValue({
            id: 'attr-self',
            referralLinkId: 'rl-1',
            referredTenantId: null,
            sourceIp: null,
            status: 'ATTRIBUTED',
            referralLink: { ownerUserId: SELF_USER, tenantId: 't-owner' },
        });

        const lock = await svc.lockOnTenantCreation({
            referredUserId: SELF_USER,
            referredTenantId: 'new-tenant',
        });

        expect(lock.locked).toBe(false);
        expect(lock.status).toBe('REJECTED');
        expect(lock.rejectionReason).toBe('SELF_REFERRAL_BLOCKED');

        // Step 3: processFirstPayment → skipped (attribution REJECTED)
        const rewardPrisma = makeSharedRewardPrisma({
            attribution: {
                id: 'attr-self',
                status: 'REJECTED',
                referralLinkId: 'rl-1',
                referredTenantId: 'new-tenant',
                referralLink: { ownerUserId: SELF_USER },
            },
        });
        const walletSvc = new BonusWalletService(rewardPrisma);
        const rewardSvc = new ReferralRewardService(rewardPrisma, walletSvc);

        const reward = await rewardSvc.processFirstPayment({
            referredTenantId: 'new-tenant',
            planId: 'plan_pro',
            amountPaid: 9990,
            currency: 'RUB',
            eventId: 'evt-self-001',
        });

        expect(reward.skipped).toBe(true);
        if (reward.skipped) expect(reward.reason).toBe('ATTRIBUTION_REJECTED');
        // Wallet не трогался
        expect(rewardPrisma.bonusWallet.upsert).not.toHaveBeenCalled();
    });
});

describe('FLOW-4: любой paid план триггерит reward', () => {
    it.each(['plan_starter', 'plan_basic', 'plan_pro', 'plan_enterprise'])(
        'planId=%s → reward начисляется',
        async (planId) => {
            const prisma = makeSharedRewardPrisma({
                attribution: {
                    id: 'attr-1',
                    status: 'ATTRIBUTED',
                    referralLinkId: 'rl-1',
                    referredTenantId: 'tenant-ref-1',
                    referralLink: { ownerUserId: 'owner-1' },
                },
            });
            const rewardSvc = new ReferralRewardService(prisma, new BonusWalletService(prisma));

            const r = await rewardSvc.processFirstPayment({
                referredTenantId: 'tenant-ref-1',
                planId,
                amountPaid: 9990,
                currency: 'RUB',
                eventId: `evt-${planId}`,
            });

            expect(r.skipped).toBe(false);
            if (!r.skipped && !r.alreadyRewarded) expect(r.rewarded).toBe(true);
        },
    );
});

describe('FLOW-5: REFERRAL_REWARD_RUB env управляет суммой бонуса', () => {
    const originalEnv = process.env.REFERRAL_REWARD_RUB;

    afterEach(() => {
        if (originalEnv === undefined) delete process.env.REFERRAL_REWARD_RUB;
        else process.env.REFERRAL_REWARD_RUB = originalEnv;
    });

    it('дефолт = 500 (env не задан)', async () => {
        delete process.env.REFERRAL_REWARD_RUB;
        const prisma = makeSharedRewardPrisma({
            attribution: {
                id: 'attr-1',
                status: 'ATTRIBUTED',
                referralLinkId: 'rl-1',
                referredTenantId: 'tenant-1',
                referralLink: { ownerUserId: 'owner-1' },
            },
        });
        const svc = new ReferralRewardService(prisma, new BonusWalletService(prisma));
        const r = await svc.processFirstPayment({
            referredTenantId: 'tenant-1', planId: 'plan_pro', amountPaid: 9990, currency: 'RUB', eventId: 'evt-1',
        });
        expect(r.skipped).toBe(false);
        if (!r.skipped && !r.alreadyRewarded) expect(r.rewardAmount).toBe(500);
    });

    it('REFERRAL_REWARD_RUB=750 → rewardAmount=750', async () => {
        process.env.REFERRAL_REWARD_RUB = '750';
        const prisma = makeSharedRewardPrisma({
            attribution: {
                id: 'attr-2',
                status: 'ATTRIBUTED',
                referralLinkId: 'rl-1',
                referredTenantId: 'tenant-2',
                referralLink: { ownerUserId: 'owner-1' },
            },
        });
        const svc = new ReferralRewardService(prisma, new BonusWalletService(prisma));
        const r = await svc.processFirstPayment({
            referredTenantId: 'tenant-2', planId: 'plan_pro', amountPaid: 9990, currency: 'RUB', eventId: 'evt-2',
        });
        expect(r.skipped).toBe(false);
        if (!r.skipped && !r.alreadyRewarded) expect(r.rewardAmount).toBe(750);
    });
});

// ── PROMO tests ────────────────────────────────────────────────────────────

describe('PROMO-1: promo maxUses граница', () => {
    it('usedCount = maxUses - 1 → valid (ещё есть место)', async () => {
        const svc = new PromoService(makePromoPrisma(makePromo({ maxUses: 5, usedCount: 4 })));
        const r = await svc.validate({ code: 'SPRING10', planId: 'plan_pro' });
        expect(r.valid).toBe(true);
    });

    it('usedCount = maxUses → invalid PROMO_MAX_USES_REACHED (граница включительно)', async () => {
        const svc = new PromoService(makePromoPrisma(makePromo({ maxUses: 5, usedCount: 5 })));
        const r = await svc.validate({ code: 'SPRING10', planId: 'plan_pro' });
        expect(r.valid).toBe(false);
        if (!r.valid) expect(r.conflictCode).toBe('PROMO_MAX_USES_REACHED');
    });

    it('usedCount > maxUses → invalid (защита на случай счётчика сверх лимита)', async () => {
        const svc = new PromoService(makePromoPrisma(makePromo({ maxUses: 3, usedCount: 10 })));
        const r = await svc.validate({ code: 'SPRING10', planId: 'plan_pro' });
        expect(r.valid).toBe(false);
        if (!r.valid) expect(r.conflictCode).toBe('PROMO_MAX_USES_REACHED');
    });
});

describe('PROMO-2: maxUses=null — неограниченный', () => {
    it('maxUses=null, usedCount любой → valid', async () => {
        const svc = new PromoService(makePromoPrisma(makePromo({ maxUses: null, usedCount: 9999 })));
        const r = await svc.validate({ code: 'SPRING10', planId: 'plan_pro' });
        expect(r.valid).toBe(true);
    });
});

describe('PROMO-3: stack rule EXCLUSIVE блокирует validate И apply', () => {
    it('validate: EXCLUSIVE + bonusSpend > 0 → PROMO_BONUS_STACK_NOT_ALLOWED', async () => {
        const svc = new PromoService(makePromoPrisma(makePromo({ stackPolicy: 'EXCLUSIVE' })));
        const r = await svc.validate({ code: 'SPRING10', planId: 'plan_pro', bonusSpend: 100 });
        expect(r.valid).toBe(false);
        if (!r.valid) expect(r.conflictCode).toBe('PROMO_BONUS_STACK_NOT_ALLOWED');
    });

    it('apply: EXCLUSIVE + bonusSpend > 0 → ConflictException', async () => {
        const svc = new PromoService(makePromoPrisma(makePromo({ stackPolicy: 'EXCLUSIVE' })));
        await expect(
            svc.apply({ code: 'SPRING10', planId: 'plan_pro', tenantId: 'tenant-abc', bonusSpend: 100 }),
        ).rejects.toMatchObject({ response: { code: 'PROMO_BONUS_STACK_NOT_ALLOWED' } });
    });

    it('COMBINABLE_WITH_BONUS: validate + apply разрешены при bonusSpend > 0', async () => {
        const promo = makePromo({ stackPolicy: 'COMBINABLE_WITH_BONUS' });
        const prisma = makePromoPrisma(promo);
        const svc = new PromoService(prisma);

        const validateResult = await svc.validate({ code: 'SPRING10', planId: 'plan_pro', bonusSpend: 200 });
        expect(validateResult.valid).toBe(true);

        const applyResult = await svc.apply({ code: 'SPRING10', planId: 'plan_pro', tenantId: 'tenant-abc', bonusSpend: 200 });
        expect(applyResult.applied).toBe(true);
        expect(applyResult.alreadyApplied).toBe(false);
    });
});

describe('PROMO-4: expiresAt boundary', () => {
    it('expiresAt в будущем → valid', async () => {
        const future = new Date(Date.now() + 86_400_000);
        const svc = new PromoService(makePromoPrisma(makePromo({ expiresAt: future })));
        const r = await svc.validate({ code: 'SPRING10', planId: 'plan_pro' });
        expect(r.valid).toBe(true);
    });

    it('expiresAt точно сейчас (в прошлом на 1 мс) → PROMO_EXPIRED', async () => {
        const pastMs = new Date(Date.now() - 1);
        const svc = new PromoService(makePromoPrisma(makePromo({ expiresAt: pastMs })));
        const r = await svc.validate({ code: 'SPRING10', planId: 'plan_pro' });
        expect(r.valid).toBe(false);
        if (!r.valid) expect(r.conflictCode).toBe('PROMO_EXPIRED');
    });

    it('expiresAt=null → никогда не истекает', async () => {
        const svc = new PromoService(makePromoPrisma(makePromo({ expiresAt: null })));
        const r = await svc.validate({ code: 'SPRING10', planId: 'plan_pro' });
        expect(r.valid).toBe(true);
    });
});

// ── LEDGER tests ───────────────────────────────────────────────────────────

describe('LEDGER-1: balance integrity — credit + debit', () => {
    it('credit(500) → balance=500; debit(200) → balance=300', async () => {
        const { prisma, getBalance } = makeWalletPrisma(0);
        const svc = new BonusWalletService(prisma);

        await svc.credit({ ownerUserId: 'owner-1', amount: 500, reasonCode: 'REFERRAL_REWARD' });
        expect(getBalance()).toBe(500);

        // Теперь кошелёк существует — мокируем findUnique с текущим балансом
        prisma.bonusWallet.findUnique = jest.fn().mockResolvedValue({
            id: 'wallet-1',
            balance: makeDecimal(500),
        });

        await svc.debit({ ownerUserId: 'owner-1', amount: 200, reasonCode: 'BONUS_SPEND' });
        expect(getBalance()).toBe(300);
    });

    it('debit(600) при balance=500 → ConflictException BONUS_INSUFFICIENT_BALANCE', async () => {
        const { prisma } = makeWalletPrisma(500);
        const svc = new BonusWalletService(prisma);

        await expect(
            svc.debit({ ownerUserId: 'owner-1', amount: 600, reasonCode: 'BONUS_SPEND' }),
        ).rejects.toMatchObject({ response: { code: 'BONUS_INSUFFICIENT_BALANCE' } });
    });

    it('debit точной суммы баланса разрешён (balance=300, debit=300)', async () => {
        const { prisma } = makeWalletPrisma(300);
        const svc = new BonusWalletService(prisma);

        prisma.bonusWallet.findUnique = jest.fn().mockResolvedValue({
            id: 'wallet-1',
            balance: makeDecimal(300),
        });

        const r = await svc.debit({ ownerUserId: 'owner-1', amount: 300, reasonCode: 'BONUS_SPEND' });
        expect(r.transactionId).toBeTruthy();
    });
});

describe('LEDGER-2: повторный credit (P2002) не дублирует баланс', () => {
    it('P2002 на BonusTransaction.create → alreadyCredited=true, upsert/update не вызывались дважды', async () => {
        // Уже при первом $transaction падает P2002 — значит upsert вызван,
        // но create отклонён → alreadyCredited=true, баланс не инкрементирован дважды
        const prisma: any = {
            bonusWallet: {
                findUnique: jest.fn().mockResolvedValue(null),
                upsert: jest.fn().mockResolvedValue({ id: 'wallet-1', balance: makeDecimal(500) }),
                update: jest.fn(),
            },
            bonusTransaction: {
                create: jest.fn().mockRejectedValue({ code: 'P2002' }),
            },
        };
        prisma.$transaction = jest.fn().mockImplementation(async (cb: any) => cb(prisma));

        const svc = new BonusWalletService(prisma);
        const r = await svc.credit({
            ownerUserId: 'owner-1',
            amount: 500,
            reasonCode: 'REFERRAL_REWARD',
            referredTenantId: 'tenant-1',
        });

        expect(r.alreadyCredited).toBe(true);
        expect(r.transactionId).toBeNull();
        // Upsert был вызван в рамках $transaction, но только 1 раз
        expect(prisma.bonusWallet.upsert).toHaveBeenCalledTimes(1);
    });
});

// ── ATTRIB tests ──────────────────────────────────────────────────────────

describe('ATTRIB-1: captureRegistration нормализует код', () => {
    it.each([
        ['code1234', 'CODE1234'],
        ['Code1234', 'CODE1234'],
        [' CODE1234 ', 'CODE1234'],
    ])('input "%s" нормализуется к "%s" при lookup', async (input, normalized) => {
        const linkSvc = makeLinkSvc({
            id: 'rl-1', code: normalized,
            ownerUserId: 'owner-1', tenantId: 'tenant-owner', isActive: true,
        });
        const prisma: any = {
            referralAttribution: {
                create: jest.fn().mockResolvedValue({ id: 'att-1' }),
                findUnique: jest.fn().mockResolvedValue(null),
            },
            membership: { findFirst: jest.fn().mockResolvedValue(null) },
        };

        const svc = new ReferralAttributionService(prisma, linkSvc, makeFraudSvc(), makeAuditSvc());
        const r = await svc.captureRegistration({ referralCode: input, referredUserId: 'user-new' });

        expect(r.captured).toBe(true);
        // Проверяем, что findActiveByCode вызван с нормализованным кодом
        expect((linkSvc.findActiveByCode as jest.Mock)).toHaveBeenCalledWith(normalized);
    });
});
