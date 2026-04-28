import { Body, Controller, ForbiddenException, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../auth/public.decorator';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';
import { ApplyPromoDto } from './dto/apply-promo.dto';
import { ValidatePromoDto } from './dto/validate-promo.dto';
import { PromoService } from './promo.service';

/**
 * Promo REST API (TASK_REFERRALS_4).
 *
 *   POST /promos/validate — Public. Dry-run проверка промокода без side effects.
 *   POST /promos/apply    — Owner. Применить промокод к checkout активного tenant.
 */
@Controller('promos')
export class PromoController {
    constructor(
        private readonly promoService: PromoService,
        private readonly prisma: PrismaService,
    ) {}

    /**
     * Dry-run валидация промокода. Доступна без авторизации,
     * чтобы checkout мог показать preview скидки до логина.
     *
     * Всегда возвращает 200: `valid: true` или `valid: false + conflictCode`.
     */
    @Public()
    @Post('validate')
    async validate(@Body() dto: ValidatePromoDto) {
        return this.promoService.validate({
            code: dto.code,
            planId: dto.planId,
            bonusSpend: dto.bonusSpend,
        });
    }

    /**
     * Применить промокод к оплате текущего tenant.
     * Требует активного tenant + роль OWNER.
     *
     * Идемпотентен: повторный вызов с тем же кодом вернёт
     * `alreadyApplied: true` без повторного инкремента usedCount.
     *
     * Конфликты (409): PROMO_EXPIRED, PROMO_MAX_USES_REACHED,
     * PROMO_NOT_APPLICABLE, PROMO_BONUS_STACK_NOT_ALLOWED.
     */
    @UseGuards(RequireActiveTenantGuard)
    @Post('apply')
    async apply(@Req() req: any, @Body() dto: ApplyPromoDto) {
        await this._assertOwner(req.activeTenantId, req.user?.id);
        return this.promoService.apply({
            code: dto.code,
            planId: dto.planId,
            tenantId: req.activeTenantId,
            bonusSpend: dto.bonusSpend,
        });
    }

    private async _assertOwner(tenantId: string, userId: string | undefined) {
        if (!userId) {
            throw new ForbiddenException({ code: 'TENANT_ACCESS_DENIED' });
        }
        const m = await this.prisma.membership.findFirst({
            where: { tenantId, userId, status: 'ACTIVE' },
            select: { role: true },
        });
        if (!m || m.role !== Role.OWNER) {
            throw new ForbiddenException({ code: 'ROLE_FORBIDDEN' });
        }
    }
}
