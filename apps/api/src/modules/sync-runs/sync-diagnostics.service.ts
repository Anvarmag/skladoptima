import {
    Injectable,
    Logger,
    BadRequestException,
    NotFoundException,
} from '@nestjs/common';
import {
    SyncRunStatus,
    SyncRunItemStatus,
    SyncRunItemType,
    SyncRunItemStage,
    Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SyncRunEventNames } from '../marketplace_sync/sync-run.events';

/**
 * Диагностический writer для sync run pipeline (TASK_SYNC_4).
 *
 * Используется будущим worker'ом (TASK_SYNC_5) и адаптерами для:
 * - регистрации проблемных item-level кейсов (FAILED / CONFLICT / BLOCKED);
 * - регистрации конфликтов синхронизации, которые требуют разбора support'ом;
 * - инкремента aggregated counters в `SyncRun` (`processedCount`/`errorCount`).
 *
 * Ключевые правила MVP §8:
 * - **Item-level записи создаются ТОЛЬКО для FAILED / CONFLICT / BLOCKED.**
 *   `recordItem()` отвергает `SUCCESS` и `SKIPPED` с явной ошибкой —
 *   success path хранится агрегатами в `SyncRun.processedCount`. Это
 *   §20 риск: «полная success item-level трасса раздувает storage и
 *   diagnostic noise быстрее реальной пользы».
 * - **`incrementProcessed()` / `incrementErrors()`** — для агрегатов;
 *   worker вызывает их в каждом stage без записи каждого успешного item.
 *
 * Контракт `externalEventId` (§14):
 * - стабильный id события маркетплейса (например, `posting_number` Ozon
 *   или `id` WB order). Hand off дальше в `InventoryEffectLock.sourceEventId`
 *   обеспечит, что повторная обработка не вызовет дублирующего бизнес-эффекта.
 * - Sync-слой только трассирует: если событие уже было обработано (видно
 *   по существующей `InventoryEffectLock` записи), worker пропускает его
 *   тихо без `recordItem()` (§14 явно: «повторная обработка одного и того
 *   же external event не должна создавать повторный бизнес-эффект»).
 */

const PROBLEM_ITEM_STATUSES: ReadonlySet<SyncRunItemStatus> = new Set([
    SyncRunItemStatus.FAILED,
    SyncRunItemStatus.CONFLICT,
    SyncRunItemStatus.BLOCKED,
]);

export interface RecordItemInput {
    runId: string;
    itemType: SyncRunItemType;
    itemKey: string;
    stage: SyncRunItemStage;
    status: SyncRunItemStatus;
    externalEventId?: string | null;
    payload?: Prisma.InputJsonValue;
    error?: Prisma.InputJsonValue;
}

export interface RecordConflictInput {
    runId: string;
    entityType: string;
    entityId?: string | null;
    conflictType: string;
    payload?: Prisma.InputJsonValue;
}

