import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { OnboardingModule } from '../onboarding/onboarding.module';

@Module({
    imports: [OnboardingModule],
    providers: [SettingsService],
    controllers: [SettingsController],
    exports: [SettingsService]
})
export class SettingsModule { }
