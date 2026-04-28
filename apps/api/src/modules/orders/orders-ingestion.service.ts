import { Injectable, Logger } from '@nestjs/common';
import {
    OrderEventType,
    OrderFulfillmentMode,
    OrderInternalStatus,
    OrderItemMatchStatus,
    OrderStockEffectStatus,
    Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SyncPreflightService } from '../sync-runs/sync-preflight.service';
import {
    OrderIngestErrorCode,
    OrderIngestEventInput,
    OrderIngestItemInput,
    OrderIngestResult,
} from './orders-ingestion.contract';
import { OrderStatusMapperService } from './order-status-mapper.service';
import { OrderInventoryEffectsService } from './order-inventory-effects.service';
import { OrdersMetricsRegistry, OrdersMetricNames } from './orders.metrics';

/**
 * Идемпотентный ingestion заказов (TASK_ORDERS_2). Доменный сервис, к
 * которому ходят sync-адаптеры — он сам НЕ обращается во внешний API,
 * только в БД (см. 10-orders system-analytics §10: "Прямой polling
 * заказов из orders API в MVP запрещен").
 *
 * Контракт идемпотентности:
 *   1. Перед записью бизнес-эффекта проверяем UNIQUE
 *      `(tenantId, marketplaceAccountId, externalEventId)` на `OrderEvent`.
 *      Если такая запись уже есть — это второй раз тот же event.
 *      Никакого reserve/release/deduct повторно не делаем; пишем
 *      `DUPLICATE_IGNORED` event для трассируемости (§9 шаг 3, §15).
 *   2. Если событие старше последнего обработанного состояния заказа
 *      (`Order.processedAt`) — пишем `OUT_OF_ORDER_IGNORED`. Состояние
 *      назад не откатываем (§9 шаг 4, §20 риск "не откатывать silently").
 *   3. Любая ингестия начинается с preflight: tenant/account state может
 *      запретить приём новых внешних событий. В этом случае возвращаем
 *      `BLOCKED_BY_POLICY` и НЕ пишем событие. По §4 сценарий 4: paused
 *      integration не должна создавать обходных side-effects.
 *
 * Что НЕ делает (намеренно — следующие задачи модуля):
 *   - Не маппит `externalStatus` → `internalStatus` для FBS (это
 *     TASK_ORDERS_3). Сейчас новый FBS заказ остаётся `IMPORTED`, FBO →
 *     `DISPLAY_ONLY_FBO`, заказ с unmatched items → `UNRESOLVED`.
 *   - Не вызывает `inventory.reserve/release/deduct` (TASK_ORDERS_4).
 *     `stockEffectStatus` для FBS заказа выставляется в `PENDING` —
 *     явный сигнал, что side-effect ещё предстоит, и его можно увидеть
 *     в §19 alerts на stuck pending statuses.
 *   - Не предоставляет REST endpoint /orders — он появится в TASK_ORDERS_5.
 */
@Injectable()
export class OrdersIngestionService {
    private readonly logger = new Logger(OrdersIngestionService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly preflight: SyncPreflightService,
        private readonly statusMapper: OrderStatusMapperService,
        private readonly effects: OrderInventoryEffectsService,
        private readonly metrics: OrdersMetricsRegistry,
    ) {}

