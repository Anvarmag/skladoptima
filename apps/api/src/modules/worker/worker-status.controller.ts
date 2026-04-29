import { Controller, Get, Req, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { WorkerService } from './worker.service';

/**
 * Tenant-facing product status surface (§7 system-analytics).
 * JWT-authenticated — no @Public() — so JwtAuthGuard applies automatically.
 * Exposes only product-friendly status labels; raw job internals are filtered
 * inside WorkerService.getProductStatus().
 *
 * Deliberately a separate controller from WorkerController so the internal
 * x-internal-secret console and the tenant surface have distinct auth models.
 */
@Controller('worker')
export class WorkerStatusController {
    constructor(private readonly workerService: WorkerService) {}

    /**
     * GET /worker/status
     * Returns product-specific operation statuses for the authenticated tenant.
     * Shows: SYNC (sync_running / sync_failed / …), NOTIFICATION, FILE_CLEANUP.
     * Never returns: AUDIT_MAINTENANCE, raw payload, lastError, lease info.
     */
    @Get('status')
    async getStatus(@Req() req: Request & { user?: any }) {
        const tenantId: string | undefined = (req.user as any)?.activeTenantId;
        if (!tenantId) {
            throw new ForbiddenException({ code: 'TENANT_CONTEXT_REQUIRED' });
        }
        return this.workerService.getProductStatus(tenantId);
    }
}
