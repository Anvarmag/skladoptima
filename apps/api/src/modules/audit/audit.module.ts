import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditReadGuard } from './audit-read.guard';

@Module({
    providers: [AuditService, AuditReadGuard],
    controllers: [AuditController],
    exports: [AuditService],
})
export class AuditModule { }
