import { Module } from '@nestjs/common';
import { WarehouseSyncService } from './warehouse-sync.service';
import { WarehouseService } from './warehouse.service';
import { WarehouseController } from './warehouse.controller';

@Module({
    providers: [WarehouseSyncService, WarehouseService],
    controllers: [WarehouseController],
    exports: [WarehouseSyncService, WarehouseService],
})
export class WarehousesModule {}
