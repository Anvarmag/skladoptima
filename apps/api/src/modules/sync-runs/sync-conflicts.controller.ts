import {
    Controller,
    Get,
    Post,
    Param,
    Query,
    Req,
    UseGuards,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { SyncDiagnosticsService } from './sync-diagnostics.service';
import { ListConflictsDto } from './dto/list-conflicts.dto';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';

/**
 * REST-контур sync-conflicts (TASK_SYNC_4).
 *
 * Endpoints под global prefix `/api`:
 *   GET  /api/sync/conflicts              — список (по умолчанию открытые)
 *   GET  /api/sync/conflicts/:id          — карточка с включённым run
 *   POST /api/sync/conflicts/:id/resolve  — закрыть конфликт (идемпотентно)
 *
 * Read-доступен Owner/Admin/Manager (RequireActiveTenantGuard);
 * write (resolve) НЕ под TenantWriteGuard'ом — конфликты должны можно было
 * закрывать даже в read-only tenant state (закрытие — это внутренний
 * audit/cleanup, а не внешний API call).
 */
@UseGuards(RequireActiveTenantGuard)
@Controller('sync/conflicts')
export class SyncConflictsController {
    constructor(private readonly diagnostics: SyncDiagnosticsService) {}

    @Get()
    list(@Query() query: ListConflictsDto, @Req() req: any) {
        return this.diagnostics.listConflicts(req.activeTenantId, query);
    }

    @Get(':id')
    getById(@Param('id') id: string, @Req() req: any) {
        return this.diagnostics.getConflictById(req.activeTenantId, id);
    }

    @Post(':id/resolve')
    @HttpCode(HttpStatus.OK)
    resolve(@Param('id') id: string, @Req() req: any) {
        return this.diagnostics.resolveConflict(req.activeTenantId, id, req.user?.id ?? null);
    }
}
