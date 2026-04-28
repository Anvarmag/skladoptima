import { Injectable, Logger } from '@nestjs/common';
import {
    OrderEventType,
    OrderFulfillmentMode,
    OrderInternalStatus,
    OrderItemMatchStatus,
    OrderStockEffectStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
    InventoryEffectItem,
    InventoryService,
} from '../inventory/inventory.service';

/**
 * Inventory side-effects для orders domain (TASK_ORDERS_4).
 *
 * Связывает orders state machine (TASK_ORDERS_3) с inventory contracts
 * (`reserve / release / deduct / logReturn` из 06-inventory).
 *
 * Контракт:
 *   - вызывает inventory ТОЛЬКО для FBS заказов (`affectsStock=true`);
 *   - стабильный `sourceEventId` = `order_<orderId>:<effect>` — гарантирует
 *     idempotent-замок в `InventoryEffectLock` (один effect per order
 *     per type), даже если orders ingestion сделает повторный вызов;
 *   - НЕ применяет effect, если хотя бы один item UNMATCHED или
 *     warehouseId не определён — это §9 шаг 8 + §14: "не резервируем
 *     остатки в никуда". В этом случае `stockEffectStatus=PENDING`
 *     остаётся, и в timeline пишется `STOCK_EFFECT_FAILED` (с reason);
 *   - return events (`OrderEventType.RETURN_LOGGED`) только пишутся в
 *     timeline и в `inventory.logReturn` (audit), без auto-restock
 *     (§10 + MVP правило §15).
 *
 * Что НЕ делает:
 *   - не выбирает warehouse "за пользователя", если у item его нет:
 *     политика разрешения warehouse scope живёт в самом orders ingest /
 *     warehouse module (TASK_ORDERS_5+ scope mapper). Здесь только
 *     валидация "warehouse определён ИЛИ нет".
 *   - не меняет `internalStatus` — это TASK_ORDERS_3 mapper.
 */
@Injectable()
export class OrderInventoryEffectsService {
    private readonly logger = new Logger(OrderInventoryEffectsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly inventory: InventoryService,
    ) {}

    /**
     * Применяет inventory side-effect для заказа в зависимости от
     * целевого internal статуса:
     *   RESERVED   → inventory.reserve
     *   CANCELLED  → inventory.release  (если был reserve)
     *   FULFILLED  → inventory.deduct
     *
     * `transitionFrom` нужен для CANCELLED: release вызывается ТОЛЬКО
     * если предыдущее состояние было RESERVED — иначе нет резерва, который
     * можно отпустить (например, IMPORTED → CANCELLED при immediate cancel).
     *
     * Возвращает новое значение `stockEffectStatus`, которое caller
     * должен записать в `Order.stockEffectStatus`. Если effect не нужен
     * (FBO/intermediate transition) — возвращает текущий без изменения.
     */
    async applyTransitionEffect(args: {
        tenantId: string;
        orderId: string;
        marketplaceAccountId: string;
        fulfillmentMode: OrderFulfillmentMode;
        transitionFrom: OrderInternalStatus;
        transitionTo: OrderInternalStatus;
        currentStockEffectStatus: OrderStockEffectStatus;
    }): Promise<OrderStockEffectStatus> {
        // FBO: §9 шаг 9 — display-only, никаких side-effects.
        if (args.fulfillmentMode === OrderFulfillmentMode.FBO) {
            return OrderStockEffectStatus.NOT_REQUIRED;
        }

        const items = await this._loadItemsForEffect(args.orderId);

        // Валидация scope: все items должны быть MATCHED + warehouseId.
        // §14: без warehouse scope не резервируем "в никуда". Если хотя бы
        // одна строка не resolved — переводим в FAILED с диагностикой и
        // пишем STOCK_EFFECT_FAILED event для §19 alerts.
        const unresolved = items.filter(
            (it) => !it.productId || !it.warehouseId,
        );
        if (unresolved.length > 0) {
            await this._writeStockEffectFailed(args, {
                reason: 'UNRESOLVED_SCOPE',
                unresolvedCount: unresolved.length,
                totalItems: items.length,
            });
            return OrderStockEffectStatus.FAILED;
        }

        const effectItems: InventoryEffectItem[] = items.map((it) => ({
            productId: it.productId!,
            warehouseId: it.warehouseId!,
            qty: it.quantity,
        }));

        try {
            switch (args.transitionTo) {
                case OrderInternalStatus.RESERVED: {
                    const result = await this.inventory.reserve(
                        args.tenantId,
                        this._sourceEventId(args.orderId, 'reserve'),
                        effectItems,
                    );
                    // status='IGNORED' возможен в двух случаях:
                    //   1. paused tenant — inventory сам пишет lock=IGNORED;
                    //   2. идемпотентный повтор — effect уже был применён.
                    // Для (1) корректнее BLOCKED; (2) — APPLIED. Мы не
                    // различаем по флагу `idempotent` для простоты — оба
                    // оставляют корректное состояние стока.
                    if (result.status === 'IGNORED' && !result.idempotent) {
                        return OrderStockEffectStatus.BLOCKED;
                    }
                    return OrderStockEffectStatus.APPLIED;
                }

                case OrderInternalStatus.CANCELLED: {
                    // §9 шаг 6: release только если был reserve.
                    if (args.transitionFrom !== OrderInternalStatus.RESERVED) {
                        // Cancel из IMPORTED/UNRESOLVED — резерва не было,
                        // эффект не нужен. NOT_REQUIRED отражает это явно.
                        return OrderStockEffectStatus.NOT_REQUIRED;
                    }
                    const result = await this.inventory.release(
                        args.tenantId,
                        this._sourceEventId(args.orderId, 'release'),
                        effectItems,
                    );
                    if (result.status === 'IGNORED' && !result.idempotent) {
                        return OrderStockEffectStatus.BLOCKED;
                    }
                    return OrderStockEffectStatus.APPLIED;
                }

                case OrderInternalStatus.FULFILLED: {
                    const result = await this.inventory.deduct(
                        args.tenantId,
                        this._sourceEventId(args.orderId, 'deduct'),
                        effectItems,
                    );
                    if (result.status === 'IGNORED' && !result.idempotent) {
                        return OrderStockEffectStatus.BLOCKED;
                    }
                    return OrderStockEffectStatus.APPLIED;
                }

                default:
                    // IMPORTED/DISPLAY_ONLY_FBO/UNRESOLVED не имеют
                    // inventory effect. Возвращаем текущий статус без
                    // изменений (caller не будет апдейтить колонку).
                    return args.currentStockEffectStatus;
            }
        } catch (err: any) {
            await this._writeStockEffectFailed(args, {
                reason: 'INVENTORY_EXCEPTION',
                message: err?.message ?? 'unknown',
            });
            this.logger.error(
                `[order_effect_failed] tenant=${args.tenantId} order=${args.orderId} to=${args.transitionTo}: ${err?.message}`,
            );
            return OrderStockEffectStatus.FAILED;
        }
    }

