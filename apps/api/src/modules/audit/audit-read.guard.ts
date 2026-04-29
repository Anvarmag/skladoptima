import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Guard for audit read endpoints.
 *
 * Unlike RequireActiveTenantGuard, this guard allows access even when the tenant
 * is in TRIAL_EXPIRED / SUSPENDED / CLOSED state — audit trail must remain readable
 * for compliance and investigation purposes (system-analytics §4, scenario 4).
 *
 * Resolution order for tenantId:
 *   1. X-Tenant-Id header (required for closed/suspended tenants where activeTenantId is null)
 *   2. request.activeTenantId set by the global ActiveTenantGuard
 */
@Injectable()
export class AuditReadGuard implements CanActivate {
    private readonly logger = new Logger(AuditReadGuard.name);

    constructor(private readonly prisma: PrismaService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (!user?.id) {
            throw new ForbiddenException({ code: 'AUDIT_ACCESS_DENIED' });
        }

        const tenantId: string | undefined =
            (request.headers['x-tenant-id'] as string | undefined) ?? request.activeTenantId ?? undefined;

        if (!tenantId) {
            throw new ForbiddenException({ code: 'TENANT_CONTEXT_REQUIRED' });
        }

        // Membership check only — tenant status is intentionally NOT checked here
        const membership = await this.prisma.membership.findFirst({
            where: { tenantId, userId: user.id, status: 'ACTIVE' },
            select: { id: true },
        });

        if (!membership) {
            this.logger.warn(
                JSON.stringify({ event: 'audit_read_denied', userId: user.id, tenantId, ts: new Date().toISOString() }),
            );
            throw new ForbiddenException({ code: 'AUDIT_ACCESS_DENIED' });
        }

        // Override activeTenantId — allows subsequent RBAC check inside the service
        // even when the tenant is CLOSED/SUSPENDED (where ActiveTenantGuard set it to null).
        request.activeTenantId = tenantId;
        return true;
    }
}
