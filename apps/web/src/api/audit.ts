import axios from 'axios';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuditLog {
    id: string;
    tenantId: string;
    createdAt: string;

    // Canonical fields
    eventType: string | null;
    eventDomain: string | null;
    entityType: string | null;
    entityId: string | null;
    actorType: string | null;
    actorId: string | null;
    actorRole: string | null;
    source: string | null;
    requestId: string | null;
    correlationId: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    changedFields: string[] | null;
    metadata: Record<string, unknown> | null;
    visibilityScope: string;
    redactionLevel: string;

    // Legacy fields (may be present on old records)
    actionType: string | null;
    productSku: string | null;
    beforeTotal: number | null;
    afterTotal: number | null;
    delta: number | null;
    beforeName: string | null;
    afterName: string | null;
    actorEmail?: string | null;
    note: string | null;
}

export interface SecurityEvent {
    id: string;
    tenantId: string | null;
    userId: string | null;
    eventType: string;
    ip: string | null;
    userAgent: string | null;
    requestId: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: string;
}

export interface AuditLogFilters {
    page?: number;
    limit?: number;
    eventType?: string;
    eventDomain?: string;
    entityType?: string;
    entityId?: string;
    actorId?: string;
    requestId?: string;
    correlationId?: string;
    from?: string;
    to?: string;
}

export interface SecurityEventFilters {
    page?: number;
    limit?: number;
    eventType?: string;
    userId?: string;
    from?: string;
    to?: string;
}

export interface PageMeta {
    total: number;
    page: number;
    lastPage: number;
    retentionDays?: number;
}

export interface AuditLogsResponse {
    data: AuditLog[];
    meta: PageMeta;
}

export interface SecurityEventsResponse {
    data: SecurityEvent[];
    meta: PageMeta;
}

// ─── API client ───────────────────────────────────────────────────────────────

function tenantHeaders(tenantId: string | undefined): Record<string, string> {
    return tenantId ? { 'X-Tenant-Id': tenantId } : {};
}

export const auditApi = {
    getLogs: async (
        tenantId: string | undefined,
        filters: AuditLogFilters = {},
    ): Promise<AuditLogsResponse> => {
        const params: Record<string, string> = {};
        if (filters.page)          params.page          = String(filters.page);
        if (filters.limit)         params.limit         = String(filters.limit);
        if (filters.eventType)     params.eventType     = filters.eventType;
        if (filters.eventDomain)   params.eventDomain   = filters.eventDomain;
        if (filters.entityType)    params.entityType    = filters.entityType;
        if (filters.entityId)      params.entityId      = filters.entityId;
        if (filters.actorId)       params.actorId       = filters.actorId;
        if (filters.requestId)     params.requestId     = filters.requestId;
        if (filters.correlationId) params.correlationId = filters.correlationId;
        if (filters.from)          params.from          = filters.from;
        if (filters.to)            params.to            = filters.to;

        const { data } = await axios.get('/audit/logs', {
            params,
            headers: tenantHeaders(tenantId),
        });
        return data;
    },

    getLog: async (tenantId: string | undefined, id: string): Promise<AuditLog> => {
        const { data } = await axios.get(`/audit/logs/${id}`, {
            headers: tenantHeaders(tenantId),
        });
        return data;
    },

    getSecurityEvents: async (
        tenantId: string | undefined,
        filters: SecurityEventFilters = {},
    ): Promise<SecurityEventsResponse> => {
        const params: Record<string, string> = {};
        if (filters.page)      params.page      = String(filters.page);
        if (filters.limit)     params.limit     = String(filters.limit);
        if (filters.eventType) params.eventType = filters.eventType;
        if (filters.userId)    params.userId    = filters.userId;
        if (filters.from)      params.from      = filters.from;
        if (filters.to)        params.to        = filters.to;

        const { data } = await axios.get('/audit/security-events', {
            params,
            headers: tenantHeaders(tenantId),
        });
        return data;
    },
};
