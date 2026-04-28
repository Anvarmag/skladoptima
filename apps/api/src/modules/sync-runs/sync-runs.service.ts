import {
    Injectable,
    Logger,
    NotFoundException,
    BadRequestException,
    ConflictException,
} from '@nestjs/common';
import {
    SyncRunStatus,
    SyncTriggerScope,
    SyncTriggerType,
    Prisma,
    SyncRun,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
    SyncBlockedReasonCode,
    SyncType,
} from '../marketplace_sync/sync-run.contract';
import { SyncRunEventNames } from '../marketplace_sync/sync-run.events';
import { SyncPreflightService } from './sync-preflight.service';
import { CreateSyncRunDto } from './dto/create-sync-run.dto';
import { ListSyncRunsDto } from './dto/list-sync-runs.dto';
import { randomUUID } from 'crypto';

/**
 * Service слой sync-runs API (TASK_SYNC_2 + TASK_SYNC_3).
 *
 * Отвечает за:
 * - создание run'ов из manual API (`POST /sync/runs`) и retry-операций;
 * - delegation preflight-policy в `SyncPreflightService` (TASK_SYNC_3 — shared
 *   single source of truth для tenant/account/credentials/concurrency);
 *   неуспешный preflight материализует run со `status=BLOCKED` и машинным
 *   `blockedReason` — это §20 риск "не смешивать blocked с failed";
 * - чтение списка/деталей с включёнными items и conflicts (§12 DoD);
 * - построение детерминированного `jobKey` и DB-level idempotency через
 *   UNIQUE(tenantId, jobKey).
 *
 * Что НЕ делается здесь (намеренно):
 * - реальная обработка run'ов (PULL_STOCKS / PUSH_STOCKS / ... против внешних
 *   API) — это TASK_SYNC_4+; worker читает `QUEUED` run'ы и переводит их в
 *   `IN_PROGRESS → SUCCESS/...`.
 * - tenant full sync — §10 явно исключает из MVP runtime surface.
 */

@Injectable()
export class SyncRunsService {
    private readonly logger = new Logger(SyncRunsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly preflight: SyncPreflightService,
    ) {}

    /**
     * POST /sync/runs — создать manual run по account.
     *
     * Поток:
     *   1) Проверить, что аккаунт существует и принадлежит tenant'у.
     *   2) Preflight tenant + account state. На неудаче — материализовать
     *      run со status=BLOCKED + blockedReason и вернуть его клиенту
     *      (HTTP 200, не 403 — это _не_ ошибка валидации, а зафиксированный
     *      lifecycle: пользователь увидит запись в истории).
     *   3) Concurrency guard: один активный run на (tenant, account).
     *      Тоже материализуется как BLOCKED, чтобы попытка не пропала.
     *   4) Иначе — создать run в status=QUEUED. Worker подхватит позже.
     *
     * Idempotency: если клиент передал `idempotencyKey`, jobKey строится
     * детерминированно и DB UNIQUE возвращает уже созданный run при повторе.
     */
    async createRun(
        tenantId: string,
        actorUserId: string | null,
        dto: CreateSyncRunDto,
    ) {
        // 1. Account ownership check — должен принадлежать tenant'у.
        // Намеренно отдельно от preflight: нет аккаунта → 404, есть, но
        // policy его блокирует → BLOCKED run в истории.
        const account = await this.prisma.marketplaceAccount.findFirst({
            where: { id: dto.accountId, tenantId },
            select: { id: true },
        });
        if (!account) {
            throw new NotFoundException({ code: 'MARKETPLACE_ACCOUNT_NOT_FOUND' });
        }

        const syncTypes = dto.syncTypes as SyncType[];
        const jobKey = this._buildManualJobKey(dto.accountId, syncTypes, dto.idempotencyKey);

        // 2. Idempotency: тот же jobKey уже существует — возвращаем без побочек.
        const existing = await this.prisma.syncRun.findUnique({
            where: { tenantId_jobKey: { tenantId, jobKey } },
        });
        if (existing) {
            this.logger.log(this._eventLog(SyncRunEventNames.QUEUED, {
                tenantId,
                runId: existing.id,
                idempotent: true,
            }));
            return this._serialize(existing);
        }

        // 3. Preflight через shared service. Любая блокировка → BLOCKED run.
        const decision = await this.preflight.runPreflight(tenantId, account.id, {
            operation: 'create_manual_run',
            checkConcurrency: true,
        });
        if (!decision.allowed) {
            return this._serialize(
                await this._createBlockedRun(tenantId, {
                    accountId: account.id,
                    syncTypes,
                    triggerType: SyncTriggerType.MANUAL,
                    requestedBy: actorUserId,
                    jobKey,
                    idempotencyKey: dto.idempotencyKey ?? null,
                    blockedReason: decision.reason,
                    eventName: decision.eventName,
                    extraEventPayload: decision.conflictingRunId
                        ? { conflictingRunId: decision.conflictingRunId }
                        : undefined,
                }),
            );
        }

        // 4. Happy path: queue the run.
        try {
            const run = await this.prisma.syncRun.create({
                data: {
                    tenantId,
                    marketplaceAccountId: account.id,
                    triggerType: SyncTriggerType.MANUAL,
                    triggerScope: SyncTriggerScope.ACCOUNT,
                    syncTypes,
                    status: SyncRunStatus.QUEUED,
                    jobKey,
                    idempotencyKey: dto.idempotencyKey ?? null,
                    requestedBy: actorUserId,
                },
            });
            this.logger.log(this._eventLog(SyncRunEventNames.QUEUED, {
                tenantId,
                runId: run.id,
                accountId: account.id,
                syncTypes,
                triggerType: 'MANUAL',
            }));
            return this._serialize(run);
        } catch (err: any) {
            // Race window между findUnique и create — повторно прочитаем по jobKey.
            if (err?.code === 'P2002') {
                const racedRun = await this.prisma.syncRun.findUnique({
                    where: { tenantId_jobKey: { tenantId, jobKey } },
                });
                if (racedRun) return this._serialize(racedRun);
            }
            throw err;
        }
    }

