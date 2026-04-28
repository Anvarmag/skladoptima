import {
    Controller,
    Get,
    Patch,
    Post,
    Body,
    Param,
    Query,
    Req,
    UseGuards,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import { WarehouseSyncService } from './warehouse-sync.service';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';
import { TenantWriteGuard } from '../tenants/guards/tenant-write.guard';
import {
    WarehouseStatus,
    WarehouseType,
    WarehouseSourceMarketplace,
} from '@prisma/client';
import type { ListWarehousesQuery } from './dto/list-warehouses.query';
import { UpdateMetadataDto } from './dto/update-metadata.dto';

@UseGuards(RequireActiveTenantGuard)
@Controller('warehouses')
export class WarehouseController {
    constructor(
        private readonly warehouseService: WarehouseService,
        private readonly warehouseSyncService: WarehouseSyncService,
    ) {}

    // GET /warehouses — справочник tenant с фильтрами
    @Get()
    list(@Req() req: any, @Query() q: ListWarehousesQuery) {
        return this.warehouseService.list(req.activeTenantId, {
            page: q.page ? parseInt(q.page, 10) : undefined,
            limit: q.limit ? parseInt(q.limit, 10) : undefined,
            marketplaceAccountId: q.marketplaceAccountId,
            sourceMarketplace: this._asEnum(q.sourceMarketplace, WarehouseSourceMarketplace),
            warehouseType: this._asEnum(q.warehouseType, WarehouseType),
            status: this._asEnum(q.status, WarehouseStatus),
            search: q.search,
        });
    }

    // GET /warehouses/:id — карточка склада
    @Get(':id')
    getById(@Param('id') id: string, @Req() req: any) {
        return this.warehouseService.getById(req.activeTenantId, id);
    }

    // GET /warehouses/:id/stocks — остатки по складу
    @Get(':id/stocks')
    getStocks(@Param('id') id: string, @Req() req: any) {
        return this.warehouseService.getStocks(req.activeTenantId, id);
    }

    // POST /warehouses/sync — ручной refresh всех аккаунтов tenant'а.
    // TenantWriteGuard блокирует при TRIAL_EXPIRED/SUSPENDED/CLOSED → 403.
    // Дополнительно service делает свою проверку — defense-in-depth.
    @Post('sync')
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.OK)
    sync(@Req() req: any) {
        return this.warehouseSyncService.syncAllForTenant(req.activeTenantId);
    }

    // POST /warehouses/sync/account/:accountId — ручной refresh одного аккаунта.
    @Post('sync/account/:accountId')
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.OK)
    syncAccount(@Param('accountId') accountId: string) {
        return this.warehouseSyncService.syncForAccount(accountId);
    }

    // PATCH /warehouses/:id/metadata — единственный write-путь:
    // обновление tenant-local полей aliasName и labels.
    // TenantWriteGuard блокирует write при TRIAL_EXPIRED/SUSPENDED/CLOSED.
    @Patch(':id/metadata')
    @UseGuards(TenantWriteGuard)
    updateMetadata(
        @Param('id') id: string,
        @Body() dto: UpdateMetadataDto,
        @Req() req: any,
    ) {
        return this.warehouseService.updateMetadata(
            req.activeTenantId,
            id,
            req.user?.id ?? null,
            dto,
        );
    }

    private _asEnum<E extends Record<string, string>>(value: string | undefined, e: E): E[keyof E] | undefined {
        if (!value) return undefined;
        const upper = String(value).toUpperCase();
        return (Object.values(e) as string[]).includes(upper) ? (upper as E[keyof E]) : undefined;
    }
}
