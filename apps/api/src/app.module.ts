import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { UserModule } from './modules/users/user.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProductModule } from './modules/catalog/product.module';
import { AuditModule } from './modules/audit/audit.module';
import { SettingsModule } from './modules/marketplace/settings.module';
import { SyncModule } from './modules/marketplace_sync/sync.module';
import { FinanceModule } from './modules/finance/finance.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { HealthModule } from './health/health.module';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { CsrfGuard } from './modules/auth/csrf.guard';
import { ActiveTenantGuard } from './modules/tenants/guards/active-tenant.guard';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { MaxNotifierModule } from './modules/max-notifier/max-notifier.module';
import { TenantModule } from './modules/tenants/tenant.module';
import { TeamModule } from './modules/team/team.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { WarehousesModule } from './modules/warehouses/warehouses.module';
import { MarketplaceAccountsModule } from './modules/marketplace-accounts/marketplace-accounts.module';
import { SyncRunsModule } from './modules/sync-runs/sync-runs.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ReferralModule } from './modules/referrals/referral.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { FilesModule } from './modules/files/files.module';
import { WorkerModule } from './modules/worker/worker.module';
import { StockLocksModule } from './modules/stock-locks/stock-locks.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { AdminModule } from './modules/admin/admin.module';

// Примечание: В будущем SettingsModule и SyncModule могут быть сильно переработаны
// или перенесены в apps/worker.

@Module({
  imports: [
    PrismaModule,
    UserModule,
    AuthModule,
    ProductModule,
    AuditModule,
    SettingsModule,
    SyncModule,
    FinanceModule,
    AnalyticsModule,
    HealthModule,
    MaxNotifierModule,
    TenantModule,
    TeamModule,
    OnboardingModule,
    InventoryModule,
    WarehousesModule,
    MarketplaceAccountsModule,
    SyncRunsModule,
    OrdersModule,
    ReferralModule,
    NotificationsModule,
    FilesModule,
    WorkerModule,
    StockLocksModule,
    TasksModule,
    AdminModule,
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ActiveTenantGuard,
    },
  ],
})
export class AppModule { }
