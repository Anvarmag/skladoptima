/**
 * TASK_TASKS_6 regression spec для `TasksService`.
 *
 * Покрывает §16 тестовую матрицу system-analytics:
 *   - create / assign к non-member → 403 TASK_ASSIGN_TO_NON_MEMBER;
 *   - state transitions включая reopen DONE → OPEN;
 *   - попытка покинуть ARCHIVED → 409 TASK_INVALID_STATE_TRANSITION;
 *   - комментарий в чужой задаче → push assignee;
 *   - paused tenant блокирует write (TASK_WRITE_BLOCKED_BY_TENANT_STATE);
 *   - Inbox-фильтры (assignee=me, overdue=true, relatedOrderId) корректно
 *     собирают Prisma where;
 *   - метрики §19: tasks_created / tasks_completed / time-to-complete
 *     инкрементируются на mutation'ах.
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
    MembershipStatus: {
        ACTIVE: 'ACTIVE',
        PENDING: 'PENDING',
        REVOKED: 'REVOKED',
    },
    TaskEventType: {
        CREATED: 'CREATED',
        UPDATED: 'UPDATED',
        ASSIGNED: 'ASSIGNED',
        STATUS_CHANGED: 'STATUS_CHANGED',
        COMMENTED: 'COMMENTED',
        DUE_CHANGED: 'DUE_CHANGED',
        ARCHIVED: 'ARCHIVED',
        DUE_REMINDER_SENT: 'DUE_REMINDER_SENT',
        OVERDUE_NOTIFIED: 'OVERDUE_NOTIFIED',
    },
    TaskStatus: {
        OPEN: 'OPEN',
        IN_PROGRESS: 'IN_PROGRESS',
        WAITING: 'WAITING',
        DONE: 'DONE',
        ARCHIVED: 'ARCHIVED',
    },
}));

import { ConflictException, ForbiddenException } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksMetricNames, TasksMetricsRegistry } from './tasks.metrics';

const TENANT = 'tenant-1';
const ACTOR = 'user-actor';
const ASSIGNEE = 'user-assignee';
const TASK_ID = 'task-1';

function makeMocks() {
    // tx-стаб разделяет тот же набор моков, что и top-level prisma
    const prisma: any = {
        tenant: {
            findUnique: jest.fn().mockResolvedValue({ accessState: 'ACTIVE_PAID' }),
        },
        membership: {
            findFirst: jest.fn().mockResolvedValue({ id: 'mem-1' }),
        },
        order: {
            findFirst: jest.fn().mockResolvedValue({ id: 'ord-1' }),
        },
        task: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            findMany: jest.fn().mockResolvedValue([]),
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn(),
            update: jest.fn(),
        },
        taskComment: {
            create: jest.fn(),
            findFirst: jest.fn(),
            update: jest.fn(),
        },
        taskEvent: {
            create: jest.fn().mockResolvedValue({}),
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };

    const notifier: any = {
        notifyAssigned: jest.fn(),
        notifyStatusChanged: jest.fn(),
        notifyCommentedDebounced: jest.fn(),
    };

    const metrics = new TasksMetricsRegistry();

    return { prisma, notifier, metrics };
}

function makeSvc(mocks: ReturnType<typeof makeMocks>) {
    return new TasksService(mocks.prisma, mocks.notifier, mocks.metrics);
}

const validTask = {
    id: TASK_ID,
    title: 'T',
    status: 'OPEN',
    assigneeUserId: ASSIGNEE,
    createdByUserId: ACTOR,
    dueAt: null,
};

describe('TasksService.create', () => {
    it('успешно создаёт задачу, шлёт notify ASSIGNED и инкрементит tasks_created', async () => {
        const m = makeMocks();
        m.prisma.task.create.mockResolvedValue({
            id: TASK_ID,
            title: 'New',
            category: 'OTHER',
            priority: 'NORMAL',
        });
        const svc = makeSvc(m);

        const r = await svc.create(TENANT, ACTOR, {
            title: 'New',
            assigneeUserId: ASSIGNEE,
        });

        expect(r.id).toBe(TASK_ID);
        // CREATED + ASSIGNED события в одной транзакции
        expect(m.prisma.taskEvent.createMany).toHaveBeenCalledWith({
            data: expect.arrayContaining([
                expect.objectContaining({ eventType: 'CREATED' }),
                expect.objectContaining({ eventType: 'ASSIGNED' }),
            ]),
        });
        expect(m.notifier.notifyAssigned).toHaveBeenCalledWith(
            expect.objectContaining({ taskId: TASK_ID, assigneeUserId: ASSIGNEE }),
        );
        expect(m.metrics.snapshot().counters[TasksMetricNames.CREATED]).toBe(1);
    });

    it('assign к non-member → 403 TASK_ASSIGN_TO_NON_MEMBER, ничего не пишем', async () => {
        const m = makeMocks();
        m.prisma.membership.findFirst.mockResolvedValue(null);
        const svc = makeSvc(m);

        await expect(
            svc.create(TENANT, ACTOR, { title: 'X', assigneeUserId: 'stranger' }),
        ).rejects.toMatchObject({
            response: { code: 'TASK_ASSIGN_TO_NON_MEMBER' },
        });
        expect(m.prisma.$transaction).not.toHaveBeenCalled();
        expect(m.metrics.snapshot().counters[TasksMetricNames.CREATED]).toBeUndefined();
    });

    it('paused tenant (TRIAL_EXPIRED) блокирует create → 403 TASK_WRITE_BLOCKED_BY_TENANT_STATE', async () => {
        const m = makeMocks();
        m.prisma.tenant.findUnique.mockResolvedValue({ accessState: 'TRIAL_EXPIRED' });
        const svc = makeSvc(m);

        await expect(
            svc.create(TENANT, ACTOR, { title: 'X', assigneeUserId: ASSIGNEE }),
        ).rejects.toMatchObject({
            response: { code: 'TASK_WRITE_BLOCKED_BY_TENANT_STATE' },
        });
    });

    it.each(['SUSPENDED', 'CLOSED'])(
        '%s tenant также блокирует create',
        async (state) => {
            const m = makeMocks();
            m.prisma.tenant.findUnique.mockResolvedValue({ accessState: state });
            const svc = makeSvc(m);

            await expect(
                svc.create(TENANT, ACTOR, { title: 'X', assigneeUserId: ASSIGNEE }),
            ).rejects.toBeInstanceOf(ForbiddenException);
        },
    );
});

describe('TasksService.assign', () => {
    it('assign к non-member → 403, состояние не меняем', async () => {
        const m = makeMocks();
        m.prisma.task.findFirst.mockResolvedValue(validTask);
        m.prisma.membership.findFirst.mockResolvedValue(null);
        const svc = makeSvc(m);

        await expect(
            svc.assign(TENANT, ACTOR, TASK_ID, { assigneeUserId: 'stranger' }),
        ).rejects.toMatchObject({
            response: { code: 'TASK_ASSIGN_TO_NON_MEMBER' },
        });
        expect(m.prisma.$transaction).not.toHaveBeenCalled();
    });
});

describe('TasksService.changeStatus', () => {
    it('OPEN → DONE: completedAt заполнен, tasks_completed инкрементится, time-to-complete observed', async () => {
        const m = makeMocks();
        m.prisma.task.findFirst.mockResolvedValue(validTask);
        const created = new Date(Date.now() - 60_000);
        m.prisma.task.findUnique.mockResolvedValue({
            createdAt: created,
            category: 'OTHER',
            priority: 'NORMAL',
        });
        m.prisma.task.update.mockResolvedValue({ ...validTask, status: 'DONE' });
        const svc = makeSvc(m);

        await svc.changeStatus(TENANT, ACTOR, TASK_ID, { status: 'DONE' as any });

        expect(m.prisma.task.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ status: 'DONE', completedAt: expect.any(Date) }),
            }),
        );
        const snap = m.metrics.snapshot();
        expect(snap.counters[TasksMetricNames.COMPLETED]).toBe(1);
        expect(snap.completion.count).toBe(1);
    });

    it('reopen DONE → OPEN: completedAt сбрасывается в null', async () => {
        const m = makeMocks();
        m.prisma.task.findFirst.mockResolvedValue({ ...validTask, status: 'DONE' });
        m.prisma.task.update.mockResolvedValue({ ...validTask, status: 'OPEN' });
        const svc = makeSvc(m);

        await svc.changeStatus(TENANT, ACTOR, TASK_ID, { status: 'OPEN' as any });

        expect(m.prisma.task.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ status: 'OPEN', completedAt: null }),
            }),
        );
    });

    it('попытка transition из ARCHIVED → 409 TASK_INVALID_STATE_TRANSITION', async () => {
        const m = makeMocks();
        m.prisma.task.findFirst.mockResolvedValue({ ...validTask, status: 'ARCHIVED' });
        const svc = makeSvc(m);

        await expect(
            svc.changeStatus(TENANT, ACTOR, TASK_ID, { status: 'OPEN' as any }),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(m.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('запрещённый transition OPEN → DONE-WAITING сразу → ConflictException', async () => {
        // Делаем заведомо невалидный transition: WAITING → ARCHIVED (не разрешён по §13)
        const m = makeMocks();
        m.prisma.task.findFirst.mockResolvedValue({ ...validTask, status: 'WAITING' });
        const svc = makeSvc(m);

        await expect(
            svc.changeStatus(TENANT, ACTOR, TASK_ID, { status: 'ARCHIVED' as any }),
        ).rejects.toMatchObject({
            response: { code: 'TASK_INVALID_STATE_TRANSITION' },
        });
    });
});

describe('TasksService.addComment', () => {
    it('комментарий в чужой задаче → notifier.notifyCommentedDebounced(assignee)', async () => {
        const m = makeMocks();
        m.prisma.task.findFirst.mockResolvedValue({
            ...validTask,
            assigneeUserId: ASSIGNEE,
            createdByUserId: 'other-creator',
        });
        m.prisma.taskComment.create.mockResolvedValue({ id: 'c1' });
        const svc = makeSvc(m);

        await svc.addComment(TENANT, ACTOR, TASK_ID, { body: 'note' });

        expect(m.notifier.notifyCommentedDebounced).toHaveBeenCalledWith(
            expect.objectContaining({ assigneeUserId: ASSIGNEE, actorUserId: ACTOR }),
        );
    });

    it('paused tenant блокирует комментарий', async () => {
        const m = makeMocks();
        m.prisma.task.findFirst.mockResolvedValue(validTask);
        m.prisma.tenant.findUnique.mockResolvedValue({ accessState: 'SUSPENDED' });
        const svc = makeSvc(m);

        await expect(
            svc.addComment(TENANT, ACTOR, TASK_ID, { body: 'note' }),
        ).rejects.toMatchObject({
            response: { code: 'TASK_WRITE_BLOCKED_BY_TENANT_STATE' },
        });
    });
});

describe('TasksService.findAll Inbox-фильтры', () => {
    it('assignee=me маппится в actorUserId в where', async () => {
        const m = makeMocks();
        const svc = makeSvc(m);

        await svc.findAll(TENANT, ACTOR, { assignee: 'me' } as any);

        const call = m.prisma.task.findMany.mock.calls[0][0];
        expect(call.where).toMatchObject({
            tenantId: TENANT,
            assigneeUserId: ACTOR,
        });
    });

    it('overdue=true добавляет dueAt<now AND status NOT IN (DONE,ARCHIVED) в AND', async () => {
        const m = makeMocks();
        const svc = makeSvc(m);

        await svc.findAll(TENANT, ACTOR, { overdue: true } as any);

        const call = m.prisma.task.findMany.mock.calls[0][0];
        expect(call.where.AND).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ dueAt: { lt: expect.any(Date) } }),
                expect.objectContaining({
                    status: { notIn: ['DONE', 'ARCHIVED'] },
                }),
            ]),
        );
    });

    it('relatedOrderId фильтр прокидывается в where', async () => {
        const m = makeMocks();
        const svc = makeSvc(m);

        await svc.findAll(TENANT, ACTOR, { relatedOrderId: 'ord-42' } as any);

        const call = m.prisma.task.findMany.mock.calls[0][0];
        expect(call.where.relatedOrderId).toBe('ord-42');
    });

    it('view=kanban сортирует по updatedAt desc, view=inbox — dueAt asc + createdAt desc', async () => {
        const m = makeMocks();
        const svc = makeSvc(m);

        await svc.findAll(TENANT, ACTOR, { view: 'kanban' } as any);
        expect(m.prisma.task.findMany.mock.calls[0][0].orderBy).toEqual([{ updatedAt: 'desc' }]);

        m.prisma.task.findMany.mockClear();

        await svc.findAll(TENANT, ACTOR, { view: 'inbox' } as any);
        expect(m.prisma.task.findMany.mock.calls[0][0].orderBy).toEqual([
            { dueAt: { sort: 'asc', nulls: 'last' } },
            { createdAt: 'desc' },
        ]);
    });
});
