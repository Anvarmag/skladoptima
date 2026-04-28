import { Injectable, Logger } from '@nestjs/common';
import { ReferralAttributionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReferralAuditService } from './referral-audit.service';

/**
 * Anti-fraud guard для реферального модуля (TASK_REFERRALS_5).
 *
 * MVP fraud rules (§10 + §20):
 *
 *   Rule IP_OVERUSE_PER_CODE (severity: HIGH):
 *     Если один и тот же sourceIp уже встречается в ≥ FRAUD_MAX_SAME_IP_PER_CODE (default 3)
 *     других attribution к тому же referralLinkId за последние FRAUD_IP_WINDOW_H (default 24h)
 *     — скорее всего, это накрутка: один человек регистрирует несколько аккаунтов
 *     по одной ссылке с одного IP.
 *
 *   Rule RAPID_FIRE (severity: MEDIUM):
 *     Если один и тот же sourceIp встречается в ≥ FRAUD_MAX_RAPID_IP (default 5)
 *     attribution к ЛЮБЫМ ссылкам за последний FRAUD_RAPID_WINDOW_H (default 1h)
 *     — подозрительно высокая скорость регистраций с одного адреса.
 *
 * Конфигурация через env vars — все параметры задаются без перекомпиляции.
 *
 * recheckFraudReview():
 *   Повторно оценивает атрибуции в статусе FRAUD_REVIEW по тем же правилам.
 *   Если правила больше не срабатывают → переводит в ATTRIBUTED (false positive).
 *   Вызывается вручную (admin endpoint) или по расписанию.
 */

export interface FraudEvalArgs {
    attributionId: string;
    referralLinkId: string | null;
    sourceIp: string | null;
}

export interface FraudEvalResult {
    suspicious: boolean;
    ruleId: string | null;
    severity: 'HIGH' | 'MEDIUM' | null;
    details: string | null;
}

export interface RecheckResult {
    checked: number;
    cleared: number;
    kept: number;
}

@Injectable()
export class FraudGuardService {
    private readonly logger = new Logger(FraudGuardService.name);

    private readonly maxSameIpPerCode = Number(process.env.FRAUD_MAX_SAME_IP_PER_CODE ?? '3');
    private readonly ipWindowH = Number(process.env.FRAUD_IP_WINDOW_H ?? '24');
    private readonly maxRapidIp = Number(process.env.FRAUD_MAX_RAPID_IP ?? '5');
    private readonly rapidWindowH = Number(process.env.FRAUD_RAPID_WINDOW_H ?? '1');

    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: ReferralAuditService,
    ) {}

    /**
     * Оценивает attribution на предмет fraud. Должна вызываться ПОСЛЕ
     * self-referral check, до lock на tenant.
     *
     * Не мутирует attribution — только анализирует и возвращает verdict.
     * Переход в FRAUD_REVIEW делает вызывающий код (ReferralAttributionService).
     */
    async evaluate(args: FraudEvalArgs): Promise<FraudEvalResult> {
        if (!args.sourceIp) {
            return { suspicious: false, ruleId: null, severity: null, details: null };
        }

        const ipWindowStart = this._hoursAgo(this.ipWindowH);

        // Rule 1: IP_OVERUSE_PER_CODE
        if (args.referralLinkId) {
            const count = await this.prisma.referralAttribution.count({
                where: {
                    id: { not: args.attributionId },
                    sourceIp: args.sourceIp,
                    referralLinkId: args.referralLinkId,
                    registrationAttributedAt: { gte: ipWindowStart },
                },
            });
            if (count >= this.maxSameIpPerCode) {
                const details =
                    `ip=${args.sourceIp} link=${args.referralLinkId} count=${count} threshold=${this.maxSameIpPerCode}`;
                this.logger.warn(`fraud_rule_fired IP_OVERUSE_PER_CODE ${details}`);
                return { suspicious: true, ruleId: 'IP_OVERUSE_PER_CODE', severity: 'HIGH', details };
            }
        }

        // Rule 2: RAPID_FIRE
        const rapidWindowStart = this._hoursAgo(this.rapidWindowH);
        const rapidCount = await this.prisma.referralAttribution.count({
            where: {
                id: { not: args.attributionId },
                sourceIp: args.sourceIp,
                registrationAttributedAt: { gte: rapidWindowStart },
            },
        });
        if (rapidCount >= this.maxRapidIp) {
            const details =
                `ip=${args.sourceIp} count=${rapidCount} threshold=${this.maxRapidIp} window=${this.rapidWindowH}h`;
            this.logger.warn(`fraud_rule_fired RAPID_FIRE ${details}`);
            return { suspicious: true, ruleId: 'RAPID_FIRE', severity: 'MEDIUM', details };
        }

        return { suspicious: false, ruleId: null, severity: null, details: null };
    }

    /**
     * Повторная проверка FRAUD_REVIEW атрибуций: те, у которых fraud-правила
     * больше не срабатывают (например, окно 24h истекло), переводятся обратно
     * в ATTRIBUTED.
     *
     * Предназначен для вызова вручную или по расписанию. Защищён @SkipCsrf +
     * X-Internal-Secret на уровне endpoint'а.
     */
    async recheckFraudReview(): Promise<RecheckResult> {
        const fraudReviewAttributions = await this.prisma.referralAttribution.findMany({
            where: { status: ReferralAttributionStatus.FRAUD_REVIEW },
            select: { id: true, referralLinkId: true, sourceIp: true },
        });

        let cleared = 0;
        let kept = 0;

        for (const attr of fraudReviewAttributions) {
            const verdict = await this.evaluate({
                attributionId: attr.id,
                referralLinkId: attr.referralLinkId,
                sourceIp: attr.sourceIp,
            });

            if (!verdict.suspicious) {
                await this.prisma.referralAttribution.update({
                    where: { id: attr.id },
                    data: {
                        status: ReferralAttributionStatus.ATTRIBUTED,
                        rejectionReason: null,
                    },
                });
                this.logger.log(`fraud_recheck_cleared attribution=${attr.id}`);
                cleared++;
            } else {
                this.logger.debug(`fraud_recheck_kept attribution=${attr.id} rule=${verdict.ruleId}`);
                kept++;
            }
        }

        const result = { checked: fraudReviewAttributions.length, cleared, kept };

        await this.audit.log({
            eventType: 'FRAUD_RECHECK_COMPLETED',
            data: result,
        });

        this.logger.log(
            `fraud_recheck_completed checked=${result.checked} cleared=${cleared} kept=${kept}`,
        );

        return result;
    }

    private _hoursAgo(h: number): Date {
        return new Date(Date.now() - h * 3_600_000);
    }
}
