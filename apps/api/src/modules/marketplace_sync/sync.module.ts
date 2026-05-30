import { Module, forwardRef } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { SyncRunsModule } from '../sync-runs/sync-runs.module';
import { OrdersModule } from '../orders/orders.module';
import { AuditModule } from '../audit/audit.module';
import { StockLocksModule } from '../stock-locks/stock-locks.module';
import { MarketplaceAccountsModule } from '../marketplace-accounts/marketplace-accounts.module';

@Module({
    // SyncRunsModule поставляет SyncPreflightService — единый policy guard
    // для legacy poll loop и manual API (TASK_SYNC_3).
    // OrdersModule поставляет OrdersIngestionService — dual-write адаптер
    // в новый orders domain (TASK_ORDERS_2). Legacy `MarketplaceOrder`
    // продолжает писаться рядом до TASK_ORDERS_5+ (когда читатели
    // переключатся на доменную модель).
    // StockLocksModule поставляет StockLocksService для batch-lookup блокировок
    // в push_stocks pipeline (TASK_CHANNEL_3).
    // MarketplaceAccountsModule поставляет CredentialsCipher для декодирования
    // analyticsToken при маршрутизации WB API-вызовов (TASK_8).
    imports: [PrismaModule, SyncRunsModule, OrdersModule, AuditModule, StockLocksModule, forwardRef(() => MarketplaceAccountsModule)],
    providers: [SyncService],
    controllers: [SyncController],
    exports: [SyncService],
})
export class SyncModule { }
