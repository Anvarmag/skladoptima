import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { TenantModule } from '../tenants/tenant.module';
import { AuditModule } from '../audit/audit.module';
import { AdminAuthController } from './admin-auth/admin-auth.controller';
import { AdminAuthService } from './admin-auth/admin-auth.service';
import { AdminAuthGuard } from './admin-auth/admin-auth.guard';
import { AdminHealthController } from './admin-health/admin-health.controller';
import { TenantDirectoryController } from './tenant-directory/tenant-directory.controller';
import { TenantDirectoryService } from './tenant-directory/tenant-directory.service';
import { Tenant360Controller } from './tenant-360/tenant-360.controller';
import { TenantSummaryService } from './tenant-360/tenant-summary.service';
import { SupportActionsService } from './support-actions/support-actions.service';
import { SupportTenantActionsController } from './support-actions/support-tenant-actions.controller';
import { SupportUserActionsController } from './support-actions/support-user-actions.controller';
import { SupportNotesService } from './support-notes/support-notes.service';
import { SupportNotesController } from './support-notes/support-notes.controller';
import { AdminMetricsRegistry } from './admin.metrics';

/// Internal control plane (см. 19-admin §3, §15). Полностью изолирован от
/// tenant-facing auth/RBAC: свой JwtModule (без default secret/expiresIn —
/// AdminAuthService подписывает токены явным secret из ENV), свой набор
/// cookie/CSRF/headers, свой AdminAuthGuard.
///
/// AuthModule импортируется ради CsrfService И AuthService.triggerPasswordResetBySupport
/// (T3) — это явный доменный контракт reset flow, support не дублирует логику.
/// TenantModule даёт TenantService для extend-trial / set-access-state / restore-tenant
/// — admin-плоскость не пишет в tenant-таблицы напрямую (см. §20 риск).
/// AuditModule даёт AuditService.writePrivilegedEvent для tenant-facing
/// audit-записи с visibility=internal_only.
@Module({
    imports: [
        PrismaModule,
        AuthModule,
        TenantModule,
        AuditModule,
        // Без default secret: AdminAuthService подписывает токены явно с
        // ADMIN_JWT_SECRET и audience='admin' — это исключает риск
        // случайно-валидного admin-JWT от tenant-секрета.
        JwtModule.register({}),
    ],
    controllers: [
        AdminAuthController,
        AdminHealthController,
        TenantDirectoryController,
        Tenant360Controller,
        SupportTenantActionsController,
        SupportUserActionsController,
        SupportNotesController,
    ],
    providers: [
        AdminAuthService,
        AdminAuthGuard,
        TenantDirectoryService,
        TenantSummaryService,
        SupportActionsService,
        SupportNotesService,
        AdminMetricsRegistry,
    ],
    exports: [AdminAuthService, AdminAuthGuard, AdminMetricsRegistry],
})
export class AdminModule {}
