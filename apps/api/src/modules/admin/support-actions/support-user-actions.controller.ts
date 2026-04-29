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
import { TriggerPasswordResetDto } from './dto/password-reset.dto';
import { buildSupportRequestContext } from '../admin-auth/admin-request-context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/// POST /api/admin/users/:userId/actions/password-reset.
/// Support НИКОГДА не получает plaintext password или хэш (см. §15) —
/// только триггерит обычный self-service reset flow на user'е.
@AdminEndpoint()
@UseGuards(AdminAuthGuard)
@AdminRoles('SUPPORT_ADMIN')
@Controller('admin/users/:userId/actions')
export class SupportUserActionsController {
    constructor(private readonly actions: SupportActionsService) {}

    @Post('password-reset')
    @HttpCode(HttpStatus.OK)
    async triggerPasswordReset(
        @Param('userId') userId: string,
        @Body() dto: TriggerPasswordResetDto,
        @CurrentSupportUser() actor: SupportUserContext,
        @Req() req: Request,
    ) {
        if (!UUID_RE.test(userId)) {
            throw new BadRequestException({ code: 'ADMIN_USER_ID_INVALID' });
        }
        return this.actions.triggerPasswordReset(userId, dto.reason, {
            actor,
            ...buildSupportRequestContext(req),
        });
    }
}
