import { Module } from '@nestjs/common';
import { StockLocksService } from './stock-locks.service';
import { StockLocksController } from './stock-locks.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
    imports: [AuditModule],
    providers: [StockLocksService],
    controllers: [StockLocksController],
    exports: [StockLocksService],
})
export class StockLocksModule {}
