import { Injectable, Logger, Optional } from '@nestjs/common';
import { NotificationEvent, NotificationDispatch } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationOrchestrator } from './notification-orchestrator.service';
import { MANDATORY_CATEGORIES, PublishNotificationInput } from './notification.contract';
import { NotificationsMetricsService } from './notifications-metrics.service';

/**
 * Публичный API модуля уведомлений (TASK_NOTIFICATIONS_2).
 *
 * Это единственная точка входа для доменных модулей (Auth, Billing, Sync,
 * Inventory, Referrals и т.д.). Модули НЕ должны обращаться к orchestrator
 * или policy service напрямую — только через этот сервис.
 *
 * Ответственность:
 *   - принять PublishNotificationInput от domain module;
 *   - определить isMandatory (по категории или override);
 *   - сохранить NotificationEvent в БД;
 *   - передать событие в NotificationOrchestrator для планирования dispatch;
 *   - вернуть созданные dispatch записи.
 *
 * Что НЕ делает сервис:
 *   - НЕ отправляет уведомления (TASK_NOTIFICATIONS_3);
 *   - НЕ управляет inbox (TASK_NOTIFICATIONS_4);
 *   - НЕ предоставляет API endpoints (TASK_NOTIFICATIONS_4 — preferences/inbox).
 */
@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly orchestrator: NotificationOrchestrator,
        @Optional() private readonly metrics?: NotificationsMetricsService,
    ) {}

    /**
     * Публикует notification event от доменного модуля.
     *
     * Транзакционной атомарности между event и dispatch не требуется:
     * event-запись выживает при ошибке dispatch, и dispatch может быть
     * перепланирован позднее (observability + manual replay). Это предпочтительнее
     * вложенной транзакции, которая потеряла бы event при partial failure
     * (§19 observability requirement).
     *
     * @returns объект с созданным event и dispatch-планом.
     */
    async publishEvent(input: PublishNotificationInput): Promise<{
        event: NotificationEvent;
        dispatches: NotificationDispatch[];
    }> {
        const isMandatory =
            input.isMandatory !== undefined
                ? input.isMandatory
                : MANDATORY_CATEGORIES.has(input.category);

        // 1. Сохраняем event — источник истины, всегда наблюдаем.
        const event = await this.prisma.notificationEvent.create({
            data: {
                tenantId: input.tenantId,
                category: input.category,
                severity: input.severity,
                isMandatory,
                dedup_key: input.dedupKey ?? null,
                payload: input.payload ? (input.payload as object) : undefined,
            },
        });

        this.metrics?.increment('events_created');
        this.logger.log(JSON.stringify({
            event: 'notification_event_created',
            eventId: event.id,
            tenantId: event.tenantId,
            category: event.category,
            severity: event.severity,
            isMandatory: event.isMandatory,
            hasDedupKey: !!event.dedup_key,
            ts: new Date().toISOString(),
        }));

        // 2. Планируем dispatch через оркестратор.
        let dispatches: NotificationDispatch[] = [];
        try {
            dispatches = await this.orchestrator.orchestrate(event);
        } catch (err: any) {
            // Оркестратор не должен throw, но если бросил — не теряем event.
            // Dispatch может быть запланирован повторно через manual replay.
            this.logger.error(JSON.stringify({
                event: 'notification_orchestrator_error',
                eventId: event.id,
                tenantId: event.tenantId,
                message: err?.message,
                ts: new Date().toISOString(),
            }));
        }

        return { event, dispatches };
    }
}
