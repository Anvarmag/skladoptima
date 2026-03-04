import { Controller, Post, Get, Param, Query } from '@nestjs/common';
import { SyncService } from './sync.service';

@Controller('sync')
export class SyncController {
    constructor(private readonly syncService: SyncService) { }

    @Post('product/:id')
    syncProduct(@Param('id') id: string) {
        return this.syncService.syncProductToMarketplaces(id);
    }

    @Post('test/wb')
    testWb() {
        return this.syncService.testWbConnection();
    }

    @Post('test/ozon')
    testOzon() {
        return this.syncService.testOzonConnection();
    }

    // Временный endpoint — посмотреть текущие остатки на складе WB
    @Get('wb/stocks')
    getWbStocks() {
        return this.syncService.fetchWbStocks();
    }

    @Get('wb/warehouses')
    getWbWarehouses() {
        return this.syncService.fetchWbWarehouses();
    }

    @Post('pull/wb')
    pullFromWb() {
        return this.syncService.pullFromWb();
    }

    @Get('orders')
    getOrders(@Query() query: any) {
        return this.syncService.getMarketplaceOrders(query);
    }

    @Post('orders/poll')
    pollOrders() {
        return this.syncService.forcePollOrders();
    }

    @Get('order/:id/details')
    getOrderDetails(@Param('id') id: string) {
        return this.syncService.getOrderDetails(id);
    }

    @Post('metadata')
    syncMetadata() {
        return this.syncService.syncProductMetadata();
    }
}
