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
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

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
  ],
})
export class AppModule { }
