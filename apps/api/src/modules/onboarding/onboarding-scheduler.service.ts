import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OnboardingService } from './onboarding.service';

@Injectable()
export class OnboardingSchedulerService {
    constructor(private readonly onboardingService: OnboardingService) {}

    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async checkStuckSteps(): Promise<void> {
        await this.onboardingService.checkStuckSteps();
    }
}
