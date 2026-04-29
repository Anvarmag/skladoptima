import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TeamService } from './team.service';
import { TeamController } from './team.controller';
import { TeamSchedulerService } from './team-scheduler.service';
import { AuthModule } from '../auth/auth.module';
import { TenantModule } from '../tenants/tenant.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { AuditModule } from '../audit/audit.module';

@Module({
    imports: [ScheduleModule.forRoot(), AuthModule, TenantModule, OnboardingModule, AuditModule],
    providers: [TeamService, TeamSchedulerService],
    controllers: [TeamController],
    exports: [TeamService],
})
export class TeamModule {}
