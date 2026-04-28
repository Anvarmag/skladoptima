import {
    Controller,
    Get,
    Post,
    Param,
    Query,
    Body,
    Headers,
    Req,
    UseGuards,
    HttpCode,
    HttpStatus,
    BadRequestException,
} from '@nestjs/common';
import { SyncRunsService } from './sync-runs.service';
import { CreateSyncRunDto } from './dto/create-sync-run.dto';
import { ListSyncRunsDto } from './dto/list-sync-runs.dto';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';

/**
 * REST-контур sync-runs (TASK_SYNC_2).
 *
 * Endpoints, mapped under global `/api` prefix → доступны как
 *   POST /api/sync/runs
 *   GET  /api/sync/runs
 *   GET  /api/sync/runs/:id
 *   POST /api/sync/runs/:id/retry
 *
 * (system-analytics §6 описывает их как `/api/v1/sync/runs/...`; перенос
 * на `/v1` префикс — общая работа по версионированию API, не задача
 * текущего модуля.)
 *
 * `RequireActiveTenantGuard` обязателен (sync — tenant-bounded). Намеренно
 * НЕ используется `TenantWriteGuard`: blocked-by-policy run возвращается
 * как полноценная запись со status=BLOCKED, а не как HTTP 403. Это
 * §10/§20: продуктовая блокировка должна оставлять диагностический след
 * в истории, а не "испаряться" на уровне guard'а.
 *
 * Tenant full sync (`POST /sync/full` из §6) намеренно НЕ реализован:
 * §10/§13/§17 явно исключают его из MVP runtime surface (триггерная
 * волна на старте может уронить и naked rate limits, и pricing).
 */
@UseGuards(RequireActiveTenantGuard)
@Controller('sync/runs')
export class SyncRunsController {
    constructor(private readonly service: SyncRunsService) {}

    /**
     * POST /sync/runs.
     *
     * Idempotency-Key поддержан двумя путями:
     *   1. HTTP заголовок `Idempotency-Key: <key>` — стандарт RFC, приоритет.
     *   2. поле `idempotencyKey` в body — fallback для клиентов, у которых
     *      нет контроля над headers (например, простой fetch из формы).
     *
     * Если переданы оба и значения отличаются — 400 (явная неоднозначность,
     * клиент должен решить, какой ключ канонический).
     */
    @Post()
    @HttpCode(HttpStatus.CREATED)
    create(
        @Body() dto: CreateSyncRunDto,
        @Headers('idempotency-key') headerKey: string | undefined,
        @Req() req: any,
    ) {
        const trimmedHeader = headerKey?.trim();
        const trimmedBody = dto.idempotencyKey?.trim();

        if (trimmedHeader && trimmedBody && trimmedHeader !== trimmedBody) {
            throw new BadRequestException({
                code: 'IDEMPOTENCY_KEY_MISMATCH',
                reason: 'Idempotency-Key header conflicts with body idempotencyKey',
            });
        }

        const effectiveKey = trimmedHeader || trimmedBody || undefined;
        if (effectiveKey && effectiveKey.length > 128) {
            throw new BadRequestException({
                code: 'IDEMPOTENCY_KEY_TOO_LONG',
                maxLength: 128,
            });
        }

        return this.service.createRun(req.activeTenantId, req.user?.id ?? null, {
            ...dto,
            idempotencyKey: effectiveKey,
        });
    }

    @Get()
    list(@Query() query: ListSyncRunsDto, @Req() req: any) {
        return this.service.list(req.activeTenantId, query);
    }

    @Get(':id')
    getById(@Param('id') id: string, @Req() req: any) {
        return this.service.getById(req.activeTenantId, id);
    }

    @Post(':id/retry')
    @HttpCode(HttpStatus.CREATED)
    retry(@Param('id') id: string, @Req() req: any) {
        return this.service.retryRun(req.activeTenantId, id, req.user?.id ?? null);
    }
}