    async ingest(event: OrderIngestEventInput): Promise<OrderIngestResult> {
        // TASK_ORDERS_7: §18 SLA + §19 dashboards требуют processing
        // latency. Меряем wall-clock от вызова ingest до return — это
        // целиком time-to-DB-commit (preflight + tx + inventory).
        const startedAt = Date.now();
        const labels = {
            tenantId: event.tenantId,
            marketplace: event.marketplace,
            fulfillmentMode: event.fulfillmentMode,
            source: 'ingestion',
        };
        const observeAndReturn = <T extends OrderIngestResult>(r: T): T => {
            this.metrics.observeLatency(Date.now() - startedAt, labels);
            return r;
        };
        // ── 1. Preflight policy guard ────────────────────────────────
        // Reuse того же сервиса, что используется sync admission/worker.
        // Он умеет различать TRIAL_EXPIRED / SUSPENDED / CLOSED tenant и
        // INACTIVE/INVALID account.
        const decision = await this.preflight.runPreflight(
            event.tenantId,
            event.marketplaceAccountId,
            { operation: 'order_ingest', checkConcurrency: false },
        );
        if (!decision.allowed) {
            this.logger.warn(
                JSON.stringify({
                    event: 'order_ingest_blocked',
                    tenantId: event.tenantId,
                    accountId: event.marketplaceAccountId,
                    marketplaceOrderId: event.marketplaceOrderId,
                    externalEventId: event.externalEventId,
                    reason: decision.reason,
                }),
            );
            this.metrics.increment(OrdersMetricNames.INGEST_BLOCKED_BY_TENANT, {
                ...labels,
                reason: decision.reason,
            });
            return observeAndReturn({
                outcome: 'BLOCKED_BY_POLICY',
                errorCode: OrderIngestErrorCode.ORDER_INGEST_BLOCKED_BY_TENANT_STATE,
                policyReason: decision.reason,
            });
        }

        // ── 2. Идемпотентность по external_event_id ──────────────────
        // ПРОВЕРКА ДО транзакции: если событие уже было обработано, мы
        // даже не открываем write-транзакцию. UNIQUE на `OrderEvent`
        // — last line of defense на случай гонки между двумя workers.
        const existingEvent = await this.prisma.orderEvent.findUnique({
            where: {
                tenantId_marketplaceAccountId_externalEventId: {
                    tenantId: event.tenantId,
                    marketplaceAccountId: event.marketplaceAccountId,
                    externalEventId: event.externalEventId,
                },
            },
            select: { orderId: true },
        });
        if (existingEvent) {
            // Не пишем второй DUPLICATE_IGNORED, чтобы не загрязнять
            // timeline бесконечными повторами одного и того же ping'а.
            // Один factual UNIQUE + один первичный приём — этого достаточно
            // для §12 DoD ("повторное событие не дублирует reserve/deduct").
            this.metrics.increment(OrdersMetricNames.DUPLICATE, labels);
            return observeAndReturn({ outcome: 'DUPLICATE_IGNORED', orderId: existingEvent.orderId });
        }

        // ── 3. Транзакционный upsert + event append ──────────────────
        // Всё, что меняет state, — внутри одной транзакции, чтобы:
        //   - заказ не мог появиться без записи RECEIVED event;
        //   - конкурентный handler того же external_event_id упал
        //     на UNIQUE и был обработан как DUPLICATE_IGNORED.
        //
        // TASK_ORDERS_4: сами inventory side-effects (reserve/release/
        // deduct) выносим ЗА транзакцию ingestion'а. Inventory держит
        // свою собственную транзакцию с FOR UPDATE на StockBalance
        // (см. 06-inventory §LOCKING POLICY); вкладывать одну в другую
        // — рецепт лишних блокировок и таймаутов. Idempotency обеспечена
        // двумя слоями: (1) UNIQUE на OrderEvent — ingestion уникален;
        // (2) UNIQUE на InventoryEffectLock(tenantId, effectType,
        // sourceEventId) — даже повторный вызов inventory.reserve(...)
        // с тем же sourceEventId не задвоит резерв.
        let initialEffectTarget:
            | { from: OrderInternalStatus; to: OrderInternalStatus }
            | null = null;
        try {
            const txResult = await this.prisma.$transaction(async (tx) => {
                const existingOrder = await tx.order.findUnique({
                    where: {
                        tenantId_marketplace_marketplaceOrderId: {
                            tenantId: event.tenantId,
                            marketplace: event.marketplace,
                            marketplaceOrderId: event.marketplaceOrderId,
                        },
                    },
                    select: {
                        id: true,
                        externalStatus: true,
                        processedAt: true,
                        internalStatus: true,
                    },
                });

                // ── 3a. Out-of-order detection ───────────────────────
                // Если уже был обработан более новый event этого заказа,
                // отказываемся применять старое состояние. По §20 риск:
                // "Исторические order events не должны silently overwrite
                // более новые состояния".
                if (
                    existingOrder?.processedAt &&
                    event.occurredAt &&
                    event.occurredAt < existingOrder.processedAt
                ) {
                    await tx.orderEvent.create({
                        data: {
                            tenantId: event.tenantId,
                            orderId: existingOrder.id,
                            marketplaceAccountId: event.marketplaceAccountId,
                            externalEventId: event.externalEventId,
                            eventType: OrderEventType.OUT_OF_ORDER_IGNORED,
                            payload: {
                                eventOccurredAt: event.occurredAt.toISOString(),
                                knownProcessedAt: existingOrder.processedAt.toISOString(),
                                externalStatus: event.externalStatus ?? null,
                            },
                        },
                    });
                    return {
                        kind: 'OUT_OF_ORDER' as const,
                        orderId: existingOrder.id,
                        knownProcessedAt: existingOrder.processedAt,
                        eventOccurredAt: event.occurredAt,
                    };
                }

                // ── 3b. Determine derived fields для нового заказа ───
                const isNew = !existingOrder;
                const allMatched = event.items.every(
                    (it) => !!it.productId,
                );
                // TASK_ORDERS_3: status mapping. Initial status решает
                // mapper по правилам §13 (FBO → DISPLAY_ONLY_FBO,
                // unmatched → UNRESOLVED, FBS+matched → mapping или
                // IMPORTED fallback).
                const initialStatus = this.statusMapper.resolveInitialStatus(
                    event.marketplace,
                    event.externalStatus,
                    event.fulfillmentMode,
                    allMatched,
                );
                const affectsStock =
                    event.fulfillmentMode === OrderFulfillmentMode.FBS;
                const stockEffectStatus = affectsStock
                    ? // FBS: эффект ещё предстоит. PENDING явно показывает
                      // в §19 dashboard, что заказ ждёт связки с inventory.
                      // Сам reserve/release/deduct сделает TASK_ORDERS_4.
                      OrderStockEffectStatus.PENDING
                    : OrderStockEffectStatus.NOT_REQUIRED;

                // TASK_ORDERS_3: для существующего заказа решаем,
                // нужно ли обновить internalStatus. Решение принимает
                // mapper + state machine guard:
                //   - INTERMEDIATE (PACKED/SHIPPED/unknown) → не трогаем,
                //     external_status уже сохранён выше.
                //   - TRANSITION → проверяем isTransitionAllowed; если
                //     запрещён (например, попытка выйти из терминального),
                //     оставляем текущий и логируем — это §20 риск
                //     "не silently overwrite более новые состояния".
                let nextInternalStatus: OrderInternalStatus | undefined;
                let transitionLog: { from: OrderInternalStatus; to: OrderInternalStatus } | null = null;
                if (existingOrder) {
                    const decision = this.statusMapper.mapExternalToInternal(
                        event.marketplace,
                        event.externalStatus,
                        event.fulfillmentMode,
                    );
                    if (decision.kind === 'INTERMEDIATE' && decision.reason === 'unknown_status') {
                        this.metrics.increment(OrdersMetricNames.STATUS_MAPPING_FAILED, labels);
                    }
                    if (decision.kind === 'TRANSITION') {
                        if (
                            this.statusMapper.isTransitionAllowed(
                                existingOrder.internalStatus,
                                decision.to,
                            )
                        ) {
                            if (existingOrder.internalStatus !== decision.to) {
                                nextInternalStatus = decision.to;
                                transitionLog = {
                                    from: existingOrder.internalStatus,
                                    to: decision.to,
                                };
                            }
                        } else {
                            this.logger.warn(
                                JSON.stringify({
                                    event: 'order_status_transition_rejected',
                                    tenantId: event.tenantId,
                                    orderId: existingOrder.id,
                                    from: existingOrder.internalStatus,
                                    to: decision.to,
                                    externalStatus: event.externalStatus,
                                }),
                            );
                        }
                    }
                }

                // ── 3c. Upsert order header ──────────────────────────
                // Для существующего заказа обновляем ТОЛЬКО safe fields:
                // externalStatus, syncRunId provenance, processedAt.
                // Внутренний статус и stockEffectStatus НЕ меняем —
                // их переходы делает TASK_ORDERS_3/4.
                const orderId = existingOrder?.id ?? undefined;
                const upserted = await tx.order.upsert({
                    where: {
                        tenantId_marketplace_marketplaceOrderId: {
                            tenantId: event.tenantId,
                            marketplace: event.marketplace,
                            marketplaceOrderId: event.marketplaceOrderId,
                        },
                    },
                    create: {
                        tenantId: event.tenantId,
                        marketplace: event.marketplace,
                        marketplaceAccountId: event.marketplaceAccountId,
                        marketplaceOrderId: event.marketplaceOrderId,
                        syncRunId: event.syncRunId ?? null,
                        fulfillmentMode: event.fulfillmentMode,
                        externalStatus: event.externalStatus ?? null,
                        internalStatus: initialStatus,
                        affectsStock,
                        stockEffectStatus,
                        warehouseId: event.warehouseId ?? null,
                        orderCreatedAt: event.orderCreatedAt ?? null,
                        processedAt: event.occurredAt ?? new Date(),
                        items: {
                            create: event.items.map((it) =>
                                this._buildItemCreate(it),
                            ),
                        },
                    },
                    update: {
                        externalStatus:
                            event.externalStatus ?? existingOrder?.externalStatus,
                        syncRunId: event.syncRunId ?? null,
                        processedAt: event.occurredAt ?? new Date(),
                        // TASK_ORDERS_3: применяем transition только если
                        // mapper его одобрил и state machine guard разрешил.
                        ...(nextInternalStatus
                            ? { internalStatus: nextInternalStatus }
                            : {}),
                    },
                    select: { id: true, externalStatus: true },
                });

                // ── 3d. Append events: RECEIVED + (опционально) STATUS_CHANGED.
                // RECEIVED — провенанс приёма (см. §15). Всегда первым,
                // даже для уже существующего заказа: это документирует
                // факт повторной успешной доставки события (в отличие от
                // DUPLICATE_IGNORED, где external_event_id совпал).
                await tx.orderEvent.create({
                    data: {
                        tenantId: event.tenantId,
                        orderId: upserted.id,
                        marketplaceAccountId: event.marketplaceAccountId,
                        externalEventId: event.externalEventId,
                        eventType: OrderEventType.RECEIVED,
                        payload: this._buildReceivedPayload(event),
                    },
                });

                // STATUS_CHANGED пишем, только если у уже существующего
                // заказа реально поменялся externalStatus. Для нового
                // заказа RECEIVED уже содержит initial status — отдельный
                // STATUS_CHANGED был бы избыточен.
                if (
                    existingOrder &&
                    event.externalStatus &&
                    existingOrder.externalStatus !== event.externalStatus
                ) {
                    await tx.orderEvent.create({
                        data: {
                            tenantId: event.tenantId,
                            orderId: upserted.id,
                            marketplaceAccountId: event.marketplaceAccountId,
                            // STATUS_CHANGED — отдельное событие, не повтор
                            // RECEIVED. Дублируем external_event_id с суффиксом,
                            // чтобы не нарушить UNIQUE и сохранить трассируемость.
                            externalEventId: `${event.externalEventId}#status`,
                            eventType: OrderEventType.STATUS_CHANGED,
                            payload: {
                                from: existingOrder.externalStatus,
                                to: event.externalStatus,
                            },
                        },
                    });
                }

                // TASK_ORDERS_3: append семантического события для
                // внутреннего перехода (§15: order_reserved /
                // order_reserve_released / order_fulfilled). Это
                // отдельный event сверх STATUS_CHANGED, потому что
                // STATUS_CHANGED фиксирует raw external move, а
                // RESERVED/CANCELLED/FULFILLED — внутреннее решение
                // системы (источник истины для inventory side-effects
                // в TASK_ORDERS_4).
                if (transitionLog) {
                    const internalEventType = this._internalEventTypeFor(
                        transitionLog.to,
                    );
                    if (internalEventType) {
                        await tx.orderEvent.create({
                            data: {
                                tenantId: event.tenantId,
                                orderId: upserted.id,
                                marketplaceAccountId: event.marketplaceAccountId,
                                // Уникальный суффикс по target состоянию,
                                // чтобы не конфликтовать с RECEIVED и STATUS_CHANGED.
                                externalEventId: `${event.externalEventId}#${transitionLog.to}`,
                                eventType: internalEventType,
                                payload: {
                                    from: transitionLog.from,
                                    to: transitionLog.to,
                                    externalStatus: event.externalStatus ?? null,
                                },
                            },
                        });
                    }
                }

                // TASK_ORDERS_4: вычислим, нужно ли вызвать inventory effect
                // ПОСЛЕ транзакции. Два кейса:
                //   1. Existing order сменил internalStatus (transitionLog).
                //   2. New order сразу попал в business-critical статус
                //      (RESERVED/CANCELLED/FULFILLED) — тогда initialStatus
                //      уже equals target, и effect нужно применить
                //      "from IMPORTED" (логически).
                let effectTarget:
                    | { from: OrderInternalStatus; to: OrderInternalStatus }
                    | null = null;
                if (transitionLog) {
                    effectTarget = transitionLog;
                } else if (
                    isNew &&
                    affectsStock &&
                    (initialStatus === OrderInternalStatus.RESERVED ||
                        initialStatus === OrderInternalStatus.CANCELLED ||
                        initialStatus === OrderInternalStatus.FULFILLED)
                ) {
                    effectTarget = {
                        from: OrderInternalStatus.IMPORTED,
                        to: initialStatus,
                    };
                }

                return {
                    kind: 'INGESTED' as const,
                    orderId: upserted.id,
                    isNew,
                    effectTarget,
                };
            });

            // OUT_OF_ORDER короткий путь — без inventory.
            if (txResult.kind === 'OUT_OF_ORDER') {
                this.metrics.increment(OrdersMetricNames.OUT_OF_ORDER, labels);
                return observeAndReturn({
                    outcome: 'OUT_OF_ORDER_IGNORED',
                    orderId: txResult.orderId,
                    knownProcessedAt: txResult.knownProcessedAt,
                    eventOccurredAt: txResult.eventOccurredAt,
                });
            }

            // ── 4. Inventory side-effect (вне транзакции, см. комментарий выше).
            initialEffectTarget = txResult.effectTarget;
            if (initialEffectTarget) {
                const newEffectStatus = await this.effects.applyTransitionEffect({
                    tenantId: event.tenantId,
                    orderId: txResult.orderId,
                    marketplaceAccountId: event.marketplaceAccountId,
                    fulfillmentMode: event.fulfillmentMode,
                    transitionFrom: initialEffectTarget.from,
                    transitionTo: initialEffectTarget.to,
                    // Для нового заказа stockEffectStatus только что
                    // выставлен в PENDING (FBS) — передаём актуальное.
                    currentStockEffectStatus: event.fulfillmentMode === OrderFulfillmentMode.FBS
                        ? OrderStockEffectStatus.PENDING
                        : OrderStockEffectStatus.NOT_REQUIRED,
                });
                // Записываем итоговый stockEffectStatus в Order. Делаем
                // это ОТДЕЛЬНЫМ update'ом, чтобы не блокировать другие
                // ingestion'ы и видеть финальный статус сразу в UI.
                await this.prisma.order.update({
                    where: { id: txResult.orderId },
                    data: { stockEffectStatus: newEffectStatus },
                });
            }

            // §19 счётчики по итогу INGESTED.
            this.metrics.increment(OrdersMetricNames.INGESTED, labels);
            if (initialEffectTarget) {
                // Если effects вернул FAILED — сводный счётчик
                // side-effect failures для §19 alerts.
                const orderState = await this.prisma.order.findUnique({
                    where: { id: txResult.orderId },
                    select: { stockEffectStatus: true, internalStatus: true },
                });
                if (orderState?.stockEffectStatus === 'FAILED') {
                    this.metrics.increment(OrdersMetricNames.SIDE_EFFECT_FAILED, labels);
                }
                if (orderState?.internalStatus === 'UNRESOLVED') {
                    this.metrics.increment(OrdersMetricNames.UNMATCHED_SKU_ORDER, labels);
                }
            } else if (txResult.isNew) {
                // Для нового заказа без effect-target проверяем, не
                // оказался ли он UNRESOLVED.
                const orderState = await this.prisma.order.findUnique({
                    where: { id: txResult.orderId },
                    select: { internalStatus: true },
                });
                if (orderState?.internalStatus === 'UNRESOLVED') {
                    this.metrics.increment(OrdersMetricNames.UNMATCHED_SKU_ORDER, labels);
                }
            }

            return observeAndReturn({
                outcome: 'INGESTED',
                orderId: txResult.orderId,
                isNew: txResult.isNew,
            });
        } catch (err: any) {
            // P2002 на OrderEvent — это race condition между двумя
            // workers, обработавшими тот же event одновременно. По смыслу
            // — DUPLICATE_IGNORED (второй проигравший должен молча уйти).
            if (err?.code === 'P2002') {
                const orderRef = await this.prisma.order.findUnique({
                    where: {
                        tenantId_marketplace_marketplaceOrderId: {
                            tenantId: event.tenantId,
                            marketplace: event.marketplace,
                            marketplaceOrderId: event.marketplaceOrderId,
                        },
                    },
                    select: { id: true },
                });
                this.metrics.increment(OrdersMetricNames.DUPLICATE, { ...labels, reason: 'race_p2002' });
                return observeAndReturn({
                    outcome: 'DUPLICATE_IGNORED',
                    orderId: orderRef?.id ?? '',
                });
            }
            this.logger.error(
                `[order_ingest_failed] tenant=${event.tenantId} order=${event.marketplaceOrderId} event=${event.externalEventId}: ${err?.message ?? err}`,
            );
            this.metrics.increment(OrdersMetricNames.SIDE_EFFECT_FAILED, { ...labels, reason: 'ingest_exception' });
            return observeAndReturn({
                outcome: 'FAILED',
                errorCode: OrderIngestErrorCode.ORDER_EFFECT_APPLY_FAILED,
                message: err?.message ?? 'unknown ingestion failure',
            });
        }
    }

