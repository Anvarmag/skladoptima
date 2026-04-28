import {
    Body,
    Controller,
    ForbiddenException,
    Get,
    Param,
    Patch,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RequireActiveTenantGuard } from '../tenants/guards/require-active-tenant.guard';
import { ListInboxQueryDto } from './dto/list-inbox.query.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { NotificationsInboxService } from './notifications-inbox.service';
import { NotificationsPreferencesService } from './notifications-preferences.service';
import { NotificationsStatusService } from './notifications-status.service';
import { NotificationsMetricsService } from './notifications-metrics.service';

/**
 * REST API модуля уведомлений (TASK_NOTIFICATIONS_4).
 *
 * Маршруты:
 *   GET  /api/notifications                  — inbox feed (любой auth user)
 *   GET  /api/notifications/preferences      — настройки каналов (Owner)
 *   PATCH /api/notifications/preferences     — обновить настройки (Owner)
 *   GET  /api/notifications/status           — channel health + delivery (Owner)
 *   PATCH /api/notifications/:id/read        — пометить прочитанным (любой auth user)
 *
 * Literal-маршруты (preferences, status) объявлены раньше параметризованного
 * (:id/read), чтобы NestJS не интерпретировал их как :id.
 */
@UseGuards(RequireActiveTenantGuard)
@Controller('notifications')
export class NotificationsController {
    constructor(
        private readonly inboxService: NotificationsInboxService,
        private readonly preferencesService: NotificationsPreferencesService,
        private readonly statusService: NotificationsStatusService,
        private readonly metricsService: NotificationsMetricsService,
        private readonly prisma: PrismaService,
    ) {}

    // ── Inbox (любой авторизованный пользователь) ────────────────────────────

    @Get()
    getInbox(@Req() req: any, @Query() query: ListInboxQueryDto) {
        return this.inboxService.getInbox({
            tenantId: req.activeTenantId,
            userId: req.user.id,
            limit: query.limit,
            cursor: query.cursor,
            unreadOnly: query.unreadOnly,
        });
    }

    // ── Preferences (Owner) ──────────────────────────────────────────────────

    @Get('preferences')
    async getPreferences(@Req() req: any) {
        await this._assertOwner(req.activeTenantId, req.user?.id);
        return this.preferencesService.getPreferences(req.activeTenantId);
    }

    @Patch('preferences')
    async updatePreferences(@Req() req: any, @Body() dto: UpdatePreferencesDto) {
        await this._assertOwner(req.activeTenantId, req.user?.id);
        return this.preferencesService.updatePreferences(req.activeTenantId, dto);
    }

    // ── Channel status (Owner) ───────────────────────────────────────────────

    @Get('status')
    async getStatus(@Req() req: any) {
        await this._assertOwner(req.activeTenantId, req.user?.id);
        return this.statusService.getStatus(req.activeTenantId);
    }

    // ── In-process metrics snapshot (Owner) ─────────────────────────────────
    // Counters reset on restart. For persistent metrics use structured logs.

    @Get('metrics')
    async getMetrics(@Req() req: any) {
        await this._assertOwner(req.activeTenantId, req.user?.id);
        return this.metricsService.getSnapshot();
    }

    // ── Mark read (любой авторизованный пользователь) ───────────────────────

    @Patch(':id/read')
    markRead(@Req() req: any, @Param('id') id: string) {
        return this.inboxService.markRead({
            id,
            tenantId: req.activeTenantId,
            userId: req.user.id,
        });
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private async _assertOwner(tenantId: string, userId: string | undefined) {
        if (!userId) {
            throw new ForbiddenException({ code: 'TENANT_ACCESS_DENIED' });
        }
        const membership = await this.prisma.membership.findFirst({
            where: { tenantId, userId, status: 'ACTIVE' },
            select: { role: true },
        });
        if (!membership || membership.role !== Role.OWNER) {
            throw new ForbiddenException({ code: 'ROLE_FORBIDDEN' });
        }
    }
}
