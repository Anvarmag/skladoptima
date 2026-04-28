import { Injectable, Logger } from '@nestjs/common';
import {
    AccessState,
    MarketplaceLifecycleStatus,
    MarketplaceCredentialStatus,
    SyncRunStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
    SyncBlockedReason,
    SyncBlockedReasonCode,
} from '../marketplace_sync/sync-run.contract';
import { SyncRunEventNames } from '../marketplace_sync/sync-run.events';

/**
 * Shared preflight для sync (TASK_SYNC_3).
 *
 * Single source of truth для решения «можно ли прямо сейчас идти во внешний
 * API маркетплейса для (tenant, account)». Используется тремя слоями:
 *
 *   1. API admission (TASK_SYNC_2 → `SyncRunsService.createRun`): отказывает
 *      manual run в момент создания, материализует BLOCKED run в истории.
 *   2. Worker runtime preflight (TASK_SYNC_4+): перед каждым внешним
 *      stage-вызовом (PULL/PUSH/...) — состояние tenant/account могло
 *      измениться между QUEUED → IN_PROGRESS, поэтому проверка обязана
 *      повторяться.
 *   3. Legacy scheduled polling (`marketplace_sync/sync.service.ts`):
 *      раньше дёргал свой `_isTenantPaused` без проверки lifecycle/credentials
 *      и без записи факта блокировки. Теперь ходит сюда.
 *
 * Решения преднамеренные:
 * - **`UNKNOWN` / `VALIDATING` credentials НЕ блокируют сразу.** Worker сам
 *   запускает fresh validate перед external call (часть TASK_SYNC_4). Иначе
 *   первый sync после создания аккаунта вечно был бы blocked. Это §10 риск
 *   «не подменять fresh validation политикой».
 * - **`concurrency` отделена от других блокировок.** API admission всегда
 *   проверяет concurrency, но runtime preflight worker'а — НЕТ: worker уже
 *   _и есть_ "другой активный run", он не должен блокировать сам себя.
 *   Параметр `checkConcurrency: false` в `runtimePreflight` это закрепляет.
 * - **Decision не пишет в БД сам.** Caller (createRun / worker / scheduled
 *   poll) решает, что делать с блокировкой: материализовать `SyncRun` со
 *   `status=BLOCKED` (admission) или просто переиспользовать существующий
 *   run и записать stage-блокировку (worker). Сервис только возвращает
 *   решение и эмитит structured-лог.
 */

const PAUSED_TENANT_STATES: ReadonlySet<AccessState> = new Set([
    AccessState.TRIAL_EXPIRED,
    AccessState.SUSPENDED,
    AccessState.CLOSED,
]);

const TENANT_STATE_BLOCK_REASON: Partial<Record<AccessState, SyncBlockedReasonCode>> = {
    [AccessState.TRIAL_EXPIRED]: SyncBlockedReason.TENANT_TRIAL_EXPIRED,
    [AccessState.SUSPENDED]: SyncBlockedReason.TENANT_SUSPENDED,
    [AccessState.CLOSED]: SyncBlockedReason.TENANT_CLOSED,
};

const TENANT_STATE_BLOCK_EVENT: Partial<Record<AccessState, string>> = {
    [AccessState.TRIAL_EXPIRED]: SyncRunEventNames.BLOCKED_BY_TENANT_STATE,
    [AccessState.SUSPENDED]: SyncRunEventNames.BLOCKED_BY_TENANT_STATE,
    [AccessState.CLOSED]: SyncRunEventNames.BLOCKED_BY_TENANT_STATE,
};

export type PreflightDecision =
    | { allowed: true; tenantAccessState: AccessState }
    | {
          allowed: false;
          reason: SyncBlockedReasonCode;
          eventName: string;
          tenantAccessState: AccessState | null;
          conflictingRunId?: string;
      };

export interface PreflightOptions {
    /** Если false — пропустить concurrency check. Worker сам активный run, не должен блокировать себя. */
    checkConcurrency?: boolean;
    /** Stage/operation для structured-лога (создание run, worker stage, scheduled poll). */
    operation: string;
    /** Опциональная подсказка call site'а (для логов) — например `runId`. */
    runId?: string;
}

@Injectable()
export class SyncPreflightService {
    private readonly logger = new Logger(SyncPreflightService.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Выполняет preflight для (tenantId, accountId). Если accountId==null,
     * проверяется только tenant state — это будущий tenant_full scope, в
     * MVP не используется для actual sync (см. §10).
     */
    async runPreflight(
        tenantId: string,
        accountId: string | null,
        options: PreflightOptions,
    ): Promise<PreflightDecision> {
        const checkConcurrency = options.checkConcurrency ?? true;

        // 1. Tenant state.
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { accessState: true },
        });
        if (!tenant) {
            // Tenant не существует — возвращаем CLOSED-эквивалент. Caller
            // решит, что делать (для sync — не идти в external).
            this._logBlock(SyncRunEventNames.BLOCKED_BY_TENANT_STATE, {
                tenantId,
                accountId,
                operation: options.operation,
                reason: SyncBlockedReason.TENANT_CLOSED,
                detail: 'tenant_not_found',
            });
            return {
                allowed: false,
                reason: SyncBlockedReason.TENANT_CLOSED,
                eventName: SyncRunEventNames.BLOCKED_BY_TENANT_STATE,
                tenantAccessState: null,
            };
        }
        const accessState = tenant.accessState;

