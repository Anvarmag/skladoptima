/**
 * TASK_REFERRALS_5 spec для `FraudGuardService`.
 *
 * Покрывает §10 + §20 fraud rules:
 *   evaluate:
 *     - sourceIp=null → not suspicious (нет IP = нет правила);
 *     - IP count < threshold → not suspicious;
 *     - IP_OVERUSE_PER_CODE: count >= threshold по linkId → suspicious HIGH;
 *     - RAPID_FIRE: count >= threshold по любому коду → suspicious MEDIUM;
 *     - если оба правила — возвращает первое (IP_OVERUSE_PER_CODE приоритетнее).
 *   recheckFraudReview:
 *     - нет FRAUD_REVIEW атрибуций → checked=0, cleared=0, kept=0;
 *     - атрибуция больше не suspicious → cleared=1, status → ATTRIBUTED;
 *     - атрибуция ещё suspicious → kept=1, status не меняется;
 *     - audit.log вызывается с FRAUD_RECHECK_COMPLETED.
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: {},
    ReferralAttributionStatus: {
        ATTRIBUTED: 'ATTRIBUTED', PAID: 'PAID', REWARDED: 'REWARDED',
        REJECTED: 'REJECTED', FRAUD_REVIEW: 'FRAUD_REVIEW',
    },
}));

import { FraudGuardService } from './fraud-guard.service';
import { ReferralAuditService } from './referral-audit.service';

const ATTR_ID = 'attr-1';
const LINK_ID = 'rl-1';
const SOURCE_IP = '1.2.3.4';

function makeAuditSvc(): ReferralAuditService {
    return { log: jest.fn().mockResolvedValue(undefined) } as unknown as ReferralAuditService;
}

function makePrisma(opts: {
    ipCount?: number;
    rapidCount?: number;
    fraudReviewAttrs?: any[];
} = {}) {
    let callCount = 0;
    const prisma: any = {
        referralAttribution: {
            count: jest.fn().mockImplementation(async () => {
                callCount++;
                // Первый count — IP_OVERUSE_PER_CODE, второй — RAPID_FIRE
                if (callCount === 1) return opts.ipCount ?? 0;
                return opts.rapidCount ?? 0;
            }),
            findMany: jest.fn().mockResolvedValue(opts.fraudReviewAttrs ?? []),
            update: jest.fn().mockResolvedValue({}),
        },
    };
    return prisma;
}

// ── evaluate ──────────────────────────────────────────────────────────

describe('FraudGuardService.evaluate', () => {
    it('sourceIp=null → not suspicious (без IP правила не работают)', async () => {
        const svc = new FraudGuardService(makePrisma(), makeAuditSvc());
        const r = await svc.evaluate({ attributionId: ATTR_ID, referralLinkId: LINK_ID, sourceIp: null });
        expect(r.suspicious).toBe(false);
        expect(r.ruleId).toBeNull();
    });

    it('IP count < threshold → not suspicious', async () => {
        const svc = new FraudGuardService(makePrisma({ ipCount: 1, rapidCount: 1 }), makeAuditSvc());
        const r = await svc.evaluate({ attributionId: ATTR_ID, referralLinkId: LINK_ID, sourceIp: SOURCE_IP });
        expect(r.suspicious).toBe(false);
    });

    it('IP_OVERUSE_PER_CODE: ipCount >= 3 → suspicious HIGH', async () => {
        const svc = new FraudGuardService(makePrisma({ ipCount: 3, rapidCount: 0 }), makeAuditSvc());
        const r = await svc.evaluate({ attributionId: ATTR_ID, referralLinkId: LINK_ID, sourceIp: SOURCE_IP });
        expect(r.suspicious).toBe(true);
        expect(r.ruleId).toBe('IP_OVERUSE_PER_CODE');
        expect(r.severity).toBe('HIGH');
        expect(r.details).toContain(SOURCE_IP);
    });

    it('RAPID_FIRE: rapidCount >= 5 → suspicious MEDIUM', async () => {
        // ipCount = 0, rapidCount = 5
        const svc = new FraudGuardService(makePrisma({ ipCount: 0, rapidCount: 5 }), makeAuditSvc());
        const r = await svc.evaluate({ attributionId: ATTR_ID, referralLinkId: LINK_ID, sourceIp: SOURCE_IP });
        expect(r.suspicious).toBe(true);
        expect(r.ruleId).toBe('RAPID_FIRE');
        expect(r.severity).toBe('MEDIUM');
    });

    it('IP_OVERUSE_PER_CODE приоритетнее RAPID_FIRE (возвращает первое правило)', async () => {
        const svc = new FraudGuardService(makePrisma({ ipCount: 3, rapidCount: 5 }), makeAuditSvc());
        const r = await svc.evaluate({ attributionId: ATTR_ID, referralLinkId: LINK_ID, sourceIp: SOURCE_IP });
        // IP_OVERUSE_PER_CODE срабатывает первым, возвращаем его
        expect(r.ruleId).toBe('IP_OVERUSE_PER_CODE');
    });

    it('referralLinkId=null → пропускает IP_OVERUSE_PER_CODE, проверяет только RAPID_FIRE', async () => {
        // Для linkId=null count будет вызван только один раз (RAPID_FIRE)
        const prisma = makePrisma({ rapidCount: 1 });
        prisma.referralAttribution.count = jest.fn().mockResolvedValue(1);
        const svc = new FraudGuardService(prisma, makeAuditSvc());
        const r = await svc.evaluate({ attributionId: ATTR_ID, referralLinkId: null, sourceIp: SOURCE_IP });
        expect(r.suspicious).toBe(false);
        // count вызван только 1 раз (только RAPID_FIRE, без IP_OVERUSE_PER_CODE)
        expect(prisma.referralAttribution.count).toHaveBeenCalledTimes(1);
    });
});

// ── recheckFraudReview ───────────────────────────────────────────────

describe('FraudGuardService.recheckFraudReview', () => {
    it('нет FRAUD_REVIEW атрибуций → checked=0, cleared=0, kept=0', async () => {
        const prisma = makePrisma({ fraudReviewAttrs: [] });
        const audit = makeAuditSvc();
        const svc = new FraudGuardService(prisma, audit);
        const r = await svc.recheckFraudReview();
        expect(r).toEqual({ checked: 0, cleared: 0, kept: 0 });
        expect(audit.log).toHaveBeenCalledWith(
            expect.objectContaining({ eventType: 'FRAUD_RECHECK_COMPLETED' }),
        );
    });

    it('атрибуция больше не suspicious → cleared=1, update вызван к ATTRIBUTED', async () => {
        const attr = { id: ATTR_ID, referralLinkId: LINK_ID, sourceIp: SOURCE_IP };
        const prisma = makePrisma({ fraudReviewAttrs: [attr], ipCount: 0, rapidCount: 0 });
        const svc = new FraudGuardService(prisma, makeAuditSvc());
        const r = await svc.recheckFraudReview();
        expect(r.cleared).toBe(1);
        expect(r.kept).toBe(0);
        expect(prisma.referralAttribution.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ status: 'ATTRIBUTED', rejectionReason: null }),
            }),
        );
    });

    it('атрибуция ещё suspicious → kept=1, update не вызван', async () => {
        const attr = { id: ATTR_ID, referralLinkId: LINK_ID, sourceIp: SOURCE_IP };
        const prisma = makePrisma({ fraudReviewAttrs: [attr], ipCount: 3, rapidCount: 0 });
        const svc = new FraudGuardService(prisma, makeAuditSvc());
        const r = await svc.recheckFraudReview();
        expect(r.kept).toBe(1);
        expect(r.cleared).toBe(0);
        expect(prisma.referralAttribution.update).not.toHaveBeenCalled();
    });
});
