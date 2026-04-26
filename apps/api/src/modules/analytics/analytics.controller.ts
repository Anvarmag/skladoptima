import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';

@UseGuards(RequireActiveTenantGuard)
@Controller('analytics')
export class AnalyticsController {
    constructor(private readonly analyticsService: AnalyticsService) { }

    @Get('recommendations')
    async getRecommendations(@Req() req: any) {
        return this.analyticsService.getRecommendations(req.activeTenantId);
    }

    @Get('geo')
    async getGeoAnalytics(@Req() req: any) {
        return this.analyticsService.getGeoAnalytics(req.activeTenantId);
    }

    @Get('revenue-dynamics')
    async getRevenueDynamics(@Req() req: any) {
        return this.analyticsService.getRevenueDynamics(req.activeTenantId);
    }
}