    /**
     * TASK_ORDERS_3: маппит target internalStatus в семантический
     * `OrderEventType` для §15 (order_reserved / order_reserve_released /
     * order_fulfilled). DISPLAY_ONLY_FBO/UNRESOLVED/IMPORTED не имеют
     * соответствующего бизнес-события — для них append семантического
     * event'а пропускается (timeline всё равно содержит RECEIVED +
     * STATUS_CHANGED).
     */
    private _internalEventTypeFor(
        to: OrderInternalStatus,
    ): OrderEventType | null {
        switch (to) {
            case OrderInternalStatus.RESERVED:
                return OrderEventType.RESERVED;
            case OrderInternalStatus.CANCELLED:
                return OrderEventType.RESERVE_RELEASED;
            case OrderInternalStatus.FULFILLED:
                return OrderEventType.DEDUCTED;
            default:
                return null;
        }
    }

    private _buildItemCreate(it: OrderIngestItemInput) {
        const matched = !!it.productId;
        return {
            productId: it.productId ?? null,
            sku: it.sku ?? null,
            name: it.name ?? null,
            matchStatus: matched
                ? OrderItemMatchStatus.MATCHED
                : OrderItemMatchStatus.UNMATCHED,
            warehouseId: it.warehouseId ?? null,
            quantity: it.quantity,
            // Цена в спецификации — NUMERIC(12,2). Prisma принимает
            // number, Decimal или string; передаём через Decimal, чтобы
            // не получить float-рандом на больших суммах.
            price:
                it.price === null || it.price === undefined
                    ? null
                    : new Prisma.Decimal(it.price),
        };
    }

    private _buildReceivedPayload(
        event: OrderIngestEventInput,
    ): Prisma.InputJsonValue {
        // RECEIVED.payload содержит достаточно, чтобы восстановить
        // решение ingestion'а без обращения к raw логам (§12 DoD).
        // Каст через unknown — Prisma.InputJsonValue требует строго
        // JSON-сериализуемых литералов, а наш `payload?: Record<string, unknown>`
        // даёт более широкий тип. На рантайме поля заведомо JSON-safe.
        const obj = {
            externalStatus: event.externalStatus ?? null,
            fulfillmentMode: event.fulfillmentMode,
            syncRunId: event.syncRunId ?? null,
            occurredAt: event.occurredAt
                ? event.occurredAt.toISOString()
                : null,
            orderCreatedAt: event.orderCreatedAt
                ? event.orderCreatedAt.toISOString()
                : null,
            itemsCount: event.items.length,
            raw: event.payload ?? null,
        };
        return obj as unknown as Prisma.InputJsonValue;
    }
}
