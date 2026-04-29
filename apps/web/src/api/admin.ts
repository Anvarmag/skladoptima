import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';

// ─── Types ──────────────────────────────────────────────────────────────────

export type SupportUserRole = 'SUPPORT_ADMIN' | 'SUPPORT_READONLY';

export interface SupportUser {
    id: string;
    email: string;
    role: SupportUserRole;
}

export interface AdminMeResponse {
    supportUser: { id: string; role: SupportUserRole };
    sessionId: string;
}

export type AccessState =
    | 'TRIAL_ACTIVE'
    | 'TRIAL_EXPIRED'
    | 'ACTIVE_PAID'
    | 'GRACE_PERIOD'
    | 'SUSPENDED'
    | 'EARLY_ACCESS'
    | 'CLOSED';

export type TenantStatus = 'ACTIVE' | 'CLOSURE_PENDING' | 'CLOSED';

export interface TenantDirectoryRow {
    id: string;
    name: string;
    inn: string | null;
    status: TenantStatus;
    accessState: AccessState;
    closedAt: string | null;
    createdAt: string;
    primaryOwner: { id: string; email: string } | null;
    teamSize: number;
    marketplaceAccountsActive: number;
}

export interface TenantDirectoryPage {
    items: TenantDirectoryRow[];
    nextCursor: string | null;
    total: number;
}

export interface ListTenantsQuery {
    q?: string;
    accessState?: AccessState;
    status?: TenantStatus;
    limit?: number;
    cursor?: string;
}

export interface SupportNote {
    id: string;
    note: string;
    createdAt: string;
    updatedAt: string;
    author: { id: string; email: string; role: SupportUserRole };
}

export interface SupportActionRecord {
    id: string;
    actionType: string;
    resultStatus: 'success' | 'failed' | 'blocked';
    errorCode: string | null;
    reason: string;
    payload: Record<string, unknown> | null;
    createdAt: string;
    actorSupportUser: { id: string; email: string; role: SupportUserRole };
}

export interface Tenant360 {
    core: {
        id: string;
        name: string;
        inn: string | null;
        status: TenantStatus;
        accessState: AccessState;
        closedAt: string | null;
        createdAt: string;
        updatedAt: string;
        settings: {
            taxSystem: string | null;
            country: string | null;
            currency: string | null;
            timezone: string | null;
            legalName: string | null;
        } | null;
        closureJob: {
            status: string;
            scheduledFor: string | null;
            processedAt: string | null;
            failureReason: string | null;
        } | null;
    };
    owner: {
        id: string;
        email: string;
        status: string;
        emailVerifiedAt: string | null;
        lastLoginAt: string | null;
    } | null;
    team: {
        total: number;
        active: number;
        revoked: number;
        left: number;
        byRole: Array<{ role: string; status: string; count: number }>;
        recentMembers: Array<{
            id: string;
            role: string;
            joinedAt: string;
            user: { id: string; email: string };
        }>;
    };
    invitations: Record<string, number>;
    subscription: {
        accessState: AccessState;
        tenantStatus: TenantStatus;
        closedAt: string | null;
        history: Array<{
            id: string;
            fromState: AccessState | null;
            toState: AccessState;
            reasonCode: string | null;
            actorType: string;
            actorId: string | null;
            createdAt: string;
        }>;
    };
    marketplaceAccounts: Array<{
        id: string;
        marketplace: string;
        label: string | null;
        lifecycleStatus: string;
        credentialStatus: string;
        syncHealthStatus: string;
        syncHealthReason: string | null;
        lastValidatedAt: string | null;
        lastSyncAt: string | null;
        lastSyncResult: string | null;
        lastSyncErrorCode: string | null;
        lastSyncErrorMessage: string | null;
        deactivatedAt: string | null;
        createdAt: string;
    }>;
    sync: {
        recentRuns: Array<{
            id: string;
            marketplaceAccountId: string | null;
            triggerType: string;
            triggerScope: string;
            status: string;
            blockedReason: string | null;
            processedCount: number;
            errorCount: number;
            errorCode: string | null;
            errorMessage: string | null;
            startedAt: string | null;
            finishedAt: string | null;
            durationMs: number | null;
            createdAt: string;
        }>;
        failedRunsLast7d: number;
        openConflicts: number;
    };
    notifications: {
        recent: Array<{
            id: string;
            category: string;
            severity: string;
            isMandatory: boolean;
            createdAt: string;
        }>;
        severityCountsLast7d: Record<string, number>;
    };
    worker: {
        statusCounts: Record<string, number>;
        recentFailed: Array<{
            id: string;
            jobType: string;
            queueName: string;
            status: string;
            attempt: number;
            maxAttempts: number;
            lastError: string | null;
            finishedAt: string | null;
        }>;
    };
    files: { statusCounts: Record<string, number>; totalSizeBytes: string };
    audit: {
        totalEvents: number;
        eventsLast7d: number;
        recent: Array<{
            id: string;
            eventType: string | null;
            eventDomain: string | null;
            entityType: string | null;
            entityId: string | null;
            actorType: string | null;
            actorId: string | null;
            actorRole: string | null;
            source: string | null;
            createdAt: string;
        }>;
    };
    securityEvents: Array<{
        id: string;
        eventType: string;
        userId: string | null;
        ip: string | null;
        createdAt: string;
    }>;
    notes: { status: 'ready'; items: SupportNote[] };
    supportActions: { recent: SupportActionRecord[] };
}

export interface ApiError {
    code?: string;
    message?: string;
    retryAfterSeconds?: number;
}

