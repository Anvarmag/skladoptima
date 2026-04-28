/**
 * TASK_REFERRALS_5 spec для `ReferralAuditService`.
 *
 * Покрывает §19 (observability / audit):
 *   - успешная запись → prisma.referralAuditLog.create вызван с правильными данными;
 *   - ошибка БД → НЕ бросает exception (fire-and-forget);
 *   - все поля (attributionId, actorId, tenantId, ruleId, data) корректно маппятся.
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: {},
    ReferralAuditEventType: {
        ATTRIBUTION_CAPTURED: 'ATTRIBUTION_CAPTURED',
        ATTRIBUTION_LOCKED: 'ATTRIBUTION_LOCKED',
        ATTRIBUTION_REJECTED: 'ATTRIBUTION_REJECTED',
        ATTRIBUTION_FRAUD_REVIEW: 'ATTRIBUTION_FRAUD_REVIEW',
        REWARD_CREDITED: 'REWARD_CREDITED',
        REWARD_SKIPPED: 'REWARD_SKIPPED',
        PROMO_APPLIED: 'PROMO_APPLIED',
        PROMO_REJECTED: 'PROMO_REJECTED',
        FRAUD_RECHECK_COMPLETED: 'FRAUD_RECHECK_COMPLETED',
    },
}));

import { ReferralAuditService } from './referral-audit.service';

function makePrisma(opts: { createError?: any } = {}) {
    return {
        referralAuditLog: {
            create: opts.createError
                ? jest.fn().mockRejectedValue(opts.createError)
                : jest.fn().mockResolvedValue({ id: 'audit-1' }),
        },
    } as any;
}

describe('ReferralAuditService.log', () => {
    it('happy path → create вызван с корректными полями', async () => {
        const prisma = makePrisma();
        const svc = new ReferralAuditService(prisma);

        await svc.log({
            eventType: 'ATTRIBUTION_CAPTURED' as any,
            attributionId: 'attr-1',
            actorId: 'user-1',
            tenantId: 'tenant-1',
            ruleId: 'SELF_REFERRAL_BLOCKED',
            data: { code: 'ABC' },
        });

        expect(prisma.referralAuditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                eventType: 'ATTRIBUTION_CAPTURED',
                attributionId: 'attr-1',
                actorId: 'user-1',
                tenantId: 'tenant-1',
                ruleId: 'SELF_REFERRAL_BLOCKED',
            }),
        });
    });

    it('опциональные поля отсутствуют → пишет null', async () => {
        const prisma = makePrisma();
        const svc = new ReferralAuditService(prisma);

        await svc.log({ eventType: 'FRAUD_RECHECK_COMPLETED' as any });

        const createArg = prisma.referralAuditLog.create.mock.calls[0][0].data;
        expect(createArg.attributionId).toBeNull();
        expect(createArg.actorId).toBeNull();
        expect(createArg.tenantId).toBeNull();
        expect(createArg.ruleId).toBeNull();
        expect(createArg.data).toBeNull();
    });

    it('ошибка БД → НЕ бросает exception (fire-and-forget)', async () => {
        const prisma = makePrisma({ createError: new Error('DB connection lost') });
        const svc = new ReferralAuditService(prisma);

        // Не должен бросать
        await expect(
            svc.log({ eventType: 'ATTRIBUTION_LOCKED' as any, attributionId: 'attr-1' }),
        ).resolves.toBeUndefined();
    });
});
