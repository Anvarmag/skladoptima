/**
 * Канонические имена observability-событий inventory-модуля.
 *
 * Единый источник истины для structured-логов. Любой `logger.log/warn` в
 * inventory сервисе должен использовать константу отсюда — это защищает от
 * опечаток в `event` поле и позволяет грепать/собирать алерты по стабильным
 * именам.
 *
 * Группировка соответствует system-analytics §20 (Observability):
 *   - movement_*       → метрика `stock_movements_created`
 *   - negative_*       → метрика `negative_stock_blocked`
 *   - mismatch_*       → метрика `reserve_release_mismatch`
 *   - conflict_*       → метрика `inventory_conflicts`
 *   - paused_*         → metric `tenant_state_paused_effects`
 *   - idempotency_*    → метрика `idempotency_collisions`
 *
 * Алерт-пороги задокументированы в
 * `STRUCTURE-DEVELOPMENT/DOCS/TASKS/06-inventory/INVENTORY_OBSERVABILITY.md`.
 */
export const InventoryEvents = {
    // Manual adjustments
    ADJUSTMENT_APPLIED:               'inventory_adjustment_applied',
    ADJUSTMENT_IDEMPOTENT_REPLAY:     'inventory_adjustment_idempotent_replay',
    THRESHOLD_UPDATED:                'inventory_threshold_updated',

    // Order side-effects (reserve/release/deduct)
    ORDER_EFFECT_APPLIED:             'inventory_order_effect_applied',
    ORDER_EFFECT_IDEMPOTENT_REPLAY:   'inventory_order_effect_idempotent_replay',
    ORDER_EFFECT_PAUSED_BY_TENANT:    'inventory_order_effect_paused_by_tenant_state',

    // Returns (no auto-restock)
    RETURN_LOGGED:                    'inventory_return_logged',
    RETURN_PAUSED_BY_TENANT:          'inventory_return_paused_by_tenant_state',

    // Reconciliation / conflicts / stale events
    RECONCILE_CONFLICT_DETECTED:      'inventory_reconcile_conflict_detected',
    RECONCILE_STALE_EVENT_IGNORED:    'inventory_reconcile_stale_event_ignored',
    RECONCILE_PAUSED_BY_TENANT:       'inventory_reconcile_paused_by_tenant_state',

    // Tenant-state guard
    MANUAL_WRITE_BLOCKED_BY_TENANT:   'inventory_manual_write_blocked_by_tenant_state',

    // Internal lock failures
    LOCK_MARK_FAILED_ERROR:           'inventory_lock_mark_failed_error',
} as const;

export type InventoryEventName = typeof InventoryEvents[keyof typeof InventoryEvents];
