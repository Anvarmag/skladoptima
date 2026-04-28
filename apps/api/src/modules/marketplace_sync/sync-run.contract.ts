/**
 * Queue contract между API/scheduler и worker для модуля 09-sync.
 *
 * Single source of truth для job payload, который кладётся в очередь
 * (TASK_SYNC_2 — Queue Worker, ещё не реализован) и читается worker'ом.
 * API endpoints (TASK_SYNC_3) и scheduler (TASK_SYNC_3/5) обязаны строить
 * job из `BuildSyncRunJob` и не передавать произвольные поля мимо контракта.
 *
 * Контракт привязан к `SyncRun` (Prisma), поэтому `runId` в job — это
 * `SyncRun.id`. `jobKey` — DB-level UNIQUE(tenantId, jobKey) из миграции
 * `20260426120000_sync_data_model`.
 *
 * Задокументированный набор sync-типов (см. system-analytics §13). TEXT[]
 * в БД — для расширяемости без миграции, валидация значений — здесь.
 */

import type { SyncTriggerType, SyncTriggerScope, SyncRunStatus } from '@prisma/client';

/**
 * Допустимые значения `SyncRun.syncTypes[]`. Колонка хранит TEXT[]
 * (см. comment к модели SyncRun в schema.prisma), валидация — на app слое.
 */
export const SyncTypes = {
    PULL_STOCKS: 'PULL_STOCKS',
    PUSH_STOCKS: 'PUSH_STOCKS',
    PULL_ORDERS: 'PULL_ORDERS',
    PULL_METADATA: 'PULL_METADATA',
    FULL_SYNC: 'FULL_SYNC',
} as const;

export type SyncType = typeof SyncTypes[keyof typeof SyncTypes];

const ALLOWED_SYNC_TYPES = new Set<string>(Object.values(SyncTypes));

export function isSyncType(value: string): value is SyncType {
    return ALLOWED_SYNC_TYPES.has(value);
}

/**
 * Машинные коды для `SyncRun.blockedReason`. Не free-text: support и UI
 * полагаются на стабильный набор (см. system-analytics §10/§20: blocked
 * outcome должен быть детерминированным для одинаковых tenant/account state).
 */
export const SyncBlockedReason = {
    TENANT_TRIAL_EXPIRED: 'TENANT_TRIAL_EXPIRED',
    TENANT_SUSPENDED: 'TENANT_SUSPENDED',
    TENANT_CLOSED: 'TENANT_CLOSED',
    ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
    CREDENTIALS_INVALID: 'CREDENTIALS_INVALID',
    CREDENTIALS_NEEDS_RECONNECT: 'CREDENTIALS_NEEDS_RECONNECT',
    CONCURRENCY_GUARD: 'CONCURRENCY_GUARD',
} as const;

export type SyncBlockedReasonCode =
    typeof SyncBlockedReason[keyof typeof SyncBlockedReason];

/**
 * Машинные коды run-level ошибок (`SyncRun.errorCode`). Отделены от
 * blocked reasons: error — это сбой обработки, blocked — продуктовая
 * политика. Mapping таксономии adapter-ошибок (§20) → run-level код
 * выполняется в worker слое (TASK_SYNC_5).
 */
export const SyncErrorCode = {
    EXTERNAL_RATE_LIMIT: 'EXTERNAL_RATE_LIMIT',
    EXTERNAL_AUTH_FAILED: 'EXTERNAL_AUTH_FAILED',
    EXTERNAL_TIMEOUT: 'EXTERNAL_TIMEOUT',
    EXTERNAL_5XX: 'EXTERNAL_5XX',
    SYNC_STAGE_FAILED: 'SYNC_STAGE_FAILED',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type SyncErrorCodeValue =
    typeof SyncErrorCode[keyof typeof SyncErrorCode];

/**
 * Job payload, который worker получает из очереди. `runId` ссылается на
 * уже существующую запись `SyncRun` (создаётся API/scheduler ДО постановки
 * в очередь — это даёт пользователю немедленный feedback "run is queued"
 * и оставляет диагностический след даже если worker упал до старта).
 *
 * `jobKey` дублируется здесь, чтобы worker мог логировать его без
 * дополнительного запроса к БД.
 *
 * `attemptNumber`/`maxAttempts` повторяют поля из `SyncRun` для удобства
 * worker'а (он не должен повторно запрашивать run только ради retry policy).
 */
export interface SyncRunJob {
    runId: string;
    tenantId: string;
    marketplaceAccountId: string | null;
    triggerType: SyncTriggerType;
    triggerScope: SyncTriggerScope;
    syncTypes: SyncType[];
    jobKey: string;
    idempotencyKey?: string | null;
    attemptNumber: number;
    maxAttempts: number;
    /** Только для retry: id оригинального run (для трассировки в логах). */
    originRunId?: string | null;
}

/**
 * Параметры для построения нового sync run + job. Используется API endpoint
 * `POST /api/v1/sync/runs` (TASK_SYNC_3) и scheduler'ом.
 *
 * Отдельная структура от `SyncRunJob`, потому что на момент enqueue ещё
 * нет `runId` — он будет создан вместе с записью `SyncRun`.
 */
export interface BuildSyncRunJob {
    tenantId: string;
    marketplaceAccountId: string | null;
    triggerType: SyncTriggerType;
    triggerScope: SyncTriggerScope;
    syncTypes: SyncType[];
    requestedBy?: string | null;
    /**
     * Уникальный ключ job'а в очереди. UNIQUE(tenantId, jobKey) на уровне
     * БД гарантирует, что повторное enqueue с тем же ключом приведёт к
     * conflict и run не будет продублирован.
     *
     * Формат рекомендуемый: `${marketplaceAccountId}:${syncTypes.sort().join(',')}:${bucket}`,
     * где `bucket` — округление времени (например, до минуты для scheduled
     * или uuid v4 для manual). Конкретный builder — в TASK_SYNC_3.
     */
    jobKey: string;
    idempotencyKey?: string | null;
    /** Для retry: id оригинального run. */
    originRunId?: string | null;
    /** Для retry: какая попытка по счёту (1 = первый запуск). */
    attemptNumber?: number;
    maxAttempts?: number;
    /** Когда run может стартовать не раньше (delayed retry). */
    nextAttemptAt?: Date | null;
}

/**
 * Терминальные статусы run'а. После них run не возвращается в обработку
 * (retry создаёт НОВЫЙ run с triggerType=RETRY и origin_run_id=старый).
 */
export const TerminalSyncRunStatuses: ReadonlySet<SyncRunStatus> = new Set([
    'SUCCESS',
    'PARTIAL_SUCCESS',
    'FAILED',
    'BLOCKED',
    'CANCELLED',
]);

export function isTerminalSyncRunStatus(status: SyncRunStatus): boolean {
    return TerminalSyncRunStatuses.has(status);
}

/**
 * Active = run занимает concurrency slot аккаунта. Используется
 * application-level guard'ом перед постановкой нового run в очередь
 * (DB-level partial unique по array intersection слишком сложен для MVP —
 * см. comment в migration.sql).
 */
export const ActiveSyncRunStatuses: ReadonlySet<SyncRunStatus> = new Set([
    'QUEUED',
    'IN_PROGRESS',
]);

export function isActiveSyncRunStatus(status: SyncRunStatus): boolean {
    return ActiveSyncRunStatuses.has(status);
}
