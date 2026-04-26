import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';

@Injectable()
export class RequireActiveTenantGuard implements CanActivate {
    private readonly logger = new Logger(RequireActiveTenantGuard.name);

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        if (!request.activeTenantId) {
            const userId = request.user?.id ?? 'unknown';
            this.logger.warn(JSON.stringify({ event: 'tenant_context_required', userId, path: request.url, ts: new Date().toISOString() }));
            throw new ForbiddenException({ code: 'TENANT_CONTEXT_REQUIRED' });
        }
        return true;
    }
}
