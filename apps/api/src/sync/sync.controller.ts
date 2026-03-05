import { Controller, Post, Get, Param, Query, Req } from '@nestjs/common';
import { SyncService } from './sync.service';

@Controller('sync')
export class SyncController {
    constructor(private readonly syncService: SyncService) { }

    @Post('product/:id')
    syncProduct(@Param('id') id: string, @Req() req: any) {
        return this.syncService.syncProductToMarketplaces(id, req.user.storeId);
    }

    @Post('test/wb')
    testWb(@Req() req: any) {
        return this.syncService.testWbConnection(req.user.storeId);
    }

    @Post('test/ozon')
    testOzon(@Req() req: any) {
        return this.syncService.testOzonConnection(req.user.storeId);
    }

    // Временный endpoint — посмотреть текущие остатки на складе WB
    @Get('wb/stocks')
    getWbStocks(@Req() req: any) {
        return this.syncService.fetchWbStocks(req.user.storeId);
    }

    @Get('wb/warehouses')
    getWbWarehouses(@Req() req: any) {
        return this.syncService.fetchWbWarehouses(req.user.storeId);
    }

    @Post('pull/wb')
    pullFromWb(@Req() req: any) {
        return this.syncService.pullFromWb(req.user.storeId);
    }

    @Get('orders')
    getOrders(@Req() req: any, @Query() query: any) {
        return this.syncService.getMarketplaceOrders(req.user.storeId, query);
    }

    @Post('orders/poll')
    pollOrders(@Req() req: any) {
        return this.syncService.forcePollOrders(req.user.storeId);
    }

    @Get('order/:id/details')
    getOrderDetails(@Param('id') id: string, @Req() req: any) {
        return this.syncService.getOrderDetails(id, req.user.storeId);
    }

    @Post('metadata')
    syncMetadata(@Req() req: any) {
        return this.syncService.syncProductMetadata(req.user.storeId);
    }
}
