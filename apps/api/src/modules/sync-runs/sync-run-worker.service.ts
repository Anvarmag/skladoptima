import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import {
    SyncRunStatus,
    SyncRunItemStage,
    SyncRunItemType,
    SyncRunItemStatus,
    SyncTriggerType,
    SyncTriggerScope,
    Prisma,
    SyncRun,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MarketplaceAccountsService } from '../marketplace-accounts/marketplace-accounts.service';
import { SyncPreflightService } from './sync-preflight.service';
import { SyncDiagnosticsService } from './sync-diagnostics.service';
import {
    AdapterOutcome,
    AdapterStageResult,
} from './adapter-result';
import {
    SyncBlockedReasonCode,
    SyncErrorCodeValue,
    SyncType,
    SyncTypes,
} from '../marketplace_sync/sync-run.contract';
import { SyncRunEventNames } from '../marketplace_sync/sync-run.events';

/**
 * Stage runner — pluggable executor одной стадии sync run pipeline.
 * Реальные адаптеры (TASK_SYNC_5+ для production WB/Ozon) реализуют
 * этот интерфейс и регистрируются в `SyncRunWorker.registerRunner()`.
 *
 * MVP-thin-wrappers вокруг legacy `pullFromWb`/`pullFromOzon` живут
 * в отдельном файле и подключаются bootstrap'ом — это не трогает
 * production hot path до полной готовности новой pipeline.
 */
export interface SyncStageRunner {
    readonly syncType: SyncType;
    readonly stage: SyncRunItemStage;
    run(ctx: StageContext): Promise<AdapterStageResult>;
}

export interface StageContext {
    runId: string;
    tenantId: string;
    marketplaceAccountId: string | null;
    attemptNumber: number;
}

/**
 * Канонический порядок stages внутри run. §13: pull metadata → pull orders/
 * stocks → transform/apply → push. Worker идёт по порядку и пропускает
 * те типы, которые не запрошены в `syncTypes[]`.
 *
 * Решение по `FULL_SYNC`: если в `syncTypes` есть `FULL_SYNC`, он
 * раскрывается в полный набор остальных типов в каноническом порядке.
 */
const CANONICAL_STAGE_ORDER: SyncType[] = [
    SyncTypes.PULL_METADATA,
    SyncTypes.PULL_ORDERS,
    SyncTypes.PULL_STOCKS,
    SyncTypes.PUSH_STOCKS,
];

/** Backoff (мс) для retry: 30s, 2min, 10min. Дальше — exhausted. */
const RETRY_BACKOFF_MS = [30_000, 120_000, 600_000];

/**
 * Worker engine для sync run pipeline (TASK_SYNC_5).
 *
 * Отвечает за:
 * - lifecycle run'а: `QUEUED → IN_PROGRESS → SUCCESS/PARTIAL_SUCCESS/FAILED/BLOCKED`;
 * - оркестрацию stages в каноническом порядке (§13);
 * - классификацию stage outcomes и применение retry/circuit-breaker policy;
 * - синхронизацию `MarketplaceAccount.lastSyncResult/syncHealthStatus` через
 *   `MarketplaceAccountsService.reportSyncRun()` (existing public API);
 * - запись item-level failures и конфликтов через `SyncDiagnosticsService`.
 *
 * Что НЕ делает (ответственность других слоёв):
 * - НЕ опрашивает очередь / БД на наличие QUEUED runs — это работа
 *   queue dispatcher (TASK_18-worker module). Worker экспортирует
 *   публичный `processRun(runId)`, который dispatcher вызывает.
 * - НЕ применяет inventory side-effects напрямую — adapters должны
 *   передавать стабильный `external_event_id` в
 *   `inventoryService.reserve/release/deduct`, который уже идемпотентен
 *   через `InventoryEffectLock` (TASK_SYNC_4 контракт).
 * - НЕ держит per-process state (counters / circuit breaker memory)
 *   между вызовами — всё хранится в `SyncRun` aggregated counters и
 *   `MarketplaceAccount.syncHealthStatus`. Это делает worker stateless
 *   и пригодным для горизонтального масштабирования.
 */
