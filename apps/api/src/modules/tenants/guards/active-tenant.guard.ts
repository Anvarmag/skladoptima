import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../../auth/public.decorator';
import { SKIP_TENANT_GUARD_KEY } from '../decorators/skip-tenant-guard.decorator';

@Injectable()
export class ActiveTenantGuard implements CanActivate {
    private readonly logger = new Logger(ActiveTenantGuard.name);

    constructor(
        private readonly reflector: Reflector,
        private readonly prisma: PrismaService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (isPublic) return true;

        const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_GUARD_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (skip) return true;

        const request = context.switchToHttp().getRequest();
        const user = request.user;
        if (!user) return true;

        const tenantIdHint: string | undefined = request.headers['x-tenant-id'];

        if (tenantIdHint) {
            await this.resolveStrict(request, user.id, tenantIdHint);
        } else {
            // Если JWT содержит валидный activeTenantId (membershipVersion совпал в JwtStrategy),
            // используем его напрямую — экономим DB-запрос к UserPreference.
            const jwtTenantId: string | null | undefined = (user as any).activeTenantId;

            if (jwtTenantId !== undefined) {
                if (jwtTenantId) {
                    await this.resolveSoft(request, user.id, jwtTenantId);
                } else {
                    request.activeTenantId = null;
                }
            } else {
                const pref = await this.prisma.userPreference.findUnique({
                    where: { userId: user.id },
                    select: { lastUsedTenantId: true },
                });
                if (pref?.lastUsedTenantId) {
                    await this.resolveSoft(request, user.id, pref.lastUsedTenantId);
                } else {
                    request.activeTenantId = null;
                }
            }
        }

        return true;
    }

    // Клиент явно указал X-Tenant-Id — нет доступа → ошибка
    private async resolveStrict(request: any, userId: string, tenantId: string): Promise<void> {
        const membership = await this.prisma.membership.findFirst({
            where: { userId, tenantId, status: 'ACTIVE' },
            select: { tenant: { select: { status: true, accessState: true } } },
        });

        if (!membership) {
            this.logger.warn(JSON.stringify({ event: 'cross_tenant_access_denied', userId, tenantId, reason: 'NO_MEMBERSHIP', ts: new Date().toISOString() }));
            throw new ForbiddenException({ code: 'TENANT_ACCESS_DENIED' });
        }

        if (membership.tenant.status === 'CLOSED' || membership.tenant.accessState === 'CLOSED') {
            this.logger.warn(JSON.stringify({ event: 'cross_tenant_access_denied', userId, tenantId, reason: 'TENANT_CLOSED', ts: new Date().toISOString() }));
            throw new ForbiddenException({ code: 'TENANT_CLOSED' });
        }

        request.activeTenantId = tenantId;
        request.activeTenant = { id: tenantId, status: membership.tenant.status, accessState: membership.tenant.accessState };
    }

    // Автовыбор из preference — если нет доступа, тихо сбрасываем (клиент покажет picker)
    private async resolveSoft(request: any, userId: string, tenantId: string): Promise<void> {
        const membership = await this.prisma.membership.findFirst({
            where: { userId, tenantId, status: 'ACTIVE' },
            select: { tenant: { select: { status: true, accessState: true } } },
        });

        if (
            !membership ||
            membership.tenant.status === 'CLOSED' ||
            membership.tenant.accessState === 'CLOSED'
        ) {
            request.activeTenantId = null;
            request.activeTenant = null;
            return;
        }

        request.activeTenantId = tenantId;
        request.activeTenant = { id: tenantId, status: membership.tenant.status, accessState: membership.tenant.accessState };
    }
}
