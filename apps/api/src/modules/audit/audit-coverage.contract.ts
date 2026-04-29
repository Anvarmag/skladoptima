import { AUDIT_EVENTS, AuditEventType } from './audit-event-catalog';

// ─── Coverage contract per domain module ────────────────────────────────────
//
// Defines which audit events each domain module MUST emit for the action to be
// considered covered. Enforcement is documentation-level for now; will move to
// integration test assertions in TASK_AUDIT_5.

export interface ModuleCoverageContract {
    module:          string;
    mandatoryEvents: AuditEventType[];
    description:     string;
}

export const AUDIT_COVERAGE_CONTRACTS: ModuleCoverageContract[] = [
    {
        module: 'auth',
        description: 'Security events: all login, session, and password flows',
        mandatoryEvents: [
            AUDIT_EVENTS.LOGIN_SUCCESS,
            AUDIT_EVENTS.LOGIN_FAILED,
            AUDIT_EVENTS.LOGOUT_ALL,
            AUDIT_EVENTS.SESSION_REVOKED,
            AUDIT_EVENTS.PASSWORD_RESET_REQUESTED,
            AUDIT_EVENTS.PASSWORD_RESET_COMPLETED,
        ],
    },
    {
        module: 'catalog',
        description: 'Product lifecycle: create, update, archive, restore, merge; import commits; channel mappings',
        mandatoryEvents: [
            AUDIT_EVENTS.PRODUCT_CREATED,
            AUDIT_EVENTS.PRODUCT_UPDATED,
            AUDIT_EVENTS.PRODUCT_ARCHIVED,
            AUDIT_EVENTS.PRODUCT_RESTORED,
            AUDIT_EVENTS.PRODUCT_DUPLICATE_MERGED,
            AUDIT_EVENTS.CATALOG_IMPORT_COMMITTED,
            AUDIT_EVENTS.MARKETPLACE_MAPPING_CREATED,
            AUDIT_EVENTS.MARKETPLACE_MAPPING_DELETED,
        ],
    },
    {
        module: 'inventory',
        description: 'Stock mutations: manual adjustments and order-driven deductions',
        mandatoryEvents: [
            AUDIT_EVENTS.STOCK_MANUALLY_ADJUSTED,
            AUDIT_EVENTS.STOCK_ORDER_DEDUCTED,
            AUDIT_EVENTS.STOCK_ORDER_RETURNED,
        ],
    },
    {
        module: 'marketplace_sync',
        description: 'Sync-driven stock changes from marketplace orders',
        mandatoryEvents: [
            AUDIT_EVENTS.STOCK_ORDER_DEDUCTED,
            AUDIT_EVENTS.STOCK_ORDER_RETURNED,
        ],
    },
    {
        module: 'team',
        description: 'Team member lifecycle: invitations, role changes, removals',
        mandatoryEvents: [
            AUDIT_EVENTS.INVITE_CREATED,
            AUDIT_EVENTS.INVITE_RESENT,
            AUDIT_EVENTS.INVITE_CANCELLED,
            AUDIT_EVENTS.MEMBER_ROLE_CHANGED,
            AUDIT_EVENTS.MEMBER_REMOVED,
        ],
    },
    {
        module: 'tenants',
        description: 'Tenant lifecycle: creation, state transitions, close, restore',
        mandatoryEvents: [
            AUDIT_EVENTS.TENANT_CREATED,
            AUDIT_EVENTS.TENANT_STATE_CHANGED,
            AUDIT_EVENTS.TENANT_CLOSED,
            AUDIT_EVENTS.TENANT_RESTORED,
        ],
    },
    {
        module: 'marketplace_accounts',
        description: 'Marketplace account connect, credential update, deactivation',
        mandatoryEvents: [
            AUDIT_EVENTS.MARKETPLACE_ACCOUNT_CONNECTED,
            AUDIT_EVENTS.MARKETPLACE_CREDENTIALS_UPDATED,
            AUDIT_EVENTS.MARKETPLACE_CREDENTIALS_REVALIDATED,
            AUDIT_EVENTS.MARKETPLACE_ACCOUNT_DEACTIVATED,
        ],
    },
    {
        module: 'billing',
        description: 'Trial and subscription lifecycle events',
        mandatoryEvents: [
            AUDIT_EVENTS.TRIAL_STARTED,
            AUDIT_EVENTS.TRIAL_EXPIRED,
            AUDIT_EVENTS.SUBSCRIPTION_CHANGED,
            AUDIT_EVENTS.PAYMENT_STATUS_CHANGED,
            AUDIT_EVENTS.SUSPENSION_ENTERED,
            AUDIT_EVENTS.GRACE_ENTERED,
        ],
    },
    {
        module: 'support',
        description: 'Support/admin privileged actions on tenant data',
        mandatoryEvents: [
            AUDIT_EVENTS.SUPPORT_ACCESS_GRANTED,
            AUDIT_EVENTS.SUPPORT_TENANT_DATA_CHANGED,
            AUDIT_EVENTS.SUPPORT_TENANT_RESTORED,
            AUDIT_EVENTS.SUPPORT_TENANT_CLOSED,
            AUDIT_EVENTS.SUPPORT_NOTE_ADDED,
        ],
    },
    {
        module: 'files',
        description: 'File lifecycle: upload, replace, delete и критичные cleanup decisions',
        mandatoryEvents: [
            AUDIT_EVENTS.FILE_UPLOADED,
            AUDIT_EVENTS.FILE_REPLACED,
            AUDIT_EVENTS.FILE_DELETED,
        ],
    },
    {
        module: 'channel_controls',
        description: 'Stock channel locks: create and remove per product+marketplace',
        mandatoryEvents: [
            AUDIT_EVENTS.STOCK_LOCK_CREATED,
            AUDIT_EVENTS.STOCK_LOCK_REMOVED,
        ],
    },
];

// ─── Coverage lookup helper ──────────────────────────────────────────────────

export function getModuleContract(module: string): ModuleCoverageContract | undefined {
    return AUDIT_COVERAGE_CONTRACTS.find(c => c.module === module);
}

export function isMandatoryEvent(module: string, eventType: AuditEventType): boolean {
    return getModuleContract(module)?.mandatoryEvents.includes(eventType) ?? false;
}
