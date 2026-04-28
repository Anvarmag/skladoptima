import {
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import {
    OrderEventType,
    OrderFulfillmentMode,
    OrderInternalStatus,
    OrderStockEffectStatus,
    Role,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SyncPreflightService } from '../sync-runs/sync-preflight.service';
import { OrderInventoryEffectsService } from './order-inventory-effects.service';

/**
 * Safe reprocess для уже сохранённого заказа (TASK_ORDERS_5).
 *
 * §10 валидации:
 *   - reprocess НЕ обращается во внешний API маркетплейса — он повторно
 *     прогоняет ТОЛЬКО внутреннюю обработку уже сохранённых данных.
 *     Это значит: никаких axios-вызовов, никакого поллинга. Только
 *     перезапуск `OrderInventoryEffectsService.applyTransitionEffect`
 *     для текущего internalStatus заказа (типичный сценарий —
 *     `stockEffectStatus=FAILED` после того, как оператор вручную
 *     сматчил SKU/warehouse).
 *
 * §6 роли:
 *   - доступ к reprocess ограничен `OWNER` и `ADMIN`. Manager/Staff
 *     получают `403 FORBIDDEN`. Проверка происходит ДО любых side-
 *     effects, чтобы 403 не пах изменением состояния.
 *
 * Идемпотентность:
 *   - inventory гарантирует idempotency через `InventoryEffectLock
 *     UNIQUE(tenantId, effectType, sourceEventId)`. Стабильный
 *     `sourceEventId = order:<orderId>:<effect>` означает, что повторный
 *     вызов reserve на уже-резервированный заказ вернётся как
 *     `IGNORED + idempotent`, а не задвоит остаток.
 */
@Injectable()
export class OrdersReprocessService {
    private readonly logger = new Logger(OrdersReprocessService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly preflight: SyncPreflightService,
        private readonly effects: OrderInventoryEffectsService,
    ) {}

    /**
     * Возвращает структуру `{ status, detail }`:
     *   - `APPLIED` — inventory effect успешно (пере)применён.
     *   - `BLOCKED_BY_TENANT` — preflight отказал (tenant paused).
     *   - `NOT_APPLICABLE` — заказ в состоянии, для которого effect
     *     не предусмотрен (FBO/IMPORTED/UNRESOLVED/DISPLAY_ONLY_FBO).
     *   - `STILL_FAILED` — items по-прежнему unresolved → effect не
     *     применился; оператор должен сначала сматчить SKU/warehouse.
     */
    async reprocess(args: {
        tenantId: string;
        orderId: string;
        userId: string;
    }): Promise<{
        status: 'APPLIED' | 'BLOCKED_BY_TENANT' | 'NOT_APPLICABLE' | 'STILL_FAILED';
        stockEffectStatus: OrderStockEffectStatus;
        internalStatus: OrderInternalStatus;
        detail?: string;
    }> {
        // ── 1. Role guard. Owner/Admin only (§6). ────────────────────
        const membership = await this.prisma.membership.findFirst({
            where: {
                tenantId: args.tenantId,
                userId: args.userId,
                status: 'ACTIVE',
            },
            select: { role: true },
        });
        if (!membership) {
            throw new ForbiddenException({ code: 'TENANT_ACCESS_DENIED' });
        }
        if (membership.role !== Role.OWNER && membership.role !== Role.ADMIN) {
            throw new ForbiddenException({ code: 'ROLE_FORBIDDEN' });
        }

        // ── 2. Order load. ───────────────────────────────────────────
        const order = await this.prisma.order.findFirst({
            where: { id: args.orderId, tenantId: args.tenantId },
            select: {
                id: true,
                marketplaceAccountId: true,
                fulfillmentMode: true,
                internalStatus: true,
                stockEffectStatus: true,
                affectsStock: true,
            },
        });
        if (!order) {
            throw new NotFoundException({ code: 'ORDER_NOT_FOUND' });
        }

        // ── 3. Preflight: paused tenant не должен инициировать новый
        //      side-effect, даже если он "внутренний". §4 сценарий 4. ──
        const decision = await this.preflight.runPreflight(
            args.tenantId,
            order.marketplaceAccountId,
            { operation: 'order_reprocess', checkConcurrency: false },
        );
        if (!decision.allowed) {
            this.logger.warn(
                JSON.stringify({
                    event: 'order_reprocess_blocked',
                    tenantId: args.tenantId,
                    orderId: args.orderId,
                    reason: decision.reason,
                }),
            );
            return {
                status: 'BLOCKED_BY_TENANT',
                stockEffectStatus: order.stockEffectStatus,
                internalStatus: order.internalStatus,
                detail: decision.reason,
            };
        }

        // ── 4. Determine target effect. ──────────────────────────────
        // FBO и не-business-critical статусы не имеют inventory effect —
        // reprocess для них = no-op, возвращаем текущее состояние.
        if (order.fulfillmentMode === OrderFulfillmentMode.FBO) {
            return {
                status: 'NOT_APPLICABLE',
                stockEffectStatus: order.stockEffectStatus,
                internalStatus: order.internalStatus,
                detail: 'FBO_DISPLAY_ONLY',
            };
        }
        if (
            order.internalStatus !== OrderInternalStatus.RESERVED &&
            order.internalStatus !== OrderInternalStatus.CANCELLED &&
            order.internalStatus !== OrderInternalStatus.FULFILLED
        ) {
            return {
                status: 'NOT_APPLICABLE',
                stockEffectStatus: order.stockEffectStatus,
                internalStatus: order.internalStatus,
                detail: `internal_status=${order.internalStatus}`,
            };
        }

        // ── 5. Re-apply inventory effect. Inventory layer идемпотентен:
        //      повторный вызов того же sourceEventId на уже applied lock
        //      вернётся IGNORED+idempotent → APPLIED. Если scope наконец
        //      resolved — reserve пройдёт по-новому. ────────────────────
        const newStockEffectStatus = await this.effects.applyTransitionEffect({
            tenantId: args.tenantId,
            orderId: order.id,
            marketplaceAccountId: order.marketplaceAccountId,
            fulfillmentMode: order.fulfillmentMode,
            // Reprocess логически "снова применяем тот же транзит, в
            // котором заказ уже находится". Для CANCELLED это означает,
            // что мы хотим переиграть release из RESERVED — но если
            // release уже был успешным, idempotency lock вернёт IGNORED.
            transitionFrom:
                order.internalStatus === OrderInternalStatus.CANCELLED
                    ? OrderInternalStatus.RESERVED
                    : order.internalStatus,
            transitionTo: order.internalStatus,
            currentStockEffectStatus: order.stockEffectStatus,
        });

        // ── 6. Persist + audit event. ────────────────────────────────
        await this.prisma.order.update({
            where: { id: order.id },
            data: { stockEffectStatus: newStockEffectStatus },
        });

        // Append диагностический event в timeline. Используем
        // `RECEIVED` тип с payload `{reprocess: true}` — отдельного
        // event-type не заводим, чтобы не раздувать enum под admin-ops.
        // UNIQUE constraint обходится timestamp-суффиксом.
        const reprocessEventId = `order:${order.id}:reprocess:${Date.now()}`;
        await this.prisma.orderEvent.create({
            data: {
                tenantId: args.tenantId,
                orderId: order.id,
                marketplaceAccountId: order.marketplaceAccountId,
                externalEventId: reprocessEventId,
                eventType: OrderEventType.RECEIVED,
                payload: {
                    reprocess: true,
                    actor: args.userId,
                    previousStockEffectStatus: order.stockEffectStatus,
                    newStockEffectStatus,
                    internalStatus: order.internalStatus,
                },
            },
        });

        // STILL_FAILED — если effects вернул FAILED (UNRESOLVED_SCOPE
        // или INVENTORY_EXCEPTION). Оператор увидит, что reprocess
        // был, но проблема не решена.
        if (newStockEffectStatus === OrderStockEffectStatus.FAILED) {
            return {
                status: 'STILL_FAILED',
                stockEffectStatus: newStockEffectStatus,
                internalStatus: order.internalStatus,
                detail: 'inventory_effect_failed_again',
            };
        }

        return {
            status: 'APPLIED',
            stockEffectStatus: newStockEffectStatus,
            internalStatus: order.internalStatus,
        };
    }
}
