/**
 * Каноничные имена observability-событий sync run модуля (09-sync §19).
 *
 * Single source of truth для structured-логов и (опционально, в TASK_SYNC_5)
 * записей в audit-журнал. Любой `logger.log/warn/error` или метрика
 * `sync_runs_*` ссылается на константу отсюда — это защищает от опечаток
 * и позволяет грепать/собирать алерты по стабильным именам.
 *
 * Группировка соответствует system-analytics §19 (Observability):
 *   - lifecycle:    QUEUED, STARTED, FINISHED
 *   - blocked:      BLOCKED_BY_TENANT_STATE, BLOCKED_BY_ACCOUNT_STATE,
 *                   BLOCKED_BY_CONCURRENCY
 *   - retry:        RETRY_SCHEDULED
 *   - stage-level:  STAGE_STARTED, STAGE_FINISHED
 *   - external:     EXTERNAL_RATE_LIMIT, EXTERNAL_ERROR
 *   - conflict:     CONFLICT_DETECTED
 *
 * Метрики §19 (`sync_runs_started`, `sync_runs_failed`, `sync_runs_blocked`,
 * `partial_success_rate`, `retry_count`, `queue_lag`, `conflicts_open`)
 * вычисляются из этих событий + агрегированных счётчиков `SyncRun`.
 */
export const SyncRunEventNames = {
    // Lifecycle
    QUEUED: 'sync_run_queued',
    STARTED: 'sync_run_started',
    FINISHED: 'sync_run_finished',
    CANCELLED: 'sync_run_cancelled',

    // Policy / preflight blocks
    BLOCKED_BY_TENANT_STATE: 'sync_run_blocked_by_tenant_state',
    BLOCKED_BY_ACCOUNT_STATE: 'sync_run_blocked_by_account_state',
    BLOCKED_BY_CONCURRENCY: 'sync_run_blocked_by_concurrency',
    BLOCKED_BY_CREDENTIALS: 'sync_run_blocked_by_credentials',

    // Retry chain
    RETRY_SCHEDULED: 'sync_run_retry_scheduled',
    RETRY_EXHAUSTED: 'sync_run_retry_exhausted',

    // Stage-level (опционально, для дебага worker'а в TASK_SYNC_5)
    STAGE_STARTED: 'sync_run_stage_started',
    STAGE_FINISHED: 'sync_run_stage_finished',

    // External API
    EXTERNAL_RATE_LIMIT: 'sync_run_external_rate_limit',
    EXTERNAL_ERROR: 'sync_run_external_error',

    // Конфликты
    CONFLICT_DETECTED: 'sync_run_conflict_detected',
} as const;

export type SyncRunEventName =
    typeof SyncRunEventNames[keyof typeof SyncRunEventNames];