    /**
     * POST /sync/runs/:id/retry — создать новый run по failed/partial_success
     * предку. Создавать retry допустимо только из терминального run.
     *
     * Семантика §9 сценарий 2:
     *  - retry создаёт НОВЫЙ run (origin не «возрождается»), `triggerType=RETRY`,
     *    `originRunId = id предка`, `attemptNumber = parent.attemptNumber + 1`.
     *  - blocked-предка retry'ить нельзя: blocked — это политическое решение,
     *    не технический сбой. Пользователь должен изменить состояние tenant/
     *    account, а не повторять запуск.
     *  - cancelled-предка retry'ить тоже нельзя.
     */
    async retryRun(tenantId: string, originRunId: string, actorUserId: string | null) {
        const origin = await this.prisma.syncRun.findFirst({
            where: { id: originRunId, tenantId },
        });
        if (!origin) {
            throw new NotFoundException({ code: 'SYNC_RUN_NOT_FOUND' });
        }

        // Только FAILED / PARTIAL_SUCCESS можно retry'ить.
        if (origin.status === SyncRunStatus.SUCCESS) {
            throw new BadRequestException({
                code: 'SYNC_RUN_RETRY_NOT_APPLICABLE',
                reason: 'Origin run already SUCCESS',
            });
        }
        if (
            origin.status === SyncRunStatus.BLOCKED ||
            origin.status === SyncRunStatus.CANCELLED
        ) {
            throw new BadRequestException({
                code: 'SYNC_RUN_RETRY_NOT_APPLICABLE',
                reason: `Origin run is ${origin.status} — fix the root cause instead of retrying`,
            });
        }
        if (
            origin.status === SyncRunStatus.QUEUED ||
            origin.status === SyncRunStatus.IN_PROGRESS
        ) {
            throw new ConflictException({
                code: 'SYNC_RUN_NOT_TERMINAL',
                reason: 'Origin run is still active',
                originStatus: origin.status,
            });
        }

        // Лимит попыток: §10/§14 — fatal-ошибки → failed, мы не должны
        // retry'ить бесконечно. Используем maxAttempts из исходного run.
        if (origin.attemptNumber >= origin.maxAttempts) {
            this.logger.warn(this._eventLog(SyncRunEventNames.RETRY_EXHAUSTED, {
                tenantId,
                originRunId,
                attemptNumber: origin.attemptNumber,
                maxAttempts: origin.maxAttempts,
            }));
            throw new BadRequestException({
                code: 'SYNC_RUN_RETRY_EXHAUSTED',
                attemptNumber: origin.attemptNumber,
                maxAttempts: origin.maxAttempts,
            });
        }

        // Concurrency guard: ровно тот же account уже не должен быть в активной обработке.
        if (origin.marketplaceAccountId) {
            const active = await this.prisma.syncRun.findFirst({
                where: {
                    tenantId,
                    marketplaceAccountId: origin.marketplaceAccountId,
                    status: { in: [SyncRunStatus.QUEUED, SyncRunStatus.IN_PROGRESS] },
                },
                select: { id: true },
            });
            if (active) {
                throw new ConflictException({
                    code: 'SYNC_RUN_CONCURRENCY_CONFLICT',
                    conflictingRunId: active.id,
                });
            }
        }

        const jobKey = this._buildRetryJobKey(originRunId, origin.attemptNumber + 1);
        const syncTypes = origin.syncTypes as SyncType[];

        const run = await this.prisma.syncRun.create({
            data: {
                tenantId,
                marketplaceAccountId: origin.marketplaceAccountId,
                triggerType: SyncTriggerType.RETRY,
                triggerScope: origin.triggerScope,
                syncTypes,
                status: SyncRunStatus.QUEUED,
                originRunId: origin.id,
                jobKey,
                idempotencyKey: origin.idempotencyKey,
                requestedBy: actorUserId,
                attemptNumber: origin.attemptNumber + 1,
                maxAttempts: origin.maxAttempts,
            },
        });

        this.logger.log(this._eventLog(SyncRunEventNames.RETRY_SCHEDULED, {
            tenantId,
            runId: run.id,
            originRunId: origin.id,
            attemptNumber: run.attemptNumber,
            maxAttempts: run.maxAttempts,
        }));

        return this._serialize(run);
    }

