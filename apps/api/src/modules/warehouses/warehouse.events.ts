/**
 * Каноничные имена observability-событий warehouse-модуля.
 *
 * Single source of truth для structured-логов. Любой `logger.log/warn` в
 * warehouse сервисах ссылается на константу отсюда — это защищает от
 * опечаток в `event` поле и позволяет грепать/собирать алерты по стабильным
 * именам.
 *
 * Группировка соответствует system-analytics §19 (Observability):
 *   - sync_*           → метрика `warehouses_synced` / `warehouse_sync_failed`
 *   - upsert_*         → метрика `warehouse_upserts`
 *   - lifecycle_*      → метрика `inactive_warehouses` / archive coverage
 *   - classification_* → метрика `classification_changes`
 *   - paused_*         → policy / tenant-state observability
 *   - metadata_updated → audit alias/labels (TASK_WAREHOUSES_4)
 *
 * Алерт-пороги задокументированы в
 * `STRUCTURE-DEVELOPMENT/DOCS/TASKS/07-warehouses/WAREHOUSE_OBSERVABILITY.md`.
 */
export const WarehouseEvents = {
    // Sync flow
    SYNC_STARTED: 'warehouse_sync_started',
    SYNC_COMPLETED: 'warehouse_sync_completed',
    SYNC_FAILED: 'warehouse_sync_failed',
    SYNC_PAUSED_BY_TENANT: 'warehouse_sync_paused_by_tenant_state',

    // Upsert outcomes
    UPSERT_CREATED: 'warehouse_upsert_created',
    UPSERT_UPDATED: 'warehouse_upsert_updated',

    // Lifecycle transitions
    LIFECYCLE_INACTIVE: 'warehouse_lifecycle_inactive',
    LIFECYCLE_ARCHIVED: 'warehouse_lifecycle_archived',
    LIFECYCLE_REACTIVATED: 'warehouse_lifecycle_reactivated',

    // Anomalies
    CLASSIFICATION_CHANGED: 'warehouse_classification_changed',

    // Tenant-local writes
    METADATA_UPDATED: 'warehouse_metadata_updated',
} as const;

export type WarehouseEventName = typeof WarehouseEvents[keyof typeof WarehouseEvents];