        if (PAUSED_TENANT_STATES.has(accessState)) {
            const reason = TENANT_STATE_BLOCK_REASON[accessState]!;
            const eventName = TENANT_STATE_BLOCK_EVENT[accessState]!;
            this._logBlock(eventName, {
                tenantId,
                accountId,
                operation: options.operation,
                reason,
                runId: options.runId,
                accessState,
            });
            return { allowed: false, reason, eventName, tenantAccessState: accessState };
        }

        // 2. Account-уровневые проверки (только если есть конкретный аккаунт).
        if (accountId) {
            const account = await this.prisma.marketplaceAccount.findFirst({
                where: { id: accountId, tenantId },
                select: { id: true, lifecycleStatus: true, credentialStatus: true },
            });
            if (!account) {
                // Account не найден / удалён / другого tenant — это policy block,
                // а не 404 от API (caller сам решит, что делать). По смыслу
                // самый близкий машинный код — ACCOUNT_INACTIVE.
                this._logBlock(SyncRunEventNames.BLOCKED_BY_ACCOUNT_STATE, {
                    tenantId,
                    accountId,
                    operation: options.operation,
                    reason: SyncBlockedReason.ACCOUNT_INACTIVE,
                    detail: 'account_not_found',
                });
                return {
                    allowed: false,
                    reason: SyncBlockedReason.ACCOUNT_INACTIVE,
                    eventName: SyncRunEventNames.BLOCKED_BY_ACCOUNT_STATE,
                    tenantAccessState: accessState,
                };
            }

            if (account.lifecycleStatus !== MarketplaceLifecycleStatus.ACTIVE) {
                this._logBlock(SyncRunEventNames.BLOCKED_BY_ACCOUNT_STATE, {
                    tenantId,
                    accountId,
                    operation: options.operation,
                    reason: SyncBlockedReason.ACCOUNT_INACTIVE,
                    runId: options.runId,
                    lifecycleStatus: account.lifecycleStatus,
                });
                return {
                    allowed: false,
                    reason: SyncBlockedReason.ACCOUNT_INACTIVE,
                    eventName: SyncRunEventNames.BLOCKED_BY_ACCOUNT_STATE,
                    tenantAccessState: accessState,
                };
            }

            if (account.credentialStatus === MarketplaceCredentialStatus.INVALID) {
                this._logBlock(SyncRunEventNames.BLOCKED_BY_CREDENTIALS, {
                    tenantId,
                    accountId,
                    operation: options.operation,
                    reason: SyncBlockedReason.CREDENTIALS_INVALID,
                    runId: options.runId,
                });
                return {
                    allowed: false,
                    reason: SyncBlockedReason.CREDENTIALS_INVALID,
                    eventName: SyncRunEventNames.BLOCKED_BY_CREDENTIALS,
                    tenantAccessState: accessState,
                };
            }

            if (account.credentialStatus === MarketplaceCredentialStatus.NEEDS_RECONNECT) {
                this._logBlock(SyncRunEventNames.BLOCKED_BY_CREDENTIALS, {
                    tenantId,
                    accountId,
                    operation: options.operation,
                    reason: SyncBlockedReason.CREDENTIALS_NEEDS_RECONNECT,
                    runId: options.runId,
                });
                return {
                    allowed: false,
                    reason: SyncBlockedReason.CREDENTIALS_NEEDS_RECONNECT,
                    eventName: SyncRunEventNames.BLOCKED_BY_CREDENTIALS,
                    tenantAccessState: accessState,
                };
            }

            // 3. Concurrency guard. Только для admission (createRun); worker
            // в runtime отключает (он сам тот run, который "активен").
            if (checkConcurrency) {
                const active = await this.prisma.syncRun.findFirst({
                    where: {
                        tenantId,
                        marketplaceAccountId: accountId,
                        status: { in: [SyncRunStatus.QUEUED, SyncRunStatus.IN_PROGRESS] },
                    },
                    select: { id: true },
                });
                if (active) {
                    this._logBlock(SyncRunEventNames.BLOCKED_BY_CONCURRENCY, {
                        tenantId,
                        accountId,
                        operation: options.operation,
                        reason: SyncBlockedReason.CONCURRENCY_GUARD,
                        runId: options.runId,
                        conflictingRunId: active.id,
                    });
                    return {
                        allowed: false,
                        reason: SyncBlockedReason.CONCURRENCY_GUARD,
                        eventName: SyncRunEventNames.BLOCKED_BY_CONCURRENCY,
                        tenantAccessState: accessState,
                        conflictingRunId: active.id,
                    };
                }
            }
        }

        return { allowed: true, tenantAccessState: accessState };
    }

    private _logBlock(event: string, data: Record<string, unknown>) {
        this.logger.warn(JSON.stringify({ event, ...data, ts: new Date().toISOString() }));
    }
}
