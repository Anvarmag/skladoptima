import { Module } from '@nestjs/common';
import { BonusWalletService } from './bonus-wallet.service';
import { FraudGuardService } from './fraud-guard.service';
import { PromoController } from './promo.controller';
import { PromoService } from './promo.service';
import { ReferralAuditService } from './referral-audit.service';
import { ReferralAttributionService } from './referral-attribution.service';
import { ReferralController } from './referral.controller';
import { ReferralLinkService } from './referral-link.service';
import { ReferralMetricsService } from './referral-metrics.service';
import { ReferralRewardService } from './referral-reward.service';

/**
 * Referrals + Promos (TASK_REFERRALS_1 – TASK_REFERRALS_7).
 *
 * Exports:
 *   - ReferralLinkService        — captureRegistration flow (AuthModule)
 *   - ReferralAttributionService — lockOnTenantCreation (TenantModule)
 *   - BonusWalletService         — credit/debit
 *   - ReferralRewardService      — processFirstPayment (billing integration)
 *   - PromoService               — validate/apply promo codes
 *   - FraudGuardService          — evaluate + recheckFraudReview
 *   - ReferralAuditService       — persistent audit log
 *   - ReferralMetricsService     — structured observability events (TASK_REFERRALS_7)
 */
@Module({
    providers: [
        ReferralLinkService,
        ReferralAttributionService,
        BonusWalletService,
        ReferralRewardService,
        PromoService,
        ReferralAuditService,
        FraudGuardService,
        ReferralMetricsService,
    ],
    controllers: [ReferralController, PromoController],
    exports: [
        ReferralLinkService,
        ReferralAttributionService,
        BonusWalletService,
        ReferralRewardService,
        PromoService,
        FraudGuardService,
        ReferralAuditService,
        ReferralMetricsService,
    ],
})
export class ReferralModule {}
