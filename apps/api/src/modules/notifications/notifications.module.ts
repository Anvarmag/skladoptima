import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationsService } from './notifications.service';
import { NotificationOrchestrator } from './notification-orchestrator.service';
import { NotificationPolicyService } from './notification-policy.service';
import { NotificationDeliveryWorker } from './notification-delivery-worker.service';
import { InAppAdapter } from './channel-adapters/in-app.adapter';
import { EmailAdapter } from './channel-adapters/email.adapter';
import { NotificationsInboxService } from './notifications-inbox.service';
import { NotificationsPreferencesService } from './notifications-preferences.service';
import { NotificationsStatusService } from './notifications-status.service';
import { NotificationsMetricsService } from './notifications-metrics.service';
import { NotificationsController } from './notifications.controller';

@Module({
    imports: [
        ScheduleModule.forRoot(),
    ],
    controllers: [
        NotificationsController,
    ],
    providers: [
        // Observability (TASK_NOTIFICATIONS_7)
        NotificationsMetricsService,
        // Policy + orchestration layer (TASK_NOTIFICATIONS_2)
        NotificationsService,
        NotificationOrchestrator,
        NotificationPolicyService,
        // Delivery layer (TASK_NOTIFICATIONS_3)
        NotificationDeliveryWorker,
        InAppAdapter,
        EmailAdapter,
        // API layer (TASK_NOTIFICATIONS_4)
        NotificationsInboxService,
        NotificationsPreferencesService,
        NotificationsStatusService,
    ],
    exports: [
        NotificationsService,
    ],
})
export class NotificationsModule {}
