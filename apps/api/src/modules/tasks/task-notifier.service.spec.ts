/**
 * TASK_TASKS_6 regression spec для `TaskNotifierService`.
 *
 * Покрывает §16 матрицу:
 *   - debounce: серия комментариев за 30 сек → 1 push (мок таймера);
 *   - notify failure → counter task_notification_send_failures;
 *   - opt-out: pref[eventType] === false → не шлём;
 *   - pref.maxChatId === null → silent skip (нет канала).
 */

import { TaskNotifierService } from './task-notifier.service';
import { TasksMetricNames, TasksMetricsRegistry } from './tasks.metrics';

describe('TaskNotifierService.notifyCommentedDebounced', () => {
    let prisma: any;
    let maxNotifier: any;
    let metrics: TasksMetricsRegistry;
    let svc: TaskNotifierService;

    beforeEach(() => {
        jest.useFakeTimers();
        prisma = {
            userPreference: {
                findUnique: jest.fn().mockResolvedValue({
                    maxChatId: 'chat-1',
                    taskNotifyPreferences: null,
                }),
            },
        };
        maxNotifier = { sendMessage: jest.fn().mockResolvedValue(undefined) };
        metrics = new TasksMetricsRegistry();
        svc = new TaskNotifierService(prisma, maxNotifier, metrics);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('5 комментариев за 30 сек → ровно 1 push, debounce_collapsed += 4', async () => {
        for (let i = 0; i < 5; i++) {
            svc.notifyCommentedDebounced({
                taskId: 't1',
                taskTitle: 'T',
                assigneeUserId: 'u-assignee',
                actorUserId: 'u-actor',
            });
        }
        // Все таймеры обнуляются и пересоздаются — пуш ещё не ушёл
        expect(maxNotifier.sendMessage).not.toHaveBeenCalled();

        // Прыгаем на 30 сек вперёд → trailing-edge fire
        jest.advanceTimersByTime(30_000);
        // Дождёмся async chain (sendToUser возвращает promise)
        await Promise.resolve();
        await Promise.resolve();

        expect(maxNotifier.sendMessage).toHaveBeenCalledTimes(1);
        expect(metrics.snapshot().counters[TasksMetricNames.COMMENT_DEBOUNCE_COLLAPSED]).toBe(4);
    });

    it('комментарий от самого assignee не вызывает notify', () => {
        svc.notifyCommentedDebounced({
            taskId: 't1',
            taskTitle: 'T',
            assigneeUserId: 'u-1',
            actorUserId: 'u-1',
        });
        jest.advanceTimersByTime(60_000);
        expect(maxNotifier.sendMessage).not.toHaveBeenCalled();
    });
});

describe('TaskNotifierService.sendToUser (через notifyAssigned)', () => {
    let prisma: any;
    let maxNotifier: any;
    let metrics: TasksMetricsRegistry;
    let svc: TaskNotifierService;

    beforeEach(() => {
        prisma = {
            userPreference: { findUnique: jest.fn() },
        };
        maxNotifier = { sendMessage: jest.fn() };
        metrics = new TasksMetricsRegistry();
        svc = new TaskNotifierService(prisma, maxNotifier, metrics);
    });

    it('успешный пуш → counter task_notifications_sent +1', async () => {
        prisma.userPreference.findUnique.mockResolvedValue({
            maxChatId: 'chat-1',
            taskNotifyPreferences: null,
        });
        maxNotifier.sendMessage.mockResolvedValue(undefined);

        svc.notifyAssigned({
            taskId: 't1',
            taskTitle: 'T',
            assigneeUserId: 'u-assignee',
            actorUserId: 'u-actor',
        });
        // sendToUser — async; даём microtask flush
        await new Promise((r) => setImmediate(r));

        expect(maxNotifier.sendMessage).toHaveBeenCalledWith('chat-1', expect.any(String));
        expect(metrics.snapshot().counters[TasksMetricNames.NOTIFICATIONS_SENT]).toBe(1);
    });

    it('maxNotifier бросает → counter task_notification_send_failures +1', async () => {
        prisma.userPreference.findUnique.mockResolvedValue({
            maxChatId: 'chat-1',
            taskNotifyPreferences: null,
        });
        maxNotifier.sendMessage.mockRejectedValue(new Error('network'));

        svc.notifyAssigned({
            taskId: 't1',
            taskTitle: 'T',
            assigneeUserId: 'u-assignee',
            actorUserId: 'u-actor',
        });
        await new Promise((r) => setImmediate(r));

        expect(metrics.snapshot().counters[TasksMetricNames.NOTIFICATION_SEND_FAILURES]).toBe(1);
        expect(metrics.snapshot().counters[TasksMetricNames.NOTIFICATIONS_SENT]).toBeUndefined();
    });

    it('opt-out: pref.taskNotifyPreferences[ASSIGNED] === false → skip без send и без counter', async () => {
        prisma.userPreference.findUnique.mockResolvedValue({
            maxChatId: 'chat-1',
            taskNotifyPreferences: { ASSIGNED: false },
        });

        svc.notifyAssigned({
            taskId: 't1',
            taskTitle: 'T',
            assigneeUserId: 'u-assignee',
            actorUserId: 'u-actor',
        });
        await new Promise((r) => setImmediate(r));

        expect(maxNotifier.sendMessage).not.toHaveBeenCalled();
        expect(metrics.snapshot().counters[TasksMetricNames.NOTIFICATIONS_SENT]).toBeUndefined();
    });

    it('нет maxChatId → silent skip, без counter и без error', async () => {
        prisma.userPreference.findUnique.mockResolvedValue({
            maxChatId: null,
            taskNotifyPreferences: null,
        });

        svc.notifyAssigned({
            taskId: 't1',
            taskTitle: 'T',
            assigneeUserId: 'u-assignee',
            actorUserId: 'u-actor',
        });
        await new Promise((r) => setImmediate(r));

        expect(maxNotifier.sendMessage).not.toHaveBeenCalled();
        expect(metrics.snapshot().counters[TasksMetricNames.NOTIFICATION_SEND_FAILURES]).toBeUndefined();
    });
});
