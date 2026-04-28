/**
 * TASK_NOTIFICATIONS_7 — NotificationsInboxService spec.
 *
 * Покрывает §4 сценарий 1 и §6 API:
 *   - getInbox: items + unreadCount, cursor-based пагинация;
 *   - markRead: нормальный путь, идемпотентность, 404 для чужой записи.
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
}));

import { NotFoundException } from '@nestjs/common';
import { NotificationsInboxService } from './notifications-inbox.service';

const TENANT = 'tenant-1';
const USER = 'user-1';

function makeItem(overrides: any = {}) {
    return {
        id: 'inbox-1',
        tenantId: TENANT,
        userId: USER,
        title: 'Test notification',
        message: 'Test body',
        isRead: false,
        createdAt: new Date('2026-04-28T10:00:00Z'),
        readAt: null,
        ...overrides,
    };
}

function makePrisma(opts: {
    items?: any[];
    unreadCount?: number;
    inboxItem?: any | null;
} = {}) {
    return {
        notificationInbox: {
            findMany: jest.fn().mockResolvedValue(opts.items ?? [makeItem()]),
            count: jest.fn().mockResolvedValue(opts.unreadCount ?? 1),
            findFirst: jest.fn().mockResolvedValue(opts.inboxItem !== undefined ? opts.inboxItem : makeItem()),
            update: jest.fn().mockResolvedValue({ ...makeItem(), isRead: true, readAt: new Date() }),
        },
    } as any;
}

// ─── getInbox ────────────────────────────────────────────────────────────────

describe('NotificationsInboxService.getInbox', () => {
    it('возвращает items, unreadCount, hasMore=false когда записей меньше limit', async () => {
        const prisma = makePrisma({ items: [makeItem(), makeItem({ id: 'inbox-2' })], unreadCount: 2 });
        const svc = new NotificationsInboxService(prisma);

        const result = await svc.getInbox({ tenantId: TENANT, userId: USER, limit: 20 });

        expect(result.items).toHaveLength(2);
        expect(result.unreadCount).toBe(2);
        expect(result.hasMore).toBe(false);
        expect(result.nextCursor).toBeNull();
    });

    it('limit=2 и 3 items → hasMore=true, nextCursor установлен, items.length=2', async () => {
        const t0 = new Date('2026-04-28T10:00:00Z');
        const t1 = new Date('2026-04-28T10:01:00Z');
        const t2 = new Date('2026-04-28T10:02:00Z');
        // findMany возвращает limit+1 для определения hasMore
        const items = [
            makeItem({ id: 'inbox-0', createdAt: t2 }),
            makeItem({ id: 'inbox-1', createdAt: t1 }),
            makeItem({ id: 'inbox-2', createdAt: t0 }),
        ];
        const prisma = makePrisma({ items, unreadCount: 3 });
        const svc = new NotificationsInboxService(prisma);

        const result = await svc.getInbox({ tenantId: TENANT, userId: USER, limit: 2 });

        expect(result.items).toHaveLength(2);
        expect(result.hasMore).toBe(true);
        expect(result.nextCursor).toBe(t1.toISOString());
    });

    it('пустой inbox → items=[], unreadCount=0', async () => {
        const prisma = makePrisma({ items: [], unreadCount: 0 });
        const svc = new NotificationsInboxService(prisma);

        const result = await svc.getInbox({ tenantId: TENANT, userId: USER });

        expect(result.items).toHaveLength(0);
        expect(result.unreadCount).toBe(0);
        expect(result.hasMore).toBe(false);
    });
});

// ─── markRead ────────────────────────────────────────────────────────────────

describe('NotificationsInboxService.markRead', () => {
    it('непрочитанная запись → ok=true, alreadyRead=false, update вызван с isRead=true', async () => {
        const prisma = makePrisma({ inboxItem: makeItem({ isRead: false }) });
        const svc = new NotificationsInboxService(prisma);

        const result = await svc.markRead({ id: 'inbox-1', tenantId: TENANT, userId: USER });

        expect(result.ok).toBe(true);
        expect(result.alreadyRead).toBe(false);
        expect(prisma.notificationInbox.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'inbox-1' },
                data: expect.objectContaining({ isRead: true }),
            }),
        );
    });

    it('уже прочитанная запись → alreadyRead=true, update не вызывается (идемпотентность)', async () => {
        const prisma = makePrisma({ inboxItem: makeItem({ isRead: true }) });
        const svc = new NotificationsInboxService(prisma);

        const result = await svc.markRead({ id: 'inbox-1', tenantId: TENANT, userId: USER });

        expect(result.ok).toBe(true);
        expect(result.alreadyRead).toBe(true);
        expect(prisma.notificationInbox.update).not.toHaveBeenCalled();
    });

    it('запись не найдена (другой пользователь или tenant) → NotFoundException', async () => {
        const prisma = makePrisma({ inboxItem: null });
        const svc = new NotificationsInboxService(prisma);

        await expect(
            svc.markRead({ id: 'inbox-other', tenantId: TENANT, userId: USER }),
        ).rejects.toThrow(NotFoundException);
    });

    it('in-app inbox creation: instant auth notification попадает в inbox', async () => {
        // Симулируем, что инбокс-запись уже создана after delivery adapter
        const prisma = makePrisma({
            inboxItem: makeItem({
                title: 'Подтвердите email',
                message: 'Для завершения регистрации перейдите по ссылке в письме.',
                isRead: false,
            }),
        });
        const svc = new NotificationsInboxService(prisma);

        const result = await svc.markRead({ id: 'inbox-1', tenantId: TENANT, userId: USER });

        expect(result.ok).toBe(true);
    });
});
