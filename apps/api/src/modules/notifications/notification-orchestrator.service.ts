import { Injectable, Logger } from '@nestjs/common';
import {
    NotificationEvent,
    NotificationDispatch,
    NotificationDispatchStatus,
    Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationPolicyService } from './notification-policy.service';
import { MANDATORY_CATEGORIES } from './notification.contract';

/**
 * Dispatch orchestration pipeline (TASK_NOTIFICATIONS_2).
 *
 * Принимает сохранённый `NotificationEvent`, вызывает policy engine для
 * получения `DispatchPlan`, и создаёт `NotificationDispatch` записи в БД.
 *
 * Паттерн «event сохраняется первым, dispatch планируется вторым» обеспечивает:
 *   - event всегда прослеживаем в истории, даже если dispatch был SKIPPED;
 *   - policy engine может читать реальный `event.id` для dedup lookup.
 *
 * Что НЕ делает оркестратор:
 *   - НЕ отправляет сообщения (TASK_NOTIFICATIONS_3 — worker delivers);
 *   - НЕ форматирует тексты для каналов (delivery adapter responsibility);
 *   - НЕ управляет retry — dispatch worker следит за status/attempts.
 */
@Injectable()
export class NotificationOrchestrator {
    private readonly logger = new Logger(NotificationOrchestrator.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly policy: NotificationPolicyService,
    ) {}

    /**
     * Планирует dispatch для переданного события.
     *
     * @returns созданные `NotificationDispatch[]`. Пустой массив означает,
     *   что событие было либо подавлено dedup, либо все каналы отключены
     *   preferences (только для non-mandatory).
     */
    async orchestrate(event: NotificationEvent): Promise<NotificationDispatch[]> {
        const plan = await this.policy.evaluate({
            tenantId: event.tenantId,
            category: event.category,
            severity: event.severity,
            isMandatory: event.isMandatory,
            dedupKey: event.dedup_key ?? undefined,
            eventId: event.id,
        });

        if (plan.skippedByDedup) {
            // Фиксируем факт подавления в лог, но не создаём dispatch.
            // Event остаётся в БД для аналитики dedup_suppressed.
            this.logger.log(JSON.stringify({
                event: 'notification_orchestrator_dedup_skip',
                eventId: event.id,
                tenantId: event.tenantId,
                category: event.category,
                dedupKey: event.dedup_key,
                ts: new Date().toISOString(),
            }));
            return [];
        }

        if (plan.dispatches.length === 0) {
            this.logger.log(JSON.stringify({
                event: 'notification_orchestrator_no_channels',
                eventId: event.id,
                tenantId: event.tenantId,
                category: event.category,
                isMandatory: event.isMandatory,
                ts: new Date().toISOString(),
            }));
            return [];
        }

        // Создаём dispatch записи в одной транзакции.
        const dispatches = await this._createDispatches(event.id, plan.dispatches.map(d => ({
            channel: d.channel,
            policy: d.policy,
        })));

        this.logger.log(JSON.stringify({
            event: 'notification_dispatches_created',
            eventId: event.id,
            tenantId: event.tenantId,
            category: event.category,
            severity: event.severity,
            isMandatory: event.isMandatory,
            channels: plan.dispatches.map(d => d.channel),
            policies: plan.dispatches.map(d => d.policy),
            count: dispatches.length,
            ts: new Date().toISOString(),
        }));

        return dispatches;
    }

    // ─── Private ──────────────────────────────────────────────────────────

    private async _createDispatches(
        eventId: string,
        plans: Array<{ channel: string; policy: string }>,
    ): Promise<NotificationDispatch[]> {
        const data: Prisma.NotificationDispatchCreateManyInput[] = plans.map((p) => ({
            eventId,
            channel: p.channel as NotificationDispatch['channel'],
            policy: p.policy as NotificationDispatch['policy'],
            status: NotificationDispatchStatus.QUEUED,
            attempts: 0,
        }));

        await this.prisma.notificationDispatch.createMany({ data });

        // Возвращаем созданные записи для caller'а.
        return this.prisma.notificationDispatch.findMany({
            where: { eventId, status: NotificationDispatchStatus.QUEUED },
        });
    }
}
