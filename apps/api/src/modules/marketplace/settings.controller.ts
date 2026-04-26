import { Controller, Get, Put, Body, UseGuards, Req } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';
import { TenantWriteGuard } from '../tenants/guards/tenant-write.guard';

@UseGuards(RequireActiveTenantGuard)
@Controller('settings')
export class SettingsController {
    constructor(private readonly settingsService: SettingsService) { }

    @Get('marketplaces')
    getMarketplaces(@Req() req: any) {
        return this.settingsService.getSettings(req.activeTenantId);
    }

    @Put('marketplaces')
    @UseGuards(TenantWriteGuard)
    updateMarketplaces(@Req() req: any, @Body() updateSettingsDto: UpdateSettingsDto) {
        return this.settingsService.updateSettings(req.activeTenantId, updateSettingsDto);
    }

    @Get('store')
    getStore(@Req() req: any) {
        return this.settingsService.getStore(req.activeTenantId);
    }

    @Put('store')
    @UseGuards(TenantWriteGuard)
    updateStore(@Req() req: any, @Body() body: any) {
        return this.settingsService.updateStore(req.activeTenantId, body);
    }
}