    /** GET /sync/runs — paginated list с фильтрами. */
    async list(tenantId: string, query: ListSyncRunsDto) {
        const page = query.page && query.page > 0 ? query.page : 1;
        const limit = query.limit && query.limit > 0 ? query.limit : 20;

        const where: Prisma.SyncRunWhereInput = { tenantId };
        if (query.accountId) where.marketplaceAccountId = query.accountId;
        if (query.status) where.status = query.status;
        if (query.triggerType) where.triggerType = query.triggerType;

        const [items, total] = await Promise.all([
            this.prisma.syncRun.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.prisma.syncRun.count({ where }),
        ]);

        return {
            data: items.map((r) => this._serialize(r)),
            meta: {
                total,
                page,
                limit,
                lastPage: Math.max(1, Math.ceil(total / limit)),
            },
        };
    }

    /**
     * GET /sync/runs/:id — карточка run'а с item-level диагностикой и
     * связанными конфликтами (§12 DoD: разбираемо без прямого доступа к БД).
     * MVP-правило §8: items создаются только для проблемных кейсов, поэтому
     * для SUCCESS run массив будет пустой — это _не_ баг.
     */
    async getById(tenantId: string, runId: string) {
        const run = await this.prisma.syncRun.findFirst({
            where: { id: runId, tenantId },
            include: {
                items: { orderBy: { createdAt: 'asc' } },
                conflicts: { orderBy: { createdAt: 'desc' } },
                originRun: { select: { id: true, status: true, attemptNumber: true } },
            },
        });
        if (!run) throw new NotFoundException({ code: 'SYNC_RUN_NOT_FOUND' });

        return {
            ...this._serialize(run),
            originRun: run.originRun,
            items: run.items.map((it) => ({
                id: it.id,
                itemType: it.itemType,
                itemKey: it.itemKey,
                stage: it.stage,
                status: it.status,
                externalEventId: it.externalEventId,
                payload: it.payload,
                error: it.error,
                createdAt: it.createdAt,
            })),
            conflicts: run.conflicts.map((c) => ({
                id: c.id,
                entityType: c.entityType,
                entityId: c.entityId,
                conflictType: c.conflictType,
                payload: c.payload,
                resolvedAt: c.resolvedAt,
                createdAt: c.createdAt,
            })),
        };
    }

