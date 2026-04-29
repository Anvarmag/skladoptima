import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    ConflictException,
    BadRequestException,
    Logger,
} from '@nestjs/common';
import {
    AccessState,
    MembershipStatus,
    TaskEventType,
    TaskStatus,
    Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TaskNotifierService } from './task-notifier.service';
import { TasksMetricsRegistry, TasksMetricNames } from './tasks.metrics';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { AssignTaskDto } from './dto/assign-task.dto';
import { ChangeStatusDto } from './dto/change-status.dto';
import { AddCommentDto } from './dto/add-comment.dto';
import { ListTasksQueryDto } from './dto/list-tasks.query';

const WRITE_BLOCKED_STATES = new Set<AccessState>([
    AccessState.TRIAL_EXPIRED,
    AccessState.SUSPENDED,
    AccessState.CLOSED,
]);

// §13: разрешённые переходы состояний задачи.
// ARCHIVED — терминальное: Set пустой, переход невозможен.
const VALID_TRANSITIONS = new Map<TaskStatus, ReadonlySet<TaskStatus>>([
    [TaskStatus.OPEN,        new Set([TaskStatus.IN_PROGRESS, TaskStatus.WAITING, TaskStatus.DONE, TaskStatus.ARCHIVED])],
    [TaskStatus.IN_PROGRESS, new Set([TaskStatus.WAITING, TaskStatus.DONE, TaskStatus.OPEN])],
    [TaskStatus.WAITING,     new Set([TaskStatus.IN_PROGRESS, TaskStatus.DONE, TaskStatus.OPEN])],
    [TaskStatus.DONE,        new Set([TaskStatus.ARCHIVED, TaskStatus.OPEN])],
    [TaskStatus.ARCHIVED,    new Set()],
]);

@Injectable()
export class TasksService {
    private readonly logger = new Logger(TasksService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly notifier: TaskNotifierService,
        private readonly metrics: TasksMetricsRegistry,
    ) {}

    // ─── Create ───────────────────────────────────────────────────────────────

    async create(tenantId: string, actorUserId: string, dto: CreateTaskDto) {
        await this.assertWriteAllowed(tenantId);
        await this.assertActiveMember(tenantId, dto.assigneeUserId);

        if (dto.relatedOrderId) {
            await this.assertOrderBelongsToTenant(tenantId, dto.relatedOrderId);
        }

        const dueAt = dto.dueAt ? new Date(dto.dueAt) : null;

        const task = await this.prisma.$transaction(async (tx) => {
            const created = await tx.task.create({
                data: {
                    tenantId,
                    title: dto.title,
                    description: dto.description ?? null,
                    category: dto.category ?? 'OTHER',
                    priority: dto.priority ?? 'NORMAL',
                    status: TaskStatus.OPEN,
                    assigneeUserId: dto.assigneeUserId,
                    createdByUserId: actorUserId,
                    dueAt,
                    relatedOrderId: dto.relatedOrderId ?? null,
                    relatedProductId: dto.relatedProductId ?? null,
                    tags: dto.tags ?? [],
                },
            });

            // CREATED + ASSIGNED — два отдельных event'а по §9 step 1
            await tx.taskEvent.createMany({
                data: [
                    {
                        tenantId,
                        taskId: created.id,
                        actorUserId,
                        eventType: TaskEventType.CREATED,
                        payload: {
                            title: created.title,
                            category: created.category,
                            priority: created.priority,
                        },
                    },
                    {
                        tenantId,
                        taskId: created.id,
                        actorUserId,
                        eventType: TaskEventType.ASSIGNED,
                        payload: { from: null, to: dto.assigneeUserId },
                    },
                ],
            });

            this.logger.log(JSON.stringify({
                event: 'task_created',
                taskId: created.id,
                tenantId,
                category: created.category,
                ts: new Date().toISOString(),
            }));

            return created;
        });

        this.metrics.increment(TasksMetricNames.CREATED, {
            tenantId,
            category: task.category,
            priority: task.priority,
            source: 'service',
        });

        // Fire-and-forget: ошибки нотификаций не должны валить API (§20)
        this.notifier.notifyAssigned({
            taskId: task.id,
            taskTitle: task.title,
            assigneeUserId: dto.assigneeUserId,
            actorUserId,
        });

        return task;
    }

