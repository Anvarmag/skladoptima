import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SyncRunsModule } from '../sync-runs/sync-runs.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrdersIngestionService } from './orders-ingestion.service';
import { OrderStatusMapperService } from './order-status-mapper.service';
import { OrderInventoryEffectsService } from './order-inventory-effects.service';
import { OrdersReadService } from './orders-read.service';
import { OrdersReprocessService } from './orders-reprocess.service';
import { OrdersController } from './orders.controller';
import { OrdersMetricsRegistry } from './orders.metrics';

/**
 * Orders domain module (10-orders).
 *
 * TASK_ORDERS_2: ingestion-сервис.
 * TASK_ORDERS_3: status mapper + state machine guard.
 * TASK_ORDERS_4: inventory side-effects (reserve/release/deduct/return).
 * TASK_ORDERS_5: REST API (`GET /orders`, `GET /orders/:id`,
 *                 `GET /orders/:id/timeline`, `POST /orders/:id/reprocess`).
 *
 * `SyncRunsModule` импортируется ради `SyncPreflightService` — он
 * проверяет tenant/account state перед приёмом каждого внешнего event'а
 * (§4 сценарий 4: paused integration не должна создавать обходных
 * side-effects).
 *
 * `InventoryModule` импортируется ради `InventoryService.reserve/release/
 * deduct/logReturn` — единственная точка, через которую orders могут
 * менять stock (§5: orders не источник истины по складу, а триггер
 * управляемых движений).
 */
@Module({
    imports: [PrismaModule, SyncRunsModule, InventoryModule],
    providers: [
        OrdersIngestionService,
        OrderStatusMapperService,
        OrderInventoryEffectsService,
        OrdersReadService,
        OrdersReprocessService,
        OrdersMetricsRegistry,
    ],
    controllers: [OrdersController],
    exports: [
        OrdersIngestionService,
        OrderStatusMapperService,
        OrderInventoryEffectsService,
        OrdersMetricsRegistry,
    ],
})
export class OrdersModule {}
