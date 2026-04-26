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