    // ─── Update ───────────────────────────────────────────────────────────────
    // Обновляет title / description / category / priority / tags / dueAt.
    // Смена assignee и статуса — через отдельные методы assign / changeStatus.

    async update(tenantId: string, actorUserId: string, taskId: string, dto: UpdateTaskDto) {
        const task = await this.findTaskOrThrow(tenantId, taskId);
        await this.assertWriteAllowed(tenantId);

        const changedFields: string[] = [];
        const updateData: Record<string, unknown> = {};

        if (dto.title !== undefined)       { updateData.title       = dto.title;       changedFields.push('title'); }
        if (dto.description !== undefined) { updateData.description = dto.description; changedFields.push('description'); }
        if (dto.category !== undefined)    { updateData.category    = dto.category;    changedFields.push('category'); }
        if (dto.priority !== undefined)    { updateData.priority    = dto.priority;    changedFields.push('priority'); }
        if (dto.tags !== undefined)        { updateData.tags        = dto.tags;        changedFields.push('tags'); }

        const dueChanged = dto.dueAt !== undefined;
        let newDueAt: Date | null = null;
        if (dueChanged) {
            newDueAt = dto.dueAt ? new Date(dto.dueAt) : null;
            updateData.dueAt = newDueAt;
            // Новый дедлайн = новое окно напоминаний (§9 step 2)
            updateData.dueReminderSentAt = null;
            updateData.overdueNotifiedAt = null;
            changedFields.push('dueAt');
        }

        if (changedFields.length === 0) {
            return task;
        }

        return this.prisma.$transaction(async (tx) => {
            const updated = await tx.task.update({
                where: { id: taskId },
                data: updateData,
            });

            const events: Prisma.TaskEventCreateManyInput[] = [
                {
                    tenantId,
                    taskId,
                    actorUserId,
                    eventType: TaskEventType.UPDATED,
                    payload: { changedFields },
                },
            ];

            if (dueChanged) {
                events.push({
                    tenantId,
                    taskId,
                    actorUserId,
                    eventType: TaskEventType.DUE_CHANGED,
                    payload: {
                        from: task.dueAt?.toISOString() ?? null,
                        to: newDueAt?.toISOString() ?? null,
                    },
                });
            }

            await tx.taskEvent.createMany({ data: events });

            return updated;
        });
    }

    // ─── Assign ───────────────────────────────────────────────────────────────

    async assign(tenantId: string, actorUserId: string, taskId: string, dto: AssignTaskDto) {
        const task = await this.findTaskOrThrow(tenantId, taskId);
        await this.assertWriteAllowed(tenantId);
        await this.assertActiveMember(tenantId, dto.assigneeUserId);

        const result = await this.prisma.$transaction(async (tx) => {
            const updated = await tx.task.update({
                where: { id: taskId },
                data: { assigneeUserId: dto.assigneeUserId },
            });

            await tx.taskEvent.create({
                data: {
                    tenantId,
                    taskId,
                    actorUserId,
                    eventType: TaskEventType.ASSIGNED,
                    payload: { from: task.assigneeUserId, to: dto.assigneeUserId },
                },
            });

            this.logger.log(JSON.stringify({
                metric: 'task_assigned',
                taskId,
                tenantId,
                from: task.assigneeUserId,
                to: dto.assigneeUserId,
                ts: new Date().toISOString(),
            }));

            return updated;
        });

        this.notifier.notifyAssigned({
            taskId,
            taskTitle: task.title,
            assigneeUserId: dto.assigneeUserId,
            actorUserId,
        });

        return result;
    }

    // ─── Change Status ────────────────────────────────────────────────────────

