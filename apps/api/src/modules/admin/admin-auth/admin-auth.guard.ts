import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupportUserRole } from '@prisma/client';
import { CsrfService } from '../../auth/csrf.service';
import { AdminAuthService } from './admin-auth.service';
import { ADMIN_ROLES_KEY } from './decorators/admin-roles.decorator';
import { IS_ADMIN_PUBLIC_KEY } from './decorators/admin-public.decorator';
import { AdminMetricNames, AdminMetricsRegistry } from '../admin.metrics';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const ACCESS_COOKIE = 'AdminAuthentication';
const CSRF_COOKIE = 'admin-csrf-token';
const CSRF_HEADER = 'x-admin-csrf-token';

@Injectable()
export class AdminAuthGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly adminAuthService: AdminAuthService,
        private readonly csrfService: CsrfService,
        private readonly metrics: AdminMetricsRegistry,
    ) {}

    async canActivate(ctx: ExecutionContext): Promise<boolean> {
        const req = ctx.switchToHttp().getRequest();
        const isAdminPublic = this.reflector.getAllAndOverride<boolean>(
            IS_ADMIN_PUBLIC_KEY,
            [ctx.getHandler(), ctx.getClass()],
        );

        // CSRF (double-submit) — обязателен для unsafe методов даже на
        // admin-public endpoints (login/refresh), кроме GET csrf-token.
        if (!SAFE_METHODS.includes(req.method)) {
            const cookieToken = req.cookies?.[CSRF_COOKIE] as string | undefined;
            const headerToken = req.headers[CSRF_HEADER] as string | undefined;
            if (!this.csrfService.validateToken(cookieToken, headerToken)) {
                throw new ForbiddenException({ code: 'ADMIN_CSRF_TOKEN_INVALID' });
            }
        }

        if (isAdminPublic) return true;

        // JWT из cookie или Authorization header
        const cookieToken = req.cookies?.[ACCESS_COOKIE] as string | undefined;
        const headerAuth = req.headers['authorization'] as string | undefined;
        const bearer = headerAuth?.startsWith('Bearer ')
            ? headerAuth.slice('Bearer '.length)
            : undefined;
        const rawToken = cookieToken ?? bearer;

        if (!rawToken) {
            throw new UnauthorizedException({ code: 'ADMIN_AUTH_REQUIRED' });
        }

        const payload = await this.adminAuthService.validateAccessToken(rawToken);
        if (!payload) {
            throw new UnauthorizedException({ code: 'ADMIN_AUTH_REQUIRED' });
        }

        // RBAC: если @AdminRoles не указан — требуем любую активную роль
        // (login уже отсек !isActive). Mutating actions ОБЯЗАНЫ
        // явно объявлять @AdminRoles('SUPPORT_ADMIN').
        const requiredRoles = this.reflector.getAllAndOverride<SupportUserRole[] | undefined>(
            ADMIN_ROLES_KEY,
            [ctx.getHandler(), ctx.getClass()],
        );

        if (requiredRoles && requiredRoles.length > 0) {
            if (!requiredRoles.includes(payload.role)) {
                await this.adminAuthService.writeSecurityEvent(
                    'admin_rbac_denied',
                    payload.sub,
                    (req.ip as string) ?? null,
                    (req.headers['user-agent'] as string) ?? null,
                    {
                        sessionId: payload.sessionId,
                        actorRole: payload.role,
                        requiredRoles,
                        method: req.method,
                        path: req.originalUrl ?? req.url,
                    },
                );
                this.metrics.increment(AdminMetricNames.DENIED_ATTEMPTS, {
                    supportUserId: payload.sub,
                    role: payload.role,
                    reason:
                        requiredRoles.length === 1 && requiredRoles[0] === 'SUPPORT_ADMIN'
                            ? 'FORBIDDEN_SUPPORT_ADMIN_REQUIRED'
                            : 'FORBIDDEN_SUPPORT_ROLE_REQUIRED',
                });
                throw new ForbiddenException({
                    code:
                        requiredRoles.length === 1 && requiredRoles[0] === 'SUPPORT_ADMIN'
                            ? 'FORBIDDEN_SUPPORT_ADMIN_REQUIRED'
                            : 'FORBIDDEN_SUPPORT_ROLE_REQUIRED',
                });
            }
        }

        req.supportUser = {
            id: payload.sub,
            email: '', // email не нужен для большинства handlers; service резолвит при необходимости
            role: payload.role,
            sessionId: payload.sessionId,
        };
        return true;
    }
}
