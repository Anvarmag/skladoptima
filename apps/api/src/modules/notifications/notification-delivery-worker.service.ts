import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
    NotificationDispatch,
    NotificationDispatchPolicy,
    NotificationDispatchStatus,
    NotificationChannel,
    NotificationEvent,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InAppAdapter } from './channel-adapters/in-app.adapter';
import { EmailAdapter } from './channel-adapters/email.adapter';
import { DeliveryResult } from './channel-adapters/in-app.adapter';
import { THROTTLE_WINDOW_MS, FUTURE_CHANNELS } from './notification.contract';
import { NotificationsMetricsService } from './notifications-metrics.service';

/** Максимальное число попыток доставки перед переводом в FAILED. */
const MAX_DELIVERY_ATTEMPTS = 3;

/** Batch size: число dispatch-записей за один tick. */
const DISPATCH_BATCH_SIZE = 50;

/**
 * Backoff (секунды) для retry по номеру попытки (0-based index):
 *   Попытка 1 fail → ждём 60 с.
 *   Попытка 2 fail → ждём 300 с (5 мин).
 *   Попытка 3 fail → FAILED, больше retry нет.
 */
const RETRY_BACKOFF_SECONDS = [60, 300, 1800];

type DispatchWithEvent = NotificationDispatch & { event: NotificationEvent };

/**
 * Delivery worker — scheduled поллер очереди dispatch-записей
 * (TASK_NOTIFICATIONS_3).
 *
 * Запускается каждые 30 секунд, забирает batch QUEUED dispatches,
 * роутит каждый на канальный адаптер (IN_APP / EMAIL), обновляет
 * статус в БД. Сбой одного канала не блокирует обработку остальных.
 *
 * Что делает worker:
 *   1. Atomic batch claim (UPDATE WHERE status=QUEUED AND id IN [...]).
 *   2. THROTTLED suppression: если для (tenantId, category, channel)
 *      уже есть SENT/DELIVERED dispatch в окне 15 мин — SKIP.
 *   3. Роутинг к адаптеру.
 *   4. Обновление status: DELIVERED/SENT → success,
 *      QUEUED (scheduledAt) → retry, FAILED → exhausted.
 *
 * Что НЕ делает worker:
 *   - НЕ применяет dedup на уровне событий (это NotificationPolicyService);
 *   - НЕ создаёт новые события (это NotificationsService.publishEvent);
 *   - НЕ форматирует шаблоны для frontend (TASK_NOTIFICATIONS_6).
 */
@Injectable()
export class NotificationDeliveryWorker {
    private readonly logger = new Logger(NotificationDeliveryWorker.name);

    /** Guard от concurrent ticks при медленной обработке batch. */
    private _processing = false;

    constructor(
        private readonly prisma: PrismaService,
        private readonly inAppAdapter: InAppAdapter,
        private readonly emailAdapter: EmailAdapter,
        @Optional() private readonly metrics?: NotificationsMetricsService,
    ) {}

    @Cron('*/30 * * * * *')
    async processQueuedDispatches(): Promise<void> {
        if (this._processing) {
            return;
        }
        this._processing = true;
        try {
            await this._runBatch();
        } finally {
            this._processing = false;
        }
    }

    // ─── Batch pipeline ───────────────────────────────────────────────────

    private async _runBatch(): Promise<void> {
        const now = new Date();

        // 1. Найти кандидатов: QUEUED и scheduledAt <= now (или NULL).
        const candidates = await this.prisma.notificationDispatch.findMany({
            where: {
                status: NotificationDispatchStatus.QUEUED,
                OR: [
                    { scheduledAt: null },
                    { scheduledAt: { lte: now } },
                ],
            },
            include: { event: true },
            take: DISPATCH_BATCH_SIZE,
            orderBy: { createdAt: 'asc' },
        });

        if (candidates.length === 0) return;

        // 2. Atomic claim: UPDATE WHERE status=QUEUED AND id IN [...].
        //    Защита от race между несколькими worker instances.
        const ids = candidates.map((d) => d.id);
        const claimed = await this.prisma.notificationDispatch.updateMany({
            where: {
                id: { in: ids },
                status: NotificationDispatchStatus.QUEUED,
            },
            data: { status: NotificationDispatchStatus.QUEUED }, // touched updatedAt
        });

        if (claimed.count === 0) return;

        // 3. Обрабатываем каждый dispatch независимо (failure isolation).
        const dispatches = candidates as DispatchWithEvent[];
        await Promise.allSettled(dispatches.map((d) => this._processOne(d)));
    }

