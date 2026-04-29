import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { AdminEndpoint } from '../admin-auth/decorators/admin-endpoint.decorator';
import { TenantDirectoryService } from './tenant-directory.service';
import { ListTenantsDto } from './dto/list-tenants.dto';
import { AdminMetricsRegistry, AdminMetricNames } from '../admin.metrics';

/// GET /api/admin/tenants — справочник tenant для support.
/// Без @AdminRoles — оба support-режима (READONLY/ADMIN) видят directory.
/// Mutating поверх него (T4) живут на отдельных controllers с
/// `@AdminRoles('SUPPORT_ADMIN')`.
@AdminEndpoint()
@UseGuards(AdminAuthGuard)
@Controller('admin/tenants')
export class TenantDirectoryController {
    constructor(
        private readonly directory: TenantDirectoryService,
        private readonly metrics: AdminMetricsRegistry,
    ) {}

    @Get()
    async list(@Query() dto: ListTenantsDto, @Req() req: Request) {
        const supportUser = (req as any).supportUser;
        this.metrics.increment(AdminMetricNames.ADMIN_SEARCHES, {
            supportUserId: supportUser?.id,
            role: supportUser?.role,
        });
        return this.directory.list(dto);
    }
}
