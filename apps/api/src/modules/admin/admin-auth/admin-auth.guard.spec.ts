/**
 * TASK_ADMIN_7: regression suite для `AdminAuthGuard`.
 *
 * Покрывает §15 security guardrails и §16 матрицу:
 *   - SUPPORT_READONLY НЕ имеет mutating endpoint'ов (@AdminRoles('SUPPORT_ADMIN') блокирует);
 *   - SUPPORT_ADMIN получает доступ к mutating endpoint'ам;
 *   - admin-public endpoints обходят JWT, но не CSRF на unsafe-методах;
 *   - CSRF double-submit обязателен для unsafe методов даже на public-маршрутах;
 *   - неверный JWT → ADMIN_AUTH_REQUIRED;
 *   - RBAC denied пишет support_security_events.admin_rbac_denied + counter.
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: {},
    SupportUserRole: {
        SUPPORT_ADMIN: 'SUPPORT_ADMIN',
        SUPPORT_READONLY: 'SUPPORT_READONLY',
    },
    SupportSecurityEventType: {
        admin_rbac_denied: 'admin_rbac_denied',
    },
}));

import { ForbiddenException, UnauthorizedException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import { CsrfService } from '../../auth/csrf.service';
import { AdminMetricNames, AdminMetricsRegistry } from '../admin.metrics';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReflectorWith(
    isPublic: boolean | undefined,
    requiredRoles: string[] | undefined,
) {
    return {
        getAllAndOverride: jest.fn((key: string) => {
            if (key === 'isAdminPublic') return isPublic;
            if (key === 'adminRoles') return requiredRoles;
            return undefined;
        }),
    } as unknown as Reflector;
}

function makeReq(opts: {
    method?: string;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
    ip?: string;
    url?: string;
}) {
    return {
        method: opts.method ?? 'POST',
        cookies: opts.cookies ?? {},
        headers: opts.headers ?? {},
        ip: opts.ip ?? '10.0.0.1',
        url: opts.url ?? '/api/admin/tenants/x/actions/extend-trial',
        originalUrl: opts.url ?? '/api/admin/tenants/x/actions/extend-trial',
    } as any;
}

function makeCtx(req: any): ExecutionContext {
    return {
        switchToHttp: () => ({ getRequest: () => req }),
        getHandler: () => () => undefined,
        getClass: () => function () {},
    } as any;
}

// Override decorator constants so reflector mock matches.
jest.mock('./decorators/admin-public.decorator', () => ({
    IS_ADMIN_PUBLIC_KEY: 'isAdminPublic',
}));
jest.mock('./decorators/admin-roles.decorator', () => ({
    ADMIN_ROLES_KEY: 'adminRoles',
}));

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('AdminAuthGuard', () => {
    let csrf: { validateToken: jest.Mock };
    let auth: {
        validateAccessToken: jest.Mock;
        writeSecurityEvent: jest.Mock;
    };
    let metrics: AdminMetricsRegistry;

    beforeEach(() => {
        csrf = { validateToken: jest.fn().mockReturnValue(true) };
        auth = {
            validateAccessToken: jest.fn(),
            writeSecurityEvent: jest.fn().mockResolvedValue(undefined),
        };
        metrics = new AdminMetricsRegistry();
    });

    function makeGuard(reflector: Reflector) {
        return new AdminAuthGuard(
            reflector,
            auth as unknown as AdminAuthService,
            csrf as unknown as CsrfService,
            metrics,
        );
    }

    describe('CSRF double-submit', () => {
        it('unsafe-метод без CSRF — ADMIN_CSRF_TOKEN_INVALID', async () => {
            csrf.validateToken.mockReturnValue(false);
            const guard = makeGuard(makeReflectorWith(false, ['SUPPORT_ADMIN']));
            const ctx = makeCtx(makeReq({ method: 'POST' }));

            await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
            expect(auth.validateAccessToken).not.toHaveBeenCalled();
        });

        it('GET-метод не требует CSRF', async () => {
            const guard = makeGuard(makeReflectorWith(false, undefined));
            auth.validateAccessToken.mockResolvedValue({
                sub: 'su-1', sessionId: 's1', role: 'SUPPORT_READONLY', aud: 'admin',
            });
            const ctx = makeCtx(
                makeReq({
                    method: 'GET',
                    cookies: { AdminAuthentication: 'jwt-x' },
                }),
            );

            await expect(guard.canActivate(ctx)).resolves.toBe(true);
            expect(csrf.validateToken).not.toHaveBeenCalled();
        });

        it('admin-public POST всё равно проверяет CSRF', async () => {
            csrf.validateToken.mockReturnValue(false);
            const guard = makeGuard(makeReflectorWith(true, undefined));
            const ctx = makeCtx(makeReq({ method: 'POST', url: '/admin/auth/login' }));

            await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
        });
    });

    describe('JWT validation', () => {
        it('нет токена в cookie/Authorization — ADMIN_AUTH_REQUIRED', async () => {
            const guard = makeGuard(makeReflectorWith(false, undefined));
            const ctx = makeCtx(makeReq({}));

            await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
        });

        it('невалидный JWT — ADMIN_AUTH_REQUIRED', async () => {
            auth.validateAccessToken.mockResolvedValue(null);
            const guard = makeGuard(makeReflectorWith(false, undefined));
            const ctx = makeCtx(
                makeReq({
                    method: 'POST',
                    cookies: { AdminAuthentication: 'bad-jwt' },
                }),
            );

            await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
        });
    });

    describe('RBAC: SUPPORT_READONLY vs SUPPORT_ADMIN', () => {
        const readonlyJwt = {
            sub: 'su-readonly',
            sessionId: 'sess-1',
            role: 'SUPPORT_READONLY',
            aud: 'admin',
        };
        const adminJwt = {
            sub: 'su-admin',
            sessionId: 'sess-2',
            role: 'SUPPORT_ADMIN',
            aud: 'admin',
        };

        it('SUPPORT_READONLY на mutating endpoint — FORBIDDEN_SUPPORT_ADMIN_REQUIRED', async () => {
            auth.validateAccessToken.mockResolvedValue(readonlyJwt);
            const guard = makeGuard(makeReflectorWith(false, ['SUPPORT_ADMIN']));
            const ctx = makeCtx(
                makeReq({
                    method: 'POST',
                    cookies: { AdminAuthentication: 'jwt' },
                }),
            );

            await expect(guard.canActivate(ctx)).rejects.toMatchObject({
                response: { code: 'FORBIDDEN_SUPPORT_ADMIN_REQUIRED' },
            });

            // Audit-trail: support_security_events.admin_rbac_denied
            expect(auth.writeSecurityEvent).toHaveBeenCalledWith(
                'admin_rbac_denied',
                'su-readonly',
                expect.any(String),
                null,
                expect.objectContaining({
                    actorRole: 'SUPPORT_READONLY',
                    requiredRoles: ['SUPPORT_ADMIN'],
                }),
            );
            // Metric counter denied_attempts
            expect(metrics.snapshot().counters[AdminMetricNames.DENIED_ATTEMPTS]).toBe(1);
        });

        it('SUPPORT_ADMIN на mutating endpoint — пропуск', async () => {
            auth.validateAccessToken.mockResolvedValue(adminJwt);
            const guard = makeGuard(makeReflectorWith(false, ['SUPPORT_ADMIN']));
            const req = makeReq({
                method: 'POST',
                cookies: { AdminAuthentication: 'jwt' },
            });
            const ctx = makeCtx(req);

            await expect(guard.canActivate(ctx)).resolves.toBe(true);
            expect(auth.writeSecurityEvent).not.toHaveBeenCalled();
            // Контекст обогащён supportUser.
            expect(req.supportUser).toMatchObject({
                id: 'su-admin',
                role: 'SUPPORT_ADMIN',
                sessionId: 'sess-2',
            });
        });

        it('SUPPORT_READONLY на read-only endpoint — пропуск (без @AdminRoles)', async () => {
            auth.validateAccessToken.mockResolvedValue(readonlyJwt);
            const guard = makeGuard(makeReflectorWith(false, undefined));
            const ctx = makeCtx(
                makeReq({
                    method: 'GET',
                    cookies: { AdminAuthentication: 'jwt' },
                }),
            );

            await expect(guard.canActivate(ctx)).resolves.toBe(true);
            expect(auth.writeSecurityEvent).not.toHaveBeenCalled();
        });
    });

    describe('Authorization header (Bearer fallback)', () => {
        it('Bearer-токен из Authorization заголовка работает аналогично cookie', async () => {
            auth.validateAccessToken.mockResolvedValue({
                sub: 'su-1', sessionId: 's', role: 'SUPPORT_ADMIN', aud: 'admin',
            });
            const guard = makeGuard(makeReflectorWith(false, undefined));
            const ctx = makeCtx(
                makeReq({
                    method: 'GET',
                    headers: { authorization: 'Bearer jwt-bearer' },
                }),
            );

            await expect(guard.canActivate(ctx)).resolves.toBe(true);
            expect(auth.validateAccessToken).toHaveBeenCalledWith('jwt-bearer');
        });
    });
});
