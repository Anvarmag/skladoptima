/**
 * Контракт результата adapter-стадии для worker engine (TASK_SYNC_5).
 *
 * Главная цель: **отделить четыре класса ошибок**, которые требуют разной
 * обработки (§20 риск: «adapter errors должны нормализоваться в единую
 * taxonomy, иначе support и retry policy будут хаотичны»):
 *
 *   1. SUCCESS — без ошибок.
 *   2. PARTIAL — обработано не всё, но run не падает (фиксируется
 *      `processedCount`/`errorCount` и список item-failures).
 *   3. POLICY_BLOCK — runtime preflight отказал (tenant ушёл в paused
 *      state, account стал INACTIVE, credentials протухли). НЕ technical
 *      failure, retry бесполезен — должен поднять run в BLOCKED.
 *   4. AUTH_FAILURE — adapter получил 401/403. Это ОТДЕЛЬНО от тех. сбоя:
 *      retry без обновления credentials ничего не даст. Должен пометить
 *      account как `credentialStatus=NEEDS_RECONNECT` (через
 *      marketplace-accounts) и завершить run как FAILED.
 *   5. TECHNICAL_FAILURE — таймаут/5xx/network. Retry-eligible с backoff.
 *   6. RATE_LIMIT — 429. Retry-eligible, но с увеличенным backoff.
 *
 * Эта taxonomy используется и stage runner'ами (они возвращают
 * `AdapterStageResult`), и worker engine'ом (он маршрутизирует run на
 * основе классификации финального результата).
 */

export type AdapterOutcome =
    | 'SUCCESS'
    | 'PARTIAL'
    | 'POLICY_BLOCK'
    | 'AUTH_FAILURE'
    | 'TECHNICAL_FAILURE'
    | 'RATE_LIMIT';

import {
    SyncBlockedReasonCode,
    SyncErrorCodeValue,
} from '../marketplace_sync/sync-run.contract';
import {
    SyncRunItemType,
    SyncRunItemStage,
    Prisma,
} from '@prisma/client';

/** Единичная item-failure внутри stage. Worker запишет её через `recordItem`. */
export interface AdapterItemFailure {
    itemType: SyncRunItemType;
    itemKey: string;
    externalEventId?: string | null;
    payload?: Prisma.InputJsonValue;
    error?: Prisma.InputJsonValue;
}

/** Зафиксированный конфликт внутри stage. Worker запишет через `recordConflict`. */
export interface AdapterConflict {
    entityType: string;
    entityId?: string | null;
    conflictType: string;
    payload?: Prisma.InputJsonValue;
}

/**
 * Результат выполнения одной стадии (PULL_METADATA / PULL_ORDERS / ... ).
 * Stage runner ВСЕГДА возвращает структуру (никаких throw — аномалии
 * нормализуются в `outcome` + `errorCode`).
 */
export interface AdapterStageResult {
    outcome: AdapterOutcome;
    stage: SyncRunItemStage;
    /** Для аналитики: сколько items было обработано успешно (не пишется в SyncRunItem). */
    processedCount: number;
    /** Item-level отказы — будут записаны как FAILED items. */
    itemFailures?: AdapterItemFailure[];
    /** Конфликты — будут записаны в SyncConflict, run помечается PARTIAL_SUCCESS. */
    conflicts?: AdapterConflict[];
    /** Машинный код ошибки (для outcome ≠ SUCCESS/PARTIAL). */
    errorCode?: SyncErrorCodeValue;
    /** Свободный текст ошибки — для UI/логов. */
    errorMessage?: string;
    /** Reason код policy-block (только для outcome=POLICY_BLOCK). */
    blockedReason?: SyncBlockedReasonCode;
}

/** Helper для создания SUCCESS result в адаптере. */
export function adapterSuccess(
    stage: SyncRunItemStage,
    processedCount: number,
): AdapterStageResult {
    return { outcome: 'SUCCESS', stage, processedCount };
}

/** Helper для PARTIAL: были ошибки/конфликты, но run должен продолжить. */
export function adapterPartial(
    stage: SyncRunItemStage,
    processedCount: number,
    options: {
        itemFailures?: AdapterItemFailure[];
        conflicts?: AdapterConflict[];
        errorCode?: SyncErrorCodeValue;
        errorMessage?: string;
    } = {},
): AdapterStageResult {
    return {
        outcome: 'PARTIAL',
        stage,
        processedCount,
        ...options,
    };
}

/** Helper для классификации по HTTP статусу — стандартный axios error. */
export function classifyHttpError(
    stage: SyncRunItemStage,
    err: any,
): AdapterStageResult {
    const status: number | undefined = err?.response?.status;
    const message: string = err?.message ?? 'unknown';

    if (status === 401 || status === 403) {
        return {
            outcome: 'AUTH_FAILURE',
            stage,
            processedCount: 0,
            errorCode: 'EXTERNAL_AUTH_FAILED',
            errorMessage: message,
        };
    }
    if (status === 429) {
        return {
            outcome: 'RATE_LIMIT',
            stage,
            processedCount: 0,
            errorCode: 'EXTERNAL_RATE_LIMIT',
            errorMessage: message,
        };
    }
    if (status && status >= 500) {
        return {
            outcome: 'TECHNICAL_FAILURE',
            stage,
            processedCount: 0,
            errorCode: 'EXTERNAL_5XX',
            errorMessage: message,
        };
    }
    if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT') {
        return {
            outcome: 'TECHNICAL_FAILURE',
            stage,
            processedCount: 0,
            errorCode: 'EXTERNAL_TIMEOUT',
            errorMessage: message,
        };
    }
    return {
        outcome: 'TECHNICAL_FAILURE',
        stage,
        processedCount: 0,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: message,
    };
}