@Injectable()
export class SyncRunWorker {
    private readonly logger = new Logger(SyncRunWorker.name);

    /** Реестр зарегистрированных stage runners — заполняется bootstrap'ом. */
    private readonly runners = new Map<string, SyncStageRunner>();

    constructor(
        private readonly prisma: PrismaService,
        private readonly preflight: SyncPreflightService,
        private readonly diagnostics: SyncDiagnosticsService,
        private readonly marketplaceAccounts: MarketplaceAccountsService,
    ) {}

    /**
     * Регистрирует runner для пары (syncType, stage). Bootstrap делает это
     * для каждого marketplace adapter в TASK_SYNC_5+ adapter rollout.
     */
    registerRunner(runner: SyncStageRunner): void {
        const key = this._runnerKey(runner.syncType, runner.stage);
        this.runners.set(key, runner);
    }

    /**
     * Главный entry point: обработать конкретный run. Возвращает финальное
     * состояние `SyncRun`. Идемпотентно по run lifecycle: повторный вызов
     * на терминальном run возвращает его без изменений.
     */
    async processRun(runId: string): Promise<SyncRun> {
        const run = await this.prisma.syncRun.findUnique({ where: { id: runId } });
        if (!run) throw new NotFoundException({ code: 'SYNC_RUN_NOT_FOUND' });

        if (run.status !== SyncRunStatus.QUEUED) {
            // Защита от двойного pickup. Не throw — dispatcher ожидает
            // graceful skip, а не exception.
            this.logger.warn(this._evt('sync_run_pickup_skipped', {
                runId,
                tenantId: run.tenantId,
                actualStatus: run.status,
            }));
            return run;
        }

        // 1. Перевод в IN_PROGRESS с conditional update — защита от race
        // двух dispatcher'ов, поднявших один и тот же QUEUED run.
        const startedAt = new Date();
        const claimResult = await this.prisma.syncRun.updateMany({
            where: { id: runId, status: SyncRunStatus.QUEUED },
            data: { status: SyncRunStatus.IN_PROGRESS, startedAt },
        });
        if (claimResult.count === 0) {
            // Другой worker уже забрал run.
            const refreshed = await this.prisma.syncRun.findUnique({ where: { id: runId } });
            return refreshed!;
        }

        this.logger.log(this._evt(SyncRunEventNames.STARTED, {
            runId,
            tenantId: run.tenantId,
            triggerType: run.triggerType,
            attemptNumber: run.attemptNumber,
        }));

        try {
            // 2. Runtime preflight — состояние tenant/account могло измениться
            // с момента создания run (до часов в очереди). Re-check.
            const decision = await this.preflight.runPreflight(
                run.tenantId,
                run.marketplaceAccountId,
                {
                    operation: 'worker_start',
                    runId,
                    // worker сам и есть "активный run" — concurrency check был на admission.
                    checkConcurrency: false,
                },
            );

            if (!decision.allowed) {
                return await this._finalizeBlocked(run, decision.reason, decision.eventName);
            }

            // 3. Раскрываем FULL_SYNC, если есть, и фильтруем по
            //    каноническому порядку — пропускаем типы, не запрошенные
            //    в run (но всегда обходим в одной и той же
            //    последовательности).
            const requested = this._expandSyncTypes(run.syncTypes as string[]);
            const stagesToRun: SyncType[] = CANONICAL_STAGE_ORDER.filter((t) =>
                requested.has(t),
            );

            if (stagesToRun.length === 0) {
                return await this._finalizeFailed(
                    run,
                    'INTERNAL_ERROR',
                    'No supported sync types requested',
                );
            }

            // 4. Выполняем stages по очереди.
            let aggregateProcessed = 0;
            let aggregateErrors = 0;
            let hadConflict = false;
            let firstFailure: AdapterStageResult | null = null;

            for (const syncType of stagesToRun) {
                const runner = this._findRunner(syncType);
                if (!runner) {
                    // Runner ещё не зарегистрирован для этого type. В MVP это
                    // ожидаемо: рост adapters идёт постепенно. Считаем stage
                    // SKIPPED (не падает и не создаёт item — §8 правило).
                    this.logger.warn(this._evt('sync_run_runner_missing', {
                        runId,
                        tenantId: run.tenantId,
                        syncType,
                    }));
                    continue;
                }

                this.logger.log(this._evt(SyncRunEventNames.STAGE_STARTED, {
                    runId,
                    tenantId: run.tenantId,
                    stage: runner.stage,
                    syncType,
                }));

                let result: AdapterStageResult;
                try {
                    result = await runner.run({
                        runId,
                        tenantId: run.tenantId,
                        marketplaceAccountId: run.marketplaceAccountId,
                        attemptNumber: run.attemptNumber,
                    });
                } catch (err: any) {
                    // Stage runner НЕ должен throw — но если кинул, ловим
                    // и считаем как INTERNAL_ERROR. Не убиваем весь run.
                    this.logger.error(this._evt('sync_run_stage_threw', {
                        runId,
                        tenantId: run.tenantId,
                        syncType,
                        message: err?.message,
                    }));
                    result = {
                        outcome: 'TECHNICAL_FAILURE',
                        stage: runner.stage,
                        processedCount: 0,
                        errorCode: 'INTERNAL_ERROR',
                        errorMessage: err?.message ?? 'unknown',
                    };
                }

                // Записываем item failures (только проблемные — §8).
                if (result.itemFailures?.length) {
                    for (const f of result.itemFailures) {
                        await this.diagnostics.recordItem({
                            runId,
                            itemType: f.itemType,
                            itemKey: f.itemKey,
                            stage: runner.stage,
                            status: SyncRunItemStatus.FAILED,
                            externalEventId: f.externalEventId ?? null,
                            payload: f.payload,
                            error: f.error,
                        });
                    }
                }
                // Записываем конфликты.
                if (result.conflicts?.length) {
                    hadConflict = true;
                    for (const c of result.conflicts) {
                        await this.diagnostics.recordConflict(run.tenantId, {
                            runId,
                            entityType: c.entityType,
                            entityId: c.entityId ?? null,
                            conflictType: c.conflictType,
                            payload: c.payload,
                        });
                    }
                }

                aggregateProcessed += result.processedCount;
                aggregateErrors += result.itemFailures?.length ?? 0;

                this.logger.log(this._evt(SyncRunEventNames.STAGE_FINISHED, {
                    runId,
                    tenantId: run.tenantId,
                    stage: runner.stage,
                    syncType,
                    outcome: result.outcome,
                    processed: result.processedCount,
                }));

                // Маршрутизация по outcome:
                // - SUCCESS / PARTIAL → продолжаем дальше;
                // - POLICY_BLOCK → весь run BLOCKED, остальные stages пропускаются;
                // - AUTH_FAILURE → run FAILED, account → NEEDS_RECONNECT;
                // - TECHNICAL_FAILURE / RATE_LIMIT → run FAILED с retry policy.
                if (result.outcome === 'POLICY_BLOCK') {
                    return await this._finalizeBlocked(
                        run,
                        result.blockedReason ?? 'CREDENTIALS_INVALID',
                        SyncRunEventNames.BLOCKED_BY_TENANT_STATE,
                    );
                }
                if (
                    result.outcome === 'AUTH_FAILURE' ||
                    result.outcome === 'TECHNICAL_FAILURE' ||
                    result.outcome === 'RATE_LIMIT'
                ) {
                    firstFailure = result;
                    break;
                }
            }

            // 5. Финализация. Если был fatal stage failure — FAILED.
            if (firstFailure) {
                return await this._finalizeFailedFromStage(run, firstFailure, {
                    aggregateProcessed,
                    aggregateErrors,
                });
            }

            // PARTIAL_SUCCESS если были item failures или конфликты.
            const partial = aggregateErrors > 0 || hadConflict;
            return await this._finalizeOk(run, {
                processed: aggregateProcessed,
                errors: aggregateErrors,
                partial,
            });
        } catch (err: any) {
            // Defensive: любая необработанная ошибка наверху НЕ должна
            // оставлять run в IN_PROGRESS. Финализируем как FAILED.
            this.logger.error(this._evt('sync_run_worker_threw', {
                runId,
                tenantId: run.tenantId,
                message: err?.message,
            }));
            return await this._finalizeFailed(
                run,
                'INTERNAL_ERROR',
                err?.message ?? 'unknown',
            );
        }
    }

