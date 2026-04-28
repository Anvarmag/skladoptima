import {
    Controller,
    Get,
    Post,
    Patch,
    Body,
    Param,
    Query,
    Req,
    UseGuards,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';
import { UpdateThresholdDto } from './dto/update-threshold.dto';
import { ReconcileDto } from './dto/reconcile.dto';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';
import { TenantWriteGuard } from '../tenants/guards/tenant-write.guard';
import { StockMovementType, InventoryEffectStatus, InventoryEffectType } from '@prisma/client';

@UseGuards(RequireActiveTenantGuard)
@Controller('inventory')
export class InventoryController {
    constructor(private readonly inventoryService: InventoryService) {}

    // GET /inventory/stocks — список товаров с агрегированным балансом
    @Get('stocks')
    listStocks(
        @Req() req: any,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('search') search?: string,
    ) {
        return this.inventoryService.listStocks(req.activeTenantId, {
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
            search,
        });
    }

    // GET /inventory/stocks/:productId — детализация по складам/каналам
    @Get('stocks/:productId')
    getStockDetail(@Param('productId') productId: string, @Req() req: any) {
        return this.inventoryService.getStockDetail(req.activeTenantId, productId);
    }

    // GET /inventory/stocks/:productId/effective-available — sync handoff contract.
    // Возвращает effective available qty (только FBS-контур), отметку pushAllowed
    // и accessState. Это единственный legitimate источник для push в каналы.
    @Get('stocks/:productId/effective-available')
    getEffectiveAvailable(@Param('productId') productId: string, @Req() req: any) {
        return this.inventoryService.computeEffectiveAvailable(req.activeTenantId, productId);
    }

    // POST /inventory/adjustments — manual-корректировка остатка
    @Post('adjustments')
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.CREATED)
    createAdjustment(@Body() dto: CreateAdjustmentDto, @Req() req: any) {
        return this.inventoryService.createAdjustment(
            req.activeTenantId,
            req.user.email,
            req.user.id ?? null,
            dto,
        );
    }

    // GET /inventory/movements — история движений (с фильтрами)
    @Get('movements')
    listMovements(
        @Req() req: any,
        @Query('productId') productId?: string,
        @Query('movementType') movementType?: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.inventoryService.listMovements(req.activeTenantId, {
            productId,
            movementType: movementType as StockMovementType | undefined,
            from: from ? new Date(from) : undefined,
            to: to ? new Date(to) : undefined,
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
    }

    // GET /inventory/low-stock — товары с available <= threshold
    @Get('low-stock')
    listLowStock(@Req() req: any, @Query('threshold') threshold?: string) {
        const override = threshold !== undefined ? parseInt(threshold, 10) : undefined;
        return this.inventoryService.listLowStock(req.activeTenantId, override);
    }

    // GET /inventory/settings — текущие inventory settings (low-stock threshold)
    @Get('settings')
    getSettings(@Req() req: any) {
        return this.inventoryService.getSettings(req.activeTenantId);
    }

    // PATCH /inventory/settings/threshold — обновить low-stock threshold
    @Patch('settings/threshold')
    @UseGuards(TenantWriteGuard)
    updateThreshold(@Body() dto: UpdateThresholdDto, @Req() req: any) {
        return this.inventoryService.updateThreshold(
            req.activeTenantId,
            dto.lowStockThreshold,
            req.user.email,
        );
    }

    // POST /inventory/reconcile — сравнение внешнего snapshot с локальным available.
    // Использует TenantWriteGuard, потому что записывает CONFLICT_DETECTED movement.
    @Post('reconcile')
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.OK)
    reconcile(@Body() dto: ReconcileDto, @Req() req: any) {
        return this.inventoryService.reconcile(
            req.activeTenantId,
            dto.sourceEventId,
            {
                productId: dto.productId,
                warehouseId: dto.warehouseId,
                externalAvailable: dto.externalAvailable,
                externalEventAt: dto.externalEventAt ? new Date(dto.externalEventAt) : undefined,
            },
            { reasonCode: dto.reasonCode },
        );
    }

    // GET /inventory/effect-locks — диагностика idempotency lock'ов
    @Get('effect-locks')
    listEffectLocks(
        @Req() req: any,
        @Query('status') status?: string,
        @Query('effectType') effectType?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.inventoryService.listEffectLocks(req.activeTenantId, {
            status: status as InventoryEffectStatus | undefined,
            effectType: effectType as InventoryEffectType | undefined,
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
    }

    // GET /inventory/diagnostics — сводный observability отчёт за 24h
    @Get('diagnostics')
    getDiagnostics(@Req() req: any) {
        return this.inventoryService.getDiagnostics(req.activeTenantId);
    }

    // GET /inventory/conflicts — alias на listMovements с movementType=CONFLICT_DETECTED
    @Get('conflicts')
    listConflicts(
        @Req() req: any,
        @Query('productId') productId?: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.inventoryService.listMovements(req.activeTenantId, {
            productId,
            movementType: StockMovementType.CONFLICT_DETECTED,
            from: from ? new Date(from) : undefined,
            to: to ? new Date(to) : undefined,
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
    }
}