    // ─── private helpers ─────────────────────────────────────────────────────

    /**
     * Создаёт run сразу в status=BLOCKED со startedAt/finishedAt=now()
     * (lifecycle такого run terminал немедленно). Это материализует политическую
     * блокировку как полноценную запись в истории, а не как 403 без следа.
     */
    private async _createBlockedRun(
        tenantId: string,
        params: {
            accountId: string;
            syncTypes: SyncType[];
            triggerType: SyncTriggerType;
            requestedBy: string | null;
            jobKey: string;
            idempotencyKey: string | null;
            blockedReason: SyncBlockedReasonCode;
            eventName: string;
            originRunId?: string | null;
            extraEventPayload?: Record<string, unknown>;
        },
    ) {
        const now = new Date();
        try {
            const run = await this.prisma.syncRun.create({
                data: {
                    tenantId,
                    marketplaceAccountId: params.accountId,
                    triggerType: params.triggerType,
                    triggerScope: SyncTriggerScope.ACCOUNT,
                    syncTypes: params.syncTypes,
                    status: SyncRunStatus.BLOCKED,
                    jobKey: params.jobKey,
                    idempotencyKey: params.idempotencyKey,
                    requestedBy: params.requestedBy,
                    blockedReason: params.blockedReason,
                    originRunId: params.originRunId ?? null,
                    startedAt: now,
                    finishedAt: now,
                    durationMs: 0,
                },
            });
            this.logger.warn(this._eventLog(params.eventName, {
                tenantId,
                runId: run.id,
                accountId: params.accountId,
                blockedReason: params.blockedReason,
                ...(params.extraEventPayload ?? {}),
            }));
            return run;
        } catch (err: any) {
            // P2002 — race с idempotency. Возвращаем уже созданный run.
            if (err?.code === 'P2002') {
                const raced = await this.prisma.syncRun.findUnique({
                    where: { tenantId_jobKey: { tenantId, jobKey: params.jobKey } },
                });
                if (raced) return raced;
            }
            throw err;
        }
    }

    /**
     * Детерминированный jobKey для manual sync. Если клиент передал
     * `idempotencyKey`, используем его; иначе — UUID v4 (по сути,
     * "не-идемпотентный" запуск, каждый клик создаёт новый run).
     */
    private _buildManualJobKey(
        accountId: string,
        syncTypes: SyncType[],
        idempotencyKey: string | undefined,
    ): string {
        const sorted = [...syncTypes].sort().join(',');
        const suffix = idempotencyKey ?? randomUUID();
        return `manual:${accountId}:${sorted}:${suffix}`.slice(0, 128);
    }

    private _buildRetryJobKey(originRunId: string, attemptNumber: number): string {
        return `retry:${originRunId}:${attemptNumber}`.slice(0, 128);
    }

    /** Унифицированный JSON-формат для structured logs §19. */
    private _eventLog(event: string, data: Record<string, unknown>) {
        return JSON.stringify({ event, ...data, ts: new Date().toISOString() });
    }

    /**
     * Канонический payload для API. Намеренно НЕ возвращаем `idempotencyKey`
     * (внутренний инструмент) и `jobKey` (конструкция БД-уровня) — UI
     * оперирует `runId` и `originRunId`.
     */
    private _serialize(run: SyncRun) {
        return {
            id: run.id,
            tenantId: run.tenantId,
            accountId: run.marketplaceAccountId,
            triggerType: run.triggerType,
            triggerScope: run.triggerScope,
            syncTypes: run.syncTypes,
            status: run.status,
            originRunId: run.originRunId,
            requestedBy: run.requestedBy,
            blockedReason: run.blockedReason,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            durationMs: run.durationMs,
            processedCount: run.processedCount,
            errorCount: run.errorCount,
            errorCode: run.errorCode,
            errorMessage: run.errorMessage,
            attemptNumber: run.attemptNumber,
            maxAttempts: run.maxAttempts,
            nextAttemptAt: run.nextAttemptAt,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
        };
    }
}
