import { Injectable, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ActionType, AuditVisibilityScope, AuditRedactionLevel, Role } from '@prisma/client';
import {
    AuditWritePayload,
    SecurityEventPayload,
    EVENT_DOMAIN_MAP,
    SENSITIVE_AUDIT_FIELDS,
    AUDIT_RETENTION_DAYS,
    AUDIT_INTERNAL_METADATA_KEYS,
} from './audit-event-catalog';
import { AUDIT_COVERAGE_CONTRACTS } from './audit-coverage.contract';

export interface AuditLogFilters {
    page?:          number;
    limit?:         number;
    eventType?:     string;
    eventDomain?:   string;
    entityType?:    string;
    entityId?:      string;
    actorId?:       string;
    requestId?:     string;
    correlationId?: string;
    from?:          string; // ISO datetime
    to?:            string; // ISO datetime
    // Legacy support
    actionType?:    ActionType;
    searchSku?:     string;
}

export interface SecurityEventFilters {
    page?:      number;
    limit?:     number;
    eventType?: string;
    userId?:    string;
    from?:      string; // ISO datetime
    to?:        string; // ISO datetime
}

@Injectable()
export class AuditService {
    private readonly logger = new Logger(AuditService.name);

    constructor(private readonly prisma: PrismaService) {}

    // ─── Role assertion ─────────────────────────────────────────────────────

    async assertOwnerOrAdmin(tenantId: string, userId: string | undefined): Promise<void> {
        if (!userId) {
            throw new ForbiddenException({ code: 'AUDIT_ACCESS_DENIED' });
        }
        const membership = await this.prisma.membership.findFirst({
            where: { tenantId, userId, status: 'ACTIVE' },
            select: { role: true },
        });
        if (!membership || (membership.role !== Role.OWNER && membership.role !== Role.ADMIN)) {
            throw new ForbiddenException({ code: 'AUDIT_ROLE_FORBIDDEN' });
        }
    }

    // ─── New canonical write API ────────────────────────────────────────────

