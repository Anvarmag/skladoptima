import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SupportActionsService } from '../support-actions/support-actions.service';
import { SupportUserContext } from '../admin-auth/decorators/current-support-user.decorator';
import type { SupportRequestContext } from '../admin-auth/admin-request-context';

/// Internal notes — read-доступен обеим support-ролям, write — только SUPPORT_ADMIN
/// (контролируется на controller-слое через @AdminRoles).
///
/// Каждая создание note дополнительно журналируется в support_actions
/// (ADD_INTERNAL_NOTE), чтобы в едином журнале действий видеть, кто и что добавлял.
@Injectable()
export class SupportNotesService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly actions: SupportActionsService,
    ) {}

    async list(tenantId: string, limit: number = 50) {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true },
        });
        if (!tenant) {
            throw new NotFoundException({ code: 'ADMIN_TENANT_NOT_FOUND' });
        }

        const items = await this.prisma.supportNote.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            take: Math.min(Math.max(limit, 1), 100),
            select: {
                id: true,
                note: true,
                createdAt: true,
                updatedAt: true,
                authorSupportUser: {
                    select: { id: true, email: true, role: true },
                },
            },
        });

        return {
            items: items.map((n) => ({
                id: n.id,
                note: n.note,
                createdAt: n.createdAt,
                updatedAt: n.updatedAt,
                author: {
                    id: n.authorSupportUser.id,
                    email: n.authorSupportUser.email,
                    role: n.authorSupportUser.role,
                },
            })),
        };
    }

    async create(
        tenantId: string,
        note: string,
        actor: SupportUserContext,
        ctx: SupportRequestContext,
    ) {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true },
        });
        if (!tenant) {
            throw new NotFoundException({ code: 'ADMIN_TENANT_NOT_FOUND' });
        }

        const created = await this.prisma.supportNote.create({
            data: {
                tenantId,
                authorSupportUserId: actor.id,
                note,
            },
            select: { id: true, note: true, createdAt: true, updatedAt: true },
        });

        // recordNoteAdded одновременно пишет SUPPORT_NOTE_ADDED в общий audit
        // trail и фиксирует ADD_INTERNAL_NOTE в support_actions с auditLogId.
        const { auditLogId } = await this.actions.recordNoteAdded(tenantId, created.id, {
            actor,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
            correlationId: ctx.correlationId,
        });

        return {
            id: created.id,
            note: created.note,
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
            author: { id: actor.id, role: actor.role },
            auditLogId,
        };
    }
}
