import { Injectable, Logger } from '@nestjs/common';

/**
 * Структурированные метрики реферального модуля (TASK_REFERRALS_7).
 *
 * Каждый метод эмитит JSON-событие через Logger. Log-агрегатор (ELK, Datadog,
 * CloudWatch Logs Insights) подхватывает эти строки и строит счётчики/графики.
 *
 * Рекомендуемые алерты на базе этих событий:
 *   event=self_referral_blocked    > 10/мин  → возможный abuse-spike
 *   event=duplicate_reward_attempt > 5/мин   → аномалия billing-webhooks
 *   event=fraud_block              > 20/час  → fraud-spike
 *   event=promo_validation_failed  > 50%     → mass promo reject spike
 *   event=first_paid_reward                  → growth funnel health-metric
 *   event=bonus_spent                        → ledger flow metric
 */

export interface MetricEvent {
    event: string;
    [key: string]: unknown;
}

@Injectable()
export class ReferralMetricsService {
    private readonly logger = new Logger('ReferralMetrics');

    emit(event: MetricEvent): void {
        this.logger.log(JSON.stringify({ ...event, ts: new Date().toISOString() }));
    }

    /** Реферальная атрибуция успешно зафиксирована при регистрации. */
    trackAttributed(ownerUserId: string, referredUserId: string, code: string): void {
        this.emit({ event: 'referral_attributed', ownerUserId, referredUserId, code });
    }

    /** Первая оплата реферала — reward начислен. */
    trackFirstPaidReward(
        ownerUserId: string,
        referredTenantId: string,
        rewardAmount: number,
        eventId: string,
    ): void {
        this.emit({ event: 'first_paid_reward', ownerUserId, referredTenantId, rewardAmount, eventId });
    }

    /** Повторный first-payment webhook — reward уже был начислен. */
    trackDuplicateRewardAttempt(referredTenantId: string, eventId: string): void {
        this.emit({ event: 'duplicate_reward_attempt', referredTenantId, eventId });
    }

    /** Попытка self-referral заблокирована. */
    trackSelfReferralBlocked(userId: string, linkId: string): void {
        this.emit({ event: 'self_referral_blocked', userId, linkId });
    }

    /** Anti-fraud: атрибуция переведена в FRAUD_REVIEW. */
    trackFraudBlock(
        attributionId: string,
        ruleId: string,
        severity: string,
        sourceIp: string | null,
    ): void {
        this.emit({ event: 'fraud_block', attributionId, ruleId, severity, sourceIp });
    }

    /** Промокод не прошёл валидацию (dry-run). */
    trackPromoValidationFailed(code: string, conflictCode: string, planId: string): void {
        this.emit({ event: 'promo_validation_failed', code, conflictCode, planId });
    }

    /** Бонусный баланс списан в пользу оплаты. */
    trackBonusSpent(ownerUserId: string, amount: number, reasonCode: string): void {
        this.emit({ event: 'bonus_spent', ownerUserId, amount, reasonCode });
    }

    /** Reward processing пропущено (нет attribution / link удалён / rejected). */
    trackRewardSkipped(referredTenantId: string, reason: string, eventId: string): void {
        this.emit({ event: 'reward_skipped', referredTenantId, reason, eventId });
    }
}