    // ─── private finalization helpers ──────────────────────────────────────

    private async _finalizeOk(
        run: SyncRun,
        data: { processed: number; errors: number; partial: boolean },
    ): Promise<SyncRun> {
        const finishedAt = new Date();
        const startedAt = run.startedAt ?? finishedAt;
        const durationMs = finishedAt.getTime() - startedAt.getTime();

        const updated = await this.prisma.syncRun.update({
            where: { id: run.id },
            data: {
                status: data.partial ? SyncRunStatus.PARTIAL_SUCCESS : SyncRunStatus.SUCCESS,
                finishedAt,
                durationMs,
                processedCount: data.processed,
                errorCount: data.errors,
            },
        });

        // Handoff: обновляем sync health на marketplace account через
        // публичный API (не делаем direct prisma update — single source of
        // truth держит marketplace-accounts модуль).
        if (run.marketplaceAccountId) {
            await this.marketplaceAccounts
                .reportSyncRun(run.tenantId, run.marketplaceAccountId, {
                    ok: true,
                    partial: data.partial,
                    healthReason: data.partial ? 'PARTIAL_SUCCESS' : undefined,
                })
                .catch((e) => {
                    this.logger.warn(this._evt('sync_run_health_report_failed', {
                        runId: run.id,
                        tenantId: run.tenantId,
                        message: e?.message,
                    }));
                });
        }

        this.logger.log(this._evt(SyncRunEventNames.FINISHED, {
            runId: run.id,
            tenantId: run.tenantId,
            status: updated.status,
            durationMs,
            processed: data.processed,
            errors: data.errors,
        }));

        return updated;
    }