    async changeStatus(tenantId: string, actorUserId: string, taskId: string, dto: ChangeStatusDto) {
        const task = await this.findTaskOrThrow(tenantId, taskId);
        await this.assertWriteAllowed(tenantId);
        this.assertValidTransition(task.status, dto.status);

        const updateData: Record<string, unknown> = { status: dto.status };
        const completedAt = dto.status === TaskStatus.DONE ? new Date() : null;

        if (dto.status === TaskStatus.DONE) {
            updateData.completedAt = completedAt;
        } else if (dto.status === TaskStatus.OPEN) {
            // reopen: сбрасываем completedAt (§13: reopen DONE → OPEN разрешён)
            updateData.completedAt = null;
        } else if (dto.status === TaskStatus.ARCHIVED) {
            updateData.archivedAt = new Date();
        }

        const result = await this.prisma.$transaction(async (tx) => {
            const updated = await tx.task.update({
                where: { id: taskId },
                data: updateData,
            });

            await tx.taskEvent.create({
                data: {
                    tenantId,
                    taskId,
                    actorUserId,
                    eventType: TaskEventType.STATUS_CHANGED,
                    payload: { from: task.status, to: dto.status },
                },
            });

            this.logger.log(JSON.stringify({
                event: 'task_status_changed',
                taskId,
                tenantId,
                from: task.status,
                to: dto.status,
                ts: new Date().toISOString(),
            }));

            return updated;
        });

        // §19: tasks_completed counter + time-to-complete histogram on DONE
        if (dto.status === TaskStatus.DONE && completedAt) {
            this.metrics.increment(TasksMetricNames.COMPLETED, {
                tenantId,
                source: 'service',
            });
            const fullTask = await this.prisma.task.findUnique({
                where: { id: taskId },
                select: { createdAt: true, category: true, priority: true },
            });
            if (fullTask) {
                const ms = completedAt.getTime() - fullTask.createdAt.getTime();
                this.metrics.observeCompletion(ms, {
                    tenantId,
                    category: fullTask.category,
                    priority: fullTask.priority,
                });
            }
        }

        this.notifier.notifyStatusChanged({
            taskId,
            taskTitle: task.title,
            assigneeUserId: task.assigneeUserId,
            actorUserId,
            newStatus: dto.status,
        });

        return result;
    }

    // ─── Archive ──────────────────────────────────────────────────────────────
    // OWNER/ADMIN или автор задачи (§9 step 5). ARCHIVED — терминальное (§13).

    async archive(tenantId: string, actorUserId: string, taskId: string) {
        const task = await this.findTaskOrThrow(tenantId, taskId);
        await this.assertWriteAllowed(tenantId);
        this.assertValidTransition(task.status, TaskStatus.ARCHIVED);
        await this.assertCanArchive(tenantId, actorUserId, task.createdByUserId);

        return this.prisma.$transaction(async (tx) => {
            const updated = await tx.task.update({
                where: { id: taskId },
                data: {
                    status: TaskStatus.ARCHIVED,
                    archivedAt: new Date(),
                },
            });

            await tx.taskEvent.create({
                data: {
                    tenantId,
                    taskId,
                    actorUserId,
                    eventType: TaskEventType.ARCHIVED,
                    payload: { from: task.status },
                },
            });

            return updated;
        });
    }

    // ─── Add Comment ──────────────────────────────────────────────────────────

    async addComment(tenantId: string, actorUserId: string, taskId: string, dto: AddCommentDto) {
        const task = await this.findTaskOrThrow(tenantId, taskId);
        await this.assertWriteAllowed(tenantId);

        const comment = await this.prisma.$transaction(async (tx) => {
            const created = await tx.taskComment.create({
                data: {
                    taskId,
                    authorUserId: actorUserId,
                    body: dto.body,
                    visibility: dto.visibility ?? 'INTERNAL',
                },
            });

            await tx.taskEvent.create({
                data: {
                    tenantId,
                    taskId,
                    actorUserId,
                    eventType: TaskEventType.COMMENTED,
                    payload: { commentId: created.id },
                },
            });

            return created;
        });

        // Trailing-edge debounce 30 сек: серия комментариев → один пуш (§15)
        this.notifier.notifyCommentedDebounced({
            taskId,
            taskTitle: task.title,
            assigneeUserId: task.assigneeUserId,
            actorUserId,
        });

        return comment;
    }

