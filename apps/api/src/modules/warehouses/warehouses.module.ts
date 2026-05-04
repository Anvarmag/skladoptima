import { Module } from '@nestjs/common';
import { WarehouseSyncService } from './warehouse-sync.service';
import { WarehouseService } from './warehouse.service';
import { WarehouseController } from './warehouse.controller';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';

@Module({
    imports: [MarketplaceAccountsModule],
    providers: [WarehouseSyncService, WarehouseService],
    controllers: [WarehouseController],
    exports: [WarehouseSyncService, WarehouseService],
})
export class WarehousesModule {}
