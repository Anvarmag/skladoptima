import { BadRequestException, Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { AdminEndpoint } from '../admin-auth/decorators/admin-endpoint.decorator';
import { TenantSummaryService } from './tenant-summary.service';
import { AdminMetricsRegistry, AdminMetricNames } from '../admin.metrics';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/// GET /api/admin/tenants/:tenantId — tenant 360. Доступ обоим support
/// ролям (READONLY/ADMIN), потому что это диагностическое чтение.
/// Mutating actions поверх tenant 360 живут на отдельных controllers (T4).
@AdminEndpoint()
@UseGuards(AdminAuthGuard)
@Controller('admin/tenants')
export class Tenant360Controller {
    constructor(
        private readonly summary: TenantSummaryService,
        private readonly metrics: AdminMetricsRegistry,
    ) {}

    @Get(':tenantId')
    async get(@Param('tenantId') tenantId: string, @Req() req: Request) {
        if (!UUID_RE.test(tenantId)) {
            throw new BadRequestException({ code: 'ADMIN_TENANT_ID_INVALID' });
        }
        const supportUser = (req as any).supportUser;
        const startedAt = Date.now();
        this.metrics.increment(AdminMetricNames.TENANT_CARDS_OPENED, {
            supportUserId: supportUser?.id,
            role: supportUser?.role,
        });
        try {
            return await this.summary.getTenant360(tenantId);
        } finally {
            this.metrics.observeTenantCardLatency(Date.now() - startedAt);
        }
    }
}