    // ─── Single dispatch processing ───────────────────────────────────────

    private async _processOne(dispatch: DispatchWithEvent): Promise<void> {
        const { event } = dispatch;

        try {
            // THROTTLED suppression: проверяем, не отправляли ли уже недавно.
            if (dispatch.policy === NotificationDispatchPolicy.THROTTLED) {
                const suppressed = await this._isThrottleSuppressed(
                    event.tenantId,
                    event.category,
                    dispatch.channel,
                    dispatch.id,
                );
                if (suppressed) {
                    await this._markSkipped(dispatch.id);
                    this.metrics?.increment('throttle_suppressed');
                    this.metrics?.increment('dispatch_skipped');
                    this.logger.log(JSON.stringify({
                        event: 'dispatch_throttle_suppressed',
                        dispatchId: dispatch.id,
                        tenantId: event.tenantId,
                        category: event.category,
                        channel: dispatch.channel,
                        ts: new Date().toISOString(),
                    }));
                    return;
                }
            }

            // SCHEDULED: если scheduledAt ещё в будущем — пропускаем.
            if (
                dispatch.policy === NotificationDispatchPolicy.SCHEDULED &&
                dispatch.scheduledAt &&
                dispatch.scheduledAt > new Date()
            ) {
                return;
            }

            // Роутинг к адаптеру.
            const result = await this._route(dispatch, event);

            if (result.success) {
                await this._markDelivered(dispatch.id, dispatch.channel);
                const isFinal = dispatch.channel === NotificationChannel.IN_APP;
                this.metrics?.increment(isFinal ? 'dispatch_delivered' : 'dispatch_sent');
                this.metrics?.recordDeliveryLatency(event.createdAt);
            } else if (result.errorType === 'temporary' && dispatch.attempts + 1 < MAX_DELIVERY_ATTEMPTS) {
                await this._scheduleRetry(dispatch, result.error ?? 'UNKNOWN_ERROR');
                this.metrics?.increment('retry_scheduled');
            } else {
                await this._markFailed(dispatch.id, result.error ?? 'EXHAUSTED');
                this.metrics?.increment('dispatch_failed');
            }
        } catch (err: any) {
            // Defensive catch: adapter не должен throw, но если бросил —
            // не теряем dispatch, пытаемся retry или FAILED.
            this.logger.error(JSON.stringify({
                event: 'dispatch_process_threw',
                dispatchId: dispatch.id,
                tenantId: event.tenantId,
                message: err?.message,
                ts: new Date().toISOString(),
            }));

            if (dispatch.attempts + 1 < MAX_DELIVERY_ATTEMPTS) {
                await this._scheduleRetry(dispatch, err?.message ?? 'INTERNAL_ERROR').catch(() => {});
                this.metrics?.increment('retry_scheduled');
            } else {
                await this._markFailed(dispatch.id, err?.message ?? 'INTERNAL_ERROR').catch(() => {});
                this.metrics?.increment('dispatch_failed');
            }
        }
    }

    // ─── Adapter routing ──────────────────────────────────────────────────

    private async _route(
        dispatch: DispatchWithEvent,
        event: NotificationEvent,
    ): Promise<DeliveryResult> {
        switch (dispatch.channel) {
            case NotificationChannel.IN_APP:
                return this.inAppAdapter.deliver(dispatch, event);
            case NotificationChannel.EMAIL:
                return this.emailAdapter.deliver(dispatch, event);
            default:
                // FUTURE_CHANNELS (TELEGRAM, MAX) — адаптеры не реализованы в MVP.
                // Dispatch помечается FAILED сразу (permanent), без retry.
                // Добавить case выше после реализации адаптера в TASK_NOTIFICATIONS_6+.
                this.logger.warn(JSON.stringify({
                    event: 'dispatch_channel_not_implemented',
                    dispatchId: dispatch.id,
                    channel: dispatch.channel,
                    isFutureChannel: FUTURE_CHANNELS.has(dispatch.channel as NotificationChannel),
                    ts: new Date().toISOString(),
                }));
                return { success: false, errorType: 'permanent', error: 'CHANNEL_NOT_IMPLEMENTED' };
        }
    }

