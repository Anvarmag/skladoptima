import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service';
import { ActionType } from '@prisma/client';

@Controller('audit')
export class AuditController {
    constructor(private readonly auditService: AuditService) { }

    @Get()
    async getLogs(
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('actionType') actionType?: ActionType,
        @Query('search') search?: string,
    ) {
        return this.auditService.getLogs(
            page ? parseInt(page, 10) : 1,
            limit ? parseInt(limit, 10) : 20,
            actionType,
            search,
        );
    }
}
