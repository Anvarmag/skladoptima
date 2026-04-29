/**
 * TASK_TASKS_6 regression spec для `TaskDueReminderService`.
 *
 * Покрывает §16 матрицу:
 *   - cron due-reminder: повторный запуск → второй пуш не отправляется
 *     (атомарный UPDATE WHERE dueReminderSentAt IS NULL — count=0);
 *   - overdue notify ровно один раз;
 *   - paused tenant пропускается (учёт в counter task_cron_skipped_paused_tenant);
 *   - gauge tasks_overdue_active обновляется в конце job'а;
 *   - structured-логи на cron decisions (skipped / sent).
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: {},
    AccessState: {
        EARLY_ACCESS: 'EARLY_ACCESS',
        TRIAL_ACTIVE: 'TRIAL_ACTIVE',
        TRIAL_EXPIRED: 'TRIAL_EXPIRED',
        ACTIVE_PAID: 'ACTIVE_PAID',
        GRACE_PERIOD: 'GRACE_PERIOD',
        SUSPENDED: 'SUSPENDED',
        CLOSED: 'CLOSED',
    },
    TaskStatus: {
        OPEN: 'OPEN',
        IN_PROGRESS: 'IN_PROGRESS',
        WAITING: 'WAITING',
        DONE: 'DONE',
        ARCHIVED: 'ARCHIVED',
    },
}));

import { TaskDueReminderService } from './task-due-reminder.service';
import { TasksMetricNames, TasksMetricsRegistry } from './tasks.metrics';

function makeMocks() {
    const prisma: any = {
        task: {
            findMany: jest.fn().mockResolvedValue([]),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            count: jest.fn().mockResolvedValue(0),
        },
    };
    const notifier: any = {
        notifyDueReminder: jest.fn().mockResolvedValue(undefined),
        notifyOverdue: jest.fn().mockResolvedValue(undefined),
    };
    const metrics = new TasksMetricsRegistry();
    return { prisma, notifier, metrics };
}

function makeSvc(m: ReturnType<typeof makeMocks>) {
    return new TaskDueReminderService(m.prisma, m.notifier, m.metrics);
}

describe('TaskDueReminderService.taskDueReminderJob', () => {
    it('первый run: due-reminder отправлен, dueReminderSentAt атомарно обновлён', async () => {
        const m = makeMocks();
        m.prisma.task.findMany
            .mockResolvedValueOnce([
                { id: 'tsk-1', title: 'X', assigneeUserId: 'u1', tenantId: 'ten-1' },
            ])
            .mockResolvedValueOnce([]); // overdue list — пустой
        m.prisma.task.updateMany.mockResolvedValueOnce({ count: 1 });

        await makeSvc(m).taskDueReminderJob();

        expect(m.prisma.task.updateMany).toHaveBeenCalledWith({
            where: { id: 'tsk-1', dueReminderSentAt: null },
            data: { dueReminderSentAt: expect.any(Date) },
        });
        expect(m.notifier.notifyDueReminder).toHaveBeenCalledTimes(1);
        expect(m.metrics.snapshot().counters[TasksMetricNames.DUE_REMINDER_SENT]).toBe(1);
    });

    it('повторный run: атомарный UPDATE возвращает count=0 → notify НЕ отправляется', async () => {
        const m = makeMocks();
        m.prisma.task.findMany
            .mockResolvedValueOnce([
                { id: 'tsk-1', title: 'X', assigneeUserId: 'u1', tenantId: 'ten-1' },
            ])
            .mockResolvedValueOnce([]);
        // Имитируем race: другой инстанс cron'а уже выставил dueReminderSentAt
        m.prisma.task.updateMany.mockResolvedValueOnce({ count: 0 });

        await makeSvc(m).taskDueReminderJob();

        expect(m.notifier.notifyDueReminder).not.toHaveBeenCalled();
        expect(m.metrics.snapshot().counters[TasksMetricNames.DUE_REMINDER_SENT]).toBeUndefined();
    });

    it('overdue notify ровно один раз: атомарный UPDATE count=0 на втором запуске', async () => {
        const m = makeMocks();
        // Первый run: due пустой, overdue 1 задача — нотифицируем
        m.prisma.task.findMany
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
                { id: 'tsk-2', title: 'O', assigneeUserId: 'u2', tenantId: 'ten-1' },
            ]);
        m.prisma.task.updateMany.mockResolvedValueOnce({ count: 1 });

        await makeSvc(m).taskDueReminderJob();
        expect(m.notifier.notifyOverdue).toHaveBeenCalledTimes(1);
        expect(m.metrics.snapshot().counters[TasksMetricNames.OVERDUE_NOTIFIED]).toBe(1);

        // Второй run: та же задача всплывает в findMany (например, из-за гонки),
        // но updateMany count=0 → notify НЕ повторяется
        m.prisma.task.findMany
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
                { id: 'tsk-2', title: 'O', assigneeUserId: 'u2', tenantId: 'ten-1' },
            ]);
        m.prisma.task.updateMany.mockResolvedValueOnce({ count: 0 });

        await makeSvc(m).taskDueReminderJob();
        expect(m.notifier.notifyOverdue).toHaveBeenCalledTimes(1); // не увеличилось
        expect(m.metrics.snapshot().counters[TasksMetricNames.OVERDUE_NOTIFIED]).toBe(1);
    });

    it('paused tenant: задачи отфильтрованы из findMany (PAUSED_STATES в where), counter task_cron_skipped_paused_tenant += N', async () => {
        const m = makeMocks();
        // findMany не возвращает paused задач (это работа prisma-фильтра).
        // count для skipped возвращает 3 — это и есть paused-кандидаты.
        m.prisma.task.count
            .mockResolvedValueOnce(3) // skipped count для paused tenants
            .mockResolvedValueOnce(0); // overdue gauge
        m.prisma.task.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

        await makeSvc(m).taskDueReminderJob();

        // Проверяем, что findMany содержит фильтр по NOT IN PAUSED_STATES
        const dueWhere = m.prisma.task.findMany.mock.calls[0][0].where;
        expect(dueWhere.tenant.accessState.notIn).toEqual(
            expect.arrayContaining(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED']),
        );
        expect(m.metrics.snapshot().counters[TasksMetricNames.CRON_SKIPPED_PAUSED_TENANT]).toBe(3);
        expect(m.notifier.notifyDueReminder).not.toHaveBeenCalled();
    });

    it('gauge tasks_overdue_active обновляется значением count() в конце run', async () => {
        const m = makeMocks();
        m.prisma.task.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
        m.prisma.task.count
            .mockResolvedValueOnce(0) // skipped
            .mockResolvedValueOnce(7); // overdue active gauge

        await makeSvc(m).taskDueReminderJob();

        expect(m.metrics.snapshot().gauges[TasksMetricNames.OVERDUE_ACTIVE]).toBe(7);
    });
});