    private async _finalizeFailedFromStage(
        run: SyncRun,
        failure: AdapterStageResult,
        agg: { aggregateProcessed: number; aggregateErrors: number },
    ): Promise<SyncRun> {
        const finishedAt = new Date();
        const startedAt = run.startedAt ?? finishedAt;
        const durationMs = finishedAt.getTime() - startedAt.getTime();

        // Retry policy: AUTH_FAILURE НЕ retry'им автоматически (бесполезно
        // без обновления credentials). TECHNICAL/RATE_LIMIT — eligible.
        const isRetryEligible =
            (failure.outcome === 'TECHNICAL_FAILURE' || failure.outcome === 'RATE_LIMIT') &&
            run.attemptNumber < run.maxAttempts;
        const nextAttemptAt = isRetryEligible
            ? new Date(
                  finishedAt.getTime() +
                      this._backoffMs(run.attemptNumber, failure.outcome === 'RATE_LIMIT'),
              )
            : null;

        const updated = await this.prisma.syncRun.update({
            where: { id: run.id },
            data: {
                status: SyncRunStatus.FAILED,
                finishedAt,
                durationMs,
                processedCount: agg.aggregateProcessed,
                errorCount: agg.aggregateErrors > 0 ? agg.aggregateErrors : 1,
                errorCode: failure.errorCode ?? 'INTERNAL_ERROR',
                errorMessage: failure.errorMessage ?? null,
                nextAttemptAt,
            },
        });

        // Handoff в marketplace account: если AUTH_FAILURE — отдельный путь
        // через reportSyncRun не помечает credentials (§20 invariant: sync
        // health и credential validity — независимые слои). Фактическое
        // переключение credentialStatus → NEEDS_RECONNECT — task validate'а
        // на marketplace-accounts, который worker запустит отдельно при
        // следующем validate (§14 marketplace-accounts).
        if (run.marketplaceAccountId) {
            await this.marketplaceAccounts
                .reportSyncRun(run.tenantId, run.marketplaceAccountId, {
                    ok: false,
                    errorCode: failure.errorCode,
                    errorMessage: failure.errorMessage,
                    healthReason: failure.errorCode,
                })
                .catch((e) => {
                    this.logger.warn(this._evt('sync_run_health_report_failed', {
                        runId: run.id,
                        tenantId: run.tenantId,
                        message: e?.message,
                    }));
                });
        }

        const eventName = this._eventNameForFailure(failure.outcome);
        this.logger.error(this._evt(eventName, {
            runId: run.id,
            tenantId: run.tenantId,
            outcome: failure.outcome,
            errorCode: failure.errorCode,
            attemptNumber: run.attemptNumber,
            nextAttemptAt: nextAttemptAt?.toISOString() ?? null,
        }));

        if (isRetryEligible) {
            this.logger.log(this._evt(SyncRunEventNames.RETRY_SCHEDULED, {
                runId: run.id,
                tenantId: run.tenantId,
                nextAttemptAt: nextAttemptAt!.toISOString(),
                attemptNumber: run.attemptNumber + 1,
                maxAttempts: run.maxAttempts,
            }));
        } else if (run.attemptNumber >= run.maxAttempts) {
            this.logger.warn(this._evt(SyncRunEventNames.RETRY_EXHAUSTED, {
                runId: run.id,
                tenantId: run.tenantId,
                attemptNumber: run.attemptNumber,
                maxAttempts: run.maxAttempts,
            }));
        }

        return updated;
    }

