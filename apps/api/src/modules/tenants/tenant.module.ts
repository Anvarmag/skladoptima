import { Module } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { TenantController } from './tenant.controller';
import { ActiveTenantGuard } from './guards/active-tenant.guard';
import { RequireActiveTenantGuard } from './guards/require-active-tenant.guard';
import { TenantWriteGuard } from './guards/tenant-write.guard';
import { AccessStatePolicy } from './access-state.policy';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { ReferralModule } from '../referrals/referral.module';

@Module({
    imports: [OnboardingModule, ReferralModule],
    providers: [TenantService, AccessStatePolicy, ActiveTenantGuard, RequireActiveTenantGuard, TenantWriteGuard],
    controllers: [TenantController],
    exports: [TenantService, AccessStatePolicy, ActiveTenantGuard, RequireActiveTenantGuard, TenantWriteGuard],
})
export class TenantModule {}
