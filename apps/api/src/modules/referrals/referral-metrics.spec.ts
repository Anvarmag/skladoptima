/**
 * TASK_REFERRALS_7 spec для `ReferralMetricsService`.
 *
 * Покрывает §19 (observability/metrics):
 *   - emit(): структурированный JSON + поле ts;
 *   - trackAttributed: event=referral_attributed + нужные поля;
 *   - trackFirstPaidReward: event=first_paid_reward + нужные поля;
 *   - trackDuplicateRewardAttempt: event=duplicate_reward_attempt;
 *   - trackSelfReferralBlocked: event=self_referral_blocked;
 *   - trackFraudBlock: event=fraud_block с severity и sourceIp;
 *   - trackPromoValidationFailed: event=promo_validation_failed;
 *   - trackBonusSpent: event=bonus_spent;
 *   - trackRewardSkipped: event=reward_skipped.
 */

import { Logger } from '@nestjs/common';
import { ReferralMetricsService } from './referral-metrics.service';

function makeSvc() {
    const svc = new ReferralMetricsService();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    return svc;
}

function captureEmitted(svc: ReferralMetricsService): MetricCapture {
    const captured: string[] = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((msg: any) => {
        captured.push(String(msg));
    });
    return {
        last: () => JSON.parse(captured[captured.length - 1]),
        all: () => captured.map(s => JSON.parse(s)),
    };
}

interface MetricCapture {
    last: () => Record<string, unknown>;
    all: () => Record<string, unknown>[];
}

afterEach(() => jest.restoreAllMocks());

// ── emit ──────────────────────────────────────────────────────────────

describe('ReferralMetricsService.emit', () => {
    it('записывает JSON-строку с полем ts', () => {
        const svc = new ReferralMetricsService();
        const cap = captureEmitted(svc);

        svc.emit({ event: 'test_event', foo: 'bar' });

        const parsed = cap.last();
        expect(parsed.event).toBe('test_event');
        expect(parsed.foo).toBe('bar');
        expect(typeof parsed.ts).toBe('string');
        expect(() => new Date(parsed.ts as string)).not.toThrow();
    });

    it('ts — валидная ISO-дата текущего момента', () => {
        const before = Date.now();
        const svc = new ReferralMetricsService();
        const cap = captureEmitted(svc);

        svc.emit({ event: 'ts_test' });

        const parsed = cap.last();
        const ts = new Date(parsed.ts as string).getTime();
        expect(ts).toBeGreaterThanOrEqual(before);
        expect(ts).toBeLessThanOrEqual(Date.now());
    });
});

// ── track methods ─────────────────────────────────────────────────────

describe('ReferralMetricsService track methods', () => {
    it('trackAttributed → event=referral_attributed + поля ownerUserId, referredUserId, code', () => {
        const svc = new ReferralMetricsService();
        const cap = captureEmitted(svc);

        svc.trackAttributed('owner-1', 'user-ref-1', 'CODE1234');

        const e = cap.last();
        expect(e.event).toBe('referral_attributed');
        expect(e.ownerUserId).toBe('owner-1');
        expect(e.referredUserId).toBe('user-ref-1');
        expect(e.code).toBe('CODE1234');
    });

    it('trackFirstPaidReward → event=first_paid_reward + rewardAmount и eventId', () => {
        const svc = new ReferralMetricsService();
        const cap = captureEmitted(svc);

        svc.trackFirstPaidReward('owner-1', 'tenant-ref-1', 500, 'evt-billing-1');

        const e = cap.last();
        expect(e.event).toBe('first_paid_reward');
        expect(e.ownerUserId).toBe('owner-1');
        expect(e.referredTenantId).toBe('tenant-ref-1');
        expect(e.rewardAmount).toBe(500);
        expect(e.eventId).toBe('evt-billing-1');
    });

    it('trackDuplicateRewardAttempt → event=duplicate_reward_attempt', () => {
        const svc = new ReferralMetricsService();
        const cap = captureEmitted(svc);

        svc.trackDuplicateRewardAttempt('tenant-ref-1', 'evt-dup-1');

        const e = cap.last();
        expect(e.event).toBe('duplicate_reward_attempt');
        expect(e.referredTenantId).toBe('tenant-ref-1');
        expect(e.eventId).toBe('evt-dup-1');
    });

    it('trackSelfReferralBlocked → event=self_referral_blocked + userId и linkId', () => {
        const svc = new ReferralMetricsService();
        const cap = captureEmitted(svc);

        svc.trackSelfReferralBlocked('user-self', 'rl-1');

        const e = cap.last();
        expect(e.event).toBe('self_referral_blocked');
        expect(e.userId).toBe('user-self');
        expect(e.linkId).toBe('rl-1');
    });

    it('trackFraudBlock → event=fraud_block + ruleId, severity, sourceIp', () => {
        const svc = new ReferralMetricsService();
        const cap = captureEmitted(svc);

        svc.trackFraudBlock('attr-1', 'IP_OVERUSE_PER_CODE', 'HIGH', '1.2.3.4');

        const e = cap.last();
        expect(e.event).toBe('fraud_block');
        expect(e.attributionId).toBe('attr-1');
        expect(e.ruleId).toBe('IP_OVERUSE_PER_CODE');
        expect(e.severity).toBe('HIGH');
        expect(e.sourceIp).toBe('1.2.3.4');
    });

    it('trackFraudBlock → sourceIp может быть null', () => {
        const svc = new ReferralMetricsService();
        const cap = captureEmitted(svc);

        svc.trackFraudBlock('attr-2', 'RAPID_FIRE', 'MEDIUM', null);

        const e = cap.last();
        expect(e.sourceIp).toBeNull();
    });

    it('trackPromoValidationFailed → event=promo_validation_failed + conflictCode', () => {
        const svc = new ReferralMetricsService();
        const cap = captureEmitted(svc);

        svc.trackPromoValidationFailed('SPRING10', 'PROMO_EXPIRED', 'plan_pro');

        const e = cap.last();
        expect(e.event).toBe('promo_validation_failed');
        expect(e.code).toBe('SPRING10');
        expect(e.conflictCode).toBe('PROMO_EXPIRED');
        expect(e.planId).toBe('plan_pro');
    });

    it('trackBonusSpent → event=bonus_spent + amount и reasonCode', () => {
        const svc = new ReferralMetricsService();
        const cap = captureEmitted(svc);

        svc.trackBonusSpent('owner-1', 300, 'BONUS_SPEND');

        const e = cap.last();
        expect(e.event).toBe('bonus_spent');
        expect(e.ownerUserId).toBe('owner-1');
        expect(e.amount).toBe(300);
        expect(e.reasonCode).toBe('BONUS_SPEND');
    });

    it('trackRewardSkipped → event=reward_skipped + reason', () => {
        const svc = new ReferralMetricsService();
        const cap = captureEmitted(svc);

        svc.trackRewardSkipped('tenant-1', 'NO_ATTRIBUTION', 'evt-1');

        const e = cap.last();
        expect(e.event).toBe('reward_skipped');
        expect(e.reason).toBe('NO_ATTRIBUTION');
    });
});
