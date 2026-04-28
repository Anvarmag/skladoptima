import {
    Body,
    Controller,
    ForbiddenException,
    Get,
    Header,
    Param,
    Post,
    Query,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { AnalyticsService } from './analytics.service';
import { AnalyticsReadService } from './analytics-read.service';
import { AnalyticsAggregatorService } from './analytics-aggregator.service';
import { AnalyticsAbcService } from './analytics-abc.service';
import { AnalyticsRecommendationsService } from './analytics-recommendations.service';
import { AnalyticsStatusService } from './analytics-status.service';
import { AnalyticsExportService } from './analytics-export.service';
import { AnalyticsMetricsRegistry } from './analytics.metrics';
import { PrismaService } from '../../prisma/prisma.service';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';
import { TenantWriteGuard } from '../tenants/guards/tenant-write.guard';
import {
    AbcQueryDto,
    AnalyticsPeriodDto,
    ExportQueryDto,
    RebuildAbcDto,
    RebuildDailyDto,
    TopProductsQueryDto,
} from './dto/analytics-period.dto';
import { AnalyticsRecommendationPriority } from '@prisma/client';

/**
 * Analytics REST API.
 *
 * Маршруты §6 system-analytics:
 *   GET   /analytics/dashboard               — KPI cards + top marketplace share
 *   GET   /analytics/revenue-dynamics        — daily series
 *   GET   /analytics/products/top            — top SKU за период
 *   GET   /analytics/products/:productId     — drill-down по SKU
 *   POST  /analytics/daily/rebuild           — Owner/Admin rebuild daily layer
 *
 * Legacy (TASK_ANALYTICS_4 will retire эти эндпоинты или объединит):
 *   GET   /analytics/recommendations         — текущий on-the-fly
 *   GET   /analytics/geo                     — текущий on-the-fly
 *   GET   /analytics/revenue-dynamics/legacy — старый realtime по 14 дням
 *
 * Все read-эндпоинты доступны при `RequireActiveTenantGuard` — read-only
 * остаётся в paused tenant'ах (§4 сценарий 4). Write (`POST .../rebuild`)
 * — `TenantWriteGuard` + role check внутри.
 */
@UseGuards(RequireActiveTenantGuard)
@Controller('analytics')
export class AnalyticsController {
    constructor(
        private readonly analyticsService: AnalyticsService,
        private readonly readService: AnalyticsReadService,
        private readonly aggregator: AnalyticsAggregatorService,
        private readonly abcService: AnalyticsAbcService,
        private readonly recommendationsService: AnalyticsRecommendationsService,
        private readonly statusService: AnalyticsStatusService,
        private readonly exportService: AnalyticsExportService,
        private readonly metrics: AnalyticsMetricsRegistry,
        private readonly prisma: PrismaService,
    ) {}

    /**
     * §19 observability — process-local snapshot метрик. Owner/Admin only;
     * `/health/analytics` для будущей интеграции с external probe.
     */
    @Get('metrics/snapshot')
    async getMetricsSnapshot(@Req() req: any) {
        await this._assertOwnerOrAdmin(req.activeTenantId, req.user?.id);
        return this.metrics.snapshot();
    }

    // ─── New read APIs (TASK_ANALYTICS_2) ────────────────────────────

    @Get('dashboard')
    async getDashboard(@Req() req: any, @Query() q: AnalyticsPeriodDto) {
        return this.readService.getDashboard(req.activeTenantId, {
            periodFrom: new Date(q.from),
            periodTo: new Date(q.to),
        });
    }

    @Get('revenue-dynamics')
    async getRevenueDynamics(@Req() req: any, @Query() q: AnalyticsPeriodDto) {
        return this.readService.getRevenueDynamics(req.activeTenantId, {
            periodFrom: new Date(q.from),
            periodTo: new Date(q.to),
        });
    }

    @Get('products/top')
    async getTopProducts(@Req() req: any, @Query() q: TopProductsQueryDto) {
        return this.readService.getTopProducts(req.activeTenantId, {
            periodFrom: new Date(q.from),
            periodTo: new Date(q.to),
            limit: q.limit,
            marketplace: q.marketplace,
        });
    }

    @Get('products/:productId')
    async getProductDrillDown(
        @Req() req: any,
        @Param('productId') productId: string,
        @Query() q: AnalyticsPeriodDto,
    ) {
        return this.readService.getProductDrillDown(req.activeTenantId, productId, {
            periodFrom: new Date(q.from),
            periodTo: new Date(q.to),
        });
    }

    @Post('daily/rebuild')
    @UseGuards(TenantWriteGuard)
    async rebuildDaily(@Req() req: any, @Body() dto: RebuildDailyDto) {
        await this._assertOwnerOrAdmin(req.activeTenantId, req.user?.id);
        return this.aggregator.rebuildDailyRange({
            tenantId: req.activeTenantId,
            periodFrom: new Date(dto.from),
            periodTo: new Date(dto.to),
        });
    }

    // ─── ABC (TASK_ANALYTICS_3) ──────────────────────────────────────

    @Get('abc')
    async getAbc(@Req() req: any, @Query() q: AbcQueryDto) {
        return this.abcService.getSnapshot(
            req.activeTenantId,
            new Date(q.from),
            new Date(q.to),
            q.metric,
        );
    }

    @Post('abc/rebuild')
    @UseGuards(TenantWriteGuard)
    async rebuildAbc(@Req() req: any, @Body() dto: RebuildAbcDto) {
        await this._assertOwnerOrAdmin(req.activeTenantId, req.user?.id);
        return this.abcService.rebuild({
            tenantId: req.activeTenantId,
            periodFrom: new Date(dto.from),
            periodTo: new Date(dto.to),
            metric: dto.metric,
        });
    }

    // ─── Recommendations / Status / Export (TASK_ANALYTICS_4) ────────

    /**
     * Read-only список активных explainable рекомендаций, отсортирован
     * HIGH → MEDIUM → LOW + createdAt desc. §15: пользовательский
     * dismiss/applied workflow в MVP не поддерживается.
     */
    @Get('recommendations')
    async getRecommendations(
        @Req() req: any,
        @Query('priority') priority?: AnalyticsRecommendationPriority,
        @Query('limit') limit?: string,
    ) {
        return this.recommendationsService.list(req.activeTenantId, {
            priority,
            limit: limit ? Number(limit) : undefined,
        });
    }

    @Post('recommendations/refresh')
    @UseGuards(TenantWriteGuard)
    async refreshRecommendations(@Req() req: any) {
        await this._assertOwnerOrAdmin(req.activeTenantId, req.user?.id);
        return this.recommendationsService.refresh({ tenantId: req.activeTenantId });
    }

    @Get('status')
    async getStatus(@Req() req: any) {
        return this.statusService.getStatus(req.activeTenantId);
    }

    @Get('export')
    async exportData(@Req() req: any, @Res() res: any, @Query() q: ExportQueryDto) {
        await this._assertOwnerOrAdmin(req.activeTenantId, req.user?.id);
        const result = await this.exportService.export({
            tenantId: req.activeTenantId,
            target: q.target,
            format: q.format ?? 'csv',
            periodFrom: new Date(q.from),
            periodTo: new Date(q.to),
            metric: q.metric,
        });
        res.set('Content-Type', result.contentType);
        res.set('Content-Disposition', `attachment; filename="${result.filename}"`);
        return res.send(result.body);
    }

    // ─── Legacy on-the-fly (frontend пока на этих) ───────────────────

    /**
     * Legacy on-the-fly recommendations. После TASK_ANALYTICS_6 (frontend
     * переключение) — удалить вместе с легаси `analytics.service.ts`.
     */
    @Get('recommendations/legacy')
    async getLegacyRecommendations(@Req() req: any) {
        return this.analyticsService.getRecommendations(req.activeTenantId);
    }

    @Get('geo')
    async getGeoAnalytics(@Req() req: any) {
        return this.analyticsService.getGeoAnalytics(req.activeTenantId);
    }

    /**
     * Legacy 14-дневный revenue dynamics — текущий frontend ходит сюда.
     * После TASK_ANALYTICS_6 (frontend rewrite) эндпоинт можно удалить;
     * `GET /analytics/revenue-dynamics?from=...&to=...` заменяет его
     * полностью.
     */
    @Get('revenue-dynamics/legacy')
    async getLegacyRevenueDynamics(@Req() req: any) {
        return this.analyticsService.getRevenueDynamics(req.activeTenantId);
    }

    private async _assertOwnerOrAdmin(tenantId: string, userId: string | undefined) {
        if (!userId) {
            throw new ForbiddenException({ code: 'TENANT_ACCESS_DENIED' });
        }
        const m = await this.prisma.membership.findFirst({
            where: { tenantId, userId, status: 'ACTIVE' },
            select: { role: true },
        });
        if (!m || (m.role !== Role.OWNER && m.role !== Role.ADMIN)) {
            throw new ForbiddenException({ code: 'ROLE_FORBIDDEN' });
        }
    }
}
