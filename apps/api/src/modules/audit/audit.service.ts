import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ActionType, AuditVisibilityScope, AuditRedactionLevel } from '@prisma/client';
import {
    AuditWritePayload,
    SecurityEventPayload,
    EVENT_DOMAIN_MAP,
    SENSITIVE_AUDIT_FIELDS,
} from './audit-event-catalog';

@Injectable()
export class AuditService {
    constructor(private readonly prisma: PrismaService) {}

    // ─── New canonical write API ────────────────────────────────────────────

    async writeEvent(payload: AuditWritePayload): Promise<void> {
        const {
            tenantId,
            eventType,
            eventDomain,
            entityType,
            entityId,
            actorType,
            actorId,
            actorRole,
            source,
            requestId,
            correlationId,
            before,
            after,
            changedFields,
            metadata,
            visibilityScope = AuditVisibilityScope.tenant,
            redactionLevel  = AuditRedactionLevel.none,
        } = payload;

        await this.prisma.auditLog.create({
            data: {
                tenantId,
                eventType,
                eventDomain: eventDomain ?? EVENT_DOMAIN_MAP[eventType] ?? null,
                entityType:  entityType ?? null,
                entityId:    entityId   ?? null,
                actorType,
                actorId:     actorId    ?? null,
                actorRole:   actorRole  ?? null,
                source,
                requestId:     requestId     ?? null,
                correlationId: correlationId ?? null,
                before:        before        ? this.sanitize(before) : undefined,
                after:         after         ? this.sanitize(after)  : undefined,
                changedFields: changedFields ?? null,
                metadata:      metadata      ?? null,
                visibilityScope,
                redactionLevel,
            },
        });
    }

    async writeSecurityEvent(payload: SecurityEventPayload): Promise<void> {
        await this.prisma.securityEvent.create({
            data: {
                tenantId:  payload.tenantId  ?? null,
                userId:    payload.userId    ?? null,
                eventType: payload.eventType as any,
                ip:        payload.ip        ?? null,
                userAgent: payload.userAgent ?? null,
                requestId: payload.requestId ?? null,
                metadata:  payload.metadata  ?? null,
            },
        });
    }

    // ─── Read API ───────────────────────────────────────────────────────────

    async getLogs(
        tenantId:    string,
        page  = 1,
        limit = 20,
        actionType?: ActionType,
        searchSku?:  string,
    ) {
        const skip = (page - 1) * limit;
        const where: any = { tenantId, visibilityScope: AuditVisibilityScope.tenant };

        if (actionType) where.actionType = actionType;
        if (searchSku)  where.productSku = { contains: searchSku, mode: 'insensitive' };

        const [logs, total] = await Promise.all([
            this.prisma.auditLog.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
            this.prisma.auditLog.count({ where }),
        ]);

        return {
            data: logs,
            meta: { total, page, lastPage: Math.ceil(total / limit) },
        };
    }

    // ─── Legacy write (kept until TASK_AUDIT_2 migrates all callers) ────────

    async logAction(data: {
        actionType:  ActionType;
        productId?:  string;
        productSku?: string;
        beforeTotal?: number;
        afterTotal?:  number;
        delta?:       number;
        beforeName?:  string;
        afterName?:   string;
        actorUserId:  string;
        note?:        string;
        tenantId:     string;
    }) {
        return this.prisma.auditLog.create({ data });
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    private sanitize(obj: Record<string, unknown>): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = SENSITIVE_AUDIT_FIELDS.has(key) ? '[REDACTED]' : value;
        }
        return result;
    }
}
