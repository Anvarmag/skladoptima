import {
    Injectable,
    Logger,
    NotFoundException,
    BadRequestException,
    ConflictException,
    ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';
import { InventoryEvents } from './inventory.events';
import {
    AccessState,
    StockMovementType,
    StockMovementSource,
    InventoryFulfillmentMode,
    InventoryEffectType,
    InventoryEffectStatus,
    MarketplaceType,
    Role,
    Prisma,
} from '@prisma/client';
import { AUDIT_EVENTS } from '../audit/audit-event-catalog';

const PAUSED_STATES: ReadonlySet<AccessState> = new Set([
    AccessState.TRIAL_EXPIRED,
    AccessState.SUSPENDED,
    AccessState.CLOSED,
]);

export type EffectiveAvailable = {
    productId: string;
    pushAllowed: boolean;
    pausedByTenantState: boolean;
    accessState: AccessState;
    totalAvailable: number;
    byWarehouse: Array<{
        warehouseId: string;
        fulfillmentMode: InventoryFulfillmentMode;
        onHand: number;
        reserved: number;
        available: number;
    }>;
    source: 'balance' | 'product_fallback';
};

/**
 * Контракт reserve/release/deduct/return от orders/sync. Один вызов = один
 * business event с стабильным `sourceEventId` (например, marketplace order_id);
 * `items[]` — список позиций заказа.
 */
export type InventoryEffectItem = {
    productId: string;
    warehouseId?: string;
    qty: number;
};

export type InventoryEffectResult = {
    sourceEventId: string;
    effectType: InventoryEffectType;
    status: 'APPLIED' | 'IGNORED';
    idempotent: boolean;
    movements: Array<{
        movementId: string;
        productId: string;
        warehouseId: string;
        delta: number;
        onHandAfter: number;
        reservedAfter: number;
    }>;
};

/**
 * Reconciliation snapshot из внешнего источника (marketplace push, sync job).
 * Используется для конфликт-детекции: сравниваем `externalAvailable` с локальным
 * `StockBalance.available` и фиксируем расхождение как `CONFLICT_DETECTED`
 * movement БЕЗ автоматической перезаписи остатка (политика §10/§13/§21
 * system-analytics — конфликт должен быть диагностируемым, а не silent overwrite).
 */
export type ReconcileSnapshot = {
    productId: string;
    warehouseId?: string;
    externalAvailable: number;
    externalEventAt?: Date;
};

export type ReconcileResult = {
    sourceEventId: string;
    status: 'NO_CONFLICT' | 'CONFLICT_LOGGED' | 'IGNORED_STALE' | 'IDEMPOTENT';
    idempotent: boolean;
    productId: string;
    warehouseId: string;
    localAvailable: number;
    externalAvailable: number;
    diff: number;
    movementId?: string;
    staleAgainstAt?: Date;
};

/**
 * Sentinel-идентификатор склада. В MVP справочник складов не реализован
 * (см. system-analytics §2 — внешний reference layer), поэтому baseline-
 * корректировки попадают в default-warehouse для FBS-контура. Когда появится
 * Warehouse-домен (TASK_INVENTORY_5+), это значение заменится FK-ссылкой.
 */
const DEFAULT_WAREHOUSE_ID = 'default';

/**
 * ───────────────────────────────────────────────────────────────────────────
 *  TENANT STATE & FBS/FBO BOUNDARY POLICY (TASK_INVENTORY_5)
 * ───────────────────────────────────────────────────────────────────────────
 *  Inventory side-effects привязаны к tenant `AccessState` (см. `02-tenant`):
 *    - `TRIAL_EXPIRED` / `SUSPENDED` / `CLOSED` — manual write-actions
 *       (`createAdjustment`, `updateThreshold`) запрещены и на HTTP-слое
 *       (`TenantWriteGuard`), и в сервисе (`_assertManualWriteAllowed`) —
 *       второе на случай прямых вызовов из orders/jobs;
 *    - в этих же состояниях order/sync-driven side-effects (`reserve/release/
 *       deduct/reconcile/logReturn`) НЕ применяются: возвращается результат со
 *       статусом `IGNORED` и `pausedByTenantState: true`, лок переводится в
 *       `IGNORED`, движение не пишется. Возврат tenant'а в активное состояние
 *       снимает паузу (новые события снова применяются), повторно прогонять
 *       устаревшие snapshots вручную не нужно.
 *
 *  FBS/FBO разграничение (см. system-analytics §14, §16):
 *    - Управляемый контур: `StockBalance.isExternal = false` (FBS). Только эти
 *       балансы участвуют в push в каналы и в защитах `RESERVED_EXCEEDS_ONHAND`.
 *    - Внешний контур: `isExternal = true` (FBO) — read-model для аналитики и
 *       не участвует в effective available.
 *    - Channel lock/override per marketplace в MVP НЕ поддерживается (зафикси-
 *       ровано в §22/§23 system-analytics — перенесено в future scope). Sync
 *       handoff использует единое `effective available qty` через
 *       `computeEffectiveAvailable`, любые попытки канал-специфичной логики
 *       обязаны проходить через явное расширение этого контракта.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * ───────────────────────────────────────────────────────────────────────────
 *  LOCKING POLICY (TASK_INVENTORY_4)
 * ───────────────────────────────────────────────────────────────────────────
 *  Reserve / release / deduct path использует **pessimistic locking**:
 *    `SELECT ... FOR UPDATE` на `StockBalance` row внутри
 *    `prisma.$transaction`. Выбор обоснован тем, что reserve-path работает с
 *    высокой конкуренцией (несколько marketplace events приходят одновременно
 *    через webhooks/poll), и optimistic retry увеличил бы хвостовую латентность
 *    под нагрузкой. Idempotency-замок (`InventoryEffectLock`) — отдельный
 *    UNIQUE-замок на `(tenantId, effectType, sourceEventId)`, гарантирующий
 *    ровно одно применение business-event'а. Любой сторонний модуль (orders,
 *    sync) ОБЯЗАН использовать стабильный `sourceEventId` — это контракт.
 *
 *  Reconciliation path (`reconcile`) НЕ берёт FOR UPDATE — операция read-only
 *    по семантике (не меняет остаток), пишет только `CONFLICT_DETECTED`
 *    movement. Optimistic чтение допустимо, потому что небольшое расхождение
 *    в момент сравнения нормально для diagnostics-цели.
 * ───────────────────────────────────────────────────────────────────────────
 */

@Injectable()
export class InventoryService {
    private readonly logger = new Logger(InventoryService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly auditService: AuditService,
    ) {}

    // ----------------------------------------------------------------
    // STOCKS — list / detail
    // ----------------------------------------------------------------

    async listStocks(
        tenantId: string,
        opts: { page?: number; limit?: number; search?: string } = {},
    ) {
        const page = opts.page && opts.page > 0 ? opts.page : 1;
        const limit = opts.limit && opts.limit > 0 ? opts.limit : 20;
        const skip = (page - 1) * limit;

        // Источник истины — продукт; balance подтягиваем агрегированно. Это позволяет
        // показать товары без созданного StockBalance (lazy-bridge с MVP `Product.total`).
        const where: Prisma.ProductWhereInput = {
            tenantId,
            deletedAt: null,
        };
        if (opts.search) {
            where.OR = [
                { name: { contains: opts.search, mode: 'insensitive' } },
                { sku: { contains: opts.search, mode: 'insensitive' } },
            ];
        }

        const [products, total] = await Promise.all([
            this.prisma.product.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    sku: true,
                    name: true,
                    photo: true,
                    total: true,
                    reserved: true,
                    stockBalances: true,
                },
            }),
            this.prisma.product.count({ where }),
        ]);

        const data = products.map((p) => this._composeProductView(p));

        return {
            data,
            meta: { total, page, lastPage: Math.ceil(total / limit) },
        };
    }

    async getStockDetail(tenantId: string, productId: string) {
        const product = await this.prisma.product.findFirst({
            where: { id: productId, tenantId },
            select: {
                id: true,
                sku: true,
                name: true,
                photo: true,
                total: true,
                reserved: true,
                stockBalances: true,
            },
        });
        if (!product) {
            throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND' });
        }

        return {
            product: { id: product.id, sku: product.sku, name: product.name, photo: product.photo },
            balances: this._composeBalances(product),
            aggregates: this._aggregate(product),
        };
    }

    // ----------------------------------------------------------------
    // ADJUSTMENT — атомарная manual-корректировка с movement-записью
    // ----------------------------------------------------------------

    async createAdjustment(
        tenantId: string,
        actorEmail: string,
        userId: string | null,
        dto: CreateAdjustmentDto,
    ) {
        if ((dto.delta === undefined || dto.delta === null) && (dto.targetQuantity === undefined || dto.targetQuantity === null)) {
            throw new BadRequestException({
                code: 'ADJUSTMENT_MODE_REQUIRED',
                message: 'Either delta or targetQuantity must be provided',
            });
        }
        if (dto.delta !== undefined && dto.delta !== null && dto.targetQuantity !== undefined && dto.targetQuantity !== null) {
            throw new BadRequestException({
                code: 'ADJUSTMENT_MODE_AMBIGUOUS',
                message: 'Provide either delta or targetQuantity, not both',
            });
        }
        if (dto.delta === 0) {
            throw new BadRequestException({ code: 'ADJUSTMENT_DELTA_ZERO', message: 'delta must not be zero' });
        }

        await this._assertManualWriteAllowed(tenantId);

        const warehouseId = dto.warehouseId ?? DEFAULT_WAREHOUSE_ID;

        // Idempotency check вне транзакции — экономит локи на дубликате.
        if (dto.idempotencyKey) {
            const existing = await this.prisma.stockMovement.findFirst({
                where: { tenantId, idempotencyKey: dto.idempotencyKey },
            });
            if (existing) {
                this.logger.log(JSON.stringify({
                    event: InventoryEvents.ADJUSTMENT_IDEMPOTENT_REPLAY,
                    tenantId,
                    idempotencyKey: dto.idempotencyKey,
                    movementId: existing.id,
                }));
                return this._loadAdjustmentResult(existing.id);
            }
        }

        // Транзакция: lock balance row → recalc → write movement → update Product.total bridge.
        const result = await this.prisma.$transaction(async (tx) => {
            const product = await tx.product.findFirst({
                where: { id: dto.productId, tenantId, deletedAt: null },
                select: { id: true, sku: true, total: true, reserved: true },
            });
            if (!product) {
                throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND' });
            }

            // SELECT ... FOR UPDATE на StockBalance row для serialization.
            // Если ряд ещё не существует, создаём его с baseline из Product.total
            // (lazy-bridge с MVP моделью, где остатки лежали в продукте).
            const balanceId = await this._ensureBalanceLocked(tx, tenantId, product.id, warehouseId, product.total);
            const lockedRows = await tx.$queryRaw<Array<{
                id: string;
                onHand: number;
                reserved: number;
                isExternal: boolean;
            }>>(
                Prisma.sql`SELECT "id", "onHand", "reserved", "isExternal" FROM "StockBalance" WHERE "id" = ${balanceId} FOR UPDATE`,
            );
            const balance = lockedRows[0];
            if (!balance) {
                throw new NotFoundException({ code: 'STOCK_BALANCE_NOT_FOUND' });
            }

            const onHandBefore = balance.onHand;
            const reservedBefore = balance.reserved;
            const delta =
                dto.delta !== undefined && dto.delta !== null
                    ? dto.delta
                    : (dto.targetQuantity as number) - onHandBefore;

            if (delta === 0) {
                throw new BadRequestException({ code: 'ADJUSTMENT_NOOP', message: 'targetQuantity equals current onHand' });
            }

            const onHandAfter = onHandBefore + delta;
            if (onHandAfter < 0) {
                throw new BadRequestException({
                    code: 'NEGATIVE_STOCK_NOT_ALLOWED',
                    message: 'on_hand cannot become negative',
                    onHandBefore,
                    delta,
                });
            }
            if (!balance.isExternal && reservedBefore > onHandAfter) {
                throw new ConflictException({
                    code: 'RESERVED_EXCEEDS_ONHAND',
                    message: 'Adjustment would leave reserved greater than onHand for managed warehouse',
                    onHandAfter,
                    reserved: reservedBefore,
                });
            }

            await tx.stockBalance.update({
                where: { id: balance.id },
                data: { onHand: onHandAfter },
            });

            const movement = await tx.stockMovement.create({
                data: {
                    tenantId,
                    productId: product.id,
                    warehouseId,
                    movementType: delta > 0 ? StockMovementType.MANUAL_ADD : StockMovementType.MANUAL_REMOVE,
                    delta,
                    onHandBefore,
                    onHandAfter,
                    reservedBefore,
                    reservedAfter: reservedBefore,
                    reasonCode: dto.reasonCode,
                    comment: dto.comment ?? null,
                    source: StockMovementSource.USER,
                    idempotencyKey: dto.idempotencyKey ?? null,
                    actorUserId: userId,
                },
            });

            // Bridge с legacy MVP: пока остатки потребляются через Product.total (UI/sync),
            // держим его согласованным. Полная отвязка — TASK_INVENTORY_5.
            await tx.product.update({
                where: { id: product.id },
                data: { total: onHandAfter },
            });

            return { movement, productSku: product.sku, onHandBefore, onHandAfter, reservedBefore };
        });

        await this.auditService.writeEvent({
            tenantId,
            eventType: AUDIT_EVENTS.STOCK_MANUALLY_ADJUSTED,
            entityType: 'PRODUCT',
            entityId: dto.productId,
            actorType: 'user',
            actorId: userId ?? undefined,
            source: 'ui',
            before: { onHand: result.onHandBefore },
            after:  { onHand: result.onHandAfter },
            changedFields: ['onHand'],
            metadata: {
                sku: result.productSku,
                delta: result.movement.delta,
                movementId: result.movement.id,
                reasonCode: dto.reasonCode,
                comment: dto.comment ?? null,
                warehouseId,
            },
        });

        this.logger.log(JSON.stringify({
            event: InventoryEvents.ADJUSTMENT_APPLIED,
            tenantId,
            productId: dto.productId,
            warehouseId,
            movementId: result.movement.id,
            delta: result.movement.delta,
            onHandBefore: result.onHandBefore,
            onHandAfter: result.onHandAfter,
            reasonCode: dto.reasonCode,
            actorUserId: userId,
        }));

        return {
            movementId: result.movement.id,
            onHandBefore: result.onHandBefore,
            onHandAfter: result.onHandAfter,
            reservedBefore: result.reservedBefore,
            reservedAfter: result.reservedBefore,
            availableAfter: Math.max(0, result.onHandAfter - result.reservedBefore),
            reasonCode: dto.reasonCode,
        };
    }

    // ----------------------------------------------------------------
    // MOVEMENTS — append-only history
    // ----------------------------------------------------------------

    async listMovements(
        tenantId: string,
        opts: {
            page?: number;
            limit?: number;
            productId?: string;
            movementType?: StockMovementType;
            from?: Date;
            to?: Date;
        } = {},
    ) {
        const page = opts.page && opts.page > 0 ? opts.page : 1;
        const limit = opts.limit && opts.limit > 0 ? opts.limit : 50;
        const skip = (page - 1) * limit;

        const where: Prisma.StockMovementWhereInput = { tenantId };
        if (opts.productId) where.productId = opts.productId;
        if (opts.movementType) where.movementType = opts.movementType;
        if (opts.from || opts.to) {
            where.createdAt = {};
            if (opts.from) (where.createdAt as Prisma.DateTimeFilter).gte = opts.from;
            if (opts.to) (where.createdAt as Prisma.DateTimeFilter).lte = opts.to;
        }

        const [movements, total] = await Promise.all([
            this.prisma.stockMovement.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    product: { select: { id: true, sku: true, name: true } },
                    actorUser: { select: { id: true, email: true } },
                },
            }),
            this.prisma.stockMovement.count({ where }),
        ]);

        return {
            data: movements,
            meta: { total, page, lastPage: Math.ceil(total / limit) },
        };
    }

    // ----------------------------------------------------------------
    // LOW STOCK — items below threshold
    // ----------------------------------------------------------------

    async listLowStock(tenantId: string, override?: number) {
        const settings = await this._getSettings(tenantId);
        const threshold = override !== undefined ? override : settings.lowStockThreshold;

        // Источник истины — StockBalance (`available` STORED GENERATED).
        // Для товаров без записанного баланса даём фоллбек на `Product.total - reserved`.
        const balances = await this.prisma.stockBalance.findMany({
            where: {
                tenantId,
                available: { lte: threshold },
                isExternal: false,
            },
            include: {
                product: { select: { id: true, sku: true, name: true, deletedAt: true } },
            },
            orderBy: { available: 'asc' },
            take: 200,
        });

        const fromBalances = balances
            .filter((b) => b.product && !b.product.deletedAt)
            .map((b) => ({
                productId: b.productId,
                sku: b.product!.sku,
                name: b.product!.name,
                warehouseId: b.warehouseId,
                onHand: b.onHand,
                reserved: b.reserved,
                available: b.available,
                source: 'balance' as const,
            }));

        // Bridge: товары без StockBalance — берём оценку из Product.total/reserved.
        const productsWithBalanceIds = new Set(balances.map((b) => b.productId));
        const fallback = await this.prisma.product.findMany({
            where: {
                tenantId,
                deletedAt: null,
                id: { notIn: Array.from(productsWithBalanceIds) },
            },
            select: { id: true, sku: true, name: true, total: true, reserved: true },
        });

        const fromFallback = fallback
            .filter((p) => Math.max(0, p.total - p.reserved) <= threshold)
            .map((p) => ({
                productId: p.id,
                sku: p.sku,
                name: p.name,
                warehouseId: DEFAULT_WAREHOUSE_ID,
                onHand: p.total,
                reserved: p.reserved,
                available: Math.max(0, p.total - p.reserved),
                source: 'product_fallback' as const,
            }));

        const items = [...fromBalances, ...fromFallback].sort((a, b) => a.available - b.available);

        return {
            threshold,
            count: items.length,
            items,
        };
    }

    // ----------------------------------------------------------------
    // SETTINGS — low-stock threshold
    // ----------------------------------------------------------------

    async getSettings(tenantId: string) {
        return this._getSettings(tenantId);
    }

    async updateThreshold(tenantId: string, lowStockThreshold: number, actorEmail: string) {
        if (lowStockThreshold < 0) {
            throw new BadRequestException({ code: 'THRESHOLD_NEGATIVE', message: 'lowStockThreshold must be >= 0' });
        }
        await this._assertManualWriteAllowed(tenantId);
        const updated = await this.prisma.inventorySettings.upsert({
            where: { tenantId },
            update: { lowStockThreshold },
            create: { tenantId, lowStockThreshold },
        });

        this.logger.log(JSON.stringify({
            event: InventoryEvents.THRESHOLD_UPDATED,
            tenantId,
            lowStockThreshold,
            actorEmail,
        }));

        return updated;
    }

    // ----------------------------------------------------------------
    // CHANNEL VISIBILITY SETTINGS
    // ----------------------------------------------------------------

    private _parseVisibility(settings: { channelVisibilitySettings: unknown } | null): MarketplaceType[] {
        const raw = settings?.channelVisibilitySettings as { visibleMarketplaces?: string[] } | null;
        if (!raw || !Array.isArray(raw.visibleMarketplaces) || raw.visibleMarketplaces.length === 0) {
            return Object.values(MarketplaceType);
        }
        return raw.visibleMarketplaces as MarketplaceType[];
    }

    async getChannelVisibility(tenantId: string) {
        const settings = await this._getSettings(tenantId);
        return { visibleMarketplaces: this._parseVisibility(settings) };
    }

    async updateChannelVisibility(tenantId: string, actorUserId: string, visibleMarketplaces: MarketplaceType[]) {
        await this._assertManualWriteAllowed(tenantId);

        const membership = await this.prisma.membership.findFirst({
            where: { tenantId, userId: actorUserId, status: 'ACTIVE' },
            select: { role: true },
        });
        if (!membership) {
            throw new ForbiddenException({ code: 'TENANT_ACCESS_DENIED' });
        }
        if (membership.role !== Role.OWNER && membership.role !== Role.ADMIN) {
            throw new ForbiddenException({ code: 'ROLE_FORBIDDEN' });
        }

        if (!visibleMarketplaces.length) {
            throw new BadRequestException({ code: 'VISIBLE_MARKETPLACES_CANNOT_BE_EMPTY' });
        }

        await this.prisma.inventorySettings.upsert({
            where: { tenantId },
            update: { channelVisibilitySettings: { visibleMarketplaces } },
            create: { tenantId, channelVisibilitySettings: { visibleMarketplaces } },
        });

        this.logger.log(JSON.stringify({
            event: 'channel_visibility_updated',
            tenantId,
            actorUserId,
            visibleMarketplaces,
        }));

        return { visibleMarketplaces };
    }

    // ----------------------------------------------------------------
    // ORDER SIDE-EFFECTS — reserve / release / deduct / return
    // ----------------------------------------------------------------

    /**
     * Reserve: блокирует qty под заказ. `reserved += qty`, `available -= qty`
     * (через GENERATED колонку в БД). Не уходит в отрицательный available для
     * управляемого FBS-контура.
     */
    async reserve(tenantId: string, sourceEventId: string, items: InventoryEffectItem[]) {
        return this._applyOrderEffect({
            tenantId,
            sourceEventId,
            effectType: InventoryEffectType.ORDER_RESERVE,
            movementType: StockMovementType.ORDER_RESERVED,
            items,
        });
    }

    /**
     * Release: отмена резерва (cancel заказа до отгрузки). `reserved -= qty`.
     */
    async release(tenantId: string, sourceEventId: string, items: InventoryEffectItem[]) {
        return this._applyOrderEffect({
            tenantId,
            sourceEventId,
            effectType: InventoryEffectType.ORDER_RELEASE,
            movementType: StockMovementType.ORDER_RELEASED,
            items,
        });
    }

    /**
     * Deduct: финальное списание со склада (заказ выполнен). Снимает резерв и
     * `onHand` одновременно: `reserved -= qty`, `onHand -= qty`. Если резерва
     * нет (immediate-deduct flow) — снимает только onHand.
     */
    async deduct(tenantId: string, sourceEventId: string, items: InventoryEffectItem[]) {
        return this._applyOrderEffect({
            tenantId,
            sourceEventId,
            effectType: InventoryEffectType.ORDER_DEDUCT,
            movementType: StockMovementType.ORDER_DEDUCTED,
            items,
        });
    }

    /**
     * Return: фиксирует возврат как audit-событие. По MVP-policy §10 и §17
     * автоматический +qty в `onHand` НЕ делается — пользователь решает
     * восстановить остаток вручную через manual adjustment, когда товар
     * физически вернулся на склад.
     */
    async logReturn(
        tenantId: string,
        sourceEventId: string,
        items: InventoryEffectItem[],
        reasonCode?: string,
    ): Promise<InventoryEffectResult> {
        const paused = await this._isTenantPaused(tenantId);
        if (paused.paused) {
            await this._markLockIgnoredForPause(
                tenantId,
                InventoryEffectType.SYNC_RECONCILE,
                sourceEventId,
            );
            this.logger.warn(JSON.stringify({
                event: InventoryEvents.RETURN_PAUSED_BY_TENANT,
                tenantId,
                sourceEventId,
                accessState: paused.accessState,
            }));
            return {
                sourceEventId,
                effectType: InventoryEffectType.SYNC_RECONCILE,
                status: 'IGNORED',
                idempotent: false,
                movements: [],
            };
        }

        const idempotency = await this._checkLock(
            tenantId,
            InventoryEffectType.SYNC_RECONCILE,
            sourceEventId,
        );
        if (idempotency.idempotent) {
            return {
                sourceEventId,
                effectType: InventoryEffectType.SYNC_RECONCILE,
                status: 'IGNORED',
                idempotent: true,
                movements: [],
            };
        }

        const movements = await this.prisma.$transaction(async (tx) => {
            await this._upsertLockProcessing(
                tx,
                tenantId,
                InventoryEffectType.SYNC_RECONCILE,
                sourceEventId,
            );

            const out: InventoryEffectResult['movements'] = [];
            for (const item of items) {
                this._validateItem(item);
                const warehouseId = item.warehouseId ?? DEFAULT_WAREHOUSE_ID;
                const balance = await this._lockOrCreateBalance(
                    tx,
                    tenantId,
                    item.productId,
                    warehouseId,
                );

                const movement = await tx.stockMovement.create({
                    data: {
                        tenantId,
                        productId: item.productId,
                        warehouseId,
                        movementType: StockMovementType.RETURN_LOGGED,
                        delta: 0,
                        onHandBefore: balance.onHand,
                        onHandAfter: balance.onHand,
                        reservedBefore: balance.reserved,
                        reservedAfter: balance.reserved,
                        reasonCode: reasonCode ?? 'RETURN',
                        comment: `return logged for sourceEvent=${sourceEventId}, qty=${item.qty}`,
                        source: StockMovementSource.MARKETPLACE,
                        sourceEventId,
                        actorUserId: null,
                    },
                });

                out.push({
                    movementId: movement.id,
                    productId: item.productId,
                    warehouseId,
                    delta: 0,
                    onHandAfter: balance.onHand,
                    reservedAfter: balance.reserved,
                });
            }

            await tx.inventoryEffectLock.update({
                where: {
                    tenantId_effectType_sourceEventId: {
                        tenantId,
                        effectType: InventoryEffectType.SYNC_RECONCILE,
                        sourceEventId,
                    },
                },
                data: { status: InventoryEffectStatus.APPLIED },
            });
            return out;
        });

        this.logger.log(JSON.stringify({
            event: InventoryEvents.RETURN_LOGGED,
            tenantId,
            sourceEventId,
            items: items.length,
        }));

        return {
            sourceEventId,
            effectType: InventoryEffectType.SYNC_RECONCILE,
            status: 'APPLIED',
            idempotent: false,
            movements,
        };
    }

    // ----------------------------------------------------------------
    // RECONCILIATION — sync-driven conflict detection (§13, §21)
    // ----------------------------------------------------------------

    /**
     * Сравнивает внешний snapshot с локальным `available` и фиксирует расхождение
     * как `CONFLICT_DETECTED` movement. НЕ меняет балансы — пользователь решает,
     * выровнять ли вручную через manual adjustment.
     *
     * Stale-event policy: если у нас уже есть marketplace movement для того же
     * (productId, warehouseId) с `createdAt > externalEventAt`, событие считается
     * устаревшим — lock переводится в `IGNORED`, conflict не пишется.
     *
     * Идемпотентность: `(tenantId, effectType=SYNC_RECONCILE, sourceEventId)`
     * гарантирует, что один и тот же sync-event не создаст двух CONFLICT_DETECTED
     * записей.
     */
    async reconcile(
        tenantId: string,
        sourceEventId: string,
        snapshot: ReconcileSnapshot,
        opts: { reasonCode?: string } = {},
    ): Promise<ReconcileResult> {
        if (!sourceEventId || sourceEventId.length > 128) {
            throw new BadRequestException({ code: 'SOURCE_EVENT_ID_REQUIRED' });
        }
        if (!snapshot || typeof snapshot.productId !== 'string' || !snapshot.productId) {
            throw new BadRequestException({ code: 'SNAPSHOT_PRODUCT_ID_REQUIRED' });
        }
        if (!Number.isInteger(snapshot.externalAvailable) || snapshot.externalAvailable < 0) {
            throw new BadRequestException({
                code: 'EXTERNAL_AVAILABLE_INVALID',
                message: 'externalAvailable must be a non-negative integer',
            });
        }

        const warehouseId = snapshot.warehouseId ?? DEFAULT_WAREHOUSE_ID;
        const effectType = InventoryEffectType.SYNC_RECONCILE;

        // Tenant pause: reconcile из внешнего канала тоже не должен прокатываться.
        const paused = await this._isTenantPaused(tenantId);
        if (paused.paused) {
            await this._markLockIgnoredForPause(tenantId, effectType, sourceEventId);
            this.logger.warn(JSON.stringify({
                event: InventoryEvents.RECONCILE_PAUSED_BY_TENANT,
                tenantId,
                sourceEventId,
                productId: snapshot.productId,
                accessState: paused.accessState,
            }));
            const local = await this._readLocalAvailable(tenantId, snapshot.productId, warehouseId);
            return {
                sourceEventId,
                status: 'IGNORED_STALE',
                idempotent: false,
                productId: snapshot.productId,
                warehouseId,
                localAvailable: local,
                externalAvailable: snapshot.externalAvailable,
                diff: snapshot.externalAvailable - local,
            };
        }

        // Pre-check idempotency.
        const lockCheck = await this._checkLock(tenantId, effectType, sourceEventId);
        if (lockCheck.idempotent) {
            const existing = await this.prisma.stockMovement.findFirst({
                where: {
                    tenantId,
                    sourceEventId,
                    movementType: StockMovementType.CONFLICT_DETECTED,
                },
                orderBy: { createdAt: 'desc' },
            });
            const local = await this._readLocalAvailable(tenantId, snapshot.productId, warehouseId);
            return {
                sourceEventId,
                status: 'IDEMPOTENT',
                idempotent: true,
                productId: snapshot.productId,
                warehouseId,
                localAvailable: local,
                externalAvailable: snapshot.externalAvailable,
                diff: snapshot.externalAvailable - local,
                movementId: existing?.id,
            };
        }

        // Stale-event detection — последний marketplace movement позднее externalEventAt.
        if (snapshot.externalEventAt) {
            const latest = await this.prisma.stockMovement.findFirst({
                where: {
                    tenantId,
                    productId: snapshot.productId,
                    warehouseId,
                    source: StockMovementSource.MARKETPLACE,
                },
                orderBy: { createdAt: 'desc' },
                select: { createdAt: true },
            });
            if (latest && latest.createdAt > snapshot.externalEventAt) {
                // Замок ставим в IGNORED, чтобы повтор того же события не выполнял лишнюю работу.
                await this.prisma.inventoryEffectLock.upsert({
                    where: {
                        tenantId_effectType_sourceEventId: { tenantId, effectType, sourceEventId },
                    },
                    create: {
                        tenantId,
                        effectType,
                        sourceEventId,
                        status: InventoryEffectStatus.IGNORED,
                    },
                    update: { status: InventoryEffectStatus.IGNORED },
                });

                this.logger.warn(JSON.stringify({
                    event: InventoryEvents.RECONCILE_STALE_EVENT_IGNORED,
                    tenantId,
                    sourceEventId,
                    productId: snapshot.productId,
                    warehouseId,
                    externalEventAt: snapshot.externalEventAt.toISOString(),
                    latestLocalAt: latest.createdAt.toISOString(),
                }));

                const local = await this._readLocalAvailable(tenantId, snapshot.productId, warehouseId);
                return {
                    sourceEventId,
                    status: 'IGNORED_STALE',
                    idempotent: false,
                    productId: snapshot.productId,
                    warehouseId,
                    localAvailable: local,
                    externalAvailable: snapshot.externalAvailable,
                    diff: snapshot.externalAvailable - local,
                    staleAgainstAt: latest.createdAt,
                };
            }
        }

        // Применяем (write lock + сравнение + при расхождении — CONFLICT_DETECTED).
        const result = await this.prisma.$transaction(async (tx) => {
            await this._upsertLockProcessing(tx, tenantId, effectType, sourceEventId);

            const product = await tx.product.findFirst({
                where: { id: snapshot.productId, tenantId },
                select: { id: true, total: true, reserved: true },
            });
            if (!product) {
                throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', productId: snapshot.productId });
            }

            const balance = await tx.stockBalance.findUnique({
                where: {
                    tenantId_productId_warehouseId: {
                        tenantId,
                        productId: snapshot.productId,
                        warehouseId,
                    },
                },
            });
            const localAvailable = balance
                ? balance.available
                : Math.max(0, product.total - product.reserved);
            const onHand = balance ? balance.onHand : product.total;
            const reserved = balance ? balance.reserved : product.reserved;
            const diff = snapshot.externalAvailable - localAvailable;

            let movementId: string | undefined;
            if (diff !== 0) {
                const movement = await tx.stockMovement.create({
                    data: {
                        tenantId,
                        productId: snapshot.productId,
                        warehouseId,
                        movementType: StockMovementType.CONFLICT_DETECTED,
                        // delta = расхождение (positive = внешний больше нашего, negative = меньше).
                        // Остаток НЕ меняется — поэтому before == after.
                        delta: diff,
                        onHandBefore: onHand,
                        onHandAfter: onHand,
                        reservedBefore: reserved,
                        reservedAfter: reserved,
                        reasonCode: opts.reasonCode ?? 'RECONCILE_DIFF',
                        comment: `external=${snapshot.externalAvailable}, local=${localAvailable}, diff=${diff}`,
                        source: StockMovementSource.MARKETPLACE,
                        sourceEventId,
                        actorUserId: null,
                    },
                });
                movementId = movement.id;
            }

            await tx.inventoryEffectLock.update({
                where: {
                    tenantId_effectType_sourceEventId: { tenantId, effectType, sourceEventId },
                },
                data: { status: InventoryEffectStatus.APPLIED },
            });

            return { localAvailable, diff, movementId };
        });

        if (result.diff !== 0) {
            this.logger.warn(JSON.stringify({
                event: InventoryEvents.RECONCILE_CONFLICT_DETECTED,
                tenantId,
                sourceEventId,
                productId: snapshot.productId,
                warehouseId,
                localAvailable: result.localAvailable,
                externalAvailable: snapshot.externalAvailable,
                diff: result.diff,
                movementId: result.movementId,
            }));
        }

        return {
            sourceEventId,
            status: result.diff === 0 ? 'NO_CONFLICT' : 'CONFLICT_LOGGED',
            idempotent: false,
            productId: snapshot.productId,
            warehouseId,
            localAvailable: result.localAvailable,
            externalAvailable: snapshot.externalAvailable,
            diff: result.diff,
            movementId: result.movementId,
        };
    }

    // ----------------------------------------------------------------
    // DIAGNOSTICS — observability over locks/conflicts/replays
    // ----------------------------------------------------------------

    async listEffectLocks(
        tenantId: string,
        opts: {
            status?: InventoryEffectStatus;
            effectType?: InventoryEffectType;
            page?: number;
            limit?: number;
        } = {},
    ) {
        const page = opts.page && opts.page > 0 ? opts.page : 1;
        const limit = opts.limit && opts.limit > 0 ? opts.limit : 50;
        const skip = (page - 1) * limit;

        const where: Prisma.InventoryEffectLockWhereInput = { tenantId };
        if (opts.status) where.status = opts.status;
        if (opts.effectType) where.effectType = opts.effectType;

        const [data, total] = await Promise.all([
            this.prisma.inventoryEffectLock.findMany({
                where,
                skip,
                take: limit,
                orderBy: { updatedAt: 'desc' },
            }),
            this.prisma.inventoryEffectLock.count({ where }),
        ]);

        return { data, meta: { total, page, lastPage: Math.ceil(total / limit) } };
    }

    /**
     * Сводный отчёт для observability: счётчики идемпотентных replay'ев,
     * processing/failed locks, conflicts за последние 24 часа, reserve/release
     * mismatch (release > reserved случаи попадают в FAILED locks).
     */
    async getDiagnostics(tenantId: string) {
        const now = new Date();
        const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const [
            processingLocks,
            failedLocks,
            appliedLocks,
            ignoredLocks,
            conflictsLast24h,
            reserveReleaseMismatchLast24h,
            negativeStockBlockedLast24h,
        ] = await Promise.all([
            this.prisma.inventoryEffectLock.count({
                where: { tenantId, status: InventoryEffectStatus.PROCESSING },
            }),
            this.prisma.inventoryEffectLock.count({
                where: { tenantId, status: InventoryEffectStatus.FAILED },
            }),
            this.prisma.inventoryEffectLock.count({
                where: { tenantId, status: InventoryEffectStatus.APPLIED },
            }),
            this.prisma.inventoryEffectLock.count({
                where: { tenantId, status: InventoryEffectStatus.IGNORED },
            }),
            this.prisma.stockMovement.count({
                where: {
                    tenantId,
                    movementType: StockMovementType.CONFLICT_DETECTED,
                    createdAt: { gte: dayAgo },
                },
            }),
            // reserve/release/negative_stock failures фиксируются как FAILED locks.
            // Точный счётчик — это failed locks за 24h независимо от effectType.
            this.prisma.inventoryEffectLock.count({
                where: {
                    tenantId,
                    status: InventoryEffectStatus.FAILED,
                    updatedAt: { gte: dayAgo },
                    effectType: { in: [InventoryEffectType.ORDER_RELEASE, InventoryEffectType.ORDER_RESERVE] },
                },
            }),
            this.prisma.inventoryEffectLock.count({
                where: {
                    tenantId,
                    status: InventoryEffectStatus.FAILED,
                    updatedAt: { gte: dayAgo },
                    effectType: InventoryEffectType.ORDER_DEDUCT,
                },
            }),
        ]);

        return {
            generatedAt: now.toISOString(),
            window: '24h',
            locks: {
                processing: processingLocks,
                applied: appliedLocks,
                ignored: ignoredLocks,
                failed: failedLocks,
            },
            conflictsLast24h,
            reserveReleaseFailedLast24h: reserveReleaseMismatchLast24h,
            deductFailedLast24h: negativeStockBlockedLast24h,
        };
    }

    // ----------------------------------------------------------------
    // SYNC HANDOFF — effective available qty contract (§15)
    // ----------------------------------------------------------------

    /**
     * Единственный legitimate источник `available` для push в каналы. Суммирует
     * только управляемый FBS-контур (`isExternal=false`); FBO-балансы исключены
     * по policy §14. Для tenants без StockBalance возвращается фоллбек на
     * `Product.total - Product.reserved` (lazy-bridge с MVP).
     *
     * `pushAllowed` = false при tenant pause (TRIAL_EXPIRED/SUSPENDED/CLOSED) —
     * sync должен пропустить любой push на маркетплейс. По §16 интеграции
     * приостановлены, и effective available не должен утекать в каналы.
     */
    async computeEffectiveAvailable(
        tenantId: string,
        productId: string,
    ): Promise<EffectiveAvailable> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { accessState: true },
        });
        if (!tenant) {
            throw new NotFoundException({ code: 'TENANT_NOT_FOUND' });
        }
        const paused = PAUSED_STATES.has(tenant.accessState);

        const product = await this.prisma.product.findFirst({
            where: { id: productId, tenantId, deletedAt: null },
            select: {
                id: true,
                total: true,
                reserved: true,
                stockBalances: {
                    where: { isExternal: false },
                    select: {
                        warehouseId: true,
                        fulfillmentMode: true,
                        onHand: true,
                        reserved: true,
                        available: true,
                    },
                },
            },
        });
        if (!product) {
            throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND' });
        }

        if (product.stockBalances.length > 0) {
            const totalAvailable = product.stockBalances.reduce(
                (sum, b) => sum + Math.max(0, b.available),
                0,
            );
            return {
                productId: product.id,
                pushAllowed: !paused,
                pausedByTenantState: paused,
                accessState: tenant.accessState,
                totalAvailable,
                byWarehouse: product.stockBalances.map((b) => ({
                    warehouseId: b.warehouseId,
                    fulfillmentMode: b.fulfillmentMode,
                    onHand: b.onHand,
                    reserved: b.reserved,
                    available: Math.max(0, b.available),
                })),
                source: 'balance',
            };
        }

        // Lazy-bridge на MVP: пока StockBalance не создан, считаем по Product.total/reserved.
        const fallback = Math.max(0, product.total - product.reserved);
        return {
            productId: product.id,
            pushAllowed: !paused,
            pausedByTenantState: paused,
            accessState: tenant.accessState,
            totalAvailable: fallback,
            byWarehouse: [{
                warehouseId: DEFAULT_WAREHOUSE_ID,
                fulfillmentMode: InventoryFulfillmentMode.FBS,
                onHand: product.total,
                reserved: product.reserved,
                available: fallback,
            }],
            source: 'product_fallback',
        };
    }

    // ----------------------------------------------------------------
    // TENANT-STATE PAUSE HELPERS (§16)
    // ----------------------------------------------------------------

    private async _isTenantPaused(tenantId: string): Promise<{ paused: boolean; accessState: AccessState }> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { accessState: true },
        });
        if (!tenant) {
            // Нет tenant'а — это must-fix, throw NotFound вместо silent ignore.
            throw new NotFoundException({ code: 'TENANT_NOT_FOUND' });
        }
        return { paused: PAUSED_STATES.has(tenant.accessState), accessState: tenant.accessState };
    }

    private async _assertManualWriteAllowed(tenantId: string): Promise<void> {
        const { paused, accessState } = await this._isTenantPaused(tenantId);
        if (paused) {
            this.logger.warn(JSON.stringify({
                event: InventoryEvents.MANUAL_WRITE_BLOCKED_BY_TENANT,
                tenantId,
                accessState,
            }));
            throw new ForbiddenException({
                code: 'INVENTORY_WRITE_BLOCKED_BY_TENANT_STATE',
                accessState,
            });
        }
    }

    private async _markLockIgnoredForPause(
        tenantId: string,
        effectType: InventoryEffectType,
        sourceEventId: string,
    ): Promise<void> {
        await this.prisma.inventoryEffectLock.upsert({
            where: {
                tenantId_effectType_sourceEventId: { tenantId, effectType, sourceEventId },
            },
            create: {
                tenantId,
                effectType,
                sourceEventId,
                status: InventoryEffectStatus.IGNORED,
            },
            update: { status: InventoryEffectStatus.IGNORED },
        });
    }

    private async _readLocalAvailable(
        tenantId: string,
        productId: string,
        warehouseId: string,
    ): Promise<number> {
        const balance = await this.prisma.stockBalance.findUnique({
            where: { tenantId_productId_warehouseId: { tenantId, productId, warehouseId } },
        });
        if (balance) return balance.available;
        // Fallback на legacy Product.total/reserved для tenants без StockBalance.
        const product = await this.prisma.product.findFirst({
            where: { id: productId, tenantId },
            select: { total: true, reserved: true },
        });
        if (!product) return 0;
        return Math.max(0, product.total - product.reserved);
    }

    // ----------------------------------------------------------------
    // PRIVATE
    // ----------------------------------------------------------------

    private async _applyOrderEffect(params: {
        tenantId: string;
        sourceEventId: string;
        effectType: InventoryEffectType;
        movementType: StockMovementType;
        items: InventoryEffectItem[];
    }): Promise<InventoryEffectResult> {
        const { tenantId, sourceEventId, effectType, movementType, items } = params;

        if (!sourceEventId || sourceEventId.length > 128) {
            throw new BadRequestException({
                code: 'SOURCE_EVENT_ID_REQUIRED',
                message: 'sourceEventId must be a non-empty string up to 128 chars',
            });
        }
        if (!Array.isArray(items) || items.length === 0) {
            throw new BadRequestException({
                code: 'ITEMS_REQUIRED',
                message: 'items must be a non-empty array',
            });
        }
        items.forEach((it) => this._validateItem(it));

        // Tenant-state pause: TRIAL_EXPIRED/SUSPENDED/CLOSED — внешние side-effects
        // не применяются, lock переводим в IGNORED, чтобы повторная доставка не
        // плодила работу. Возврат в активное состояние снимает паузу.
        const paused = await this._isTenantPaused(tenantId);
        if (paused.paused) {
            await this._markLockIgnoredForPause(tenantId, effectType, sourceEventId);
            this.logger.warn(JSON.stringify({
                event: InventoryEvents.ORDER_EFFECT_PAUSED_BY_TENANT,
                tenantId,
                sourceEventId,
                effectType,
                accessState: paused.accessState,
            }));
            return {
                sourceEventId,
                effectType,
                status: 'IGNORED',
                idempotent: false,
                movements: [],
            };
        }

        const idempotency = await this._checkLock(tenantId, effectType, sourceEventId);
        if (idempotency.idempotent) {
            this.logger.log(JSON.stringify({
                event: InventoryEvents.ORDER_EFFECT_IDEMPOTENT_REPLAY,
                tenantId,
                sourceEventId,
                effectType,
            }));
            return {
                sourceEventId,
                effectType,
                status: 'IGNORED',
                idempotent: true,
                movements: [],
            };
        }

        let movements: InventoryEffectResult['movements'];
        try {
            movements = await this.prisma.$transaction(async (tx) => {
                await this._upsertLockProcessing(tx, tenantId, effectType, sourceEventId);

                const out: InventoryEffectResult['movements'] = [];
                for (const item of items) {
                    const warehouseId = item.warehouseId ?? DEFAULT_WAREHOUSE_ID;
                    const balance = await this._lockOrCreateBalance(
                        tx,
                        tenantId,
                        item.productId,
                        warehouseId,
                    );

                    const { onHandAfter, reservedAfter, delta } = this._computeOrderEffect(
                        effectType,
                        balance,
                        item.qty,
                    );

                    if (onHandAfter < 0) {
                        throw new ConflictException({
                            code: 'NEGATIVE_STOCK_NOT_ALLOWED',
                            message: 'effect would push onHand below zero',
                            productId: item.productId,
                            warehouseId,
                            onHandBefore: balance.onHand,
                            qty: item.qty,
                        });
                    }
                    if (reservedAfter < 0) {
                        throw new ConflictException({
                            code: 'RELEASE_EXCEEDS_RESERVED',
                            message: 'cannot release more than currently reserved',
                            productId: item.productId,
                            warehouseId,
                            reservedBefore: balance.reserved,
                            qty: item.qty,
                        });
                    }
                    if (!balance.isExternal && reservedAfter > onHandAfter) {
                        throw new ConflictException({
                            code: 'RESERVED_EXCEEDS_ONHAND',
                            message: 'reserved would exceed onHand for managed warehouse',
                            productId: item.productId,
                            warehouseId,
                            onHandAfter,
                            reservedAfter,
                        });
                    }

                    await tx.stockBalance.update({
                        where: { id: balance.id },
                        data: { onHand: onHandAfter, reserved: reservedAfter },
                    });

                    const movement = await tx.stockMovement.create({
                        data: {
                            tenantId,
                            productId: item.productId,
                            warehouseId,
                            movementType,
                            delta,
                            onHandBefore: balance.onHand,
                            onHandAfter,
                            reservedBefore: balance.reserved,
                            reservedAfter,
                            reasonCode: this._reasonForEffect(effectType),
                            comment: `sourceEvent=${sourceEventId}, qty=${item.qty}`,
                            source: StockMovementSource.MARKETPLACE,
                            sourceEventId,
                            actorUserId: null,
                        },
                    });

                    // Bridge с legacy MVP: deduct/reserve затрагивают Product.total.
                    if (effectType === InventoryEffectType.ORDER_DEDUCT) {
                        await tx.product.update({
                            where: { id: item.productId },
                            data: { total: onHandAfter },
                        });
                    }

                    out.push({
                        movementId: movement.id,
                        productId: item.productId,
                        warehouseId,
                        delta,
                        onHandAfter,
                        reservedAfter,
                    });
                }

                await tx.inventoryEffectLock.update({
                    where: {
                        tenantId_effectType_sourceEventId: { tenantId, effectType, sourceEventId },
                    },
                    data: { status: InventoryEffectStatus.APPLIED },
                });

                return out;
            });
        } catch (err) {
            // Lock остаётся PROCESSING — переводим в FAILED отдельной транзакцией,
            // чтобы при retry можно было снова попробовать (FAILED → PROCESSING discarded).
            await this._markLockFailed(tenantId, effectType, sourceEventId).catch((e) =>
                this.logger.warn(JSON.stringify({
                    event: InventoryEvents.LOCK_MARK_FAILED_ERROR,
                    tenantId,
                    sourceEventId,
                    effectType,
                    error: (e as Error)?.message,
                })),
            );
            throw err;
        }

        this.logger.log(JSON.stringify({
            event: InventoryEvents.ORDER_EFFECT_APPLIED,
            tenantId,
            sourceEventId,
            effectType,
            items: movements.length,
        }));

        return {
            sourceEventId,
            effectType,
            status: 'APPLIED',
            idempotent: false,
            movements,
        };
    }

    private _validateItem(item: InventoryEffectItem) {
        if (!item || typeof item.productId !== 'string' || !item.productId) {
            throw new BadRequestException({ code: 'ITEM_PRODUCT_ID_REQUIRED' });
        }
        if (!Number.isInteger(item.qty) || item.qty <= 0) {
            throw new BadRequestException({
                code: 'ITEM_QTY_INVALID',
                message: 'qty must be a positive integer',
                productId: item.productId,
            });
        }
    }

    private _computeOrderEffect(
        effectType: InventoryEffectType,
        balance: { onHand: number; reserved: number },
        qty: number,
    ): { onHandAfter: number; reservedAfter: number; delta: number } {
        switch (effectType) {
            case InventoryEffectType.ORDER_RESERVE:
                // delta — изменение `reserved`; onHand не трогаем.
                return {
                    onHandAfter: balance.onHand,
                    reservedAfter: balance.reserved + qty,
                    delta: qty,
                };
            case InventoryEffectType.ORDER_RELEASE:
                return {
                    onHandAfter: balance.onHand,
                    reservedAfter: balance.reserved - qty,
                    delta: -qty,
                };
            case InventoryEffectType.ORDER_DEDUCT: {
                // Списание со склада. Если резерв был — снимаем оба, иначе только onHand.
                const reserveDecrement = Math.min(qty, balance.reserved);
                return {
                    onHandAfter: balance.onHand - qty,
                    reservedAfter: balance.reserved - reserveDecrement,
                    delta: -qty,
                };
            }
            default:
                throw new BadRequestException({ code: 'EFFECT_TYPE_UNSUPPORTED', effectType });
        }
    }

    private _reasonForEffect(effectType: InventoryEffectType): string {
        switch (effectType) {
            case InventoryEffectType.ORDER_RESERVE: return 'ORDER_RESERVED';
            case InventoryEffectType.ORDER_RELEASE: return 'ORDER_RELEASED';
            case InventoryEffectType.ORDER_DEDUCT: return 'ORDER_DEDUCTED';
            case InventoryEffectType.SYNC_RECONCILE: return 'SYNC_RECONCILE';
            default: return 'UNKNOWN';
        }
    }

    private async _checkLock(
        tenantId: string,
        effectType: InventoryEffectType,
        sourceEventId: string,
    ): Promise<{ idempotent: boolean }> {
        const lock = await this.prisma.inventoryEffectLock.findUnique({
            where: {
                tenantId_effectType_sourceEventId: { tenantId, effectType, sourceEventId },
            },
        });
        if (!lock) return { idempotent: false };
        if (lock.status === InventoryEffectStatus.APPLIED) return { idempotent: true };
        if (lock.status === InventoryEffectStatus.IGNORED) return { idempotent: true };
        if (lock.status === InventoryEffectStatus.PROCESSING) {
            throw new ConflictException({
                code: 'INVENTORY_EFFECT_PROCESSING',
                message: 'Another worker is currently applying this effect',
                effectType,
                sourceEventId,
            });
        }
        // FAILED — позволяем retry (вернётся в PROCESSING через upsert).
        return { idempotent: false };
    }

    private async _upsertLockProcessing(
        tx: Prisma.TransactionClient,
        tenantId: string,
        effectType: InventoryEffectType,
        sourceEventId: string,
    ) {
        return tx.inventoryEffectLock.upsert({
            where: {
                tenantId_effectType_sourceEventId: { tenantId, effectType, sourceEventId },
            },
            create: {
                tenantId,
                effectType,
                sourceEventId,
                status: InventoryEffectStatus.PROCESSING,
            },
            update: {
                // Допускаем retry после FAILED.
                status: InventoryEffectStatus.PROCESSING,
            },
        });
    }

    private async _markLockFailed(
        tenantId: string,
        effectType: InventoryEffectType,
        sourceEventId: string,
    ) {
        await this.prisma.inventoryEffectLock.updateMany({
            where: { tenantId, effectType, sourceEventId, status: InventoryEffectStatus.PROCESSING },
            data: { status: InventoryEffectStatus.FAILED },
        });
    }

    private async _lockOrCreateBalance(
        tx: Prisma.TransactionClient,
        tenantId: string,
        productId: string,
        warehouseId: string,
    ): Promise<{ id: string; onHand: number; reserved: number; isExternal: boolean }> {
        // Lazy-bridge с MVP: если StockBalance ещё не существует, создаём с baseline
        // из Product.total (иначе новые tenant'ы получают 0 и любой reserve проваливается).
        const product = await tx.product.findFirst({
            where: { id: productId, tenantId },
            select: { total: true },
        });
        if (!product) {
            throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', productId });
        }

        const balanceId = await this._ensureBalanceLocked(
            tx,
            tenantId,
            productId,
            warehouseId,
            product.total,
        );

        const rows = await tx.$queryRaw<Array<{
            id: string;
            onHand: number;
            reserved: number;
            isExternal: boolean;
        }>>(
            Prisma.sql`SELECT "id", "onHand", "reserved", "isExternal" FROM "StockBalance" WHERE "id" = ${balanceId} FOR UPDATE`,
        );
        const balance = rows[0];
        if (!balance) {
            throw new NotFoundException({ code: 'STOCK_BALANCE_NOT_FOUND', productId });
        }
        return balance;
    }
    // ----------------------------------------------------------------

    private async _getSettings(tenantId: string) {
        const existing = await this.prisma.inventorySettings.findUnique({ where: { tenantId } });
        if (existing) return existing;
        // Lazy-create с дефолтом — упрощает GET без write-action.
        return this.prisma.inventorySettings.upsert({
            where: { tenantId },
            update: {},
            create: { tenantId },
        });
    }

    private async _ensureBalanceLocked(
        tx: Prisma.TransactionClient,
        tenantId: string,
        productId: string,
        warehouseId: string,
        baselineOnHand: number,
    ): Promise<string> {
        // upsert на (tenantId, productId, warehouseId): создаёт ряд из baseline,
        // если корректировка по этому скале первая для tenant.
        const balance = await tx.stockBalance.upsert({
            where: {
                tenantId_productId_warehouseId: { tenantId, productId, warehouseId },
            },
            update: {},
            create: {
                tenantId,
                productId,
                warehouseId,
                fulfillmentMode: InventoryFulfillmentMode.FBS,
                isExternal: false,
                onHand: Math.max(0, baselineOnHand),
                reserved: 0,
            },
        });
        return balance.id;
    }

    private async _loadAdjustmentResult(movementId: string) {
        const movement = await this.prisma.stockMovement.findUnique({ where: { id: movementId } });
        if (!movement) {
            throw new NotFoundException({ code: 'STOCK_MOVEMENT_NOT_FOUND' });
        }
        return {
            movementId: movement.id,
            onHandBefore: movement.onHandBefore ?? 0,
            onHandAfter: movement.onHandAfter ?? 0,
            reservedBefore: movement.reservedBefore ?? 0,
            reservedAfter: movement.reservedAfter ?? 0,
            availableAfter: Math.max(0, (movement.onHandAfter ?? 0) - (movement.reservedAfter ?? 0)),
            reasonCode: movement.reasonCode ?? null,
            replayed: true,
        };
    }

    private _composeProductView(p: {
        id: string;
        sku: string;
        name: string;
        photo: string | null;
        total: number;
        reserved: number;
        stockBalances: Array<{
            warehouseId: string;
            fulfillmentMode: InventoryFulfillmentMode;
            isExternal: boolean;
            onHand: number;
            reserved: number;
            available: number;
        }>;
    }) {
        const balances = this._composeBalances(p);
        const aggregates = this._aggregate(p);
        return {
            productId: p.id,
            sku: p.sku,
            name: p.name,
            photo: p.photo,
            ...aggregates,
            balances,
        };
    }

    private _composeBalances(p: {
        total: number;
        reserved: number;
        stockBalances: Array<{
            warehouseId: string;
            fulfillmentMode: InventoryFulfillmentMode;
            isExternal: boolean;
            onHand: number;
            reserved: number;
            available: number;
        }>;
    }) {
        if (p.stockBalances.length > 0) {
            return p.stockBalances.map((b) => ({
                warehouseId: b.warehouseId,
                fulfillmentMode: b.fulfillmentMode,
                isExternal: b.isExternal,
                onHand: b.onHand,
                reserved: b.reserved,
                available: b.available,
            }));
        }
        // Bridge: у товара ещё нет ни одной adjustment'и → показываем legacy product.total.
        return [{
            warehouseId: DEFAULT_WAREHOUSE_ID,
            fulfillmentMode: InventoryFulfillmentMode.FBS,
            isExternal: false,
            onHand: p.total,
            reserved: p.reserved,
            available: Math.max(0, p.total - p.reserved),
        }];
    }

    private _aggregate(p: {
        total: number;
        reserved: number;
        stockBalances: Array<{ isExternal: boolean; onHand: number; reserved: number; available: number }>;
    }) {
        if (p.stockBalances.length > 0) {
            const managed = p.stockBalances.filter((b) => !b.isExternal);
            const onHand = managed.reduce((s, b) => s + b.onHand, 0);
            const reserved = managed.reduce((s, b) => s + b.reserved, 0);
            const available = managed.reduce((s, b) => s + b.available, 0);
            return { onHand, reserved, available };
        }
        return {
            onHand: p.total,
            reserved: p.reserved,
            available: Math.max(0, p.total - p.reserved),
        };
    }
}