@Injectable()
export class SyncDiagnosticsService {
    private readonly logger = new Logger(SyncDiagnosticsService.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Записать проблемный item в диагностику. ОТВЕРГАЕТ SUCCESS/SKIPPED —
     * для них использовать `incrementProcessed()` / агрегаты.
     */
    async recordItem(input: RecordItemInput) {
        if (!PROBLEM_ITEM_STATUSES.has(input.status)) {
            throw new BadRequestException({
                code: 'SYNC_ITEM_NOT_RECORDABLE',
                reason: 'MVP §8: item-level записи только для FAILED/CONFLICT/BLOCKED',
                providedStatus: input.status,
            });
        }

        // Проверяем, что run действительно существует — иначе FK-ошибка
        // на стороне БД даст менее читаемый stack trace.
        const run = await this.prisma.syncRun.findUnique({
            where: { id: input.runId },
            select: { id: true, tenantId: true, status: true },
        });
        if (!run) {
            throw new NotFoundException({ code: 'SYNC_RUN_NOT_FOUND', runId: input.runId });
        }

        const item = await this.prisma.syncRunItem.create({
            data: {
                runId: input.runId,
                itemType: input.itemType,
                itemKey: input.itemKey.slice(0, 128),
                stage: input.stage,
                status: input.status,
                externalEventId: input.externalEventId ?? null,
                payload: input.payload as Prisma.InputJsonValue,
                error: input.error as Prisma.InputJsonValue,
            },
        });

        this.logger.warn(this._eventLog('sync_run_item_recorded', {
            tenantId: run.tenantId,
            runId: input.runId,
            itemId: item.id,
            itemType: input.itemType,
            stage: input.stage,
            status: input.status,
            externalEventId: input.externalEventId ?? null,
        }));

        return item;
    }

    /**
     * Зарегистрировать конфликт синхронизации (§9 сценарий 3). Run при
     * этом НЕ падает — продолжает обработку других items, но финальный
     * статус будет PARTIAL_SUCCESS вместо SUCCESS.
     *
     * Дополнительно эмитит `sync_run_conflict_detected` event.
     */
    async recordConflict(tenantId: string, input: RecordConflictInput) {
        // Проверяем ownership run'а — запись конфликта в чужой tenant запрещена.
        const run = await this.prisma.syncRun.findFirst({
            where: { id: input.runId, tenantId },
            select: { id: true },
        });
        if (!run) {
            throw new NotFoundException({ code: 'SYNC_RUN_NOT_FOUND', runId: input.runId });
        }

        const conflict = await this.prisma.syncConflict.create({
            data: {
                tenantId,
                runId: input.runId,
                entityType: input.entityType.slice(0, 64),
                entityId: input.entityId?.slice(0, 128) ?? null,
                conflictType: input.conflictType.slice(0, 64),
                payload: input.payload as Prisma.InputJsonValue,
            },
        });

        this.logger.warn(this._eventLog(SyncRunEventNames.CONFLICT_DETECTED, {
            tenantId,
            runId: input.runId,
            conflictId: conflict.id,
            entityType: input.entityType,
            entityId: input.entityId ?? null,
            conflictType: input.conflictType,
        }));

        return conflict;
    }

    /** Инкремент `processedCount` (для успешных items без записи). */
    async incrementProcessed(runId: string, by: number = 1) {
        if (by <= 0) return;
        await this.prisma.syncRun.update({
            where: { id: runId },
            data: { processedCount: { increment: by } },
        });
    }

    /** Инкремент `errorCount` (без записи в SyncRunItem — используется парно с recordItem). */
    async incrementErrors(runId: string, by: number = 1) {
        if (by <= 0) return;
        await this.prisma.syncRun.update({
            where: { id: runId },
            data: { errorCount: { increment: by } },
        });
    }

    /**
     * GET /sync/conflicts — paginated list. По умолчанию — только открытые
     * (`resolvedAt IS NULL`).
     */
    async listConflicts(
        tenantId: string,
        query: {
            status?: 'open' | 'resolved' | 'all';
            entityType?: string;
            runId?: string;
            page?: number;
            limit?: number;
        },
    ) {
        const page = query.page && query.page > 0 ? query.page : 1;
        const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 20;

        const where: Prisma.SyncConflictWhereInput = { tenantId };
        const status = query.status ?? 'open';
        if (status === 'open') where.resolvedAt = null;
        else if (status === 'resolved') where.resolvedAt = { not: null };
        if (query.entityType) where.entityType = query.entityType;
        if (query.runId) where.runId = query.runId;

        const [items, total] = await Promise.all([
            this.prisma.syncConflict.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
                select: {
                    id: true,
                    runId: true,
                    entityType: true,
                    entityId: true,
                    conflictType: true,
                    payload: true,
                    resolvedAt: true,
                    createdAt: true,
                    run: {
                        select: {
                            id: true,
                            marketplaceAccountId: true,
                            triggerType: true,
                            status: true,
                        },
                    },
                },
            }),
            this.prisma.syncConflict.count({ where }),
        ]);

        return {
            data: items,
            meta: {
                total,
                page,
                limit,
                lastPage: Math.max(1, Math.ceil(total / limit)),
            },
        };
    }

    async getConflictById(tenantId: string, id: string) {
        const conflict = await this.prisma.syncConflict.findFirst({
            where: { id, tenantId },
            include: {
                run: {
                    select: {
                        id: true,
                        marketplaceAccountId: true,
                        triggerType: true,
                        triggerScope: true,
                        status: true,
                        syncTypes: true,
                        attemptNumber: true,
                        maxAttempts: true,
                        createdAt: true,
                        finishedAt: true,
                    },
                },
            },
        });
        if (!conflict) {
            throw new NotFoundException({ code: 'SYNC_CONFLICT_NOT_FOUND' });
        }
        return conflict;
    }

    /**
     * POST /sync/conflicts/:id/resolve — закрыть конфликт. Идемпотентно:
     * повторный resolve уже закрытого конфликта возвращает текущее состояние.
     */
    async resolveConflict(tenantId: string, id: string, actorUserId: string | null) {
        const conflict = await this.prisma.syncConflict.findFirst({
            where: { id, tenantId },
            select: { id: true, resolvedAt: true, runId: true, conflictType: true },
        });
        if (!conflict) {
            throw new NotFoundException({ code: 'SYNC_CONFLICT_NOT_FOUND' });
        }
        if (conflict.resolvedAt) {
            return this.prisma.syncConflict.findUnique({ where: { id } });
        }

        const updated = await this.prisma.syncConflict.update({
            where: { id },
            data: { resolvedAt: new Date() },
        });

        this.logger.log(this._eventLog('sync_conflict_resolved', {
            tenantId,
            conflictId: id,
            runId: conflict.runId,
            conflictType: conflict.conflictType,
            actorUserId,
        }));

        return updated;
    }

    private _eventLog(event: string, data: Record<string, unknown>) {
        return JSON.stringify({ event, ...data, ts: new Date().toISOString() });
    }
}

/**
 * Реэкспорт enum-значений для удобства потребителей (worker, тесты).
 * `import { SyncItem } from '...'` короче, чем три отдельных enum'а.
 */
export const SyncItem = {
    Type: {
        STOCK: 'STOCK',
        ORDER: 'ORDER',
        PRODUCT: 'PRODUCT',
        WAREHOUSE: 'WAREHOUSE',
    },
    Stage: {
        PREFLIGHT: 'PREFLIGHT',
        PULL: 'PULL',
        TRANSFORM: 'TRANSFORM',
        APPLY: 'APPLY',
        PUSH: 'PUSH',
    },
    Status: {
        FAILED: 'FAILED',
        CONFLICT: 'CONFLICT',
        BLOCKED: 'BLOCKED',
    },
} as const;
