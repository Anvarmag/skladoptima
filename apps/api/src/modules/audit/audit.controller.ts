import {
    Controller,
    Get,
    Post,
    Param,
    Query,
    Body,
    Req,
    Headers,
    UnauthorizedException,
    UseGuards,
} from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditReadGuard } from './audit-read.guard';
import { AuditWritePayload, SecurityEventPayload } from './audit-event-catalog';

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET ?? '';

function assertInternalSecret(secret: string | undefined): void {
    if (!INTERNAL_API_SECRET || secret !== INTERNAL_API_SECRET) {
        throw new UnauthorizedException({ code: 'AUDIT_INTERNAL_ACCESS_DENIED' });
    }
}

@Controller('audit')
export class AuditController {
    constructor(private readonly auditService: AuditService) {}

    // ─── GET /audit/logs — Business audit trail (OWNER/ADMIN only) ──────────

    @UseGuards(AuditReadGuard)
    @Get('logs')
    async getLogs(
        @Req() req: any,
        @Query('page')          page?:          string,
        @Query('limit')         limit?:         string,
        @Query('eventType')     eventType?:     string,
        @Query('eventDomain')   eventDomain?:   string,
        @Query('entityType')    entityType?:    string,
        @Query('entityId')      entityId?:      string,
        @Query('actorId')       actorId?:       string,
        @Query('requestId')     requestId?:     string,
        @Query('correlationId') correlationId?: string,
        @Query('from')          from?:          string,
        @Query('to')            to?:            string,
    ) {
        await this.auditService.assertOwnerOrAdmin(req.activeTenantId, req.user?.id);

        return this.auditService.getLogs(req.activeTenantId, {
            page:          page  ? parseInt(page,  10) : 1,
            limit:         limit ? parseInt(limit, 10) : 20,
            eventType,
            eventDomain,
            entityType,
            entityId,
            actorId,
            requestId,
            correlationId,
            from,
            to,
        });
    }

    // ─── GET /audit/logs/:id — Single audit record (OWNER/ADMIN only) ────────

    @UseGuards(AuditReadGuard)
    @Get('logs/:id')
    async getLog(
        @Req() req: any,
        @Param('id') id: string,
    ) {
        await this.auditService.assertOwnerOrAdmin(req.activeTenantId, req.user?.id);
        return this.auditService.getLog(req.activeTenantId, id);
    }

    // ─── GET /audit/security-events — Security event log (OWNER/ADMIN only) ─

    @UseGuards(AuditReadGuard)
    @Get('security-events')
    async getSecurityEvents(
        @Req() req: any,
        @Query('page')      page?:      string,
        @Query('limit')     limit?:     string,
        @Query('eventType') eventType?: string,
        @Query('userId')    userId?:    string,
        @Query('from')      from?:      string,
        @Query('to')        to?:        string,
    ) {
        await this.auditService.assertOwnerOrAdmin(req.activeTenantId, req.user?.id);

        return this.auditService.getSecurityEvents(req.activeTenantId, req.user?.id, {
            page:      page  ? parseInt(page,  10) : 1,
            limit:     limit ? parseInt(limit, 10) : 20,
            eventType,
            userId,
            from,
            to,
        });
    }

    // ─── GET /audit/coverage-status — Audit coverage diagnostics ─────────────

    @UseGuards(AuditReadGuard)
    @Get('coverage-status')
    async getCoverageStatus(@Req() req: any) {
        await this.auditService.assertOwnerOrAdmin(req.activeTenantId, req.user?.id);
        return this.auditService.getCoverageStatus(req.activeTenantId);
    }

    // ─── Legacy alias (kept for existing frontend) ────────────────────────────

    @UseGuards(AuditReadGuard)
    @Get()
    async getLogsLegacy(
        @Req() req: any,
        @Query('page')       page?:       string,
        @Query('limit')      limit?:      string,
        @Query('actionType') actionType?: string,
        @Query('search')     search?:     string,
    ) {
        await this.auditService.assertOwnerOrAdmin(req.activeTenantId, req.user?.id);

        return this.auditService.getLogs(req.activeTenantId, {
            page:      page  ? parseInt(page,  10) : 1,
            limit:     limit ? parseInt(limit, 10) : 20,
            actionType: actionType as any,
            searchSku: search,
        });
    }

    // ─── POST /audit/internal/write — Internal write (trusted services only) ─

    @Post('internal/write')
    async internalWrite(
        @Headers('x-internal-secret') secret: string | undefined,
        @Body() body: { type: 'audit' | 'security'; payload: AuditWritePayload | SecurityEventPayload },
    ) {
        assertInternalSecret(secret);

        if (body.type === 'security') {
            await this.auditService.writeSecurityEvent(body.payload as SecurityEventPayload);
        } else {
            await this.auditService.writeEvent(body.payload as AuditWritePayload);
        }

        return { ok: true };
    }
}
