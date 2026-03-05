import { Controller, Get, Put, Body, UseGuards, Req } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
    constructor(private readonly settingsService: SettingsService) { }

    @Get('marketplaces')
    getMarketplaces(@Req() req: any) {
        return this.settingsService.getSettings(req.user.storeId);
    }

    @Put('marketplaces')
    updateMarketplaces(@Req() req: any, @Body() updateSettingsDto: UpdateSettingsDto) {
        return this.settingsService.updateSettings(req.user.storeId, updateSettingsDto);
    }

    @Get('store')
    getStore(@Req() req: any) {
        return this.settingsService.getStore(req.user.storeId);
    }

    @Put('store')
    updateStore(@Req() req: any, @Body('name') name: string) {
        return this.settingsService.updateStore(req.user.storeId, name);
    }
}
