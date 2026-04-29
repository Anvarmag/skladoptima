/**
 * TASK_AUDIT_7 spec для `AuditReadGuard`.
 *
 * Покрывает ключевые сценарии (system-analytics §4, §17):
 *   - Нет user.id → AUDIT_ACCESS_DENIED.
 *   - Нет tenantId ни в header, ни в activeTenantId → TENANT_CONTEXT_REQUIRED.
 *   - Нет активного членства → AUDIT_ACCESS_DENIED.
 *   - Активное членство → guard возвращает true.
 *   - Приоритет X-Tenant-Id header над activeTenantId.
 *   - После прохождения guard устанавливает request.activeTenantId.
 *   - TRIAL_EXPIRED / SUSPENDED / CLOSED: guard НЕ проверяет статус тенанта,
 *     проходит если членство активно (compliance requirement §4 scenario 4).
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: {},
}));

import { ForbiddenException, Logger } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { AuditReadGuard } from './audit-read.guard';

// ─── Helper factories ─────────────────────────────────────────────────────────

function makeContext(opts: {
    userId?:         string;
    tenantIdHeader?: string;
    activeTenantId?: string;
}): ExecutionContext {
    return {
        switchToHttp: () => ({
            getRequest: () => ({
                user:           opts.userId ? { id: opts.userId } : undefined,
                headers:        opts.tenantIdHeader
                    ? { 'x-tenant-id': opts.tenantIdHeader }
                    : {},
                activeTenantId: opts.activeTenantId,
            }),
        }),
    } as unknown as ExecutionContext;
}

function makePrisma(membership: object | null = { id: 'mem-1' }) {
    return {
        membership: {
            findFirst: jest.fn().mockResolvedValue(membership),
        },
    } as any;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AuditReadGuard', () => {
    let loggerWarnSpy: jest.SpyInstance;

    beforeEach(() => {
        loggerWarnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    });

    afterEach(() => jest.clearAllMocks());

    it('нет user → AUDIT_ACCESS_DENIED', async () => {
        const guard = new AuditReadGuard(makePrisma());
        const ctx   = makeContext({ activeTenantId: 'tenant-1' });

        await expect(guard.canActivate(ctx))
            .rejects.toMatchObject({ response: { code: 'AUDIT_ACCESS_DENIED' } });
    });

    it('нет tenantId ни в header, ни в activeTenantId → TENANT_CONTEXT_REQUIRED', async () => {
        const guard = new AuditReadGuard(makePrisma());
        const ctx   = makeContext({ userId: 'user-1' });

        await expect(guard.canActivate(ctx))
            .rejects.toMatchObject({ response: { code: 'TENANT_CONTEXT_REQUIRED' } });
    });

    it('нет активного членства → AUDIT_ACCESS_DENIED и лог предупреждения', async () => {
        const guard = new AuditReadGuard(makePrisma(null));
        const ctx   = makeContext({ userId: 'user-1', activeTenantId: 'tenant-1' });

        await expect(guard.canActivate(ctx))
            .rejects.toMatchObject({ response: { code: 'AUDIT_ACCESS_DENIED' } });

        expect(loggerWarnSpy).toHaveBeenCalledWith(
            expect.stringContaining('audit_read_denied'),
        );
    });

    it('активное членство → возвращает true', async () => {
        const guard = new AuditReadGuard(makePrisma({ id: 'mem-1' }));
        const ctx   = makeContext({ userId: 'user-1', activeTenantId: 'tenant-1' });

        const result = await guard.canActivate(ctx);
        expect(result).toBe(true);
    });

    it('после прохождения устанавливает request.activeTenantId', async () => {
        const guard   = new AuditReadGuard(makePrisma({ id: 'mem-1' }));
        const request = {
            user:           { id: 'user-1' },
            headers:        {},
            activeTenantId: 'tenant-from-global',
        };
        const ctx: ExecutionContext = {
            switchToHttp: () => ({ getRequest: () => request }),
        } as any;

        await guard.canActivate(ctx);
        expect(request.activeTenantId).toBe('tenant-from-global');
    });

    it('X-Tenant-Id header имеет приоритет над activeTenantId', async () => {
        const prisma = makePrisma({ id: 'mem-1' });
        const guard  = new AuditReadGuard(prisma);
        const ctx    = makeContext({
            userId:          'user-1',
            tenantIdHeader:  'tenant-from-header',
            activeTenantId:  'tenant-from-active',
        });

        await guard.canActivate(ctx);

        // Guard должен был выполнить lookup именно по tenant-from-header
        expect(prisma.membership.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ tenantId: 'tenant-from-header' }),
            }),
        );
    });

    it('TRIAL_EXPIRED — guard НЕ проверяет accessState, пропускает при наличии членства', async () => {
        // Симуляция: activeTenantId может быть null когда тенант TRIAL_EXPIRED/SUSPENDED/CLOSED
        // (ActiveTenantGuard выставляет null), но заголовок X-Tenant-Id передаётся явно.
        const prisma = makePrisma({ id: 'mem-1' });
        const guard  = new AuditReadGuard(prisma);
        const request = {
            user:           { id: 'user-1' },
            headers:        { 'x-tenant-id': 'suspended-tenant' },
            activeTenantId: null,
        };
        const ctx: ExecutionContext = {
            switchToHttp: () => ({ getRequest: () => request }),
        } as any;

        const result = await guard.canActivate(ctx);
        expect(result).toBe(true);
        // activeTenantId должен быть выставлен для последующего RBAC
        expect(request.activeTenantId).toBe('suspended-tenant');
    });

    it('X-Tenant-Id присутствует, членства нет → AUDIT_ACCESS_DENIED', async () => {
        const guard = new AuditReadGuard(makePrisma(null));
        const ctx   = makeContext({
            userId:         'user-1',
            tenantIdHeader: 'tenant-1',
        });

        await expect(guard.canActivate(ctx))
            .rejects.toThrow(ForbiddenException);
    });
});
