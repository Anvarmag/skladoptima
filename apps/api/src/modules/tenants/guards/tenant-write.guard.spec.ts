import { ForbiddenException, Logger } from '@nestjs/common';
import { TenantWriteGuard } from './tenant-write.guard';
import { ExecutionContext } from '@nestjs/common';

// ─── Helper: build a minimal ExecutionContext mock ───────────────────────────

function makeContext(accessState?: string): ExecutionContext {
    return {
        switchToHttp: () => ({
            getRequest: () => ({
                activeTenant: accessState ? { accessState } : undefined,
                activeTenantId: 'tenant-1',
                user: { id: 'user-1' },
                url: '/products',
            }),
        }),
    } as unknown as ExecutionContext;
}

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('TenantWriteGuard', () => {
    let guard: TenantWriteGuard;
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
        guard = new TenantWriteGuard();
        warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    });

    afterEach(() => jest.clearAllMocks());

    // ─── States that MUST block writes ──────────────────────────────────────

    it('throws TENANT_WRITE_BLOCKED for TRIAL_EXPIRED tenant', () => {
        expect(() => guard.canActivate(makeContext('TRIAL_EXPIRED'))).toThrow(ForbiddenException);
    });

    it('throws TENANT_WRITE_BLOCKED for SUSPENDED tenant', () => {
        expect(() => guard.canActivate(makeContext('SUSPENDED'))).toThrow(ForbiddenException);
    });

    it('throws TENANT_WRITE_BLOCKED for CLOSED tenant', () => {
        expect(() => guard.canActivate(makeContext('CLOSED'))).toThrow(ForbiddenException);
    });

    it('includes accessState in the error response for diagnostics', () => {
        try {
            guard.canActivate(makeContext('SUSPENDED'));
            fail('should have thrown');
        } catch (err: any) {
            expect(err.response).toMatchObject({
                code: 'TENANT_WRITE_BLOCKED',
                accessState: 'SUSPENDED',
            });
        }
    });

    it('logs tenant_write_blocked structured event on block', () => {
        try {
            guard.canActivate(makeContext('TRIAL_EXPIRED'));
        } catch {
            // expected
        }
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('"event":"tenant_write_blocked"'),
        );
    });

    // ─── States that MUST allow writes ──────────────────────────────────────

    it('allows writes for ACTIVE_PAID tenant', () => {
        expect(guard.canActivate(makeContext('ACTIVE_PAID'))).toBe(true);
    });

    it('allows writes for TRIAL_ACTIVE tenant', () => {
        expect(guard.canActivate(makeContext('TRIAL_ACTIVE'))).toBe(true);
    });

    it('allows writes for GRACE_PERIOD tenant', () => {
        expect(guard.canActivate(makeContext('GRACE_PERIOD'))).toBe(true);
    });

    it('allows writes for EARLY_ACCESS tenant', () => {
        expect(guard.canActivate(makeContext('EARLY_ACCESS'))).toBe(true);
    });

    it('allows writes when activeTenant is undefined (no tenant context)', () => {
        expect(guard.canActivate(makeContext(undefined))).toBe(true);
    });
});
