import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { CurrentSupportUser } from '../admin-auth/decorators/current-support-user.decorator';
import type { SupportUserContext } from '../admin-auth/decorators/current-support-user.decorator';
import { AdminEndpoint } from '../admin-auth/decorators/admin-endpoint.decorator';
import { AdminRoles } from '../admin-auth/decorators/admin-roles.decorator';

/// Минимальный probing endpoint, который гарантирует, что admin-плоскость
/// поднята и RBAC работает. Используется в smoke-тестах T1-приёмки.
@AdminEndpoint()
@UseGuards(AdminAuthGuard)
@Controller('admin/health')
export class AdminHealthController {
    /// SUPPORT_READONLY и SUPPORT_ADMIN — оба видят ping
    @Get('ping')
    ping(@CurrentSupportUser() actor: SupportUserContext) {
        return { ok: true, role: actor.role };
    }

    /// Только SUPPORT_ADMIN — для проверки границы между read-only и mutating
    @AdminRoles('SUPPORT_ADMIN')
    @Get('admin-only')
    adminOnly() {
        return { ok: true, scope: 'SUPPORT_ADMIN' };
    }
}
