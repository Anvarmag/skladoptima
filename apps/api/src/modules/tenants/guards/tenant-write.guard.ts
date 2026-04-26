import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';

const WRITE_BLOCKED = new Set(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED']);

@Injectable()
export class TenantWriteGuard implements CanActivate {
    private readonly logger = new Logger(TenantWriteGuard.name);

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const state: string | undefined = request.activeTenant?.accessState;

        if (state && WRITE_BLOCKED.has(state)) {
            const userId = request.user?.id ?? 'unknown';
            const tenantId = request.activeTenantId ?? 'unknown';
            this.logger.warn(JSON.stringify({ event: 'tenant_write_blocked', userId, tenantId, accessState: state, path: request.url, ts: new Date().toISOString() }));
            throw new ForbiddenException({ code: 'TENANT_WRITE_BLOCKED', accessState: state });
        }
        return true;
    }
}
