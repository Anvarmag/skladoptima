import { Module } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { OnboardingController } from './onboarding.controller';
import { OnboardingSchedulerService } from './onboarding-scheduler.service';

@Module({
    providers: [OnboardingService, OnboardingSchedulerService],
    controllers: [OnboardingController],
    exports: [OnboardingService],
})
export class OnboardingModule {}
