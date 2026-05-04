import { Controller, Post, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { SyncService } from './sync.service';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';
import { TenantWriteGuard } from '../tenants/guards/tenant-write.guard';

@UseGuards(RequireActiveTenantGuard)
@Controller('sync')
export class SyncController {
    constructor(private readonly syncService: SyncService) { }

    @Post('product/:id')
    @UseGuards(TenantWriteGuard)
    syncProduct(@Param('id') id: string, @Req() req: any) {
        return this.syncService.syncProductToMarketplaces(id, req.activeTenantId);
    }

    @Post('test/wb')
    @UseGuards(TenantWriteGuard)
    testWb(@Req() req: any) {
        return this.syncService.testWbConnection(req.activeTenantId);
    }

    @Post('test/ozon')
    @UseGuards(TenantWriteGuard)
    testOzon(@Req() req: any) {
        return this.syncService.testOzonConnection(req.activeTenantId);
    }

    @Get('wb/stocks')
    getWbStocks(@Req() req: any) {
        return this.syncService.fetchWbStocks(req.activeTenantId);
    }

    @Get('wb/warehouses')
    getWbWarehouses(@Req() req: any) {
        return this.syncService.fetchWbWarehouses(req.activeTenantId);
    }

    @Post('pull/wb')
    @UseGuards(TenantWriteGuard)
    pullFromWb(@Req() req: any) {
        return this.syncService.pullFromWb(req.activeTenantId);
    }

    @Post('pull/ozon')
    @UseGuards(TenantWriteGuard)
    pullFromOzon(@Req() req: any) {
        return this.syncService.pullFromOzon(req.activeTenantId);
    }

    @Get('orders')
    getOrders(@Req() req: any, @Query() query: any) {
        return this.syncService.getMarketplaceOrders(req.activeTenantId, query);
    }

    @Post('orders/poll')
    @UseGuards(TenantWriteGuard)
    pollOrders(@Req() req: any) {
        return this.syncService.forcePollOrders(req.activeTenantId);
    }

    @Get('order/:id/details')
    getOrderDetails(@Param('id') id: string, @Req() req: any) {
        return this.syncService.getOrderDetails(id, req.activeTenantId);
    }

    @Post('metadata')
    @UseGuards(TenantWriteGuard)
    syncMetadata(@Req() req: any) {
        return this.syncService.syncProductMetadata(req.activeTenantId);
    }

    @Post('full-sync')
    @UseGuards(TenantWriteGuard)
    fullSync(@Req() req: any) {
        return this.syncService.fullSync(req.activeTenantId);
    }

    @Post('pull/wb-finances')
    @UseGuards(TenantWriteGuard)
    pullWbFinances(@Req() req: any, @Query('days') days?: string) {
        const daysNum = days ? parseInt(days, 10) : 30;
        return this.syncService.pullWbFinances(req.activeTenantId, daysNum);
    }

    @Post('import/wb')
    @UseGuards(TenantWriteGuard)
    importFromWb(@Req() req: any) {
        return this.syncService.importProductsFromWb(req.activeTenantId);
    }
}
