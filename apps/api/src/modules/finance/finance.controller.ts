import {
    Body,
    Controller,
    ForbiddenException,
    Get,
    Param,
    Patch,
    Post,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { FinanceService } from './finance.service';
import { FinanceReadService } from './finance-read.service';
import { FinanceCostProfileService } from './finance-cost-profile.service';
import { FinanceSnapshotService } from './finance-snapshot.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';
import { TenantWriteGuard } from '../tenants/guards/tenant-write.guard';
import { UpdateProductCostDto } from './dto/update-product-cost.dto';
import { RebuildSnapshotDto } from './dto/rebuild-snapshot.dto';

/**
 * Finance REST API (TASK_FINANCE_4).
 *
 * Маршруты по §6 system-analytics:
 *
 *   GET   /finance/unit-economics                  — read snapshot list
 *   GET   /finance/unit-economics/:productId       — read product detail
 *   GET   /finance/dashboard                       — totals + top + warnings
 *   GET   /finance/snapshots/status                — last snapshot meta
 *   GET   /finance/warnings                        — active warnings list
 *   PATCH /finance/products/:productId/cost        — Owner/Admin (через сервис)
 *   POST  /finance/snapshots/rebuild               — Owner/Admin (через сервис)
 *
 *   GET   /finance/unit-economics/legacy           — старый realtime calc
 *                                                    (ради backward-compat
 *                                                    с frontend UnitEconomics.tsx
 *                                                    до TASK_FINANCE_5)
 *
 * Read-эндпоинты: только `RequireActiveTenantGuard`. Read доступен и
 * при paused tenant (§4 сценарий 4: история read-only).
 *
 * Write-эндпоинты: дополнительно `TenantWriteGuard` (отбивает paused) +
 * role check внутри сервиса (membership.role IN OWNER/ADMIN).
 */
@UseGuards(RequireActiveTenantGuard)
@Controller('finance')
export class FinanceController {
    constructor(
        private readonly financeService: FinanceService,
        private readonly readService: FinanceReadService,
        private readonly costProfileService: FinanceCostProfileService,
        private readonly snapshotService: FinanceSnapshotService,
        private readonly prisma: PrismaService,
    ) {}

    // ─── Read ────────────────────────────────────────────────────────

    @Get('unit-economics')
    async listUnitEconomics(
        @Req() req: any,
        @Query('search') search?: string,
        @Query('incompleteOnly') incompleteOnly?: string,
    ) {
        return this.readService.listUnitEconomics(req.activeTenantId, {
            search,
            incompleteOnly: incompleteOnly === 'true',
        });
    }

    @Get('unit-economics/legacy')
    async legacyUnitEconomics(@Req() req: any, @Query('productId') productId?: string) {
        // Backward-compat: текущий UnitEconomics.tsx ходит сюда. После
        // TASK_FINANCE_5 (frontend rewrite) этот endpoint можно удалить.
        return this.financeService.calculateUnitEconomics(req.activeTenantId, productId);
    }

    @Get('unit-economics/:productId')
    async getProductDetail(@Req() req: any, @Param('productId') productId: string) {
        return this.readService.getProductDetail(req.activeTenantId, productId);
    }

    @Get('dashboard')
    async getDashboard(@Req() req: any) {
        return this.readService.getDashboard(req.activeTenantId);
    }

    @Get('snapshots/status')
    async getStatus(@Req() req: any) {
        return this.snapshotService.getStatus(req.activeTenantId);
    }

    @Get('warnings')
    async listWarnings(@Req() req: any) {
        return this.readService.listActiveWarnings(req.activeTenantId);
    }

    // ─── Write ───────────────────────────────────────────────────────

    @Patch('products/:productId/cost')
    @UseGuards(TenantWriteGuard)
    async updateProductCost(
        @Req() req: any,
        @Param('productId') productId: string,
        @Body() dto: UpdateProductCostDto,
    ) {
        return this.costProfileService.updateProductCost({
            tenantId: req.activeTenantId,
            productId,
            actorUserId: req.user?.id,
            input: {
                baseCost: dto.baseCost,
                packagingCost: dto.packagingCost,
                additionalCost: dto.additionalCost,
                costCurrency: dto.costCurrency,
            },
        });
    }

    @Post('snapshots/rebuild')
    @UseGuards(TenantWriteGuard)
    async rebuildSnapshot(@Req() req: any, @Body() dto: RebuildSnapshotDto) {
        // Role check для rebuild (Owner/Admin) — делаем через membership
        // lookup, как и в OrdersReprocessService. Сервис сам role не
        // проверяет — это endpoint-level политика.
        await this._assertOwnerOrAdmin(req.activeTenantId, req.user?.id);

        return this.snapshotService.rebuild({
            tenantId: req.activeTenantId,
            periodFrom: new Date(dto.periodFrom),
            periodTo: new Date(dto.periodTo),
            periodType: dto.periodType,
            requestedBy: req.user?.id ?? null,
            jobKey: dto.jobKey ?? null,
        });
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
