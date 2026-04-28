/**
 * TASK_REFERRALS_1 + TASK_REFERRALS_5 spec для `ReferralAttributionService`.
 *
 * Покрывает §13 + §16 + anti-fraud:
 *   - captureRegistration: invalid code → captured=false, без exception;
 *   - captureRegistration: ok → создание ATTRIBUTED записи;
 *   - captureRegistration: повторный signup → ALREADY_CAPTURED;
 *   - lockOnTenantCreation: нет attribution → skipped=true (нерефератный signup);
 *   - lockOnTenantCreation: self-referral (owner == user) → REJECTED + reason;
 *   - lockOnTenantCreation: self-referral (membership в link.tenant) → REJECTED;
 *   - lockOnTenantCreation: fraud detected → FRAUD_REVIEW (TASK_REFERRALS_5);
 *   - lockOnTenantCreation: happy path → locked=true, tenantLockedAt set;
 *   - lockOnTenantCreation: уже locked на тот же tenant → idempotent;
 *   - lockOnTenantCreation: уже locked на другой tenant → 409 ALREADY_LOCKED;
 *   - getOwnerStatus: возвращает funnel + правила MVP.
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: {},
    ReferralAttributionStatus: {
        ATTRIBUTED: 'ATTRIBUTED', PAID: 'PAID', REWARDED: 'REWARDED',
        REJECTED: 'REJECTED', FRAUD_REVIEW: 'FRAUD_REVIEW',
    },
}));

import { ConflictException } from '@nestjs/common';
import { FraudGuardService } from './fraud-guard.service';
import { ReferralAuditService } from './referral-audit.service';
import { ReferralAttributionService } from './referral-attribution.service';
import { ReferralLinkService } from './referral-link.service';

const USER = 'user-2';
const TENANT = 'tenant-2';
const OWNER = 'user-owner';
const OWNER_TENANT = 'tenant-owner';
const LINK_ID = 'rl-1';

function makeLinkSvc(opts: { link?: any | null } = {}): ReferralLinkService {
    return {
        findActiveByCode: jest.fn().mockResolvedValue(
            opts.link === undefined
                ? {
                      id: LINK_ID, code: 'CODE1234',
                      ownerUserId: OWNER, tenantId: OWNER_TENANT, isActive: true,
                  }
                : opts.link,
        ),
    } as unknown as ReferralLinkService;
}

function makePrisma(opts: any = {}) {
    return {
        referralAttribution: {
            create: opts.createError
                ? jest.fn().mockRejectedValue(opts.createError)
                : jest.fn().mockResolvedValue(opts.created ?? { id: 'att-1' }),
            findUnique: jest.fn().mockResolvedValue(opts.attribution ?? null),
            update: jest.fn().mockImplementation(async ({ where, data }) => ({
                id: where.id, ...data, status: data.status ?? 'ATTRIBUTED',
                rejectionReason: data.rejectionReason ?? null,
            })),
            groupBy: jest.fn().mockResolvedValue(opts.grouped ?? []),
            count: jest.fn().mockResolvedValue(opts.ipCount ?? 0),
        },
        membership: {
            findFirst: jest.fn().mockResolvedValue(opts.membership ?? null),
        },
        referralLink: {
            findUnique: jest.fn().mockResolvedValue(opts.link ?? null),
        },
    } as any;
}

function makeFraudSvc(opts: { suspicious?: boolean; ruleId?: string } = {}): FraudGuardService {
    return {
        evaluate: jest.fn().mockResolvedValue({
            suspicious: opts.suspicious ?? false,
            ruleId: opts.ruleId ?? null,
            severity: opts.suspicious ? 'HIGH' : null,
            details: opts.suspicious ? 'test-fraud-details' : null,
        }),
    } as unknown as FraudGuardService;
}

function makeAuditSvc(): ReferralAuditService {
    return { log: jest.fn().mockResolvedValue(undefined) } as unknown as ReferralAuditService;
}

describe('ReferralAttributionService.captureRegistration', () => {
    it('пустой/whitespace код → captured=false, INVALID_CODE', async () => {
        const svc = new ReferralAttributionService(makePrisma({}), makeLinkSvc(), makeFraudSvc(), makeAuditSvc());
        const r = await svc.captureRegistration({ referralCode: '   ', referredUserId: USER });
        expect(r.captured).toBe(false);
        expect(r.reason).toBe('INVALID_CODE');
    });

    it('код не найден → captured=false, НЕ кидает exception (soft fail)', async () => {
        const linkSvc = makeLinkSvc({ link: null });
        const svc = new ReferralAttributionService(makePrisma({}), linkSvc, makeFraudSvc(), makeAuditSvc());
        const r = await svc.captureRegistration({ referralCode: 'BAD', referredUserId: USER });
        expect(r.captured).toBe(false);
        expect(r.reason).toBe('INVALID_CODE');
    });

    it('happy path → создаёт attribution с context', async () => {
        const prisma = makePrisma({ created: { id: 'att-new' } });
        const svc = new ReferralAttributionService(prisma, makeLinkSvc(), makeFraudSvc(), makeAuditSvc());
        const r = await svc.captureRegistration({
            referralCode: 'CODE1234', referredUserId: USER,
            utmSource: 'google', utmCampaign: 'spring', sourceIp: '1.2.3.4', userAgent: 'curl',
        });
        expect(r.captured).toBe(true);
        expect(r.attributionId).toBe('att-new');
        const createCall = prisma.referralAttribution.create.mock.calls[0][0].data;
        expect(createCall).toMatchObject({
            referralLinkId: LINK_ID,
            referralCode: 'CODE1234',
            referredUserId: USER,
            status: 'ATTRIBUTED',
            utmSource: 'google',
            utmCampaign: 'spring',
            sourceIp: '1.2.3.4',
            userAgent: 'curl',
        });
    });

    it('повторный signup того же user (P2002) → ALREADY_CAPTURED, существующий id', async () => {
        const prisma = makePrisma({ createError: { code: 'P2002' } });
        prisma.referralAttribution.findUnique = jest
            .fn()
            .mockResolvedValue({ id: 'att-existing' });
        const svc = new ReferralAttributionService(prisma, makeLinkSvc(), makeFraudSvc(), makeAuditSvc());
        const r = await svc.captureRegistration({ referralCode: 'CODE1234', referredUserId: USER });
        expect(r.captured).toBe(false);
        expect(r.reason).toBe('ALREADY_CAPTURED');
        expect(r.attributionId).toBe('att-existing');
    });
});

describe('ReferralAttributionService.lockOnTenantCreation', () => {
    it('нет attribution → skipped=true (нерефератный signup)', async () => {
        const prisma = makePrisma({ attribution: null });
        const svc = new ReferralAttributionService(prisma, makeLinkSvc(), makeFraudSvc(), makeAuditSvc());
        const r = await svc.lockOnTenantCreation({
            referredUserId: USER, referredTenantId: TENANT,
        });
        expect(r.skipped).toBe(true);
        expect(r.locked).toBe(false);
    });

    it('self-referral по owner === user → REJECTED', async () => {
        const prisma = makePrisma({
            attribution: {
                id: 'att-self',
                referralLinkId: LINK_ID,
                referredTenantId: null,
                status: 'ATTRIBUTED',
                referralLink: { ownerUserId: USER, tenantId: OWNER_TENANT },
            },
        });
        const svc = new ReferralAttributionService(prisma, makeLinkSvc(), makeFraudSvc(), makeAuditSvc());
        const r = await svc.lockOnTenantCreation({
            referredUserId: USER, referredTenantId: TENANT,
        });
        expect(r.locked).toBe(false);
        expect(r.status).toBe('REJECTED');
        expect(r.rejectionReason).toBe('SELF_REFERRAL_BLOCKED');
        // КЛЮЧЕВОЕ: НЕ должны ставить referredTenantId.
        const updateCall = prisma.referralAttribution.update.mock.calls[0][0];
        expect(updateCall.data).not.toHaveProperty('referredTenantId');
    });

    it('self-referral по существующему membership в link.tenant → REJECTED', async () => {
        const prisma = makePrisma({
            attribution: {
                id: 'att-mem',
                referralLinkId: LINK_ID,
                referredTenantId: null,
                status: 'ATTRIBUTED',
                referralLink: { ownerUserId: OWNER, tenantId: OWNER_TENANT },
            },
            membership: { id: 'mem-1' }, // user уже member tenant'а ссылки
        });
        const svc = new ReferralAttributionService(prisma, makeLinkSvc(), makeFraudSvc(), makeAuditSvc());
        const r = await svc.lockOnTenantCreation({
            referredUserId: USER, referredTenantId: TENANT,
        });
        expect(r.locked).toBe(false);
        expect(r.status).toBe('REJECTED');
    });

    it('TASK_REFERRALS_5: fraud detected → FRAUD_REVIEW, locked=false', async () => {
        const prisma = makePrisma({
            attribution: {
                id: 'att-fraud',
                referralLinkId: LINK_ID,
                referredTenantId: null,
                sourceIp: '1.2.3.4',
                status: 'ATTRIBUTED',
                referralLink: { ownerUserId: OWNER, tenantId: OWNER_TENANT },
            },
        });
        const fraud = makeFraudSvc({ suspicious: true, ruleId: 'IP_OVERUSE_PER_CODE' });
        const svc = new ReferralAttributionService(prisma, makeLinkSvc(), fraud, makeAuditSvc());

        const r = await svc.lockOnTenantCreation({
            referredUserId: USER, referredTenantId: TENANT,
        });

        expect(r.locked).toBe(false);
        expect(r.status).toBe('FRAUD_REVIEW');
        expect(r.rejectionReason).toBe('IP_OVERUSE_PER_CODE');
        // fraud.evaluate должен быть вызван
        expect((fraud.evaluate as jest.Mock)).toHaveBeenCalledWith(
            expect.objectContaining({ attributionId: 'att-fraud', sourceIp: '1.2.3.4' }),
        );
    });

    it('happy path → locked=true, tenantLockedAt установлен', async () => {
        const prisma = makePrisma({
            attribution: {
                id: 'att-ok',
                referralLinkId: LINK_ID,
                referredTenantId: null,
                sourceIp: '5.6.7.8',
                status: 'ATTRIBUTED',
                referralLink: { ownerUserId: OWNER, tenantId: OWNER_TENANT },
            },
        });
        const svc = new ReferralAttributionService(prisma, makeLinkSvc(), makeFraudSvc(), makeAuditSvc());
        const r = await svc.lockOnTenantCreation({
            referredUserId: USER, referredTenantId: TENANT,
        });
        expect(r.locked).toBe(true);
        const updateCall = prisma.referralAttribution.update.mock.calls[0][0];
        expect(updateCall.data.referredTenantId).toBe(TENANT);
        expect(updateCall.data.tenantLockedAt).toBeInstanceOf(Date);
    });

    it('уже locked на тот же tenant → idempotent, locked=true без update', async () => {
        const prisma = makePrisma({
            attribution: {
                id: 'att-already', referralLinkId: LINK_ID,
                referredTenantId: TENANT, status: 'ATTRIBUTED', rejectionReason: null,
                referralLink: { ownerUserId: OWNER, tenantId: OWNER_TENANT },
            },
        });
        const svc = new ReferralAttributionService(prisma, makeLinkSvc(), makeFraudSvc(), makeAuditSvc());
        const r = await svc.lockOnTenantCreation({
            referredUserId: USER, referredTenantId: TENANT,
        });
        expect(r.locked).toBe(true);
        expect(prisma.referralAttribution.update).not.toHaveBeenCalled();
    });

    it('уже locked на ДРУГОЙ tenant → 409 REFERRAL_ATTRIBUTION_ALREADY_LOCKED', async () => {
        const prisma = makePrisma({
            attribution: {
                id: 'att-locked', referralLinkId: LINK_ID,
                referredTenantId: 'different-tenant', status: 'ATTRIBUTED',
                referralLink: { ownerUserId: OWNER, tenantId: OWNER_TENANT },
            },
        });
        const svc = new ReferralAttributionService(prisma, makeLinkSvc(), makeFraudSvc(), makeAuditSvc());
        await expect(
            svc.lockOnTenantCreation({ referredUserId: USER, referredTenantId: TENANT }),
        ).rejects.toThrow(ConflictException);
    });
});

describe('ReferralAttributionService.getOwnerStatus', () => {
    it('нет ссылки → hasLink=false, нулевые stats, правила MVP', async () => {
        const prisma = makePrisma({});
        const svc = new ReferralAttributionService(prisma, makeLinkSvc(), makeFraudSvc(), makeAuditSvc());
        const r = await svc.getOwnerStatus({ ownerUserId: OWNER, tenantId: OWNER_TENANT });
        expect(r.hasLink).toBe(false);
        expect(r.stats.total).toBe(0);
        expect(r.rules.rewardTrigger).toBe('first_paid_subscription');
        expect(r.rules.selfReferralBlocked).toBe(true);
    });

    it('есть ссылка + funnel → агрегирует groupBy по статусам', async () => {
        const prisma = makePrisma({
            link: {
                id: LINK_ID, code: 'OWNER123', isActive: true,
                createdAt: new Date('2026-04-01'),
            },
            grouped: [
                { status: 'ATTRIBUTED', _count: { _all: 5 } },
                { status: 'PAID', _count: { _all: 2 } },
                { status: 'REWARDED', _count: { _all: 1 } },
                { status: 'REJECTED', _count: { _all: 3 } },
            ],
        });
        prisma.referralLink.findUnique = jest.fn().mockResolvedValue({
            id: LINK_ID, code: 'OWNER123', isActive: true,
            createdAt: new Date('2026-04-01'),
        });
        const svc = new ReferralAttributionService(prisma, makeLinkSvc(), makeFraudSvc(), makeAuditSvc());
        const r = await svc.getOwnerStatus({ ownerUserId: OWNER, tenantId: OWNER_TENANT });
        expect(r.hasLink).toBe(true);
        expect(r.stats).toEqual({
            attributed: 5, paid: 2, rewarded: 1, rejected: 3, fraudReview: 0, total: 11,
        });
    });
});
