import { Injectable, Logger } from '@nestjs/common';
import {
    NotificationDispatch,
    NotificationEvent,
    MembershipStatus,
    Role,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildNotificationMessage } from '../notification-message.factory';

export interface DeliveryResult {
    success: boolean;
    /** 'temporary' — retry eligible; 'permanent' — mark FAILED without retry. */
    errorType?: 'temporary' | 'permanent';
    error?: string;
}

/**
 * In-app delivery adapter (TASK_NOTIFICATIONS_3).
 *
 * Создаёт записи `NotificationInbox` для целевых пользователей tenant'а.
 * Inbox creation = delivery: никаких внешних вызовов, поэтому:
 *   - никогда не бросает temporary error;
 *   - единственная причина permanent failure — нет целевых пользователей.
 *
 * Определение целевых пользователей:
 *   1. `event.payload.targetUserId` (string) — только этот пользователь.
 *      Используется AUTH-событиями (password_reset, email_verification, invite).
 *   2. Иначе — все ACTIVE члены tenant'а с ролью OWNER или ADMIN.
 *      MANAGER/STAFF получают уведомления только если явно указаны как targetUserId.
 */
@Injectable()
export class InAppAdapter {
    private readonly logger = new Logger(InAppAdapter.name);

    constructor(private readonly prisma: PrismaService) {}

    async deliver(
        dispatch: NotificationDispatch,
        event: NotificationEvent,
    ): Promise<DeliveryResult> {
        const targetUserIds = await this._resolveTargetUsers(event);

        if (targetUserIds.length === 0) {
            this.logger.warn(JSON.stringify({
                event: 'in_app_no_target_users',
                eventId: event.id,
                tenantId: event.tenantId,
                dispatchId: dispatch.id,
                ts: new Date().toISOString(),
            }));
            return { success: false, errorType: 'permanent', error: 'NO_TARGET_USERS' };
        }

        const { title, body } = buildNotificationMessage(
            event.category,
            event.severity,
            event.payload as Record<string, unknown> | null,
        );

        await this.prisma.notificationInbox.createMany({
            data: targetUserIds.map((userId) => ({
                tenantId: event.tenantId,
                userId,
                title,
                message: body,
            })),
            skipDuplicates: false,
        });

        this.logger.log(JSON.stringify({
            event: 'in_app_inbox_created',
            dispatchId: dispatch.id,
            eventId: event.id,
            tenantId: event.tenantId,
            recipientCount: targetUserIds.length,
            ts: new Date().toISOString(),
        }));

        return { success: true };
    }

    private async _resolveTargetUsers(event: NotificationEvent): Promise<string[]> {
        const payload = event.payload as Record<string, unknown> | null;
        const targetUserId = payload?.targetUserId as string | undefined;

        if (targetUserId) {
            return [targetUserId];
        }

        const memberships = await this.prisma.membership.findMany({
            where: {
                tenantId: event.tenantId,
                status: MembershipStatus.ACTIVE,
                role: { in: [Role.OWNER, Role.ADMIN] },
            },
            select: { userId: true },
        });

        return memberships.map((m) => m.userId);
    }
}