    async writeEvent(payload: AuditWritePayload): Promise<string> {
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

        try {
            const created = await this.prisma.auditLog.create({
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
                    before:        before    ? this.sanitize(before)    as any : undefined,
                    after:         after     ? this.sanitize(after)     as any : undefined,
                    changedFields: (changedFields ?? null) as any,
                    metadata:      metadata  ? this.sanitize(metadata)  as any : null,
                    visibilityScope,
                    redactionLevel,
                },
                select: { id: true },
            });
            this.logger.log(JSON.stringify({
                metric: 'audit_write_success',
                eventType,
                eventDomain: eventDomain ?? EVENT_DOMAIN_MAP[eventType] ?? null,
                actorType,
                tenantId,
                ts: new Date().toISOString(),
            }));
            return created.id;
        } catch (err: any) {
            this.logger.error(JSON.stringify({
                metric: 'audit_write_failure',
                eventType,
                tenantId,
                error: err?.message ?? String(err),
                ts:    new Date().toISOString(),
            }));
            throw err;
        }
    }

    // Privileged write for support/admin actions — forces internal_only visibility.
    // Use this whenever a support or admin tool modifies tenant data on behalf.
    // Возвращает id созданной AuditLog записи — нужен для linkage в `support_actions.audit_log_id`.
    async writePrivilegedEvent(payload: Omit<AuditWritePayload, 'actorType' | 'visibilityScope'>): Promise<string> {
        return this.writeEvent({
            ...payload,
            actorType: 'support',
            visibilityScope: AuditVisibilityScope.internal_only,
            redactionLevel: payload.redactionLevel ?? AuditRedactionLevel.partial,
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
                metadata:  (payload.metadata  ?? null) as any,
            },
        });
        this.logger.log(JSON.stringify({
            metric:    'security_event_logged',
            eventType: payload.eventType,
            userId:    payload.userId ?? null,
            tenantId:  payload.tenantId ?? null,
            ts:        new Date().toISOString(),
        }));
    }

    // ─── Read API — tenant-facing (OWNER/ADMIN only) ────────────────────────

    async getLogs(tenantId: string, filters: AuditLogFilters = {}) {
        const {
            page = 1, limit = 20,
            eventType, eventDomain, entityType, entityId, actorId,
            requestId, correlationId, from, to,
            actionType, searchSku,
        } = filters;
        const skip = (page - 1) * limit;

        // Enforce 180-day retention: tenant-facing API never exposes records older than the window.
        // If the caller passes an older 'from', we silently clamp it to the retention cutoff.
        const retentionCutoff = new Date();
        retentionCutoff.setDate(retentionCutoff.getDate() - AUDIT_RETENTION_DAYS);
        const effectiveFrom = from
            ? new Date(Math.max(new Date(from).getTime(), retentionCutoff.getTime()))
            : retentionCutoff;

        const where: any = {
            tenantId,
            // Only tenant-visible records; internal_only records never reach this path
            visibilityScope: AuditVisibilityScope.tenant,
            createdAt: {
                gte: effectiveFrom,
                ...(to ? { lte: new Date(to) } : {}),
            },
        };

        if (eventType)     where.eventType     = eventType;
        if (eventDomain)   where.eventDomain   = eventDomain;
        if (entityType)    where.entityType    = entityType;
        if (entityId)      where.entityId      = entityId;
        if (actorId)       where.actorId       = actorId;
        if (requestId)     where.requestId     = requestId;
        if (correlationId) where.correlationId = correlationId;
        // Legacy filters (kept while old records still exist)
        if (actionType) where.actionType = actionType;
        if (searchSku)  where.productSku = { contains: searchSku, mode: 'insensitive' };

        const [logs, total] = await Promise.all([
            this.prisma.auditLog.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
            this.prisma.auditLog.count({ where }),
        ]);

        this.logger.log(JSON.stringify({
            metric:   'audit_query_executed',
            query:    'getLogs',
            tenantId,
            filters:  { eventType, eventDomain, entityType, entityId, actorId, from: effectiveFrom.toISOString(), to },
            resultCount: total,
            ts:       new Date().toISOString(),
        }));

        return {
            data: logs.map(log => this.maskAuditLogForTenant(log)),
            meta: { total, page, lastPage: Math.ceil(total / limit), retentionDays: AUDIT_RETENTION_DAYS },
        };
    }

    async getLog(tenantId: string, id: string) {
        const log = await this.prisma.auditLog.findFirst({
            where: { id, tenantId },
        });

        if (!log) {
            throw new NotFoundException({ code: 'AUDIT_RECORD_NOT_FOUND' });
        }

        if (log.visibilityScope === AuditVisibilityScope.internal_only) {
            throw new ForbiddenException({ code: 'AUDIT_INTERNAL_ONLY_RECORD' });
        }

        return this.maskAuditLogForTenant(log);
    }

    // Security events for tenant OWNER/ADMIN:
    // Shows events for all active members of the tenant, optionally filtered by userId.
    // IP addresses are partially masked — tenant OWNER/ADMIN sees only the network prefix.
    async getSecurityEvents(tenantId: string, actorUserId: string, filters: SecurityEventFilters = {}) {
        const { page = 1, limit = 20, eventType, userId, from, to } = filters;
        const skip = (page - 1) * limit;

        // Collect all userIds in this tenant for cross-member security visibility
        const memberships = await this.prisma.membership.findMany({
            where: { tenantId, status: 'ACTIVE' },
            select: { userId: true },
        });
        const tenantUserIds = memberships.map(m => m.userId);

        const where: any = {
            OR: [
                { tenantId },
                { userId: { in: tenantUserIds } },
            ],
        };
        if (eventType) where.eventType = eventType;
        if (userId)    where.userId    = userId;
        if (from || to) {
            where.createdAt = {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to   ? { lte: new Date(to)   } : {}),
            };
        }

        const [events, total] = await Promise.all([
            this.prisma.securityEvent.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
            this.prisma.securityEvent.count({ where }),
        ]);

        this.logger.log(JSON.stringify({
            metric:      'audit_query_executed',
            query:       'getSecurityEvents',
            tenantId,
            filters:     { eventType, userId, from, to },
            resultCount: total,
            ts:          new Date().toISOString(),
        }));

        return {
            data: events.map(e => ({ ...e, ip: this.maskIpForTenant(e.ip) })),
            meta: { total, page, lastPage: Math.ceil(total / limit) },
        };
    }

    async getCoverageStatus(tenantId: string) {
        // For each module contract, check which mandatory events have at least one record.
        // We batch all distinct eventTypes into a single query to avoid N queries.
        const allMandatoryTypes = [
            ...new Set(AUDIT_COVERAGE_CONTRACTS.flatMap(c => c.mandatoryEvents)),
        ];

        const found = await this.prisma.auditLog.findMany({
            where: { tenantId, eventType: { in: allMandatoryTypes } },
            distinct: ['eventType'],
            select: { eventType: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
        });

        const seenTypes = new Set(found.map(r => r.eventType).filter((t): t is string => t !== null));
        const lastSeenAt: Record<string, Date> = {};
        for (const r of found) {
            if (r.eventType && !lastSeenAt[r.eventType]) lastSeenAt[r.eventType] = r.createdAt;
        }

        const modules = AUDIT_COVERAGE_CONTRACTS.map(contract => {
            const covered = contract.mandatoryEvents.filter(e => seenTypes.has(e));
            const missing  = contract.mandatoryEvents.filter(e => !seenTypes.has(e));
            return {
                module:        contract.module,
                description:   contract.description,
                coveragePct:   contract.mandatoryEvents.length
                    ? Math.round((covered.length / contract.mandatoryEvents.length) * 100)
                    : 100,
                covered:       covered.map(e => ({ eventType: e, lastSeenAt: lastSeenAt[e] ?? null })),
                missing,
            };
        });

        const totalEvents  = AUDIT_COVERAGE_CONTRACTS.reduce((s, c) => s + c.mandatoryEvents.length, 0);
        const totalCovered = AUDIT_COVERAGE_CONTRACTS.reduce(
            (s, c) => s + c.mandatoryEvents.filter(e => seenTypes.has(e)).length, 0,
        );

        const overallCoveragePct = totalEvents ? Math.round((totalCovered / totalEvents) * 100) : 100;

        this.logger.log(JSON.stringify({
            metric:             'audit_coverage_checked',
            tenantId,
            overallCoveragePct,
            totalEvents,
            totalCovered,
            ts:                 new Date().toISOString(),
        }));

        return {
            tenantId,
            overallCoveragePct,
            modules,
        };
    }

    // ─── Legacy write (kept until all callers are migrated) ─────────────────

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

    // Deep-sanitize: removes sensitive fields from objects and arrays at any nesting depth.
    private sanitize(value: unknown): unknown {
        if (Array.isArray(value)) {
            return value.map(item => this.sanitize(item));
        }
        if (value !== null && typeof value === 'object') {
            const result: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
                result[k] = SENSITIVE_AUDIT_FIELDS.has(k) ? '[REDACTED]' : this.sanitize(v);
            }
            return result;
        }
        return value;
    }

    // Apply before/after and metadata masking rules for tenant-facing read model.
    // redactionLevel=strict  → wipe before, after, changedFields, metadata
    // redactionLevel=partial → strip internal-only metadata keys
    // redactionLevel=none    → pass through as-is (sensitive fields already removed at write time)
    private maskAuditLogForTenant(log: any): any {
        const masked = { ...log };

        if (masked.redactionLevel === AuditRedactionLevel.strict) {
            masked.before        = null;
            masked.after         = null;
            masked.changedFields = null;
            masked.metadata      = null;
        } else if (masked.redactionLevel === AuditRedactionLevel.partial) {
            if (masked.metadata && typeof masked.metadata === 'object') {
                const clean: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(masked.metadata as Record<string, unknown>)) {
                    if (!AUDIT_INTERNAL_METADATA_KEYS.has(k)) clean[k] = v;
                }
                masked.metadata = clean;
            }
        }

        return masked;
    }

    // Mask last IPv4 octet or last IPv6 group for tenant-facing responses.
    // Full IPs are available only to support-internal tooling.
    private maskIpForTenant(ip: string | null): string | null {
        if (!ip) return null;
        const ipv4 = ip.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
        if (ipv4) return `${ipv4[1]}.*`;
        // IPv6 — mask last colon-separated group
        const parts = ip.split(':');
        if (parts.length > 1) {
            parts[parts.length - 1] = '****';
            return parts.join(':');
        }
        return ip;
    }
}
