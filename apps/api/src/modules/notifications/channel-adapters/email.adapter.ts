import { Injectable, Logger } from '@nestjs/common';
import {
    NotificationDispatch,
    NotificationEvent,
    MembershipStatus,
    Role,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildNotificationMessage } from '../notification-message.factory';
import { DeliveryResult } from './in-app.adapter';

/**
 * Email delivery adapter (TASK_NOTIFICATIONS_3).
 *
 * MVP: stub-реализация со структурированным логом.
 * Провайдер-ready интерфейс: подключение реального email-провайдера
 * (SendGrid / Postmark / Mailgun) требует замены только метода
 * `_sendViaProvider()` без изменения delivery pipeline.
 *
 * Определение получателя:
 *   1. `event.payload.targetUserId` → email этого пользователя.
 *   2. `event.payload.targetUserEmail` → прямой email (без DB-запроса).
 *   3. Иначе → email primary owner tenant'а.
 *
 * Статус delivery:
 *   - SENT: письмо принято провайдером (provider returns 2xx).
 *     Фактический DELIVERED нельзя отследить без webhook от провайдера —
 *     это TASK_NOTIFICATIONS_7+ (observability phase).
 *   - Temporary error → retry eligible.
 *   - Permanent error (invalid email, unsubscribed) → FAILED.
 */
@Injectable()
export class EmailAdapter {
    private readonly logger = new Logger(EmailAdapter.name);

    constructor(private readonly prisma: PrismaService) {}

    async deliver(
        dispatch: NotificationDispatch,
        event: NotificationEvent,
    ): Promise<DeliveryResult> {
        const recipientEmail = await this._resolveRecipientEmail(event);

        if (!recipientEmail) {
            this.logger.warn(JSON.stringify({
                event: 'email_no_recipient',
                dispatchId: dispatch.id,
                eventId: event.id,
                tenantId: event.tenantId,
                ts: new Date().toISOString(),
            }));
            return { success: false, errorType: 'permanent', error: 'NO_RECIPIENT_EMAIL' };
        }

        const { title, body } = buildNotificationMessage(
            event.category,
            event.severity,
            event.payload as Record<string, unknown> | null,
        );

        return this._sendViaProvider(dispatch.id, event.id, recipientEmail, title, body);
    }

    // ─── Provider integration point ───────────────────────────────────────

    /**
     * MVP stub — логирует письмо в structured-log формате.
     *
     * TODO T15-30: replace with real email provider.
     * Signature stays the same — swap implementation, not the interface.
     * Provider should return:
     *   - success=true, messageId=<provider-id> on acceptance;
     *   - success=false, errorType='temporary' on 5xx / timeout;
     *   - success=false, errorType='permanent' on invalid email / bounce.
     */
    private async _sendViaProvider(
        dispatchId: string,
        eventId: string,
        to: string,
        subject: string,
        body: string,
    ): Promise<DeliveryResult> {
        this.logger.log(JSON.stringify({
            event: 'email_sent_stub',
            dispatchId,
            eventId,
            to,
            subject,
            bodyPreview: body.slice(0, 120),
            ts: new Date().toISOString(),
        }));

        return { success: true };
    }

    // ─── Recipient resolution ─────────────────────────────────────────────

    private async _resolveRecipientEmail(event: NotificationEvent): Promise<string | null> {
        const payload = event.payload as Record<string, unknown> | null;

        // Priority 1: direct email in payload (fastest path)
        const directEmail = payload?.targetUserEmail as string | undefined;
        if (directEmail) return directEmail;

        // Priority 2: userId in payload → load user email
        const targetUserId = payload?.targetUserId as string | undefined;
        if (targetUserId) {
            const user = await this.prisma.user.findUnique({
                where: { id: targetUserId },
                select: { email: true },
            });
            return user?.email ?? null;
        }

        // Priority 3: tenant primary owner
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: event.tenantId },
            select: { primaryOwnerUserId: true },
        });
        if (!tenant?.primaryOwnerUserId) return null;

        const owner = await this.prisma.user.findUnique({
            where: { id: tenant.primaryOwnerUserId },
            select: { email: true },
        });
        return owner?.email ?? null;
    }
}