    // ─── THROTTLED suppression ────────────────────────────────────────────

    /**
     * Для THROTTLED dispatches проверяем: есть ли уже SENT или DELIVERED
     * dispatch для (tenantId, category, channel) в последние 15 минут.
     *
     * Исключаем текущий dispatchId, чтобы не suppress сам себя.
     */
    private async _isThrottleSuppressed(
        tenantId: string,
        category: NotificationEvent['category'],
        channel: NotificationChannel,
        currentDispatchId: string,
    ): Promise<boolean> {
        const windowStart = new Date(Date.now() - THROTTLE_WINDOW_MS);

        const recent = await this.prisma.notificationDispatch.findFirst({
            where: {
                id: { not: currentDispatchId },
                channel,
                status: { in: [NotificationDispatchStatus.SENT, NotificationDispatchStatus.DELIVERED] },
                sentAt: { gte: windowStart },
                event: { tenantId, category },
            },
            select: { id: true },
        });

        return recent !== null;
    }

    // ─── Status updates ───────────────────────────────────────────────────

    private async _markDelivered(
        dispatchId: string,
        channel: NotificationChannel,
    ): Promise<void> {
        // IN_APP: помечаем DELIVERED (inbox создан = доставлено).
        // EMAIL и другие каналы: помечаем SENT (принято провайдером).
        const isFinalDelivered = channel === NotificationChannel.IN_APP;
        const now = new Date();

        await this.prisma.notificationDispatch.update({
            where: { id: dispatchId },
            data: {
                status: isFinalDelivered
                    ? NotificationDispatchStatus.DELIVERED
                    : NotificationDispatchStatus.SENT,
                sentAt: now,
                deliveredAt: isFinalDelivered ? now : undefined,
                lastError: null,
            },
        });

        this.logger.log(JSON.stringify({
            event: 'dispatch_delivered',
            dispatchId,
            channel,
            status: isFinalDelivered ? 'DELIVERED' : 'SENT',
            ts: now.toISOString(),
        }));
    }

    private async _scheduleRetry(
        dispatch: DispatchWithEvent,
        lastError: string,
    ): Promise<void> {
        const nextAttempt = dispatch.attempts + 1;
        const backoffIdx = Math.min(dispatch.attempts, RETRY_BACKOFF_SECONDS.length - 1);
        const nextAttemptAt = new Date(Date.now() + RETRY_BACKOFF_SECONDS[backoffIdx] * 1000);

        await this.prisma.notificationDispatch.update({
            where: { id: dispatch.id },
            data: {
                status: NotificationDispatchStatus.QUEUED,
                attempts: nextAttempt,
                lastError,
                scheduledAt: nextAttemptAt,
            },
        });

        this.logger.warn(JSON.stringify({
            event: 'dispatch_retry_scheduled',
            dispatchId: dispatch.id,
            channel: dispatch.channel,
            attempt: nextAttempt,
            nextAttemptAt: nextAttemptAt.toISOString(),
            lastError,
            ts: new Date().toISOString(),
        }));
    }

    private async _markFailed(dispatchId: string, lastError: string): Promise<void> {
        await this.prisma.notificationDispatch.update({
            where: { id: dispatchId },
            data: {
                status: NotificationDispatchStatus.FAILED,
                lastError,
            },
        });

        this.logger.error(JSON.stringify({
            event: 'dispatch_failed',
            dispatchId,
            lastError,
            ts: new Date().toISOString(),
        }));
    }

    private async _markSkipped(dispatchId: string): Promise<void> {
        await this.prisma.notificationDispatch.update({
            where: { id: dispatchId },
            data: { status: NotificationDispatchStatus.SKIPPED },
        });
    }
}
