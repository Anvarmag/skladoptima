import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AccessState, TaskStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TaskNotifierService } from './task-notifier.service';
import { TasksMetricsRegistry, TasksMetricNames } from './tasks.metrics';

const TERMINAL_STATUSES: TaskStatus[] = [TaskStatus.DONE, TaskStatus.ARCHIVED];
const PAUSED_STATES: AccessState[] = [
    AccessState.TRIAL_EXPIRED,
    AccessState.SUSPENDED,
    AccessState.CLOSED,
];

@Injectable()
export class TaskDueReminderService {
    private readonly logger = new Logger(TaskDueReminderService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly notifier: TaskNotifierService,
        private readonly metrics: TasksMetricsRegistry,
    ) {}

    // Каждые 10 минут (§15 аналитики: due/overdue cron)
    @Cron('0 */10 * * * *')
    async taskDueReminderJob(): Promise<void> {
        const now = new Date();
        const in1h = new Date(now.getTime() + 60 * 60 * 1000);

        // §19, §20: paused-tenant counter — задачи скипнутых тенантов считаем
        // отдельно, чтобы видеть в логах "сколько reminder-кандидатов мы НЕ
        // отправили из-за SUSPENDED/TRIAL_EXPIRED/CLOSED".
        const skippedCount = await this.prisma.task.count({
            where: {
                dueAt: { lt: in1h },
                dueReminderSentAt: null,
                status: { notIn: TERMINAL_STATUSES },
                tenant: { accessState: { in: PAUSED_STATES } },
            },
        });
        if (skippedCount > 0) {
            this.metrics.increment(
                TasksMetricNames.CRON_SKIPPED_PAUSED_TENANT,
                { source: 'cron' },
                skippedCount,
            );
            this.logger.log(JSON.stringify({
                event: 'task_cron_skipped_paused_tenant',
                count: skippedCount,
                ts: now.toISOString(),
            }));
        }

        // ── Due reminder: dueAt IN [now, now+1h], ещё не отправляли, не завершены ──
        const dueSoon = await this.prisma.task.findMany({
            where: {
                dueAt: { gte: now, lte: in1h },
                dueReminderSentAt: null,
                status: { notIn: TERMINAL_STATUSES },
                tenant: { accessState: { notIn: PAUSED_STATES } },
            },
            select: { id: true, title: true, assigneeUserId: true, tenantId: true },
        });

        let sentDue = 0;
        for (const task of dueSoon) {
            // Атомарный гард: UPDATE WHERE dueReminderSentAt IS NULL гарантирует,
            // что при параллельном запуске cron второй инстанс пропускает задачу (§20).
            const { count } = await this.prisma.task.updateMany({
                where: { id: task.id, dueReminderSentAt: null },
                data: { dueReminderSentAt: now },
            });

            if (count > 0) {
                sentDue++;
                await this.notifier.notifyDueReminder(task.id, task.title, task.assigneeUserId);
                this.metrics.increment(TasksMetricNames.DUE_REMINDER_SENT, {
                    tenantId: task.tenantId,
                    source: 'cron',
                });
                this.logger.log(JSON.stringify({
                    event: 'due_reminder_sent',
                    taskId: task.id,
                    ts: now.toISOString(),
                }));
            }
        }

        // ── Overdue: dueAt < now, просрочены, ещё не уведомляли ──
        const overdue = await this.prisma.task.findMany({
            where: {
                dueAt: { lt: now },
                overdueNotifiedAt: null,
                status: { notIn: TERMINAL_STATUSES },
                tenant: { accessState: { notIn: PAUSED_STATES } },
            },
            select: { id: true, title: true, assigneeUserId: true, tenantId: true },
        });

        let sentOverdue = 0;
        for (const task of overdue) {
            const { count } = await this.prisma.task.updateMany({
                where: { id: task.id, overdueNotifiedAt: null },
                data: { overdueNotifiedAt: now },
            });

            if (count > 0) {
                sentOverdue++;
                await this.notifier.notifyOverdue(task.id, task.title, task.assigneeUserId);
                this.metrics.increment(TasksMetricNames.OVERDUE_NOTIFIED, {
                    tenantId: task.tenantId,
                    source: 'cron',
                });
                this.logger.log(JSON.stringify({
                    event: 'overdue_notified',
                    taskId: task.id,
                    ts: now.toISOString(),
                }));
            }
        }

        // §19: gauge tasks_overdue_active = текущие просроченные открытые задачи.
        // Считаем после всей работы cron — отражает «здесь и сейчас»-snapshot.
        const overdueActive = await this.prisma.task.count({
            where: {
                dueAt: { lt: now },
                status: { notIn: TERMINAL_STATUSES },
            },
        });
        this.metrics.setGauge(TasksMetricNames.OVERDUE_ACTIVE, overdueActive, {
            source: 'cron',
        });

        if (dueSoon.length > 0 || overdue.length > 0) {
            this.logger.log(JSON.stringify({
                event: 'task_due_reminder_job_complete',
                dueReminders: sentDue,
                overdueNotified: sentOverdue,
                overdueActive,
                ts: now.toISOString(),
            }));
        }
    }
}
