import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MaxNotifierModule } from '../max-notifier/max-notifier.module';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { TaskNotifierService } from './task-notifier.service';
import { TaskDueReminderService } from './task-due-reminder.service';
import { TasksMetricsRegistry } from './tasks.metrics';

/**
 * Tasks domain module (21-tasks).
 *
 * TASK_TASKS_2: TasksService — CRUD, state machine, комментарии.
 * TASK_TASKS_3: REST API + Inbox-фильтры.
 * TASK_TASKS_4: Push-нотификации (TaskNotifierService) + cron due-reminders (TaskDueReminderService).
 * TASK_TASKS_5: Frontend /app/tasks + связка из Orders.
 *
 * PrismaModule не нужен в imports — он задекорирован @Global() и
 * доступен во всех модулях приложения без явного импорта.
 */
@Module({
    imports: [
        ScheduleModule.forRoot(),
        MaxNotifierModule,
    ],
    controllers: [TasksController],
    providers: [
        TasksService,
        TaskNotifierService,
        TaskDueReminderService,
        TasksMetricsRegistry,
    ],
    exports: [TasksService, TasksMetricsRegistry],
})
export class TasksModule {}
