import { AuditActorType, AuditSource, AuditVisibilityScope, AuditRedactionLevel } from '@prisma/client';

// ─── Domain taxonomy ────────────────────────────────────────────────────────

export const AUDIT_DOMAINS = {
    AUTH:        'AUTH',
    SESSION:     'SESSION',
    PASSWORD:    'PASSWORD',
    TEAM:        'TEAM',
    TENANT:      'TENANT',
    CATALOG:     'CATALOG',
    INVENTORY:   'INVENTORY',
    MARKETPLACE: 'MARKETPLACE',
    SYNC:        'SYNC',
    BILLING:     'BILLING',
    SUPPORT:     'SUPPORT',
    FINANCE:     'FINANCE',
} as const;

export type AuditDomain = (typeof AUDIT_DOMAINS)[keyof typeof AUDIT_DOMAINS];

// ─── Event type catalog ─────────────────────────────────────────────────────

export const AUDIT_EVENTS = {
    // AUTH
    LOGIN_SUCCESS:              'LOGIN_SUCCESS',
    LOGIN_FAILED:               'LOGIN_FAILED',
    LOGOUT_ALL:                 'LOGOUT_ALL',
    SESSION_REVOKED:            'SESSION_REVOKED',

    // PASSWORD
    PASSWORD_RESET_REQUESTED:   'PASSWORD_RESET_REQUESTED',
    PASSWORD_RESET_COMPLETED:   'PASSWORD_RESET_COMPLETED',

    // TEAM
    INVITE_CREATED:             'INVITE_CREATED',
    INVITE_RESENT:              'INVITE_RESENT',
    INVITE_CANCELLED:           'INVITE_CANCELLED',
    MEMBER_ROLE_CHANGED:        'MEMBER_ROLE_CHANGED',
    MEMBER_REMOVED:             'MEMBER_REMOVED',

    // TENANT
    TENANT_CREATED:             'TENANT_CREATED',
    TENANT_STATE_CHANGED:       'TENANT_STATE_CHANGED',
    TENANT_CLOSED:              'TENANT_CLOSED',
    TENANT_RESTORED:            'TENANT_RESTORED',

    // CATALOG
    PRODUCT_CREATED:            'PRODUCT_CREATED',
    PRODUCT_UPDATED:            'PRODUCT_UPDATED',
    PRODUCT_ARCHIVED:           'PRODUCT_ARCHIVED',
    PRODUCT_DUPLICATE_MERGED:   'PRODUCT_DUPLICATE_MERGED',

    // INVENTORY
    STOCK_MANUALLY_ADJUSTED:    'STOCK_MANUALLY_ADJUSTED',
    STOCK_CORRECTION_IMPORTED:  'STOCK_CORRECTION_IMPORTED',

    // MARKETPLACE
    MARKETPLACE_ACCOUNT_CONNECTED:          'MARKETPLACE_ACCOUNT_CONNECTED',
    MARKETPLACE_CREDENTIALS_UPDATED:        'MARKETPLACE_CREDENTIALS_UPDATED',
    MARKETPLACE_CREDENTIALS_REVALIDATED:    'MARKETPLACE_CREDENTIALS_REVALIDATED',
    MARKETPLACE_ACCOUNT_DEACTIVATED:        'MARKETPLACE_ACCOUNT_DEACTIVATED',

    // SYNC
    SYNC_MANUAL_REQUESTED:      'SYNC_MANUAL_REQUESTED',
    SYNC_RETRY_REQUESTED:       'SYNC_RETRY_REQUESTED',
    SYNC_BLOCKED_BY_POLICY:     'SYNC_BLOCKED_BY_POLICY',
    SYNC_FAILED_TERMINALLY:     'SYNC_FAILED_TERMINALLY',

    // BILLING
    TRIAL_STARTED:              'TRIAL_STARTED',
    TRIAL_EXPIRED:              'TRIAL_EXPIRED',
    SUBSCRIPTION_CHANGED:       'SUBSCRIPTION_CHANGED',
    PAYMENT_STATUS_CHANGED:     'PAYMENT_STATUS_CHANGED',
    SUSPENSION_ENTERED:         'SUSPENSION_ENTERED',
    GRACE_ENTERED:              'GRACE_ENTERED',

    // SUPPORT
    SUPPORT_ACCESS_GRANTED:             'SUPPORT_ACCESS_GRANTED',
    SUPPORT_TENANT_DATA_CHANGED:        'SUPPORT_TENANT_DATA_CHANGED',
    SUPPORT_TENANT_RESTORED:            'SUPPORT_TENANT_RESTORED',
    SUPPORT_TENANT_CLOSED:              'SUPPORT_TENANT_CLOSED',
} as const;

export type AuditEventType = (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS];

// ─── Mandatory event domain map ─────────────────────────────────────────────