    private async _finalizeFailed(
        run: SyncRun,
        errorCode: SyncErrorCodeValue,
        errorMessage: string,
    ): Promise<SyncRun> {
        const finishedAt = new Date();
        const startedAt = run.startedAt ?? finishedAt;
        const durationMs = finishedAt.getTime() - startedAt.getTime();
        return this.prisma.syncRun.update({
            where: { id: run.id },
            data: {
                status: SyncRunStatus.FAILED,
                finishedAt,
                durationMs,
                errorCode,
                errorMessage,
                errorCount: 1,
            },
        });
    }

    private async _finalizeBlocked(
        run: SyncRun,
        reason: SyncBlockedReasonCode,
        eventName: string,
    ): Promise<SyncRun> {
        const finishedAt = new Date();
        const startedAt = run.startedAt ?? finishedAt;
        const durationMs = finishedAt.getTime() - startedAt.getTime();
        const updated = await this.prisma.syncRun.update({
            where: { id: run.id },
            data: {
                status: SyncRunStatus.BLOCKED,
                finishedAt,
                durationMs,
                blockedReason: reason,
            },
        });
        this.logger.warn(this._evt(eventName, {
            runId: run.id,
            tenantId: run.tenantId,
            reason,
        }));
        return updated;
    }

    // ─── helpers ────────────────────────────────────────────────────────────

    private _expandSyncTypes(types: string[]): Set<SyncType> {
        const out = new Set<SyncType>();
        for (const t of types) {
            if (t === SyncTypes.FULL_SYNC) {
                CANONICAL_STAGE_ORDER.forEach((s) => out.add(s));
            } else {
                out.add(t as SyncType);
            }
        }
        return out;
    }

    private _findRunner(syncType: SyncType): SyncStageRunner | undefined {
        // Возвращаем первый matching runner по syncType независимо от stage —
        // адаптер сам знает свою stage (PULL_METADATA → PULL, PUSH_STOCKS → PUSH).
        for (const r of this.runners.values()) {
            if (r.syncType === syncType) return r;
        }
        return undefined;
    }

    private _runnerKey(syncType: SyncType, stage: SyncRunItemStage): string {
        return `${syncType}::${stage}`;
    }

    private _backoffMs(attemptNumber: number, isRateLimit: boolean): number {
        const idx = Math.min(attemptNumber - 1, RETRY_BACKOFF_MS.length - 1);
        const base = RETRY_BACKOFF_MS[idx];
        // Rate-limit получает удвоенный backoff.
        return isRateLimit ? base * 2 : base;
    }

    private _eventNameForFailure(outcome: AdapterOutcome): string {
        if (outcome === 'AUTH_FAILURE') return SyncRunEventNames.EXTERNAL_ERROR;
        if (outcome === 'RATE_LIMIT') return SyncRunEventNames.EXTERNAL_RATE_LIMIT;
        return SyncRunEventNames.EXTERNAL_ERROR;
    }

    private _evt(event: string, data: Record<string, unknown>) {
        return JSON.stringify({ event, ...data, ts: new Date().toISOString() });
    }
}