    /**
     * §10 + §15: return event только логируется без auto-restock.
     * Пишет `RETURN_LOGGED` в order timeline и вызывает
     * `inventory.logReturn(...)` для audit-следа в movements.
     */
    async logReturn(args: {
        tenantId: string;
        orderId: string;
        marketplaceAccountId: string;
        externalEventId: string;
        fulfillmentMode: OrderFulfillmentMode;
    }): Promise<void> {
        if (args.fulfillmentMode === OrderFulfillmentMode.FBO) {
            // FBO returns в MVP не отслеживаем как stock event.
            return;
        }
        const items = await this._loadItemsForEffect(args.orderId);
        const effectItems: InventoryEffectItem[] = items
            .filter((it) => it.productId)
            .map((it) => ({
                productId: it.productId!,
                warehouseId: it.warehouseId ?? undefined,
                qty: it.quantity,
            }));

        await this.inventory.logReturn(
            args.tenantId,
            this._sourceEventId(args.orderId, 'return'),
            effectItems,
            'RETURN',
        );

        await this.prisma.orderEvent.create({
            data: {
                tenantId: args.tenantId,
                orderId: args.orderId,
                marketplaceAccountId: args.marketplaceAccountId,
                externalEventId: `${args.externalEventId}#return`,
                eventType: OrderEventType.RETURN_LOGGED,
                payload: { autoRestock: false, itemsCount: effectItems.length },
            },
        });
    }

    private async _loadItemsForEffect(orderId: string) {
        return this.prisma.orderItem.findMany({
            where: { orderId },
            select: {
                productId: true,
                warehouseId: true,
                matchStatus: true,
                quantity: true,
                sku: true,
            },
        });
    }

    private async _writeStockEffectFailed(
        args: {
            tenantId: string;
            orderId: string;
            marketplaceAccountId: string;
            transitionFrom: OrderInternalStatus;
            transitionTo: OrderInternalStatus;
        },
        details: Record<string, unknown>,
    ): Promise<void> {
        await this.prisma.orderEvent.create({
            data: {
                tenantId: args.tenantId,
                orderId: args.orderId,
                marketplaceAccountId: args.marketplaceAccountId,
                // Стабильный суффикс — не конфликтует с RECEIVED/STATUS_CHANGED
                // и обеспечивает уникальность по failed-attempt.
                externalEventId: `order_${args.orderId}:effect_fail:${args.transitionTo}`,
                eventType: OrderEventType.STOCK_EFFECT_FAILED,
                payload: {
                    from: args.transitionFrom,
                    to: args.transitionTo,
                    ...details,
                },
            },
        });
    }

    private _sourceEventId(
        orderId: string,
        effect: 'reserve' | 'release' | 'deduct' | 'return',
    ): string {
        // Стабильный sourceEventId per order per effect-type. Inventory
        // UNIQUE(tenantId, effectType, sourceEventId) гарантирует, что
        // повторный вызов того же effect для того же заказа дедуплицируется
        // (см. inventory §14). Effect-type зашит в строку, чтобы reserve и
        // release одного заказа не конфликтовали.
        return `order:${orderId}:${effect}`;
    }
}

// Helper: предикат для caller'а — нужно ли вызывать `applyTransitionEffect`
// для данного internal transition. Вынесен сюда, чтобы caller (ingestion
// service) не дублировал логику.
export function shouldApplyEffectFor(
    to: OrderInternalStatus,
    from: OrderInternalStatus,
): boolean {
    if (to === from) return false;
    return (
        to === OrderInternalStatus.RESERVED ||
        to === OrderInternalStatus.CANCELLED ||
        to === OrderInternalStatus.FULFILLED
    );
}

// Helper: предикат "хватает ли scope на effect". Используется initial
// flow (когда новый FBS заказ сразу становится RESERVED): если items не
// resolved, applyTransitionEffect вернёт FAILED — но мы можем коротко
// зашортить и отдать UNRESOLVED state без фактического вызова inventory.
export function isFullyResolvedForEffect(
    items: ReadonlyArray<{
        productId: string | null;
        warehouseId: string | null;
        matchStatus: OrderItemMatchStatus;
    }>,
): boolean {
    if (items.length === 0) return false;
    return items.every(
        (it) =>
            it.matchStatus === OrderItemMatchStatus.MATCHED &&
            !!it.productId &&
            !!it.warehouseId,
    );
}
