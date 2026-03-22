import { Controller, Post, Get, Param, Query, Req } from '@nestjs/common';
import { SyncService } from './sync.service';

@Controller('sync')
export class SyncController {
    constructor(private readonly syncService: SyncService) { }

    @Post('product/:id')
    syncProduct(@Param('id') id: string, @Req() req: any) {
        return this.syncService.syncProductToMarketplaces(id, req.user.tenantId);
    }

    @Post('test/wb')
    testWb(@Req() req: any) {
        return this.syncService.testWbConnection(req.user.tenantId);
    }

    @Post('test/ozon')
    testOzon(@Req() req: any) {
        return this.syncService.testOzonConnection(req.user.tenantId);
    }

    // Временный endpoint — посмотреть текущие остатки на складе WB
    @Get('wb/stocks')
    getWbStocks(@Req() req: any) {
        return this.syncService.fetchWbStocks(req.user.tenantId);
    }

    @Get('wb/warehouses')
    getWbWarehouses(@Req() req: any) {
        return this.syncService.fetchWbWarehouses(req.user.tenantId);
    }

    @Post('pull/wb')
    pullFromWb(@Req() req: any) {
        return this.syncService.pullFromWb(req.user.tenantId);
    }

    @Post('pull/ozon')
    pullFromOzon(@Req() req: any) {
        return this.syncService.pullFromOzon(req.user.tenantId);
    }

    @Get('orders')
    getOrders(@Req() req: any, @Query() query: any) {
        return this.syncService.getMarketplaceOrders(req.user.tenantId, query);
    }

    @Post('orders/poll')
    pollOrders(@Req() req: any) {
        return this.syncService.forcePollOrders(req.user.tenantId);
    }

    @Get('order/:id/details')
    getOrderDetails(@Param('id') id: string, @Req() req: any) {
        return this.syncService.getOrderDetails(id, req.user.tenantId);
    }

    @Post('metadata')
    syncMetadata(@Req() req: any) {
        return this.syncService.syncProductMetadata(req.user.tenantId);
    }

    @Post('full-sync')
    fullSync(@Req() req: any) {
        return this.syncService.fullSync(req.user.tenantId);
    }
}