export const EVENT_DOMAIN_MAP: Record<AuditEventType, AuditDomain> = {
    LOGIN_SUCCESS:              AUDIT_DOMAINS.AUTH,
    LOGIN_FAILED:               AUDIT_DOMAINS.AUTH,
    LOGOUT_ALL:                 AUDIT_DOMAINS.SESSION,
    SESSION_REVOKED:            AUDIT_DOMAINS.SESSION,

    PASSWORD_RESET_REQUESTED:   AUDIT_DOMAINS.PASSWORD,
    PASSWORD_RESET_COMPLETED:   AUDIT_DOMAINS.PASSWORD,

    INVITE_CREATED:             AUDIT_DOMAINS.TEAM,
    INVITE_RESENT:              AUDIT_DOMAINS.TEAM,
    INVITE_CANCELLED:           AUDIT_DOMAINS.TEAM,
    MEMBER_ROLE_CHANGED:        AUDIT_DOMAINS.TEAM,
    MEMBER_REMOVED:             AUDIT_DOMAINS.TEAM,

    TENANT_CREATED:             AUDIT_DOMAINS.TENANT,
    TENANT_STATE_CHANGED:       AUDIT_DOMAINS.TENANT,
    TENANT_CLOSED:              AUDIT_DOMAINS.TENANT,
    TENANT_RESTORED:            AUDIT_DOMAINS.TENANT,

    PRODUCT_CREATED:            AUDIT_DOMAINS.CATALOG,
    PRODUCT_UPDATED:            AUDIT_DOMAINS.CATALOG,
    PRODUCT_ARCHIVED:           AUDIT_DOMAINS.CATALOG,
    PRODUCT_DUPLICATE_MERGED:   AUDIT_DOMAINS.CATALOG,

    STOCK_MANUALLY_ADJUSTED:    AUDIT_DOMAINS.INVENTORY,
    STOCK_CORRECTION_IMPORTED:  AUDIT_DOMAINS.INVENTORY,

    MARKETPLACE_ACCOUNT_CONNECTED:       AUDIT_DOMAINS.MARKETPLACE,
    MARKETPLACE_CREDENTIALS_UPDATED:     AUDIT_DOMAINS.MARKETPLACE,
    MARKETPLACE_CREDENTIALS_REVALIDATED: AUDIT_DOMAINS.MARKETPLACE,
    MARKETPLACE_ACCOUNT_DEACTIVATED:     AUDIT_DOMAINS.MARKETPLACE,

    SYNC_MANUAL_REQUESTED:      AUDIT_DOMAINS.SYNC,
    SYNC_RETRY_REQUESTED:       AUDIT_DOMAINS.SYNC,
    SYNC_BLOCKED_BY_POLICY:     AUDIT_DOMAINS.SYNC,
    SYNC_FAILED_TERMINALLY:     AUDIT_DOMAINS.SYNC,

    TRIAL_STARTED:              AUDIT_DOMAINS.BILLING,
    TRIAL_EXPIRED:              AUDIT_DOMAINS.BILLING,
    SUBSCRIPTION_CHANGED:       AUDIT_DOMAINS.BILLING,
    PAYMENT_STATUS_CHANGED:     AUDIT_DOMAINS.BILLING,
    SUSPENSION_ENTERED:         AUDIT_DOMAINS.BILLING,
    GRACE_ENTERED:              AUDIT_DOMAINS.BILLING,

    SUPPORT_ACCESS_GRANTED:          AUDIT_DOMAINS.SUPPORT,
    SUPPORT_TENANT_DATA_CHANGED:     AUDIT_DOMAINS.SUPPORT,
    SUPPORT_TENANT_RESTORED:         AUDIT_DOMAINS.SUPPORT,
    SUPPORT_TENANT_CLOSED:           AUDIT_DOMAINS.SUPPORT,
};

// ─── Write payload type ─────────────────────────────────────────────────────

export interface AuditWritePayload {
    tenantId:      string;
    eventType:     AuditEventType;
    eventDomain?:  AuditDomain;
    entityType?:   string;
    entityId?:     string;
    actorType:     AuditActorType;
    actorId?:      string;
    actorRole?:    string;
    source:        AuditSource;
    requestId?:    string;
    correlationId?: string;
    before?:       Record<string, unknown>;
    after?:        Record<string, unknown>;
    changedFields?: string[];
    metadata?:     Record<string, unknown>;
    visibilityScope?: AuditVisibilityScope;
    redactionLevel?:  AuditRedactionLevel;
}

// ─── Security event payload type ────────────────────────────────────────────

export interface SecurityEventPayload {
    tenantId?:  string;
    userId?:    string;
    eventType:  string;
    ip?:        string;
    userAgent?: string;
    requestId?: string;
    metadata?:  Record<string, unknown>;
}

// ─── Sensitive fields that must never appear in audit payload ───────────────

export const SENSITIVE_AUDIT_FIELDS = new Set([
    'password',
    'passwordHash',
    'token',
    'secret',
    'apiKey',
    'refreshToken',
    'accessToken',
    'verificationToken',
    'resetToken',
    'otp',
]);
