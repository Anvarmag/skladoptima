import { Injectable, Logger } from '@nestjs/common';
import { ReferralAttributionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BonusWalletService } from './bonus-wallet.service';

/**
 * Обработка первой оплаты referred tenant и начисление reward (TASK_REFERRALS_3).
 *
 * Контракт MVP (§9 + §10 + §16):
 *   - Reward начисляется СТРОГО по первой успешной оплате любого paid плана.
 *   - Один eligible tenant → не более одного reward credit (двойная защита:
 *     status=REWARDED check + UNIQUE(walletId, reasonCode, referredTenantId) в ledger).
 *   - Статусный переход: ATTRIBUTED → PAID → REWARDED (или PAID → REWARDED
 *     если billing event пришёл после уже проставленного PAID).
 *   - Повторный webhook с тем же referredTenantId → idempotent, `alreadyRewarded=true`.
 *   - REJECTED / FRAUD_REVIEW → reward никогда, `skipped=true`.
 *
 * Сумма награды: REFERRAL_REWARD_RUB env (дефолт 500 руб).
 */

export interface ProcessFirstPaymentArgs {
    referredTenantId: string;
    planId: string;
    amountPaid: number;
    currency?: string;
    eventId: string;
}

export type ProcessFirstPaymentResult =
    | { skipped: true; reason: 'NO_ATTRIBUTION' | 'LINK_DELETED' | 'ATTRIBUTION_REJECTED'; status?: ReferralAttributionStatus }
    | { skipped: false; alreadyRewarded: true; rewarded: false }
    | {
          skipped: false;
          alreadyRewarded: false;
          rewarded: true;
          rewardAmount: number;
          transactionId: string | null;
          alreadyCredited: boolean;
      };

@Injectable()
export class ReferralRewardService {
    private readonly logger = new Logger(ReferralRewardService.name);
    private readonly rewardAmount = Number(process.env.REFERRAL_REWARD_RUB ?? '500');

    constructor(
        private readonly prisma: PrismaService,
        private readonly walletService: BonusWalletService,
    ) {}

    /**
     * Основной метод: triggered billing-системой после first successful payment.
     *
     * Идемпотентность:
     *   - Если attribution уже REWARDED → возвращаем `alreadyRewarded=true` без мутаций.
     *   - Если credit уже был (P2002) → `alreadyCredited=true`, но переходим в REWARDED.
     */
    async processFirstPayment(args: ProcessFirstPaymentArgs): Promise<ProcessFirstPaymentResult> {
        // 1. Ищем attribution по referredTenantId (установлен при tenant creation — §13 lock).
        const attribution = await this.prisma.referralAttribution.findUnique({
            where: { referredTenantId: args.referredTenantId },
            include: { referralLink: { select: { ownerUserId: true } } },
        });

        // 2. Нет attribution для этого tenant'а → нерефератная оплата.
        if (!attribution) {
            this.logger.debug(
                `referral_first_payment_no_attribution tenant=${args.referredTenantId} event=${args.eventId}`,
            );
            return { skipped: true, reason: 'NO_ATTRIBUTION' };
        }

        // 3. Ссылка удалена — snapshot referralCode есть, но ownerUserId нет.
        if (!attribution.referralLink) {
            this.logger.warn(
                `referral_first_payment_link_deleted tenant=${args.referredTenantId} ` +
                    `attribution=${attribution.id} event=${args.eventId}`,
            );
            return { skipped: true, reason: 'LINK_DELETED' };
        }

        const { ownerUserId } = attribution.referralLink;

        // 4. Терминальные rejected-статусы → reward никогда.
        if (
            attribution.status === ReferralAttributionStatus.REJECTED ||
            attribution.status === ReferralAttributionStatus.FRAUD_REVIEW
        ) {
            this.logger.debug(
                `referral_first_payment_skipped status=${attribution.status} ` +
                    `tenant=${args.referredTenantId} event=${args.eventId}`,
            );
            return { skipped: true, reason: 'ATTRIBUTION_REJECTED', status: attribution.status };
        }

        // 5. Уже вознаграждён → идемпотентный успех.
        if (attribution.status === ReferralAttributionStatus.REWARDED) {
            this.logger.debug(
                `referral_first_payment_already_rewarded tenant=${args.referredTenantId} event=${args.eventId}`,
            );
            return { skipped: false, alreadyRewarded: true, rewarded: false };
        }

        // 6. ATTRIBUTED → PAID (фиксируем дату первой оплаты).
        //    Если уже PAID — пропускаем update (повторный вызов после retry).
        if (attribution.status === ReferralAttributionStatus.ATTRIBUTED) {
            await this.prisma.referralAttribution.update({
                where: { id: attribution.id },
                data: {
                    status: ReferralAttributionStatus.PAID,
                    firstPaidAt: new Date(),
                },
            });
            this.logger.log(
                `referral_attribution_paid tenant=${args.referredTenantId} ` +
                    `owner=${ownerUserId} event=${args.eventId}`,
            );
        }

        // 7. Начисляем бонус (идемпотентно — UNIQUE в ledger).
        const creditResult = await this.walletService.credit({
            ownerUserId,
            amount: this.rewardAmount,
            reasonCode: 'REFERRAL_REWARD',
            referredTenantId: args.referredTenantId,
            metadata: {
                planId: args.planId,
                amountPaid: args.amountPaid,
                currency: args.currency ?? 'RUB',
                eventId: args.eventId,
            },
        });

        // 8. PAID → REWARDED.
        await this.prisma.referralAttribution.update({
            where: { id: attribution.id },
            data: { status: ReferralAttributionStatus.REWARDED },
        });

        // 9. Структурированный лог-событие (§19: referral_bonus_credited).
        //    В production — заменить на push-уведомление/email owner'у.
        this.logger.log(
            JSON.stringify({
                event: 'referral_bonus_credited',
                ownerUserId,
                referredTenantId: args.referredTenantId,
                rewardAmount: this.rewardAmount,
                alreadyCredited: creditResult.alreadyCredited,
                transactionId: creditResult.transactionId,
                eventId: args.eventId,
                ts: new Date().toISOString(),
            }),
        );

        return {
            skipped: false,
            alreadyRewarded: false,
            rewarded: true,
            rewardAmount: this.rewardAmount,
            transactionId: creditResult.transactionId,
            alreadyCredited: creditResult.alreadyCredited,
        };
    }
}
