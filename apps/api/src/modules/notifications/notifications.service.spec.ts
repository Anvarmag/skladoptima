/**
 * TASK_NOTIFICATIONS_7 — NotificationsService spec.
 *
 * Покрывает §3-4 system-analytics:
 *   - isMandatory авто-определяется по категории (AUTH/BILLING/SYSTEM → true);
 *   - явный override isMandatory=true работает для любой категории;
 *   - оркестратор бросает исключение → event всё равно сохранён, dispatches=[].
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    NotificationCategory: {
        AUTH: 'AUTH', BILLING: 'BILLING', SYNC: 'SYNC',
        INVENTORY: 'INVENTORY', REFERRAL: 'REFERRAL', SYSTEM: 'SYSTEM',
    },
    NotificationChannel: { EMAIL: 'EMAIL', IN_APP: 'IN_APP', TELEGRAM: 'TELEGRAM', MAX: 'MAX' },
    NotificationSeverity: { CRITICAL: 'CRITICAL', WARNING: 'WARNING', INFO: 'INFO' },
    NotificationDispatchPolicy: { INSTANT: 'INSTANT', THROTTLED: 'THROTTLED', SCHEDULED: 'SCHEDULED', DIGEST: 'DIGEST' },
    NotificationDispatchStatus: { QUEUED: 'QUEUED', SENT: 'SENT', DELIVERED: 'DELIVERED', FAILED: 'FAILED', SKIPPED: 'SKIPPED' },
}));

import { NotificationsService } from './notifications.service';
import { NotificationCategory, NotificationSeverity } from '@prisma/client';

const TENANT = 'tenant-1';

function makePrisma(eventOverrides: any = {}) {
    return {
        notificationEvent: {
            create: jest.fn().mockResolvedValue({
                id: 'event-1',
                tenantId: TENANT,
                category: 'AUTH',
                severity: 'INFO',
                isMandatory: true,
                dedup_key: null,
                payload: null,
                createdAt: new Date('2026-04-28T10:00:00Z'),
                ...eventOverrides,
            }),
        },
    } as any;
}

function makeOrchestrator(dispatches: any[] = [], throws = false) {
    return {
        orchestrate: throws
            ? jest.fn().mockRejectedValue(new Error('orchestration_error'))
            : jest.fn().mockResolvedValue(dispatches),
    } as any;
}

describe('NotificationsService.publishEvent', () => {
    it('AUTH category → isMandatory=true автоматически', async () => {
        const prisma = makePrisma({ category: 'AUTH', isMandatory: true });
        const svc = new NotificationsService(prisma, makeOrchestrator());

        await svc.publishEvent({
            tenantId: TENANT,
            category: NotificationCategory.AUTH,
            severity: NotificationSeverity.INFO,
        });

        const createArgs = prisma.notificationEvent.create.mock.calls[0][0];
        expect(createArgs.data.isMandatory).toBe(true);
    });

    it('BILLING category → isMandatory=true автоматически', async () => {
        const prisma = makePrisma({ category: 'BILLING', isMandatory: true });
        const svc = new NotificationsService(prisma, makeOrchestrator());

        await svc.publishEvent({
            tenantId: TENANT,
            category: NotificationCategory.BILLING,
            severity: NotificationSeverity.CRITICAL,
        });

        const createArgs = prisma.notificationEvent.create.mock.calls[0][0];
        expect(createArgs.data.isMandatory).toBe(true);
    });

    it('REFERRAL category → isMandatory=false автоматически', async () => {
        const prisma = makePrisma({ category: 'REFERRAL', isMandatory: false });
        const svc = new NotificationsService(prisma, makeOrchestrator());

        await svc.publishEvent({
            tenantId: TENANT,
            category: NotificationCategory.REFERRAL,
            severity: NotificationSeverity.INFO,
        });

        const createArgs = prisma.notificationEvent.create.mock.calls[0][0];
        expect(createArgs.data.isMandatory).toBe(false);
    });

    it('SYNC category, явный isMandatory=true override → передаётся в БД', async () => {
        const prisma = makePrisma({ category: 'SYNC', isMandatory: true });
        const svc = new NotificationsService(prisma, makeOrchestrator());

        await svc.publishEvent({
            tenantId: TENANT,
            category: NotificationCategory.SYNC,
            severity: NotificationSeverity.CRITICAL,
            isMandatory: true,
        });

        const createArgs = prisma.notificationEvent.create.mock.calls[0][0];
        expect(createArgs.data.isMandatory).toBe(true);
    });

    it('dedupKey задан → передаётся как dedup_key', async () => {
        const prisma = makePrisma({ dedup_key: 'sync_failed:acc-1', isMandatory: false });
        const svc = new NotificationsService(prisma, makeOrchestrator());

        await svc.publishEvent({
            tenantId: TENANT,
            category: NotificationCategory.SYNC,
            severity: NotificationSeverity.WARNING,
            dedupKey: 'sync_failed:acc-1',
        });

        const createArgs = prisma.notificationEvent.create.mock.calls[0][0];
        expect(createArgs.data.dedup_key).toBe('sync_failed:acc-1');
    });

    it('оркестратор бросает исключение → event сохранён, dispatches=[]', async () => {
        const prisma = makePrisma();
        const svc = new NotificationsService(prisma, makeOrchestrator([], true));

        const { event, dispatches } = await svc.publishEvent({
            tenantId: TENANT,
            category: NotificationCategory.AUTH,
            severity: NotificationSeverity.INFO,
        });

        expect(prisma.notificationEvent.create).toHaveBeenCalledTimes(1);
        expect(event).toBeDefined();
        expect(event.id).toBe('event-1');
        expect(dispatches).toEqual([]);
    });
});
