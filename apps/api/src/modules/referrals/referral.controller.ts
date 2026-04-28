import {
    Body,
    Controller,
    ForbiddenException,
    Get,
    Post,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../auth/public.decorator';
import { SkipCsrf } from '../auth/skip-csrf.decorator';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';
import { BonusWalletService } from './bonus-wallet.service';
import { FirstPaymentWebhookDto } from './dto/first-payment-webhook.dto';
import { ReferralAttributionService } from './referral-attribution.service';
import { ReferralLinkService } from './referral-link.service';
import { ReferralRewardService } from './referral-reward.service';

/**
 * Referral REST API.
 *
 * TASK_REFERRALS_1 (Owner-only reads):
 *   GET /referrals/link    — получить или создать реферальную ссылку.
 *   GET /referrals/status  — воронка приглашений + правила MVP.
 *
 * TASK_REFERRALS_2 (Owner-only reads):
 *   GET /referrals/bonus-balance       — текущий бонусный баланс.
 *   GET /referrals/bonus-transactions  — история операций (cursor-based).
 *
 * TASK_REFERRALS_3 (Internal webhook):
 *   POST /referrals/webhook/first-payment — internal billing trigger.
 *     @Public() + @SkipCsrf() + X-Internal-Secret header.
 *
 * Stats / promos — TASK_REFERRALS_4/5.
 */
@Controller('referrals')
export class ReferralController {
    constructor(
        private readonly linkService: ReferralLinkService,
        private readonly attributionService: ReferralAttributionService,
        private readonly walletService: BonusWalletService,
        private readonly rewardService: ReferralRewardService,
        private readonly prisma: PrismaService,
    ) {}

    // ── Owner-only endpoints (require active tenant) ──────────────────────

    @UseGuards(RequireActiveTenantGuard)
    @Get('link')
    async getLink(@Req() req: any) {
        await this._assertOwner(req.activeTenantId, req.user?.id);
        return this.linkService.getOrCreateForOwner({
            ownerUserId: req.user.id,
            tenantId: req.activeTenantId,
        });
    }

    @UseGuards(RequireActiveTenantGuard)
    @Get('status')
    async getStatus(@Req() req: any) {
        await this._assertOwner(req.activeTenantId, req.user?.id);
        return this.attributionService.getOwnerStatus({
            ownerUserId: req.user.id,
            tenantId: req.activeTenantId,
        });
    }

    @UseGuards(RequireActiveTenantGuard)
    @Get('bonus-balance')
    async getBonusBalance(@Req() req: any) {
        await this._assertOwner(req.activeTenantId, req.user?.id);
        return this.walletService.getBalance(req.user.id);
    }

    @UseGuards(RequireActiveTenantGuard)
    @Get('bonus-transactions')
    async getBonusTransactions(
        @Req() req: any,
        @Query('limit') limit?: string,
        @Query('cursor') cursor?: string,
    ) {
        await this._assertOwner(req.activeTenantId, req.user?.id);
        return this.walletService.getTransactions(req.user.id, {
            limit: limit ? parseInt(limit, 10) : undefined,
            cursor,
        });
    }

    // ── Internal webhook (billing → referral) ────────────────────────────

    /**
     * Billing-система вызывает этот endpoint после первой успешной оплаты
     * referred tenant'а. Защищён shared secret'ом (не JWT): биллинг работает
     * как отдельный сервис без токена пользователя.
     *
     * Идемпотентен: повторный вызов с тем же referredTenantId возвращает
     * `alreadyRewarded: true` без дополнительных начислений.
     *
     * Env: INTERNAL_WEBHOOK_SECRET — обязателен в production (если пустой, webhook заблокирован).
     */
    @Public()
    @SkipCsrf()
    @Post('webhook/first-payment')
    async webhookFirstPayment(@Req() req: any, @Body() dto: FirstPaymentWebhookDto) {
        this._assertInternalSecret(req);
        return this.rewardService.processFirstPayment({
            referredTenantId: dto.referredTenantId,
            planId: dto.planId,
            amountPaid: dto.amountPaid,
            currency: dto.currency,
            eventId: dto.eventId,
        });
    }

    // ── Private helpers ───────────────────────────────────────────────────

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

    /**
     * Проверяет X-Internal-Secret header против INTERNAL_WEBHOOK_SECRET env.
     * Если секрет не задан в окружении — webhook заблокирован (fail-safe для prod).
     */
    private _assertInternalSecret(req: any) {
        const secret = process.env.INTERNAL_WEBHOOK_SECRET;
        if (!secret || req.headers['x-internal-secret'] !== secret) {
            throw new ForbiddenException({ code: 'INVALID_INTERNAL_SECRET' });
        }
    }
}
