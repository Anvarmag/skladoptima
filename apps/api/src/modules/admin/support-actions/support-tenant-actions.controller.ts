import {
    BadRequestException,
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { AdminEndpoint } from '../admin-auth/decorators/admin-endpoint.decorator';
import { AdminRoles } from '../admin-auth/decorators/admin-roles.decorator';
import { CurrentSupportUser } from '../admin-auth/decorators/current-support-user.decorator';
import type { SupportUserContext } from '../admin-auth/decorators/current-support-user.decorator';
import { SupportActionsService } from './support-actions.service';
import { ExtendTrialDto } from './dto/extend-trial.dto';
import { SetAccessStateDto } from './dto/set-access-state.dto';
import { RestoreTenantDto } from './dto/restore-tenant.dto';
import { buildSupportRequestContext } from '../admin-auth/admin-request-context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/// POST /api/admin/tenants/:tenantId/actions/* — high-risk support actions.
/// Все три endpoint'а:
///   • требуют SUPPORT_ADMIN (см. §15 «SUPPORT_READONLY не имеет mutating endpoints»);
///   • DTO валидирует reason >= 10 символов (high-risk requirement из §10);
///   • тело ответа = результат доменного сервиса (не сырой support_actions row).
@AdminEndpoint()
@UseGuards(AdminAuthGuard)
@AdminRoles('SUPPORT_ADMIN')
@Controller('admin/tenants/:tenantId/actions')
export class SupportTenantActionsController {
    constructor(private readonly actions: SupportActionsService) {}

    @Post('extend-trial')
    @HttpCode(HttpStatus.OK)
    async extendTrial(
        @Param('tenantId') tenantId: string,
        @Body() dto: ExtendTrialDto,
        @CurrentSupportUser() actor: SupportUserContext,
        @Req() req: Request,
    ) {
        this.assertUuid(tenantId);
        return this.actions.extendTrial(tenantId, dto.reason, {
            actor,
            ...buildSupportRequestContext(req),
        });
    }

    @Post('set-access-state')
    @HttpCode(HttpStatus.OK)
    async setAccessState(
        @Param('tenantId') tenantId: string,
        @Body() dto: SetAccessStateDto,
        @CurrentSupportUser() actor: SupportUserContext,
        @Req() req: Request,
    ) {
        this.assertUuid(tenantId);
        return this.actions.setAccessState(tenantId, dto.toState, dto.reason, {
            actor,
            ...buildSupportRequestContext(req),
        });
    }

    @Post('restore-tenant')
    @HttpCode(HttpStatus.OK)
    async restoreTenant(
        @Param('tenantId') tenantId: string,
        @Body() dto: RestoreTenantDto,
        @CurrentSupportUser() actor: SupportUserContext,
        @Req() req: Request,
    ) {
        this.assertUuid(tenantId);
        return this.actions.restoreTenant(tenantId, dto.reason, {
            actor,
            ...buildSupportRequestContext(req),
        });
    }

    private assertUuid(id: string): void {
        if (!UUID_RE.test(id)) {
            throw new BadRequestException({ code: 'ADMIN_TENANT_ID_INVALID' });
        }
    }
}
