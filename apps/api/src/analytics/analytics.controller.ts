import { Controller, Get, Req } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
    constructor(private readonly analyticsService: AnalyticsService) { }

    @Get('recommendations')
    async getRecommendations(@Req() req: any) {
        return this.analyticsService.getRecommendations(req.user.storeId);
    }

    @Get('geo')
    async getGeoAnalytics(@Req() req: any) {
        return this.analyticsService.getGeoAnalytics(req.user.storeId);
    }

    @Get('revenue-dynamics')
    async getRevenueDynamics(@Req() req: any) {
        return this.analyticsService.getRevenueDynamics(req.user.storeId);
    }
}
