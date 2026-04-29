import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { WorkerService } from './worker.service';
import { WorkerController } from './worker.controller';
import { WorkerStatusController } from './worker-status.controller';
import { WorkerAlertsService } from './worker-alerts.service';
import { WorkerRuntimeService } from './worker-runtime.service';
import { WorkerSchedulerService } from './worker-scheduler.service';
import { JobHandlerRegistry } from './job-handler.registry';

@Module({
    imports: [ScheduleModule.forRoot()],
    providers: [
        WorkerService,
        WorkerAlertsService,
        WorkerRuntimeService,
        WorkerSchedulerService,
        JobHandlerRegistry,
    ],
    controllers: [WorkerController, WorkerStatusController],
    exports: [
        WorkerService,
        WorkerAlertsService,
        WorkerRuntimeService,
        WorkerSchedulerService,
        JobHandlerRegistry,
    ],
})
export class WorkerModule {}
