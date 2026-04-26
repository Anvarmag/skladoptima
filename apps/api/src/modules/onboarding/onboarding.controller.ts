import { Controller, Get, Post, Patch, Body, Param, Req } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { UpdateStepDto } from './dto/update-step.dto';

@Controller('onboarding')
export class OnboardingController {
    constructor(private readonly onboardingService: OnboardingService) {}

    @Get('state')
    getState(@Req() req: any) {
        return this.onboardingService.getState(req.user.id, req.activeTenantId ?? null);
    }

    @Post('start')
    start(@Req() req: any) {
        return this.onboardingService.startState(req.user.id, req.activeTenantId ?? null);
    }

    @Patch('steps/:stepKey')
    updateStep(
        @Param('stepKey') stepKey: string,
        @Body() dto: UpdateStepDto,
        @Req() req: any,
    ) {
        return this.onboardingService.updateStep(
            req.user.id,
            req.activeTenantId ?? null,
            stepKey,
            dto.status,
        );
    }

    @Post('close')
    close(@Req() req: any) {
        return this.onboardingService.closeState(req.user.id, req.activeTenantId ?? null);
    }

    @Post('reopen')
    reopen(@Req() req: any) {
        return this.onboardingService.reopenState(req.user.id, req.activeTenantId ?? null);
    }

    @Post('complete')
    complete(@Req() req: any) {
        return this.onboardingService.completeState(req.user.id, req.activeTenantId ?? null);
    }
}
