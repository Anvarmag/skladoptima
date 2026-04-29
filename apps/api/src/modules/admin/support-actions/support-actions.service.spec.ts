/**
 * TASK_ADMIN_7: regression suite для `SupportActionsService`.
 *
 * Покрывает тестовую матрицу §16:
 *   - extend-trial — success path с reason ≥ 10;
 *   - set-access-state — success / billing-override-blocked;
 *   - restore-tenant — retention-window expired = blocked;
 *   - trigger-password-reset — user-not-found = blocked, success path;
 *   - notes (recordNoteAdded) — счётчик и audit-trail;
 *   - tenant-not-found = blocked + ADMIN_TENANT_NOT_FOUND;
 *   - метрики SUPPORT_ACTIONS_STARTED/SUCCEEDED/FAILED + BILLING_OVERRIDE_BLOCKED.
 *
 * Mock'и: prisma + tenantService + authService + auditService + metrics.
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: {},
    SupportActionType: {
        EXTEND_TRIAL: 'EXTEND_TRIAL',
        SET_ACCESS_STATE: 'SET_ACCESS_STATE',
        RESTORE_TENANT: 'RESTORE_TENANT',
        TRIGGER_PASSWORD_RESET: 'TRIGGER_PASSWORD_RESET',
        ADD_INTERNAL_NOTE: 'ADD_INTERNAL_NOTE',
    },
    SupportActionResultStatus: {
        success: 'success',
        failed: 'failed',
        blocked: 'blocked',
    },
}));

import {
    BadRequestException,
    ForbiddenException,
    NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { TenantService } from '../../tenants/tenant.service';
import { AuthService } from '../../auth/auth.service';
import { AuditService } from '../../audit/audit.service';
import { AdminMetricsRegistry, AdminMetricNames } from '../admin.metrics';
import { SupportActionsService } from './support-actions.service';

// ─── Mocks ────────────────────────────────────────────────────────────────────

function makePrismaMock() {
    return {
        tenant: { findUnique: jest.fn() },
        user: { findUnique: jest.fn() },
        supportAction: { create: jest.fn().mockResolvedValue({ id: 'sa-1' }) },
    } as any;
}

function makeTenantServiceMock() {
    return {
        extendTrialBySupport: jest.fn(),
        transitionAccessState: jest.fn(),
        restoreTenantBySupport: jest.fn(),
    } as any;
}

function makeAuthServiceMock() {
    return {
        triggerPasswordResetBySupport: jest.fn().mockResolvedValue({ ok: true }),
    } as any;
}

function makeAuditServiceMock() {
    return {
        writePrivilegedEvent: jest.fn().mockResolvedValue('audit-log-id-1'),
    } as any;
}

const SUPPORT_ADMIN_ACTOR = {
    id: 'su-1',
    email: 'support@example.com',
    role: 'SUPPORT_ADMIN' as const,
    sessionId: 'sess-1',
};

const CTX = {
    actor: SUPPORT_ADMIN_ACTOR,
    ip: '10.0.0.1',
    userAgent: 'jest',
    correlationId: 'corr-1',
};

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const VALID_REASON = 'Operator confirmed via support ticket #12345';

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('SupportActionsService', () => {
    let service: SupportActionsService;
    let prisma: ReturnType<typeof makePrismaMock>;
    let tenantService: ReturnType<typeof makeTenantServiceMock>;
    let authService: ReturnType<typeof makeAuthServiceMock>;
    let auditService: ReturnType<typeof makeAuditServiceMock>;
    let metrics: AdminMetricsRegistry;

    beforeEach(async () => {
        prisma = makePrismaMock();
        tenantService = makeTenantServiceMock();
        authService = makeAuthServiceMock();
        auditService = makeAuditServiceMock();
        metrics = new AdminMetricsRegistry();

        const module = await Test.createTestingModule({
            providers: [
                SupportActionsService,
                { provide: PrismaService, useValue: prisma },
                { provide: TenantService, useValue: tenantService },
                { provide: AuthService, useValue: authService },
                { provide: AuditService, useValue: auditService },
                { provide: AdminMetricsRegistry, useValue: metrics },
            ],
        }).compile();

        service = module.get(SupportActionsService);
    });

    // ─── extendTrial ─────────────────────────────────────────────────────────

    describe('extendTrial', () => {
        it('success — пишет support_action, audit, инкрементит SUCCEEDED', async () => {
            prisma.tenant.findUnique.mockResolvedValue({ id: TENANT_ID });
            tenantService.extendTrialBySupport.mockResolvedValue({
                tenantId: TENANT_ID,
                previousState: 'TRIAL_EXPIRED',
                currentState: 'TRIAL_ACTIVE',
                idempotent: false,
            });

            const out = await service.extendTrial(TENANT_ID, VALID_REASON, CTX);

            expect(out.currentState).toBe('TRIAL_ACTIVE');
            expect(tenantService.extendTrialBySupport).toHaveBeenCalledWith(
                TENANT_ID,
                expect.objectContaining({ supportUserId: 'su-1' }),
            );
            expect(auditService.writePrivilegedEvent).toHaveBeenCalled();
            expect(prisma.supportAction.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        actionType: 'EXTEND_TRIAL',
                        reason: VALID_REASON,
                        resultStatus: 'success',
                        auditLogId: 'audit-log-id-1',
                        correlationId: 'corr-1',
                    }),
                }),
            );

            const snap = metrics.snapshot();
            expect(snap.counters[AdminMetricNames.SUPPORT_ACTIONS_STARTED]).toBe(1);
            expect(snap.counters[AdminMetricNames.SUPPORT_ACTIONS_SUCCEEDED]).toBe(1);
            expect(snap.counters[AdminMetricNames.SUPPORT_ACTIONS_FAILED]).toBeUndefined();
        });

        it('blocked — tenant not found = ADMIN_TENANT_NOT_FOUND', async () => {
            prisma.tenant.findUnique.mockResolvedValue(null);

            await expect(service.extendTrial(TENANT_ID, VALID_REASON, CTX))
                .rejects.toMatchObject({ response: { code: 'ADMIN_TENANT_NOT_FOUND' } });

            expect(tenantService.extendTrialBySupport).not.toHaveBeenCalled();
            expect(prisma.supportAction.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        resultStatus: 'blocked',
                        errorCode: 'ADMIN_TENANT_NOT_FOUND',
                    }),
                }),
            );
            const snap = metrics.snapshot();
            expect(snap.counters[AdminMetricNames.SUPPORT_ACTIONS_FAILED]).toBe(1);
        });
    });

    // ─── setAccessState ───────────────────────────────────────────────────────

    describe('setAccessState', () => {
        it('success — переводит в SUSPENDED', async () => {
            prisma.tenant.findUnique.mockResolvedValue({ id: TENANT_ID });
            tenantService.transitionAccessState.mockResolvedValue({
                tenantId: TENANT_ID,
                previousState: 'TRIAL_ACTIVE',
                currentState: 'SUSPENDED',
            });

            await service.setAccessState(TENANT_ID, 'SUSPENDED', VALID_REASON, CTX);

            expect(tenantService.transitionAccessState).toHaveBeenCalledWith(
                TENANT_ID,
                expect.objectContaining({
                    toState: 'SUSPENDED',
                    actorType: 'SUPPORT',
                    actorId: 'su-1',
                }),
                { supportContext: true },
            );
        });

        it('blocked — BILLING_OVERRIDE_NOT_ALLOWED инкрементит отдельный counter', async () => {
            prisma.tenant.findUnique.mockResolvedValue({ id: TENANT_ID });
            // policy.assertSupportTransitionAllowed выбрасывает BadRequestException
            // с кодом BILLING_OVERRIDE_NOT_ALLOWED.
            const billingErr = new BadRequestException({
                code: 'BILLING_OVERRIDE_NOT_ALLOWED',
            });
            tenantService.transitionAccessState.mockRejectedValue(billingErr);

            await expect(
                service.setAccessState(TENANT_ID, 'ACTIVE_PAID', VALID_REASON, CTX),
            ).rejects.toBe(billingErr);

            expect(prisma.supportAction.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        resultStatus: 'blocked',
                        errorCode: 'BILLING_OVERRIDE_NOT_ALLOWED',
                    }),
                }),
            );

            const snap = metrics.snapshot();
            expect(snap.counters[AdminMetricNames.SUPPORT_ACTIONS_FAILED]).toBe(1);
            expect(snap.counters[AdminMetricNames.BILLING_OVERRIDE_BLOCKED]).toBe(1);
        });
    });

    // ─── restoreTenant ────────────────────────────────────────────────────────

    describe('restoreTenant', () => {
        it('blocked — retention window expired инкрементит RESTORE_BLOCKED_BY_RETENTION', async () => {
            prisma.tenant.findUnique.mockResolvedValue({ id: TENANT_ID });
            const retentionErr = new ForbiddenException({
                code: 'TENANT_RETENTION_WINDOW_EXPIRED',
            });
            tenantService.restoreTenantBySupport.mockRejectedValue(retentionErr);

            await expect(service.restoreTenant(TENANT_ID, VALID_REASON, CTX))
                .rejects.toBe(retentionErr);

            const snap = metrics.snapshot();
            expect(snap.counters[AdminMetricNames.SUPPORT_ACTIONS_FAILED]).toBe(1);
            expect(snap.counters[AdminMetricNames.RESTORE_BLOCKED_BY_RETENTION]).toBe(1);
            expect(prisma.supportAction.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        resultStatus: 'blocked',
                        errorCode: 'TENANT_RETENTION_WINDOW_EXPIRED',
                    }),
                }),
            );
        });

        it('success — фиксирует TENANT_RESTORED audit-event', async () => {
            prisma.tenant.findUnique.mockResolvedValue({ id: TENANT_ID });
            tenantService.restoreTenantBySupport.mockResolvedValue({
                tenantId: TENANT_ID,
                status: 'ACTIVE',
                accessState: 'SUSPENDED',
            });

            await service.restoreTenant(TENANT_ID, VALID_REASON, CTX);

            expect(auditService.writePrivilegedEvent).toHaveBeenCalledWith(
                expect.objectContaining({
                    metadata: expect.objectContaining({
                        supportAction: 'RESTORE_TENANT',
                        reason: VALID_REASON,
                    }),
                }),
            );
        });
    });

    // ─── triggerPasswordReset ─────────────────────────────────────────────────

    describe('triggerPasswordReset', () => {
        it('blocked — user not found = AUTH_USER_NOT_FOUND', async () => {
            prisma.user.findUnique.mockResolvedValue(null);

            await expect(service.triggerPasswordReset(USER_ID, VALID_REASON, CTX))
                .rejects.toMatchObject({ response: { code: 'AUTH_USER_NOT_FOUND' } });

            expect(authService.triggerPasswordResetBySupport).not.toHaveBeenCalled();
            expect(prisma.supportAction.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        resultStatus: 'blocked',
                        errorCode: 'AUTH_USER_NOT_FOUND',
                        targetUserId: USER_ID,
                    }),
                }),
            );
        });

        it('success — резолвит tenantId через membership и пишет audit', async () => {
            prisma.user.findUnique.mockResolvedValue({
                id: USER_ID,
                memberships: [{ tenantId: TENANT_ID }],
            });

            const result = await service.triggerPasswordReset(USER_ID, VALID_REASON, CTX);

            expect(result.tenantId).toBe(TENANT_ID);
            expect(authService.triggerPasswordResetBySupport).toHaveBeenCalledWith(
                USER_ID,
                expect.objectContaining({ supportUserId: 'su-1' }),
            );
            // Audit написан с tenantId (privileged).
            expect(auditService.writePrivilegedEvent).toHaveBeenCalledWith(
                expect.objectContaining({
                    tenantId: TENANT_ID,
                    metadata: expect.objectContaining({
                        supportAction: 'TRIGGER_PASSWORD_RESET',
                    }),
                }),
            );

            const snap = metrics.snapshot();
            expect(snap.counters[AdminMetricNames.SUPPORT_ACTIONS_SUCCEEDED]).toBe(1);
        });

        it('orphan user (нет membership) — success без AuditLog (только support_actions)', async () => {
            prisma.user.findUnique.mockResolvedValue({
                id: USER_ID,
                memberships: [],
            });

            const result = await service.triggerPasswordReset(USER_ID, VALID_REASON, CTX);

            expect(result.tenantId).toBeNull();
            // AuditLog требует tenantId — privileged write пропускается.
            expect(auditService.writePrivilegedEvent).not.toHaveBeenCalled();
            expect(prisma.supportAction.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        resultStatus: 'success',
                        tenantId: null,
                        targetUserId: USER_ID,
                    }),
                }),
            );
        });
    });

    // ─── recordNoteAdded ──────────────────────────────────────────────────────

    describe('recordNoteAdded', () => {
        it('пишет SUPPORT_NOTE_ADDED в audit + ADD_INTERNAL_NOTE в support_actions + counter NOTES_CREATED', async () => {
            const out = await service.recordNoteAdded(TENANT_ID, 'note-1', CTX);

            expect(out.auditLogId).toBe('audit-log-id-1');
            expect(auditService.writePrivilegedEvent).toHaveBeenCalledWith(
                expect.objectContaining({
                    eventType: expect.stringContaining('NOTE'),
                    entityType: 'support_note',
                    entityId: 'note-1',
                }),
            );
            expect(prisma.supportAction.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        actionType: 'ADD_INTERNAL_NOTE',
                        auditLogId: 'audit-log-id-1',
                    }),
                }),
            );
            const snap = metrics.snapshot();
            expect(snap.counters[AdminMetricNames.NOTES_CREATED]).toBe(1);
        });

        it('audit-write упал — support_action всё равно сохранён (auditLogId=null)', async () => {
            auditService.writePrivilegedEvent.mockRejectedValueOnce(
                new Error('audit pipeline down'),
            );

            const out = await service.recordNoteAdded(TENANT_ID, 'note-1', CTX);

            expect(out.auditLogId).toBeNull();
            // recordAction всё равно вызван — admin-журнал не теряется.
            expect(prisma.supportAction.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        actionType: 'ADD_INTERNAL_NOTE',
                        auditLogId: null,
                    }),
                }),
            );
        });
    });

    // ─── correlation_id propagation ───────────────────────────────────────────

    describe('correlation_id propagation', () => {
        it('correlationId из ctx уходит и в support_actions, и в AuditLog', async () => {
            prisma.tenant.findUnique.mockResolvedValue({ id: TENANT_ID });
            tenantService.extendTrialBySupport.mockResolvedValue({
                tenantId: TENANT_ID,
                previousState: 'TRIAL_EXPIRED',
                currentState: 'TRIAL_ACTIVE',
                idempotent: false,
            });

            await service.extendTrial(TENANT_ID, VALID_REASON, {
                ...CTX,
                correlationId: 'trace-xyz',
            });

            expect(prisma.supportAction.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ correlationId: 'trace-xyz' }),
                }),
            );
            expect(auditService.writePrivilegedEvent).toHaveBeenCalledWith(
                expect.objectContaining({ correlationId: 'trace-xyz' }),
            );
        });
    });
});
