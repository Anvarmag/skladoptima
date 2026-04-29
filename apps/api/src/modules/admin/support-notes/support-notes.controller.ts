import {
    BadRequestException,
    Body,
    Controller,
    Get,
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
import { SupportNotesService } from './support-notes.service';
import { CreateSupportNoteDto } from './dto/create-note.dto';
import { buildSupportRequestContext } from '../admin-auth/admin-request-context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/// GET /api/admin/tenants/:tenantId/notes      — обе support-роли (read-only видят notes по §22)
/// POST /api/admin/tenants/:tenantId/notes     — только SUPPORT_ADMIN
///
/// Class-level `@UseGuards(AdminAuthGuard)` без `@AdminRoles` означает любой
/// активный support. Mutating endpoint поднимает требование до SUPPORT_ADMIN
/// через method-level `@AdminRoles('SUPPORT_ADMIN')` — Reflector в guard'е
/// читает override через `getAllAndOverride`, поэтому method-decorator
/// перекрывает class-default'ы.
@AdminEndpoint()
@UseGuards(AdminAuthGuard)
@Controller('admin/tenants/:tenantId/notes')
export class SupportNotesController {
    constructor(private readonly notes: SupportNotesService) {}

    @Get()
    list(@Param('tenantId') tenantId: string) {
        this.assertUuid(tenantId);
        return this.notes.list(tenantId);
    }

    @Post()
    @AdminRoles('SUPPORT_ADMIN')
    create(
        @Param('tenantId') tenantId: string,
        @Body() dto: CreateSupportNoteDto,
        @CurrentSupportUser() actor: SupportUserContext,
        @Req() req: Request,
    ) {
        this.assertUuid(tenantId);
        return this.notes.create(tenantId, dto.note, actor, buildSupportRequestContext(req));
    }

    private assertUuid(id: string): void {
        if (!UUID_RE.test(id)) {
            throw new BadRequestException({ code: 'ADMIN_TENANT_ID_INVALID' });
        }
    }
}
