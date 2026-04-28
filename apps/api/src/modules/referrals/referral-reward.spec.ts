/**
 * TASK_REFERRALS_3 spec для `ReferralRewardService`.
 *
 * Покрывает §9 + §10 + §16:
 *   - нет attribution → skipped=true NO_ATTRIBUTION;
 *   - attribution REJECTED → skipped=true ATTRIBUTION_REJECTED;
 *   - attribution FRAUD_REVIEW → skipped=true ATTRIBUTION_REJECTED;
 *   - attribution REWARDED → alreadyRewarded=true (идемпотентный успех);
 *   - referralLink удалён (null) → skipped=true LINK_DELETED;
 *   - happy path ATTRIBUTED → PAID → REWARDED, credit вызван;
 *   - already PAID (retry) → сразу REWARDED, credit вызван;
 *   - credit P2002 (alreadyCredited=true) → всё равно REWARDED;
 *   - ATTRIBUTED → PAID update вызывается ровно один раз (не при PAID статусе).
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

import { ReferralRewardService } from './referral-reward.service';
import { BonusWalletService } from './bonus-wallet.service';

const OWNER = 'user-owner';
const REFERRED_TENANT = 'tenant-referred';
const ATTR_ID = 'attr-1';

const BASE_ARGS = {
    referredTenantId: REFERRED_TENANT,
    planId: 'plan_pro',
    amountPaid: 9990,
    currency: 'RUB',
    eventId: 'evt-billing-001',
};

function makeAttribution(status: string, overrides: any = {}) {
    return {
        id: ATTR_ID,
        status,
        referralLinkId: 'rl-1',
        referralLink: { ownerUserId: OWNER },
        ...overrides,
    };
}

function makePrisma(attribution: any | null, updateFn?: jest.Mock) {
    return {
        referralAttribution: {
            findUnique: jest.fn().mockResolvedValue(attribution),
            update: updateFn ?? jest.fn().mockResolvedValue({}),
        },
    } as any;
}

function makeWallet(opts: { alreadyCredited?: boolean; transactionId?: string | null } = {}): BonusWalletService {
    return {
        credit: jest.fn().mockResolvedValue({
            alreadyCredited: opts.alreadyCredited ?? false,
            transactionId: opts.transactionId ?? 'txn-reward-1',
        }),
    } as unknown as BonusWalletService;
}

// ── Тесты ────────────────────────────────────────────────────────────────────

describe('ReferralRewardService.processFirstPayment', () => {
    it('нет attribution → skipped=true, NO_ATTRIBUTION', async () => {
        const svc = new ReferralRewardService(makePrisma(null), makeWallet());
        const r = await svc.processFirstPayment(BASE_ARGS);
        expect(r.skipped).toBe(true);
        if (r.skipped) expect(r.reason).toBe('NO_ATTRIBUTION');
    });

    it('referralLink удалён → skipped=true, LINK_DELETED', async () => {
        const attr = makeAttribution('ATTRIBUTED', { referralLink: null });
        const svc = new ReferralRewardService(makePrisma(attr), makeWallet());
        const r = await svc.processFirstPayment(BASE_ARGS);
        expect(r.skipped).toBe(true);
        if (r.skipped) expect(r.reason).toBe('LINK_DELETED');
    });

    it('attribution REJECTED → skipped=true, ATTRIBUTION_REJECTED', async () => {
        const svc = new ReferralRewardService(
            makePrisma(makeAttribution('REJECTED')), makeWallet(),
        );
        const r = await svc.processFirstPayment(BASE_ARGS);
        expect(r.skipped).toBe(true);
        if (r.skipped) expect(r.reason).toBe('ATTRIBUTION_REJECTED');
    });

    it('attribution FRAUD_REVIEW → skipped=true, ATTRIBUTION_REJECTED', async () => {
        const svc = new ReferralRewardService(
            makePrisma(makeAttribution('FRAUD_REVIEW')), makeWallet(),
        );
        const r = await svc.processFirstPayment(BASE_ARGS);
        expect(r.skipped).toBe(true);
        if (r.skipped) expect(r.reason).toBe('ATTRIBUTION_REJECTED');
    });

    it('attribution REWARDED → alreadyRewarded=true, без мутаций', async () => {
        const prisma = makePrisma(makeAttribution('REWARDED'));
        const wallet = makeWallet();
        const svc = new ReferralRewardService(prisma, wallet);
        const r = await svc.processFirstPayment(BASE_ARGS);
        expect(r.skipped).toBe(false);
        if (!r.skipped) expect(r.alreadyRewarded).toBe(true);
        expect(prisma.referralAttribution.update).not.toHaveBeenCalled();
        expect(wallet.credit).not.toHaveBeenCalled();
    });

    it('happy path ATTRIBUTED → обновляет статус PAID, кредитует, обновляет REWARDED', async () => {
        const updateMock = jest.fn().mockResolvedValue({});
        const prisma = makePrisma(makeAttribution('ATTRIBUTED'), updateMock);
        const wallet = makeWallet({ transactionId: 'txn-abc' });
        const svc = new ReferralRewardService(prisma, wallet);

        const r = await svc.processFirstPayment(BASE_ARGS);

        expect(r.skipped).toBe(false);
        if (!r.skipped && !r.alreadyRewarded) {
            expect(r.rewarded).toBe(true);
            expect(r.transactionId).toBe('txn-abc');
            expect(r.alreadyCredited).toBe(false);
        }

        // Два update: ATTRIBUTED→PAID и PAID→REWARDED
        expect(updateMock).toHaveBeenCalledTimes(2);

        // Первый update: ATTRIBUTED → PAID + firstPaidAt
        expect(updateMock.mock.calls[0][0].data).toMatchObject({
            status: 'PAID',
        });
        expect(updateMock.mock.calls[0][0].data.firstPaidAt).toBeInstanceOf(Date);

        // Второй update: → REWARDED
        expect(updateMock.mock.calls[1][0].data).toEqual({ status: 'REWARDED' });

        // Credit вызван с правильными параметрами
        expect(wallet.credit).toHaveBeenCalledWith(
            expect.objectContaining({
                ownerUserId: OWNER,
                reasonCode: 'REFERRAL_REWARD',
                referredTenantId: REFERRED_TENANT,
            }),
        );
    });

    it('уже PAID (retry after partial failure) → пропускает update PAID, кредитует, REWARDED', async () => {
        const updateMock = jest.fn().mockResolvedValue({});
        const prisma = makePrisma(makeAttribution('PAID'), updateMock);
        const wallet = makeWallet();
        const svc = new ReferralRewardService(prisma, wallet);

        await svc.processFirstPayment(BASE_ARGS);

        // Только один update: PAID → REWARDED (update ATTRIBUTED→PAID не вызывается)
        expect(updateMock).toHaveBeenCalledTimes(1);
        expect(updateMock.mock.calls[0][0].data).toEqual({ status: 'REWARDED' });
        expect(wallet.credit).toHaveBeenCalledTimes(1);
    });

    it('credit уже был (alreadyCredited=true) → всё равно переходит в REWARDED', async () => {
        const updateMock = jest.fn().mockResolvedValue({});
        const prisma = makePrisma(makeAttribution('ATTRIBUTED'), updateMock);
        const wallet = makeWallet({ alreadyCredited: true, transactionId: null });
        const svc = new ReferralRewardService(prisma, wallet);

        const r = await svc.processFirstPayment(BASE_ARGS);

        expect(r.skipped).toBe(false);
        if (!r.skipped && !r.alreadyRewarded) {
            expect(r.rewarded).toBe(true);
            expect(r.alreadyCredited).toBe(true);
        }
        // Финальный update в REWARDED должен произойти даже при повторном credit
        const lastUpdate = updateMock.mock.calls[updateMock.mock.calls.length - 1][0];
        expect(lastUpdate.data).toEqual({ status: 'REWARDED' });
    });
});
