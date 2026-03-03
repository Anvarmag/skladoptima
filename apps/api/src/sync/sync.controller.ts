import { Controller, Post, Get, Param } from '@nestjs/common';
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
    getOrders() {
        return (this.syncService as any).prisma.marketplaceOrder.findMany({
            orderBy: [
                { marketplaceCreatedAt: { sort: 'desc', nulls: 'last' } },
                { createdAt: 'desc' }
            ],
            take: 100
        });
    }

    @Post('metadata')
    syncMetadata() {
        return this.syncService.syncProductMetadata();
    }
}
