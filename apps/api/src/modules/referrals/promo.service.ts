import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Промокоды (TASK_REFERRALS_4).
 *
 * Правила MVP (§14 system-analytics):
 *   - validate   — dry-run: проверяет is_active / expires_at / maxUses /
 *                  applicablePlanCodes / stack rule. Без side effects.
 *   - apply      — validate + атомарно создаёт PromoRedemption + инкрементирует
 *                  usedCount. Идемпотентен: UNIQUE(promoId, tenantId).
 *   - stack rule — stackPolicy=EXCLUSIVE: нельзя применять promo одновременно
 *                  с bonusSpend > 0 в одном checkout.
 */

export interface ValidatePromoArgs {
    code: string;
    planId: string;
    bonusSpend?: number;
}

export interface ApplyPromoArgs {
    code: string;
    planId: string;
    tenantId: string;
    bonusSpend?: number;
}

export interface PromoDiscountInfo {
    promoId: string;
    discountType: 'PERCENT' | 'FIXED';
    discountValue: number;
    stackPolicy: 'EXCLUSIVE' | 'COMBINABLE_WITH_BONUS';
}

export type ValidatePromoResult =
    | ({ valid: true } & PromoDiscountInfo)
    | { valid: false; conflictCode: string; conflictMessage: string };

export interface ApplyPromoResult extends PromoDiscountInfo {
    applied: true;
    redemptionId: string;
    alreadyApplied: boolean;
}

@Injectable()
export class PromoService {
    private readonly logger = new Logger(PromoService.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Dry-run валидация промокода. Не создаёт записей в БД.
     * Возвращает `valid: false` с кодом ошибки вместо exception,
     * чтобы frontend мог показать понятное сообщение.
     */
    async validate(args: ValidatePromoArgs): Promise<ValidatePromoResult> {
        try {
            const info = await this._findAndValidate(args.code, args.planId, args.bonusSpend);
            this.logger.log(`promo_validated code=${args.code} planId=${args.planId}`);
            return {
                valid: true,
                promoId: info.id,
                discountType: info.discountType as 'PERCENT' | 'FIXED',
                discountValue: toNumber(info.discountValue),
                stackPolicy: info.stackPolicy as 'EXCLUSIVE' | 'COMBINABLE_WITH_BONUS',
            };
        } catch (err: any) {
            const code = err?.response?.code ?? 'PROMO_INVALID';
            const message = err?.response?.message ?? err?.message ?? 'Invalid promo code';
            this.logger.log(`promo_rejected code=${args.code} conflict=${code}`);
            return { valid: false, conflictCode: code, conflictMessage: message };
        }
    }

    /**
     * Применяет промокод к checkout конкретного tenant.
     * Атомарно инкрементирует usedCount и создаёт PromoRedemption.
     *
     * Идемпотентен: если tenant уже применял этот промокод, возвращает
     * `alreadyApplied: true` без повторного инкремента.
     *
     * Бросает ConflictException при нарушении правил (истёк, исчерпан, стек).
     */
    async apply(args: ApplyPromoArgs): Promise<ApplyPromoResult> {
        const promo = await this._findAndValidate(args.code, args.planId, args.bonusSpend);

        // Проверяем, применял ли этот tenant данный промокод ранее.
        const existing = await this.prisma.promoRedemption.findUnique({
            where: { promoId_tenantId: { promoId: promo.id, tenantId: args.tenantId } },
            select: { id: true },
        });

        if (existing) {
            this.logger.log(
                `promo_already_applied code=${args.code} tenant=${args.tenantId} redemption=${existing.id}`,
            );
            return {
                applied: true,
                alreadyApplied: true,
                redemptionId: existing.id,
                promoId: promo.id,
                discountType: promo.discountType as 'PERCENT' | 'FIXED',
                discountValue: toNumber(promo.discountValue),
                stackPolicy: promo.stackPolicy as 'EXCLUSIVE' | 'COMBINABLE_WITH_BONUS',
            };
        }

        // Атомарно: создаём redemption + инкрементируем usedCount.
        const redemption = await this.prisma.$transaction(async (tx) => {
            const r = await tx.promoRedemption.create({
                data: { promoId: promo.id, tenantId: args.tenantId },
            });
            await tx.promoCode.update({
                where: { id: promo.id },
                data: { usedCount: { increment: 1 } },
            });
            return r;
        });

        this.logger.log(
            `promo_applied code=${args.code} tenant=${args.tenantId} redemption=${redemption.id}`,
        );

        return {
            applied: true,
            alreadyApplied: false,
            redemptionId: redemption.id,
            promoId: promo.id,
            discountType: promo.discountType as 'PERCENT' | 'FIXED',
            discountValue: toNumber(promo.discountValue),
            stackPolicy: promo.stackPolicy as 'EXCLUSIVE' | 'COMBINABLE_WITH_BONUS',
        };
    }

    /**
     * Находит промокод по коду и прогоняет все бизнес-правила.
     * Бросает ConflictException/NotFoundException при нарушениях.
     * Используется и в validate, и в apply.
     */
    private async _findAndValidate(code: string, planId: string, bonusSpend?: number) {
        const promo = await this.prisma.promoCode.findUnique({
            where: { code: code.trim().toUpperCase() },
        });

        if (!promo) {
            throw new NotFoundException({ code: 'PROMO_NOT_FOUND', message: `Promo code not found: ${code}` });
        }

        if (!promo.isActive) {
            throw new ConflictException({ code: 'PROMO_INACTIVE', message: 'Promo code is inactive' });
        }

        if (promo.expiresAt && promo.expiresAt < new Date()) {
            throw new ConflictException({ code: 'PROMO_EXPIRED', message: 'Promo code has expired' });
        }

        if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) {
            throw new ConflictException({ code: 'PROMO_MAX_USES_REACHED', message: 'Promo code usage limit reached' });
        }

        if (promo.applicablePlanCodes.length > 0 && !promo.applicablePlanCodes.includes(planId)) {
            throw new ConflictException({
                code: 'PROMO_NOT_APPLICABLE',
                message: `Promo code is not applicable to plan: ${planId}`,
            });
        }

        // MVP stack rule §14: EXCLUSIVE промокод нельзя комбинировать с бонусным балансом.
        if (promo.stackPolicy === 'EXCLUSIVE' && bonusSpend && bonusSpend > 0) {
            throw new ConflictException({
                code: 'PROMO_BONUS_STACK_NOT_ALLOWED',
                message: 'Cannot combine promo code with bonus balance in one checkout',
            });
        }

        return promo;
    }
}

function toNumber(v: Decimal | number): number {
    if (typeof v === 'number') return v;
    return v.toNumber();
}