// ─── Axios instance (isolated from tenant-facing axios.defaults) ────────────

/// Отдельный axios instance — обязательное требование §15 "admin auth/session
/// должны быть отделены от tenant-facing RBAC". Tenant-facing axios.defaults
/// использует свой CSRF-токен из `/api/auth/csrf-token` и cookies `Authentication`/
/// `Refresh`. Admin плоскость использует cookies `AdminAuthentication`/`AdminRefresh`
/// (path-scoped на refresh) и cookie `admin-csrf-token`. Если бы мы переиспользовали
/// глобальный axios instance, токены и interceptors протекли бы между контурами.

const adminAxios: AxiosInstance = axios.create({
    baseURL: import.meta.env.VITE_API_URL || '/api',
    withCredentials: true,
});

let _adminCsrfToken = '';
const MUTATING = new Set(['post', 'put', 'patch', 'delete']);

export async function refreshAdminCsrfToken(): Promise<void> {
    try {
        const res = await adminAxios.get('/admin/auth/csrf-token');
        _adminCsrfToken = res.data?.csrfToken ?? '';
    } catch {
        // non-fatal: server вернёт CSRF_TOKEN_INVALID при mutation
    }
}

adminAxios.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    if (config.method && MUTATING.has(config.method.toLowerCase())) {
        config.headers.set('X-CSRF-Token', _adminCsrfToken);
    }
    return config;
});

// Refresh-on-401 single-flight: на просрочку access token делаем тихий refresh
// и повторяем оригинальный запрос. На повторный 401 — даём вызывающему обработать.
let _refreshing: Promise<void> | null = null;

adminAxios.interceptors.response.use(
    (r) => r,
    async (error: AxiosError) => {
        const original = error.config as InternalAxiosRequestConfig & { _retried?: boolean };
        const status = error.response?.status;
        const url = original?.url ?? '';

        // Не пытаемся refresh на самом refresh/login/csrf-token/me — иначе луп.
        const isAuthFlow =
            url.includes('/admin/auth/refresh') ||
            url.includes('/admin/auth/login') ||
            url.includes('/admin/auth/csrf-token');

        if (status === 401 && !original?._retried && !isAuthFlow) {
            original._retried = true;
            try {
                if (!_refreshing) {
                    _refreshing = adminAxios
                        .post('/admin/auth/refresh', {})
                        .then(() => {})
                        .finally(() => {
                            _refreshing = null;
                        });
                }
                await _refreshing;
                return adminAxios.request(original);
            } catch {
                // refresh не удался — пробрасываем оригинальный 401
                return Promise.reject(error);
            }
        }
        return Promise.reject(error);
    },
);

// ─── Auth ──────────────────────────────────────────────────────────────────

export const adminAuthApi = {
    async login(email: string, password: string): Promise<{ supportUser: SupportUser }> {
        await refreshAdminCsrfToken();
        const res = await adminAxios.post('/admin/auth/login', { email, password });
        return res.data;
    },

    async me(): Promise<AdminMeResponse> {
        const res = await adminAxios.get('/admin/auth/me');
        return res.data;
    },

    async logout(): Promise<void> {
        await adminAxios.post('/admin/auth/logout', {});
    },

    async changePassword(currentPassword: string, newPassword: string): Promise<void> {
        await adminAxios.post('/admin/auth/change-password', { currentPassword, newPassword });
    },
};

// ─── Tenants ───────────────────────────────────────────────────────────────

export const adminTenantsApi = {
    async list(query: ListTenantsQuery = {}): Promise<TenantDirectoryPage> {
        const res = await adminAxios.get('/admin/tenants', { params: query });
        return res.data;
    },

    async tenant360(tenantId: string): Promise<Tenant360> {
        const res = await adminAxios.get(`/admin/tenants/${tenantId}`);
        return res.data;
    },
};

// ─── Support actions (high-risk, требуют SUPPORT_ADMIN) ────────────────────

export const adminActionsApi = {
    async extendTrial(tenantId: string, reason: string) {
        const res = await adminAxios.post(`/admin/tenants/${tenantId}/actions/extend-trial`, {
            reason,
        });
        return res.data;
    },

    async setAccessState(tenantId: string, toState: 'TRIAL_ACTIVE' | 'SUSPENDED', reason: string) {
        const res = await adminAxios.post(
            `/admin/tenants/${tenantId}/actions/set-access-state`,
            { toState, reason },
        );
        return res.data;
    },

    async restoreTenant(tenantId: string, reason: string) {
        const res = await adminAxios.post(`/admin/tenants/${tenantId}/actions/restore-tenant`, {
            reason,
        });
        return res.data;
    },

    async triggerPasswordReset(userId: string, reason: string) {
        const res = await adminAxios.post(`/admin/users/${userId}/actions/password-reset`, {
            reason,
        });
        return res.data;
    },
};

// ─── Notes ─────────────────────────────────────────────────────────────────

export const adminNotesApi = {
    async list(tenantId: string): Promise<{ items: SupportNote[] }> {
        const res = await adminAxios.get(`/admin/tenants/${tenantId}/notes`);
        return res.data;
    },

    async create(tenantId: string, note: string): Promise<SupportNote> {
        const res = await adminAxios.post(`/admin/tenants/${tenantId}/notes`, { note });
        return res.data;
    },
};

export function extractApiError(err: unknown): ApiError {
    const e = err as AxiosError<ApiError>;
    return e.response?.data ?? {};
}

export { adminAxios };
