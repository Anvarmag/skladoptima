/**
 * TASK_AUDIT_7 spec для `AuditService`.
 *
 * Покрывает тестовую матрицу (system-analytics §17):
 *   - writeEvent: sanitization чувствительных полей, инвентаризация, team, catalog, support.
 *   - writePrivilegedEvent: принудительный internal_only и actorType=support.
 *   - writeSecurityEvent: failed login, successful login, password reset.
 *   - assertOwnerOrAdmin: OWNER ✓, ADMIN ✓, MANAGER ✗, STAFF ✗, нет членства ✗.
 *   - getLogs: retention window 180 дней, только tenant-visible записи, фильтры.
 *   - getLog: drill-down, NOT_FOUND, AUDIT_INTERNAL_ONLY_RECORD.
 *   - getSecurityEvents: cross-member visibility, IP masking (IPv4, IPv6).
 *   - getCoverageStatus: aggregate coverage по всем контрактам.
 *   - maskAuditLogForTenant: strict / partial / none.
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: {},
    ActionType: {
        MANUAL_ADJUSTMENT: 'MANUAL_ADJUSTMENT',
        IMPORT:            'IMPORT',
    },
    AuditVisibilityScope: {
        tenant:        'tenant',
        internal_only: 'internal_only',
    },
    AuditRedactionLevel: {
        none:    'none',
        partial: 'partial',
        strict:  'strict',
    },
    AuditActorType: {
        user:        'user',
        support:     'support',
        system:      'system',
        marketplace: 'marketplace',
    },
    AuditSource: {
        ui:          'ui',
        api:         'api',
        worker:      'worker',
        marketplace: 'marketplace',
    },
    Role: {
        OWNER:   'OWNER',
        ADMIN:   'ADMIN',
        MANAGER: 'MANAGER',
        STAFF:   'STAFF',
    },
}));

import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuditService } from './audit.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Mock factory ─────────────────────────────────────────────────────────────

function makePrismaMock() {
    const mock = {
        auditLog: {
            create:   jest.fn().mockResolvedValue({ id: 'aud-1' }),
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn().mockResolvedValue(null),
            count:    jest.fn().mockResolvedValue(0),
        },
        securityEvent: {
            create:   jest.fn().mockResolvedValue({ id: 'sec-1' }),
            findMany: jest.fn().mockResolvedValue([]),
            count:    jest.fn().mockResolvedValue(0),
        },
        membership: {
            findFirst: jest.fn().mockResolvedValue(null),
            findMany:  jest.fn().mockResolvedValue([]),
        },
        $transaction: jest.fn().mockImplementation((fn: any) =>
            typeof fn === 'function' ? fn(mock) : Promise.all(fn),
        ),
    };
    return mock;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-001';
const USER_ID   = 'user-001';
const LOG_ID    = 'aud-abc';

const BASE_AUDIT_LOG = {
    id:              LOG_ID,
    tenantId:        TENANT_ID,
    eventType:       'STOCK_MANUALLY_ADJUSTED',
    eventDomain:     'INVENTORY',
    entityType:      'PRODUCT',
    entityId:        'prod-1',
    actorType:       'user',
    actorId:         USER_ID,
    actorRole:       'OWNER',
    source:          'ui',
    requestId:       null,
    correlationId:   null,
    before:          { onHand: 10 },
    after:           { onHand: 15 },
    changedFields:   ['onHand'],
    metadata:        { reasonCode: 'FOUND' },
    visibilityScope: 'tenant',
    redactionLevel:  'none',
    createdAt:       new Date(),
};

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('AuditService', () => {
    let svc:    AuditService;
    let prisma: ReturnType<typeof makePrismaMock>;

    beforeEach(async () => {
        prisma = makePrismaMock();
        const module = await Test.createTestingModule({
            providers: [
                AuditService,
                { provide: PrismaService, useValue: prisma },
            ],
        }).compile();
        svc = module.get(AuditService);
    });

    afterEach(() => jest.clearAllMocks());

    // ─── writeEvent ───────────────────────────────────────────────────────────

    describe('writeEvent', () => {
        it('сохраняет корректные поля при stock adjustment', async () => {
            await svc.writeEvent({
                tenantId:     TENANT_ID,
                eventType:    'STOCK_MANUALLY_ADJUSTED',
                entityType:   'PRODUCT',
                entityId:     'prod-1',
                actorType:    'user',
                actorId:      USER_ID,
                actorRole:    'OWNER',
                source:       'ui',
                before:       { onHand: 10 },
                after:        { onHand: 15 },
                changedFields: ['onHand'],
                metadata:     { reasonCode: 'FOUND', delta: 5 },
            });

            expect(prisma.auditLog.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        tenantId:   TENANT_ID,
                        eventType:  'STOCK_MANUALLY_ADJUSTED',
                        eventDomain: 'INVENTORY',
                        entityType: 'PRODUCT',
                        entityId:   'prod-1',
                        actorType:  'user',
                        actorId:    USER_ID,
                        source:     'ui',
                    }),
                }),
            );
        });

        it('применяет eventDomain из EVENT_DOMAIN_MAP, если не указан явно', async () => {
            await svc.writeEvent({
                tenantId:  TENANT_ID,
                eventType: 'INVITE_CREATED',
                actorType: 'user',
                source:    'ui',
            });

            const created = prisma.auditLog.create.mock.calls[0][0].data;
            expect(created.eventDomain).toBe('TEAM');
        });

        it('sanitize удаляет password из before/after на любой глубине', async () => {
            await svc.writeEvent({
                tenantId:  TENANT_ID,
                eventType: 'PRODUCT_UPDATED',
                actorType: 'user',
                source:    'api',
                before:    { name: 'Товар', nested: { password: 'secret123', value: 42 } },
                after:     { name: 'Товар v2', passwordHash: 'shouldBeGone' },
                metadata:  { token: 'tkn', info: 'visible', apiKey: 'key' },
            });

            const created = prisma.auditLog.create.mock.calls[0][0].data;
            expect(created.before.nested.password).toBe('[REDACTED]');
            expect(created.after.passwordHash).toBe('[REDACTED]');
            expect(created.metadata.token).toBe('[REDACTED]');
            expect(created.metadata.apiKey).toBe('[REDACTED]');
            expect(created.metadata.info).toBe('visible');
        });

        it('sanitize обрабатывает массивы в payload', async () => {
            await svc.writeEvent({
                tenantId:  TENANT_ID,
                eventType: 'PRODUCT_UPDATED',
                actorType: 'user',
                source:    'api',
                metadata:  { items: [{ secret: 'x', name: 'a' }, { secret: 'y', name: 'b' }] },
            });

            const created = prisma.auditLog.create.mock.calls[0][0].data;
            expect(created.metadata.items[0].secret).toBe('[REDACTED]');
            expect(created.metadata.items[0].name).toBe('a');
            expect(created.metadata.items[1].secret).toBe('[REDACTED]');
        });

        it('defaults visibilityScope=tenant, redactionLevel=none', async () => {
            await svc.writeEvent({
                tenantId:  TENANT_ID,
                eventType: 'PRODUCT_CREATED',
                actorType: 'user',
                source:    'ui',
            });

            const created = prisma.auditLog.create.mock.calls[0][0].data;
            expect(created.visibilityScope).toBe('tenant');
            expect(created.redactionLevel).toBe('none');
        });

        it('сохраняет catalog event PRODUCT_ARCHIVED', async () => {
            await svc.writeEvent({
                tenantId:     TENANT_ID,
                eventType:    'PRODUCT_ARCHIVED',
                entityType:   'PRODUCT',
                entityId:     'prod-2',
                actorType:    'user',
                actorId:      USER_ID,
                actorRole:    'ADMIN',
                source:       'ui',
                changedFields: ['archivedAt', 'status'],
                metadata:     { reason: 'discontinued' },
            });

            const created = prisma.auditLog.create.mock.calls[0][0].data;
            expect(created.eventType).toBe('PRODUCT_ARCHIVED');
            expect(created.eventDomain).toBe('CATALOG');
        });

        it('сохраняет team event MEMBER_ROLE_CHANGED с before/after', async () => {
            await svc.writeEvent({
                tenantId:     TENANT_ID,
                eventType:    'MEMBER_ROLE_CHANGED',
                entityType:   'MEMBERSHIP',
                entityId:     'mem-1',
                actorType:    'user',
                actorId:      USER_ID,
                source:       'ui',
                before:       { role: 'MANAGER' },
                after:        { role: 'ADMIN' },
                changedFields: ['role'],
            });

            const created = prisma.auditLog.create.mock.calls[0][0].data;
            expect(created.eventType).toBe('MEMBER_ROLE_CHANGED');
            expect(created.eventDomain).toBe('TEAM');
            expect(created.before).toMatchObject({ role: 'MANAGER' });
            expect(created.after).toMatchObject({ role: 'ADMIN' });
        });
    });

    // ─── writePrivilegedEvent ─────────────────────────────────────────────────

    describe('writePrivilegedEvent', () => {
        it('принудительно устанавливает actorType=support и visibility=internal_only', async () => {
            await svc.writePrivilegedEvent({
                tenantId:  TENANT_ID,
                eventType: 'SUPPORT_TENANT_DATA_CHANGED',
                source:    'api',
                metadata:  { supportTicketId: 'TICK-123' },
            });

            const created = prisma.auditLog.create.mock.calls[0][0].data;
            expect(created.actorType).toBe('support');
            expect(created.visibilityScope).toBe('internal_only');
        });

        it('default redactionLevel=partial для privileged events', async () => {
            await svc.writePrivilegedEvent({
                tenantId:  TENANT_ID,
                eventType: 'SUPPORT_ACCESS_GRANTED',
                source:    'api',
            });

            const created = prisma.auditLog.create.mock.calls[0][0].data;
            expect(created.redactionLevel).toBe('partial');
        });

        it('поддерживает явный redactionLevel=strict', async () => {
            await svc.writePrivilegedEvent({
                tenantId:      TENANT_ID,
                eventType:     'SUPPORT_TENANT_CLOSED',
                source:        'api',
                redactionLevel: 'strict' as any,
            });

            const created = prisma.auditLog.create.mock.calls[0][0].data;
            expect(created.redactionLevel).toBe('strict');
        });

        it('возвращает id созданной audit-записи (TASK_ADMIN_4: linkage support_actions.audit_log_id)', async () => {
            prisma.auditLog.create.mockResolvedValueOnce({ id: 'aud-priv-42' });
            const id = await svc.writePrivilegedEvent({
                tenantId:  TENANT_ID,
                eventType: 'SUPPORT_NOTE_ADDED',
                source:    'api',
                entityType: 'support_note',
                entityId:   'note-1',
            });
            expect(id).toBe('aud-priv-42');
        });

        it('пробрасывает correlationId в AuditLog (TASK_ADMIN_4: cross-trail link)', async () => {
            await svc.writePrivilegedEvent({
                tenantId:      TENANT_ID,
                eventType:     'SUPPORT_NOTE_ADDED',
                source:        'api',
                correlationId: 'corr-xyz-7',
                entityType:    'support_note',
                entityId:      'note-2',
            });
            const created = prisma.auditLog.create.mock.calls[0][0].data;
            expect(created.correlationId).toBe('corr-xyz-7');
        });
    });

    // ─── writeSecurityEvent ───────────────────────────────────────────────────

    describe('writeSecurityEvent', () => {
        it('сохраняет LOGIN_FAILED security event', async () => {
            await svc.writeSecurityEvent({
                tenantId:  undefined,
                userId:    USER_ID,
                eventType: 'login_failed',
                ip:        '192.168.1.55',
                userAgent: 'Mozilla/5.0',
                requestId: 'req-1',
                metadata:  { reason: 'invalid_credentials' },
            });

            expect(prisma.securityEvent.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        userId:    USER_ID,
                        eventType: 'login_failed',
                        ip:        '192.168.1.55',
                    }),
                }),
            );
        });

        it('сохраняет LOGIN_SUCCESS security event', async () => {
            await svc.writeSecurityEvent({
                tenantId:  TENANT_ID,
                userId:    USER_ID,
                eventType: 'login_success',
                ip:        '10.0.0.1',
            });

            const created = prisma.securityEvent.create.mock.calls[0][0].data;
            expect(created.tenantId).toBe(TENANT_ID);
            expect(created.eventType).toBe('login_success');
        });

        it('сохраняет password_reset_requested без userId', async () => {
            await svc.writeSecurityEvent({
                eventType: 'password_reset_requested',
                ip:        '1.2.3.4',
                metadata:  { email: 'user@test.com' },
            });

            const created = prisma.securityEvent.create.mock.calls[0][0].data;
            expect(created.userId).toBeNull();
            expect(created.tenantId).toBeNull();
            expect(created.eventType).toBe('password_reset_requested');
        });
    });

    // ─── assertOwnerOrAdmin — RBAC ────────────────────────────────────────────

    describe('assertOwnerOrAdmin — RBAC', () => {
        it('OWNER — доступ разрешён', async () => {
            prisma.membership.findFirst.mockResolvedValue({ role: 'OWNER' });
            await expect(svc.assertOwnerOrAdmin(TENANT_ID, USER_ID)).resolves.toBeUndefined();
        });

        it('ADMIN — доступ разрешён', async () => {
            prisma.membership.findFirst.mockResolvedValue({ role: 'ADMIN' });
            await expect(svc.assertOwnerOrAdmin(TENANT_ID, USER_ID)).resolves.toBeUndefined();
        });

        it('MANAGER — AUDIT_ROLE_FORBIDDEN', async () => {
            prisma.membership.findFirst.mockResolvedValue({ role: 'MANAGER' });
            await expect(svc.assertOwnerOrAdmin(TENANT_ID, USER_ID))
                .rejects.toMatchObject({ response: { code: 'AUDIT_ROLE_FORBIDDEN' } });
        });

        it('STAFF — AUDIT_ROLE_FORBIDDEN', async () => {
            prisma.membership.findFirst.mockResolvedValue({ role: 'STAFF' });
            await expect(svc.assertOwnerOrAdmin(TENANT_ID, USER_ID))
                .rejects.toMatchObject({ response: { code: 'AUDIT_ROLE_FORBIDDEN' } });
        });

        it('нет членства — AUDIT_ROLE_FORBIDDEN', async () => {
            prisma.membership.findFirst.mockResolvedValue(null);
            await expect(svc.assertOwnerOrAdmin(TENANT_ID, USER_ID))
                .rejects.toThrow(ForbiddenException);
        });

        it('userId undefined — AUDIT_ACCESS_DENIED', async () => {
            await expect(svc.assertOwnerOrAdmin(TENANT_ID, undefined))
                .rejects.toMatchObject({ response: { code: 'AUDIT_ACCESS_DENIED' } });
        });
    });

    // ─── getLogs ──────────────────────────────────────────────────────────────

    describe('getLogs', () => {
        it('возвращает только tenant-visible записи', async () => {
            prisma.auditLog.findMany.mockResolvedValue([BASE_AUDIT_LOG]);
            prisma.auditLog.count.mockResolvedValue(1);

            const result = await svc.getLogs(TENANT_ID);

            const whereArg = prisma.auditLog.findMany.mock.calls[0][0].where;
            expect(whereArg.visibilityScope).toBe('tenant');
        });

        it('retention window: where.createdAt.gte не ранее 180 дней', async () => {
            prisma.auditLog.findMany.mockResolvedValue([]);
            prisma.auditLog.count.mockResolvedValue(0);

            await svc.getLogs(TENANT_ID);

            const whereArg = prisma.auditLog.findMany.mock.calls[0][0].where;
            const gte: Date = whereArg.createdAt.gte;
            const daysAgo = (Date.now() - gte.getTime()) / (1000 * 60 * 60 * 24);
            expect(daysAgo).toBeCloseTo(180, 0);
        });

        it('зажимает очень старый from до retention window', async () => {
            prisma.auditLog.findMany.mockResolvedValue([]);
            prisma.auditLog.count.mockResolvedValue(0);

            const veryOldFrom = '2020-01-01T00:00:00Z';
            await svc.getLogs(TENANT_ID, { from: veryOldFrom });

            const whereArg = prisma.auditLog.findMany.mock.calls[0][0].where;
            const gte: Date = whereArg.createdAt.gte;
            const daysAgo = (Date.now() - gte.getTime()) / (1000 * 60 * 60 * 24);
            // Must be clamped to ~180 days, not the ancient date
            expect(daysAgo).toBeCloseTo(180, 0);
        });

        it('принимает недавний from и НЕ зажимает его', async () => {
            prisma.auditLog.findMany.mockResolvedValue([]);
            prisma.auditLog.count.mockResolvedValue(0);

            const recentFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            await svc.getLogs(TENANT_ID, { from: recentFrom });

            const whereArg = prisma.auditLog.findMany.mock.calls[0][0].where;
            const gte: Date = whereArg.createdAt.gte;
            const daysAgo = (Date.now() - gte.getTime()) / (1000 * 60 * 60 * 24);
            expect(daysAgo).toBeCloseTo(7, 0);
        });

        it('возвращает meta с retentionDays=180', async () => {
            prisma.auditLog.findMany.mockResolvedValue([]);
            prisma.auditLog.count.mockResolvedValue(0);

            const result = await svc.getLogs(TENANT_ID);
            expect(result.meta.retentionDays).toBe(180);
        });

        it('применяет фильтр по entityType', async () => {
            prisma.auditLog.findMany.mockResolvedValue([]);
            prisma.auditLog.count.mockResolvedValue(0);

            await svc.getLogs(TENANT_ID, { entityType: 'PRODUCT' });

            const whereArg = prisma.auditLog.findMany.mock.calls[0][0].where;
            expect(whereArg.entityType).toBe('PRODUCT');
        });

        it('применяет фильтр по requestId и correlationId', async () => {
            prisma.auditLog.findMany.mockResolvedValue([]);
            prisma.auditLog.count.mockResolvedValue(0);

            await svc.getLogs(TENANT_ID, { requestId: 'req-x', correlationId: 'corr-y' });

            const whereArg = prisma.auditLog.findMany.mock.calls[0][0].where;
            expect(whereArg.requestId).toBe('req-x');
            expect(whereArg.correlationId).toBe('corr-y');
        });

        it('возвращает маскированные записи (strict → before/after null)', async () => {
            const strictLog = { ...BASE_AUDIT_LOG, redactionLevel: 'strict' };
            prisma.auditLog.findMany.mockResolvedValue([strictLog]);
            prisma.auditLog.count.mockResolvedValue(1);

            const result = await svc.getLogs(TENANT_ID);
            expect(result.data[0].before).toBeNull();
            expect(result.data[0].after).toBeNull();
            expect(result.data[0].changedFields).toBeNull();
            expect(result.data[0].metadata).toBeNull();
        });
    });

    // ─── getLog (drill-down) ──────────────────────────────────────────────────

    describe('getLog', () => {
        it('возвращает запись по id', async () => {
            prisma.auditLog.findFirst.mockResolvedValue(BASE_AUDIT_LOG);

            const result = await svc.getLog(TENANT_ID, LOG_ID);
            expect(result.id).toBe(LOG_ID);
            expect(result.eventType).toBe('STOCK_MANUALLY_ADJUSTED');
        });

        it('NOT_FOUND если записи нет', async () => {
            prisma.auditLog.findFirst.mockResolvedValue(null);

            await expect(svc.getLog(TENANT_ID, 'nonexistent'))
                .rejects.toMatchObject({ response: { code: 'AUDIT_RECORD_NOT_FOUND' } });
        });

        it('AUDIT_INTERNAL_ONLY_RECORD для internal_only записи', async () => {
            prisma.auditLog.findFirst.mockResolvedValue({
                ...BASE_AUDIT_LOG,
                visibilityScope: 'internal_only',
            });

            await expect(svc.getLog(TENANT_ID, LOG_ID))
                .rejects.toMatchObject({ response: { code: 'AUDIT_INTERNAL_ONLY_RECORD' } });
        });

        it('применяет redactionLevel=partial — убирает internal metadata keys', async () => {
            prisma.auditLog.findFirst.mockResolvedValue({
                ...BASE_AUDIT_LOG,
                redactionLevel: 'partial',
                metadata: {
                    reasonCode:      'FOUND',
                    internalNote:    'support context',
                    supportTicketId: 'TICK-5',
                    operatorId:      'op-1',
                    requestOrigin:   'internal-tool',
                    debugContext:    'trace info',
                },
            });

            const result = await svc.getLog(TENANT_ID, LOG_ID);
            expect(result.metadata.reasonCode).toBe('FOUND');
            expect(result.metadata.internalNote).toBeUndefined();
            expect(result.metadata.supportTicketId).toBeUndefined();
            expect(result.metadata.operatorId).toBeUndefined();
            expect(result.metadata.requestOrigin).toBeUndefined();
            expect(result.metadata.debugContext).toBeUndefined();
        });
    });

    // ─── getSecurityEvents ────────────────────────────────────────────────────

    describe('getSecurityEvents', () => {
        it('собирает userId всех активных участников тенанта', async () => {
            prisma.membership.findMany.mockResolvedValue([
                { userId: 'u1' }, { userId: 'u2' },
            ]);
            prisma.securityEvent.findMany.mockResolvedValue([]);
            prisma.securityEvent.count.mockResolvedValue(0);

            await svc.getSecurityEvents(TENANT_ID, USER_ID);

            const whereArg = prisma.securityEvent.findMany.mock.calls[0][0].where;
            expect(whereArg.OR).toEqual(
                expect.arrayContaining([
                    { tenantId: TENANT_ID },
                    { userId: { in: ['u1', 'u2'] } },
                ]),
            );
        });

        it('маскирует IPv4 — скрывает последний октет', async () => {
            prisma.membership.findMany.mockResolvedValue([]);
            prisma.securityEvent.findMany.mockResolvedValue([
                { id: 's1', ip: '192.168.10.55', eventType: 'login_failed' },
            ]);
            prisma.securityEvent.count.mockResolvedValue(1);

            const result = await svc.getSecurityEvents(TENANT_ID, USER_ID);
            expect(result.data[0].ip).toBe('192.168.10.*');
        });

        it('маскирует IPv6 — скрывает последнюю группу', async () => {
            prisma.membership.findMany.mockResolvedValue([]);
            prisma.securityEvent.findMany.mockResolvedValue([
                { id: 's2', ip: '2001:db8:85a3:0:0:8a2e:370:7334', eventType: 'login_success' },
            ]);
            prisma.securityEvent.count.mockResolvedValue(1);

            const result = await svc.getSecurityEvents(TENANT_ID, USER_ID);
            expect(result.data[0].ip).toMatch(/\*\*\*\*$/);
            expect(result.data[0].ip).not.toContain('7334');
        });

        it('ip=null → остается null', async () => {
            prisma.membership.findMany.mockResolvedValue([]);
            prisma.securityEvent.findMany.mockResolvedValue([
                { id: 's3', ip: null, eventType: 'password_reset_requested' },
            ]);
            prisma.securityEvent.count.mockResolvedValue(1);

            const result = await svc.getSecurityEvents(TENANT_ID, USER_ID);
            expect(result.data[0].ip).toBeNull();
        });

        it('фильтрует по userId', async () => {
            prisma.membership.findMany.mockResolvedValue([]);
            prisma.securityEvent.findMany.mockResolvedValue([]);
            prisma.securityEvent.count.mockResolvedValue(0);

            await svc.getSecurityEvents(TENANT_ID, USER_ID, { userId: 'specific-user' });

            const whereArg = prisma.securityEvent.findMany.mock.calls[0][0].where;
            expect(whereArg.userId).toBe('specific-user');
        });
    });

    // ─── getCoverageStatus ────────────────────────────────────────────────────

    describe('getCoverageStatus', () => {
        it('возвращает overallCoveragePct=0 если ни одного события нет', async () => {
            prisma.auditLog.findMany.mockResolvedValue([]);

            const result = await svc.getCoverageStatus(TENANT_ID);
            expect(result.tenantId).toBe(TENANT_ID);
            expect(result.overallCoveragePct).toBe(0);
            // All modules present
            expect(result.modules.length).toBeGreaterThan(0);
        });

        it('возвращает 100% по модулю auth если все 6 событий есть', async () => {
            const authEvents = [
                'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT_ALL',
                'SESSION_REVOKED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED',
            ];
            prisma.auditLog.findMany.mockResolvedValue(
                authEvents.map(e => ({ eventType: e, createdAt: new Date() })),
            );

            const result = await svc.getCoverageStatus(TENANT_ID);
            const authModule = result.modules.find(m => m.module === 'auth');
            expect(authModule?.coveragePct).toBe(100);
            expect(authModule?.missing).toHaveLength(0);
        });

        it('corectly reports missing events', async () => {
            // Only LOGIN_SUCCESS covered
            prisma.auditLog.findMany.mockResolvedValue([
                { eventType: 'LOGIN_SUCCESS', createdAt: new Date() },
            ]);

            const result = await svc.getCoverageStatus(TENANT_ID);
            const authModule = result.modules.find(m => m.module === 'auth');
            expect(authModule?.missing).toContain('LOGIN_FAILED');
            expect(authModule?.missing).toContain('LOGOUT_ALL');
            expect(authModule?.coveragePct).toBeLessThan(100);
        });
    });

    // ─── maskAuditLogForTenant (redaction policy) ─────────────────────────────

    describe('maskAuditLogForTenant via getLog', () => {
        it('redactionLevel=none — before/after/metadata проходят насквозь', async () => {
            prisma.auditLog.findFirst.mockResolvedValue({
                ...BASE_AUDIT_LOG,
                redactionLevel: 'none',
            });

            const result = await svc.getLog(TENANT_ID, LOG_ID);
            expect(result.before).toMatchObject({ onHand: 10 });
            expect(result.after).toMatchObject({ onHand: 15 });
            expect(result.metadata).toMatchObject({ reasonCode: 'FOUND' });
        });

        it('redactionLevel=strict — before/after/changedFields/metadata = null', async () => {
            prisma.auditLog.findFirst.mockResolvedValue({
                ...BASE_AUDIT_LOG,
                redactionLevel:  'strict',
                before:          { secret: 'internal' },
                after:           { secret: 'internal2' },
                changedFields:   ['secret'],
                metadata:        { internalNote: 'hidden' },
            });

            const result = await svc.getLog(TENANT_ID, LOG_ID);
            expect(result.before).toBeNull();
            expect(result.after).toBeNull();
            expect(result.changedFields).toBeNull();
            expect(result.metadata).toBeNull();
        });
    });
});
