import { Controller, Get, Req } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
    constructor(private readonly analyticsService: AnalyticsService) { }

    @Get('recommendations')
    async getRecommendations(@Req() req: any) {
        return this.analyticsService.getRecommendations(req.user.tenantId);
    }

    @Get('geo')
    async getGeoAnalytics(@Req() req: any) {
        return this.analyticsService.getGeoAnalytics(req.user.tenantId);
    }

    @Get('revenue-dynamics')
    async getRevenueDynamics(@Req() req: any) {
        return this.analyticsService.getRevenueDynamics(req.user.tenantId);
    }
}
