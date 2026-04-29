import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Body,
    Param,
    Query,
    Req,
    UseGuards,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';
import { TenantWriteGuard } from '../tenants/guards/tenant-write.guard';
import { TasksService } from './tasks.service';
import { ListTasksQueryDto } from './dto/list-tasks.query';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { AssignTaskDto } from './dto/assign-task.dto';
import { ChangeStatusDto } from './dto/change-status.dto';
import { AddCommentDto } from './dto/add-comment.dto';

/**
 * REST endpoints для tasks domain (TASK_TASKS_3).
 *
 * RequireActiveTenantGuard на уровне класса — все методы требуют activeTenantId.
 * TenantWriteGuard на write-методах — блокирует запись при TRIAL_EXPIRED/SUSPENDED/CLOSED.
 * Role gating для archive (OWNER/ADMIN или автор) выполняется внутри сервиса.
 */
@UseGuards(RequireActiveTenantGuard)
@Controller('tasks')
export class TasksController {
    constructor(private readonly tasksService: TasksService) {}

    /** Список задач: Inbox / Kanban с фильтрами и пагинацией */
    @Get()
    findAll(@Req() req: any, @Query() query: ListTasksQueryDto) {
        return this.tasksService.findAll(req.activeTenantId, req.user.id, query);
    }

    /** Деталь задачи + комментарии + timeline */
    @Get(':taskId')
    findOne(@Req() req: any, @Param('taskId') taskId: string) {
        return this.tasksService.findOne(req.activeTenantId, taskId);
    }

    /** Создать задачу */
    @Post()
    @UseGuards(TenantWriteGuard)
    create(@Req() req: any, @Body() dto: CreateTaskDto) {
        return this.tasksService.create(req.activeTenantId, req.user.id, dto);
    }

    /** Обновить title / description / category / priority / tags / dueAt */
    @Patch(':taskId')
    @UseGuards(TenantWriteGuard)
    update(
        @Req() req: any,
        @Param('taskId') taskId: string,
        @Body() dto: UpdateTaskDto,
    ) {
        return this.tasksService.update(req.activeTenantId, req.user.id, taskId, dto);
    }

    /** Назначить assignee */
    @Post(':taskId/assign')
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.OK)
    assign(
        @Req() req: any,
        @Param('taskId') taskId: string,
        @Body() dto: AssignTaskDto,
    ) {
        return this.tasksService.assign(req.activeTenantId, req.user.id, taskId, dto);
    }

    /** Сменить статус задачи */
    @Post(':taskId/status')
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.OK)
    changeStatus(
        @Req() req: any,
        @Param('taskId') taskId: string,
        @Body() dto: ChangeStatusDto,
    ) {
        return this.tasksService.changeStatus(req.activeTenantId, req.user.id, taskId, dto);
    }

    /** Добавить комментарий */
    @Post(':taskId/comments')
    @UseGuards(TenantWriteGuard)
    addComment(
        @Req() req: any,
        @Param('taskId') taskId: string,
        @Body() dto: AddCommentDto,
    ) {
        return this.tasksService.addComment(req.activeTenantId, req.user.id, taskId, dto);
    }

    /** Soft delete комментария (только своего) */
    @Delete(':taskId/comments/:commentId')
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.NO_CONTENT)
    deleteComment(
        @Req() req: any,
        @Param('taskId') taskId: string,
        @Param('commentId') commentId: string,
    ) {
        return this.tasksService.deleteComment(req.activeTenantId, req.user.id, taskId, commentId);
    }

    /**
     * Архивировать задачу.
     * Role gating: OWNER/ADMIN или автор задачи (§10 аналитики).
     */
    @Post(':taskId/archive')
    @UseGuards(TenantWriteGuard)
    @HttpCode(HttpStatus.OK)
    archive(@Req() req: any, @Param('taskId') taskId: string) {
        return this.tasksService.archive(req.activeTenantId, req.user.id, taskId);
    }
}
