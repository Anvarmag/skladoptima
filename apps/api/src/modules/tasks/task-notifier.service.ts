import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MaxNotifierService } from '../max-notifier/max-notifier.service';
import { TasksMetricsRegistry, TasksMetricNames } from './tasks.metrics';

type TaskEventType = 'ASSIGNED' | 'STATUS_CHANGED' | 'COMMENTED' | 'DUE_REMINDER' | 'OVERDUE';

@Injectable()
export class TaskNotifierService {
    private readonly logger = new Logger(TaskNotifierService.name);

    // In-memory debouncer для COMMENTED: key=`${taskId}:${recipientUserId}` → таймер
    private readonly commentDebouncers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly COMMENT_DEBOUNCE_MS = 30_000;

    // Хранение количества "склеенных" комментариев для метрики debounce-collapsed
    private readonly debounceCounts = new Map<string, number>();

    // Counter для observability (§19 аналитики)
    private notifyFailures = 0;

    constructor(
        private readonly prisma: PrismaService,
        private readonly maxNotifier: MaxNotifierService,
        private readonly metrics: TasksMetricsRegistry,
    ) {}

    // ─── Публичные методы ─────────────────────────────────────────────────────

    notifyAssigned(params: {
        taskId: string;
        taskTitle: string;
        assigneeUserId: string;
        actorUserId: string;
    }): void {
        if (params.assigneeUserId === params.actorUserId) return;
        void this.sendToUser(
            params.assigneeUserId,
            `Вам назначена задача: "${params.taskTitle}"\nhttps://app/tasks/${params.taskId}`,
            'ASSIGNED',
        );
    }

    notifyStatusChanged(params: {
        taskId: string;
        taskTitle: string;
        assigneeUserId: string;
        actorUserId: string;
        newStatus: string;
    }): void {
        if (params.actorUserId === params.assigneeUserId) return;
        void this.sendToUser(
            params.assigneeUserId,
            `Статус изменён на ${params.newStatus}: "${params.taskTitle}"\nhttps://app/tasks/${params.taskId}`,
            'STATUS_CHANGED',
        );
    }

    // Trailing-edge debounce 30 сек: серия комментариев → один пуш (§15 аналитики)
    notifyCommentedDebounced(params: {
        taskId: string;
        taskTitle: string;
        assigneeUserId: string;
        actorUserId: string;
    }): void {
        if (params.actorUserId === params.assigneeUserId) return;
        const key = `${params.taskId}:${params.assigneeUserId}`;

        const existing = this.commentDebouncers.get(key);
        if (existing) clearTimeout(existing);

        // Подсчёт склеенных серий: каждый input в одно окно — +1
        const prevCount = this.debounceCounts.get(key) ?? 0;
        this.debounceCounts.set(key, prevCount + 1);

        const handle = setTimeout(() => {
            const collapsed = this.debounceCounts.get(key) ?? 1;
            this.commentDebouncers.delete(key);
            this.debounceCounts.delete(key);

            // §19: counter для каждой серии комментариев, схлопнутой в 1 пуш
            if (collapsed > 1) {
                this.metrics.increment(TasksMetricNames.COMMENT_DEBOUNCE_COLLAPSED, {
                    notificationType: 'COMMENTED',
                    source: 'notifier',
                }, collapsed - 1);
            }

            void this.sendToUser(
                params.assigneeUserId,
                `Новый комментарий в задаче: "${params.taskTitle}"\nhttps://app/tasks/${params.taskId}`,
                'COMMENTED',
            );
        }, this.COMMENT_DEBOUNCE_MS);

        this.commentDebouncers.set(key, handle);
    }

    async notifyDueReminder(taskId: string, taskTitle: string, assigneeUserId: string): Promise<void> {
        await this.sendToUser(
            assigneeUserId,
            `Дедлайн задачи менее чем через 1 час: "${taskTitle}"\nhttps://app/tasks/${taskId}`,
            'DUE_REMINDER',
        );
    }

    async notifyOverdue(taskId: string, taskTitle: string, assigneeUserId: string): Promise<void> {
        await this.sendToUser(
            assigneeUserId,
            `Задача просрочена: "${taskTitle}"\nhttps://app/tasks/${taskId}`,
            'OVERDUE',
        );
    }

    // ─── Приватные ────────────────────────────────────────────────────────────

    private async sendToUser(userId: string, message: string, eventType: TaskEventType): Promise<void> {
        try {
            const pref = await this.prisma.userPreference.findUnique({
                where: { userId },
                select: { maxChatId: true, taskNotifyPreferences: true },
            });

            if (!pref?.maxChatId) return;

            // Per-user opt-out: если preference явно задан false — пропускаем
            if (pref.taskNotifyPreferences) {
                const prefs = pref.taskNotifyPreferences as Record<string, boolean>;
                if (prefs[eventType] === false) return;
            }

            await this.maxNotifier.sendMessage(pref.maxChatId, message);

            // §19: успешный пуш — counter per channel+type
            this.metrics.increment(TasksMetricNames.NOTIFICATIONS_SENT, {
                channel: 'max',
                notificationType: eventType,
                source: 'notifier',
            });
        } catch (err: any) {
            this.notifyFailures++;
            this.metrics.increment(TasksMetricNames.NOTIFICATION_SEND_FAILURES, {
                channel: 'max',
                notificationType: eventType,
                source: 'notifier',
            });
            this.logger.error(JSON.stringify({
                event: 'task_notification_send_failure',
                total: this.notifyFailures,
                userId,
                eventType,
                message: err?.message,
                ts: new Date().toISOString(),
            }));
        }
    }
}
