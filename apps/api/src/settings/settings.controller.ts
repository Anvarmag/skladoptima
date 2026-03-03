import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
    constructor(private readonly settingsService: SettingsService) { }

    @Get('marketplaces')
    getMarketplaces() {
        return this.settingsService.getSettings();
    }

    @Put('marketplaces')
    updateMarketplaces(@Body() updateSettingsDto: UpdateSettingsDto) {
        return this.settingsService.updateSettings(updateSettingsDto);
    }
}
