import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotificationsInboxService {
    constructor(private readonly prisma: PrismaService) {}

    /**
     * Inbox feed для текущего пользователя (cursor-based pagination).
     *
     * cursor — ISO-строка createdAt последнего элемента предыдущей страницы.
     * unreadCount возвращается всегда (независимо от фильтра unreadOnly).
     */
    async getInbox(params: {
        tenantId: string;
        userId: string;
        limit?: number;
        cursor?: string;
        unreadOnly?: boolean;
    }) {
        const { tenantId, userId, limit = 20, cursor, unreadOnly } = params;

        const where = {
            tenantId,
            userId,
            ...(unreadOnly ? { isRead: false } : {}),
            ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
        };

        const [items, unreadCount] = await Promise.all([
            this.prisma.notificationInbox.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: limit + 1,
            }),
            this.prisma.notificationInbox.count({
                where: { tenantId, userId, isRead: false },
            }),
        ]);

        const hasMore = items.length > limit;
        const data = hasMore ? items.slice(0, limit) : items;
        const nextCursor = hasMore ? data[data.length - 1]!.createdAt.toISOString() : null;

        return { items: data, unreadCount, hasMore, nextCursor };
    }

    /**
     * Пометить inbox-запись как прочитанную.
     * Проверяет, что запись принадлежит текущему пользователю и tenant'у.
     */
    async markRead(params: { id: string; tenantId: string; userId: string }) {
        const { id, tenantId, userId } = params;

        const item = await this.prisma.notificationInbox.findFirst({
            where: { id, tenantId, userId },
            select: { id: true, isRead: true },
        });

        if (!item) {
            throw new NotFoundException({ code: 'NOTIFICATION_NOT_FOUND' });
        }

        if (item.isRead) {
            return { ok: true, alreadyRead: true };
        }

        await this.prisma.notificationInbox.update({
            where: { id },
            data: { isRead: true, readAt: new Date() },
        });

        return { ok: true, alreadyRead: false };
    }
}
