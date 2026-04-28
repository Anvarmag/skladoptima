/**
 * Каноничные имена observability-событий marketplace-accounts модуля.
 *
 * Single source of truth для structured-логов и записей в
 * `MarketplaceAccountEvent` журнал. Любой `logger.log/warn/error` или
 * `marketplaceAccountEvent.create({ data: { eventType: ... } })` ссылается
 * на константу отсюда — это защищает от опечаток и позволяет грепать/
 * собирать алерты по стабильным именам.
 *
 * Группировка соответствует system-analytics §15 / §19 (Observability):
 *   - lifecycle:      CREATED, DEACTIVATED, REACTIVATED
 *   - credential:     LABEL_UPDATED, CREDENTIALS_ROTATED, VALIDATED, VALIDATION_FAILED
 *   - sync health:    SYNC_ERROR_DETECTED (sync.service / worker через reportSyncRun)
 *   - tenant policy:  PAUSED_BY_TENANT_STATE
 *
 * Алерт-пороги задокументированы в
 * `STRUCTURE-DEVELOPMENT/DOCS/TASKS/08-marketplace-accounts/MARKETPLACE_ACCOUNTS_OBSERVABILITY.md`.
 *
 * Реэкспортируется существующей константой `MarketplaceAccountEvents` в
 * `marketplace-accounts.service.ts` для обратной совместимости тестов.
 */
export const MarketplaceAccountEventNames = {
    // Lifecycle
    CREATED: 'marketplace_account_created',
    DEACTIVATED: 'marketplace_account_deactivated',
    REACTIVATED: 'marketplace_account_reactivated',

    // Credential metadata
    LABEL_UPDATED: 'marketplace_account_label_updated',
    CREDENTIALS_ROTATED: 'marketplace_account_credentials_rotated',
    VALIDATED: 'marketplace_account_validated',
    VALIDATION_FAILED: 'marketplace_account_validation_failed',

    // Sync health
    SYNC_ERROR_DETECTED: 'marketplace_account_sync_error_detected',

    // Tenant policy
    PAUSED_BY_TENANT_STATE: 'marketplace_account_paused_by_tenant_state',
} as const;

export type MarketplaceAccountEventName =
    typeof MarketplaceAccountEventNames[keyof typeof MarketplaceAccountEventNames];
