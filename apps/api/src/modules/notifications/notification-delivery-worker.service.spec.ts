/**
 * TASK_NOTIFICATIONS_7 — NotificationDeliveryWorker spec.
 *
 * Покрывает delivery pipeline (§15 system-analytics):
 *   - IN_APP dispatch → DELIVERED статус, email verification → SENT;
 *   - THROTTLED: recent SENT dispatch → SKIPPED (low-stock без спама);
 *   - временный сбой провайдера (attempt 0-2) → retry с backoff;
 *   - исчерпание попыток → FAILED;
 *   - permanent error (no recipients, invalid config) → FAILED сразу;
 *   - future channel (TELEGRAM/MAX) → permanent FAILED без вызова адаптера;
 *   - пустая очередь → ничего не вызывается.
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    NotificationCategory: {
        AUTH: 'AUTH', BILLING: 'BILLING', SYNC: 'SYNC',
        INVENTORY: 'INVENTORY', REFERRAL: 'REFERRAL', SYSTEM: 'SYSTEM',
    },
    NotificationChannel: { EMAIL: 'EMAIL', IN_APP: 'IN_APP', TELEGRAM: 'TELEGRAM', MAX: 'MAX' },
    NotificationSeverity: { CRITICAL: 'CRITICAL', WARNING: 'WARNING', INFO: 'INFO' },
    NotificationDispatchPolicy: {
        INSTANT: 'INSTANT', THROTTLED: 'THROTTLED', SCHEDULED: 'SCHEDULED', DIGEST: 'DIGEST',
    },
    NotificationDispatchStatus: {
        QUEUED: 'QUEUED', SENT: 'SENT', DELIVERED: 'DELIVERED', FAILED: 'FAILED', SKIPPED: 'SKIPPED',
    },
}));

import { NotificationDeliveryWorker } from './notification-delivery-worker.service';
import {
    NotificationDispatchStatus,
    NotificationChannel,
    NotificationDispatchPolicy,
} from '@prisma/client';

const TENANT = 'tenant-1';

function makeEvent(overrides: any = {}) {
    return {
        id: 'event-1',
        tenantId: TENANT,
        category: 'SYNC',
        severity: 'WARNING',
        isMandatory: false,
        dedup_key: null,
        payload: null,
        createdAt: new Date('2026-04-28T10:00:00Z'),
        ...overrides,
    };
}

function makeDispatch(overrides: any = {}): any {
    return {
        id: 'dispatch-1',
        eventId: 'event-1',
        channel: NotificationChannel.IN_APP,
        policy: NotificationDispatchPolicy.INSTANT,
        status: NotificationDispatchStatus.QUEUED,
        attempts: 0,
        scheduledAt: null,
        sentAt: null,
        deliveredAt: null,
        lastError: null,
        createdAt: new Date('2026-04-28T10:00:00Z'),
        event: makeEvent(),
        ...overrides,
    };
}

function makePrisma(opts: {
    dispatches?: any[];
    claimedCount?: number;
    throttleRecent?: any | null;
} = {}) {
    const dispatches = opts.dispatches ?? [];
    return {
        notificationDispatch: {
            findMany: jest.fn().mockResolvedValue(dispatches),
            updateMany: jest.fn().mockResolvedValue({
                count: opts.claimedCount ?? dispatches.length,
            }),
            findFirst: jest.fn().mockResolvedValue(opts.throttleRecent ?? null),
            update: jest.fn().mockResolvedValue({}),
        },
        notificationInbox: {
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        membership: {
            findMany: jest.fn().mockResolvedValue([{ userId: 'user-1' }]),
        },
        user: {
            findUnique: jest.fn().mockResolvedValue({ email: 'user@test.com' }),
        },
        tenant: {
            findUnique: jest.fn().mockResolvedValue({ primaryOwnerUserId: 'user-1' }),
        },
    } as any;
}

function makeAdapter(result: any = { success: true }) {
    return { deliver: jest.fn().mockResolvedValue(result) };
}

function makeWorker(
    prisma: any,
    inApp: any = makeAdapter(),
    email: any = makeAdapter(),
) {
    return new NotificationDeliveryWorker(prisma, inApp as any, email as any);
}

// ─── Успешная доставка ────────────────────────────────────────────────────────

describe('NotificationDeliveryWorker — успешная доставка', () => {
    it('IN_APP dispatch → adapt.deliver вызван, update до DELIVERED', async () => {
        const dispatch = makeDispatch({ channel: NotificationChannel.IN_APP });
        const prisma = makePrisma({ dispatches: [dispatch] });
        const inApp = makeAdapter({ success: true });
        const worker = makeWorker(prisma, inApp);

        await worker.processQueuedDispatches();

        expect(inApp.deliver).toHaveBeenCalledTimes(1);
        const statusUpdates = prisma.notificationDispatch.update.mock.calls
            .map((c: any[]) => c[0]?.data?.status)
            .filter(Boolean);
        expect(statusUpdates).toContain(NotificationDispatchStatus.DELIVERED);
    });

    it('EMAIL dispatch (instant email verification) → deliver вызван, update до SENT', async () => {
        const dispatch = makeDispatch({
            channel: NotificationChannel.EMAIL,
            policy: NotificationDispatchPolicy.INSTANT,
            event: makeEvent({
                category: 'AUTH',
                isMandatory: true,
                payload: { eventType: 'EMAIL_VERIFICATION', targetUserId: 'user-1' },
            }),
        });
        const prisma = makePrisma({ dispatches: [dispatch] });
        const email = makeAdapter({ success: true });
        const worker = makeWorker(prisma, makeAdapter(), email);

        await worker.processQueuedDispatches();

        expect(email.deliver).toHaveBeenCalledTimes(1);
        const statusUpdates = prisma.notificationDispatch.update.mock.calls
            .map((c: any[]) => c[0]?.data?.status)
            .filter(Boolean);
        expect(statusUpdates).toContain(NotificationDispatchStatus.SENT);
    });

    it('пустая очередь → ни адаптер не вызван, updateMany не вызван', async () => {
        const prisma = makePrisma({ dispatches: [] });
        const inApp = makeAdapter();
        const email = makeAdapter();
        const worker = makeWorker(prisma, inApp, email);

        await worker.processQueuedDispatches();

        expect(inApp.deliver).not.toHaveBeenCalled();
        expect(email.deliver).not.toHaveBeenCalled();
        expect(prisma.notificationDispatch.updateMany).not.toHaveBeenCalled();
    });
});

// ─── THROTTLED suppression ────────────────────────────────────────────────────

describe('NotificationDeliveryWorker — THROTTLED', () => {
    it('есть недавний SENT dispatch (low-stock) → помечается SKIPPED без доставки', async () => {
        const dispatch = makeDispatch({
            policy: NotificationDispatchPolicy.THROTTLED,
            event: makeEvent({ category: 'INVENTORY' }),
        });
        const prisma = makePrisma({
            dispatches: [dispatch],
            throttleRecent: { id: 'recent-dispatch' },
        });
        const inApp = makeAdapter();
        const worker = makeWorker(prisma, inApp);

        await worker.processQueuedDispatches();

        expect(inApp.deliver).not.toHaveBeenCalled();
        const statusUpdates = prisma.notificationDispatch.update.mock.calls
            .map((c: any[]) => c[0]?.data?.status)
            .filter(Boolean);
        expect(statusUpdates).toContain(NotificationDispatchStatus.SKIPPED);
    });

    it('нет недавнего SENT (первый sync alert) → доставляется нормально', async () => {
        const dispatch = makeDispatch({
            policy: NotificationDispatchPolicy.THROTTLED,
            event: makeEvent({ category: 'SYNC' }),
        });
        const prisma = makePrisma({
            dispatches: [dispatch],
            throttleRecent: null,
        });
        const inApp = makeAdapter({ success: true });
        const worker = makeWorker(prisma, inApp);

        await worker.processQueuedDispatches();

        expect(inApp.deliver).toHaveBeenCalledTimes(1);
    });
});

// ─── Retry и failures ────────────────────────────────────────────────────────

describe('NotificationDeliveryWorker — retry и failures', () => {
    it('временный сбой провайдера (attempt 0) → scheduleRetry: attempts+1, scheduledAt в будущем', async () => {
        const dispatch = makeDispatch({ attempts: 0 });
        const prisma = makePrisma({ dispatches: [dispatch] });
        const inApp = makeAdapter({ success: false, errorType: 'temporary', error: 'PROVIDER_TIMEOUT' });
        const worker = makeWorker(prisma, inApp);

        await worker.processQueuedDispatches();

        const retryCall = prisma.notificationDispatch.update.mock.calls.find(
            (c: any[]) => c[0]?.data?.scheduledAt instanceof Date,
        );
        expect(retryCall).toBeDefined();
        expect(retryCall[0].data.attempts).toBe(1);
        expect(retryCall[0].data.lastError).toBe('PROVIDER_TIMEOUT');
        expect(retryCall[0].data.status).toBe(NotificationDispatchStatus.QUEUED);
    });

    it('временный сбой на попытке 2 (attempt=2 >= MAX-1) → FAILED без retry', async () => {
        // MAX_DELIVERY_ATTEMPTS=3: attempt+1=3 не меньше 3 → FAILED
        const dispatch = makeDispatch({ attempts: 2 });
        const prisma = makePrisma({ dispatches: [dispatch] });
        const inApp = makeAdapter({ success: false, errorType: 'temporary', error: 'TIMEOUT' });
        const worker = makeWorker(prisma, inApp);

        await worker.processQueuedDispatches();

        const failedCall = prisma.notificationDispatch.update.mock.calls.find(
            (c: any[]) => c[0]?.data?.status === NotificationDispatchStatus.FAILED,
        );
        expect(failedCall).toBeDefined();
        const retryCall = prisma.notificationDispatch.update.mock.calls.find(
            (c: any[]) => c[0]?.data?.scheduledAt instanceof Date,
        );
        expect(retryCall).toBeUndefined();
    });

    it('permanent error (NO_TARGET_USERS, attempt=0) → FAILED сразу без retry', async () => {
        const dispatch = makeDispatch({ attempts: 0 });
        const prisma = makePrisma({ dispatches: [dispatch] });
        const inApp = makeAdapter({ success: false, errorType: 'permanent', error: 'NO_TARGET_USERS' });
        const worker = makeWorker(prisma, inApp);

        await worker.processQueuedDispatches();

        const failedCall = prisma.notificationDispatch.update.mock.calls.find(
            (c: any[]) => c[0]?.data?.status === NotificationDispatchStatus.FAILED,
        );
        expect(failedCall).toBeDefined();
        const retryCall = prisma.notificationDispatch.update.mock.calls.find(
            (c: any[]) => c[0]?.data?.scheduledAt instanceof Date,
        );
        expect(retryCall).toBeUndefined();
    });

    it('TELEGRAM (future channel) → FAILED немедленно, адаптеры не вызываются', async () => {
        const dispatch = makeDispatch({ channel: NotificationChannel.TELEGRAM });
        const prisma = makePrisma({ dispatches: [dispatch] });
        const inApp = makeAdapter();
        const email = makeAdapter();
        const worker = makeWorker(prisma, inApp, email);

        await worker.processQueuedDispatches();

        expect(inApp.deliver).not.toHaveBeenCalled();
        expect(email.deliver).not.toHaveBeenCalled();
        const failedCall = prisma.notificationDispatch.update.mock.calls.find(
            (c: any[]) => c[0]?.data?.status === NotificationDispatchStatus.FAILED,
        );
        expect(failedCall).toBeDefined();
        expect(failedCall[0].data.lastError).toContain('CHANNEL_NOT_IMPLEMENTED');
    });

    it('MAX (future channel) → FAILED немедленно', async () => {
        const dispatch = makeDispatch({ channel: NotificationChannel.MAX });
        const prisma = makePrisma({ dispatches: [dispatch] });
        const worker = makeWorker(prisma);

        await worker.processQueuedDispatches();

        const failedCall = prisma.notificationDispatch.update.mock.calls.find(
            (c: any[]) => c[0]?.data?.status === NotificationDispatchStatus.FAILED,
        );
        expect(failedCall).toBeDefined();
    });

    it('SCHEDULED dispatch с scheduledAt в будущем → не обрабатывается (ранний return)', async () => {
        const futureDate = new Date(Date.now() + 60_000);
        const dispatch = makeDispatch({
            policy: NotificationDispatchPolicy.SCHEDULED,
            scheduledAt: futureDate,
        });
        const prisma = makePrisma({ dispatches: [dispatch] });
        const inApp = makeAdapter();
        const worker = makeWorker(prisma, inApp);

        await worker.processQueuedDispatches();

        expect(inApp.deliver).not.toHaveBeenCalled();
        // Никаких status-update вызовов (dispatch оставлен в QUEUED)
        expect(prisma.notificationDispatch.update).not.toHaveBeenCalled();
    });

    it('адаптер бросает исключение → retry scheduled (defensive catch)', async () => {
        const dispatch = makeDispatch({ attempts: 0 });
        const prisma = makePrisma({ dispatches: [dispatch] });
        const inApp = { deliver: jest.fn().mockRejectedValue(new Error('unexpected_adapter_throw')) };
        const worker = makeWorker(prisma, inApp as any);

        await worker.processQueuedDispatches();

        const retryCall = prisma.notificationDispatch.update.mock.calls.find(
            (c: any[]) => c[0]?.data?.scheduledAt instanceof Date,
        );
        expect(retryCall).toBeDefined();
    });
});

// ─── Concurrent tick guard ────────────────────────────────────────────────────

describe('NotificationDeliveryWorker — concurrent tick guard', () => {
    it('второй тик при активной обработке → findMany не вызывается второй раз', async () => {
        let resolveFirst!: () => void;
        const firstBatch = new Promise<void>((res) => { resolveFirst = res; });

        const dispatch = makeDispatch();
        const prisma = {
            ...makePrisma({ dispatches: [dispatch] }),
            notificationDispatch: {
                findMany: jest.fn()
                    .mockImplementationOnce(() => firstBatch.then(() => [dispatch]))
                    .mockResolvedValue([]),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                findFirst: jest.fn().mockResolvedValue(null),
                update: jest.fn().mockResolvedValue({}),
            },
        } as any;

        const inApp = makeAdapter({ success: true });
        const worker = makeWorker(prisma, inApp as any);

        const firstTick = worker.processQueuedDispatches();
        // Второй тик стартует пока первый ещё занят
        await worker.processQueuedDispatches();
        // findMany вызван только один раз (guard сработал)
        expect(prisma.notificationDispatch.findMany).toHaveBeenCalledTimes(1);
        resolveFirst();
        await firstTick;
    });
});