    // ─── Delete Comment (soft) ────────────────────────────────────────────────
    // Только свои комментарии (§14 аналитики).

    async deleteComment(
        tenantId: string,
        actorUserId: string,
        taskId: string,
        commentId: string,
    ) {
        // Проверяем, что задача принадлежит тенанту
        await this.findTaskOrThrow(tenantId, taskId);

        const comment = await this.prisma.taskComment.findFirst({
            where: { id: commentId, taskId, deletedAt: null },
            select: { id: true, authorUserId: true },
        });

        if (!comment) {
            throw new NotFoundException({ code: 'NOT_FOUND', message: 'TASK_COMMENT_NOT_FOUND' });
        }

        if (comment.authorUserId !== actorUserId) {
            throw new ForbiddenException({ code: 'TASK_COMMENT_DELETE_NOT_ALLOWED' });
        }

        await this.prisma.taskComment.update({
            where: { id: commentId },
            data: { deletedAt: new Date() },
        });
    }

    // ─── FindAll (Inbox / Kanban list) ────────────────────────────────────────

    async findAll(tenantId: string, actorUserId: string, query: ListTasksQueryDto) {
        const page = query.page ?? 1;
        const limit = query.limit ?? 20;
        const skip = (page - 1) * limit;

        const where: Prisma.TaskWhereInput = { tenantId };
        const andConditions: Prisma.TaskWhereInput[] = [];

        if (query.assignee) {
            where.assigneeUserId = query.assignee === 'me' ? actorUserId : query.assignee;
        }
        if (query.createdBy) {
            where.createdByUserId = query.createdBy === 'me' ? actorUserId : query.createdBy;
        }
        if (query.category) {
            where.category = query.category;
        }
        if (query.priority) {
            where.priority = query.priority;
        }
        if (query.relatedOrderId) {
            where.relatedOrderId = query.relatedOrderId;
        }
        if (query.search) {
            where.title = { contains: query.search, mode: 'insensitive' };
        }

        // status и overdue могут конфликтовать по полю status — собираем через AND
        if (query.status && query.status.length > 0) {
            andConditions.push({ status: { in: query.status } });
        }
        if (query.overdue === true) {
            andConditions.push(
                { dueAt: { lt: new Date() } },
                { status: { notIn: [TaskStatus.DONE, TaskStatus.ARCHIVED] } },
            );
        }
        if (andConditions.length > 0) {
            where.AND = andConditions;
        }

        // Сортировка: inbox — dueAt asc nulls last + createdAt desc; kanban — updatedAt desc
        const orderBy: Prisma.TaskOrderByWithRelationInput[] =
            query.view === 'kanban'
                ? [{ updatedAt: 'desc' }]
                : [
                      { dueAt: { sort: 'asc', nulls: 'last' } },
                      { createdAt: 'desc' },
                  ];

        const [items, total] = await Promise.all([
            this.prisma.task.findMany({ where, orderBy, skip, take: limit }),
            this.prisma.task.count({ where }),
        ]);

        return {
            items: items.map((t) => this.mapTask(t)),
            meta: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit) || 1,
            },
        };
    }

    // ─── FindOne (деталь + комментарии + timeline) ────────────────────────────

    async findOne(tenantId: string, taskId: string) {
        const task = await this.prisma.task.findFirst({
            where: { id: taskId, tenantId },
            include: {
                comments: {
                    where: { deletedAt: null },
                    orderBy: { createdAt: 'asc' },
                },
                events: {
                    orderBy: { createdAt: 'asc' },
                },
            },
        });
        if (!task) {
            throw new NotFoundException({ code: 'NOT_FOUND', message: 'TASK_NOT_FOUND' });
        }
        return {
            ...this.mapTask(task),
            comments: task.comments.map((c) => ({
                id: c.id,
                taskId: c.taskId,
                authorUserId: c.authorUserId,
                body: c.body,
                visibility: c.visibility,
                createdAt: c.createdAt.toISOString(),
                updatedAt: c.updatedAt.toISOString(),
                editedAt: c.editedAt?.toISOString() ?? null,
            })),
            events: task.events.map((e) => ({
                id: e.id,
                taskId: e.taskId,
                actorUserId: e.actorUserId,
                eventType: e.eventType,
                payload: e.payload,
                createdAt: e.createdAt.toISOString(),
            })),
        };
    }

    // ─── Private helpers ──────────────────────────────────────────────────────

    private mapTask(task: {
        id: string; tenantId: string; title: string; description: string | null;
        category: string; priority: string; status: string;
        assigneeUserId: string; createdByUserId: string;
        dueAt: Date | null; dueReminderSentAt: Date | null;
        overdueNotifiedAt: Date | null; relatedOrderId: string | null;
        relatedProductId: string | null; tags: string[];
        completedAt: Date | null; archivedAt: Date | null;
        createdAt: Date; updatedAt: Date;
    }) {
        return {
            id: task.id,
            tenantId: task.tenantId,
            title: task.title,
            description: task.description,
            category: task.category,
            priority: task.priority,
            status: task.status,
            assigneeUserId: task.assigneeUserId,
            createdByUserId: task.createdByUserId,
            dueAt: task.dueAt?.toISOString() ?? null,
            dueReminderSentAt: task.dueReminderSentAt?.toISOString() ?? null,
            overdueNotifiedAt: task.overdueNotifiedAt?.toISOString() ?? null,
            relatedOrderId: task.relatedOrderId,
            relatedProductId: task.relatedProductId,
            tags: task.tags,
            completedAt: task.completedAt?.toISOString() ?? null,
            archivedAt: task.archivedAt?.toISOString() ?? null,
            createdAt: task.createdAt.toISOString(),
            updatedAt: task.updatedAt.toISOString(),
        };
    }

    private async findTaskOrThrow(tenantId: string, taskId: string) {
        const task = await this.prisma.task.findFirst({
            where: { id: taskId, tenantId },
            select: {
                id: true,
                title: true,
                status: true,
                assigneeUserId: true,
                createdByUserId: true,
                dueAt: true,
            },
        });
        if (!task) {
            throw new NotFoundException({ code: 'NOT_FOUND', message: 'TASK_NOT_FOUND' });
        }
        return task;
    }

    private async assertWriteAllowed(tenantId: string) {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { accessState: true },
        });
        if (!tenant || WRITE_BLOCKED_STATES.has(tenant.accessState)) {
            throw new ForbiddenException({ code: 'TASK_WRITE_BLOCKED_BY_TENANT_STATE' });
        }
    }

    private async assertActiveMember(tenantId: string, userId: string) {
        const membership = await this.prisma.membership.findFirst({
            where: { userId, tenantId, status: MembershipStatus.ACTIVE },
            select: { id: true },
        });
        if (!membership) {
            throw new ForbiddenException({ code: 'TASK_ASSIGN_TO_NON_MEMBER' });
        }
    }

    private assertValidTransition(from: TaskStatus, to: TaskStatus) {
        const allowed = VALID_TRANSITIONS.get(from);
        if (!allowed || !allowed.has(to)) {
            throw new ConflictException({ code: 'TASK_INVALID_STATE_TRANSITION', from, to });
        }
    }

    private async assertCanArchive(
        tenantId: string,
        actorUserId: string,
        createdByUserId: string,
    ) {
        if (actorUserId === createdByUserId) return;

        const membership = await this.prisma.membership.findFirst({
            where: { userId: actorUserId, tenantId, status: MembershipStatus.ACTIVE },
            select: { role: true },
        });

        if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
            throw new ForbiddenException({ code: 'TASK_ARCHIVE_NOT_ALLOWED' });
        }
    }

    private async assertOrderBelongsToTenant(tenantId: string, orderId: string) {
        const order = await this.prisma.order.findFirst({
            where: { id: orderId, tenantId },
            select: { id: true },
        });
        if (!order) {
            throw new BadRequestException({
                code: 'TASK_VALIDATION_FAILED',
                message: 'ORDER_NOT_IN_TENANT',
            });
        }
    }
}
