import { Injectable, Logger } from '@nestjs/common';
import {
    MarketplaceType,
    OrderFulfillmentMode,
    OrderInternalStatus,
} from '@prisma/client';

/**
 * Mapping external WB/Ozon статусов во внутренние (10-orders system-analytics
 * §13). Реализует политику MVP:
 *
 *   - business-critical для FBS — только `RESERVED / CANCELLED / FULFILLED`;
 *   - `PACKED / SHIPPED` и аналоги остаются в `external_status` и НЕ
 *     меняют внутренний lifecycle (значение `INTERMEDIATE`);
 *   - неизвестные статусы интерпретируются как `INTERMEDIATE`, чтобы
 *     не уронить ingestion и оставить трассу в `external_status` для
 *     последующего разбора.
 *
 * State machine §13 валидируется отдельно (`isTransitionAllowed`):
 * ingestion НИКОГДА не откатывает заказ из терминального состояния
 * (`CANCELLED`/`FULFILLED`/`DISPLAY_ONLY_FBO`) обратно в активное —
 * это §20 риск "не silently overwrite более новые состояния".
 */

/** Решение mapper'а: что делать с внутренним статусом по результату внешнего. */
export type StatusMapDecision =
    /** Внешний статус не меняет внутренний lifecycle (PACKED/SHIPPED/unknown). */
    | { kind: 'INTERMEDIATE'; reason: 'known_intermediate' | 'unknown_status' }
    /** Перевести во внутренний статус (если transition разрешён). */
    | { kind: 'TRANSITION'; to: OrderInternalStatus };

// ── WB FBS статусы ────────────────────────────────────────────────────
// Источник: WB Marketplace API supplier guide. В MVP используем
// упрощённую сводку: новый/в работе → активная резервация, конечные →
// FULFILLED/CANCELLED. Промежуточные сборочные статусы → INTERMEDIATE.
const WB_STATUS_MAP: Readonly<Record<string, StatusMapDecision>> = {
    new: { kind: 'TRANSITION', to: OrderInternalStatus.RESERVED },
    waiting: { kind: 'TRANSITION', to: OrderInternalStatus.RESERVED },
    confirm: { kind: 'INTERMEDIATE', reason: 'known_intermediate' },
    confirmed: { kind: 'INTERMEDIATE', reason: 'known_intermediate' },
    sorted: { kind: 'INTERMEDIATE', reason: 'known_intermediate' },
    on_delivery: { kind: 'INTERMEDIATE', reason: 'known_intermediate' },
    sold: { kind: 'TRANSITION', to: OrderInternalStatus.FULFILLED },
    delivered: { kind: 'TRANSITION', to: OrderInternalStatus.FULFILLED },
    canceled: { kind: 'TRANSITION', to: OrderInternalStatus.CANCELLED },
    cancelled: { kind: 'TRANSITION', to: OrderInternalStatus.CANCELLED },
    canceled_by_client: { kind: 'TRANSITION', to: OrderInternalStatus.CANCELLED },
    declined_by_client: { kind: 'TRANSITION', to: OrderInternalStatus.CANCELLED },
    defect: { kind: 'TRANSITION', to: OrderInternalStatus.CANCELLED },
};

// ── Ozon FBS статусы ──────────────────────────────────────────────────
// Источник: Ozon Seller API /v3/posting/fbs/list (status enum).
// Active reserve: awaiting_*, delivering, driver_pickup, sent_by_seller.
// Terminal: delivered → FULFILLED; cancelled/not_accepted → CANCELLED.
const OZON_STATUS_MAP: Readonly<Record<string, StatusMapDecision>> = {
    acceptance_in_progress: { kind: 'TRANSITION', to: OrderInternalStatus.RESERVED },
    awaiting_approve: { kind: 'TRANSITION', to: OrderInternalStatus.RESERVED },
    awaiting_packaging: { kind: 'TRANSITION', to: OrderInternalStatus.RESERVED },
    awaiting_registration: { kind: 'TRANSITION', to: OrderInternalStatus.RESERVED },
    awaiting_deliver: { kind: 'TRANSITION', to: OrderInternalStatus.RESERVED },
    arbitration: { kind: 'INTERMEDIATE', reason: 'known_intermediate' },
    client_arbitration: { kind: 'INTERMEDIATE', reason: 'known_intermediate' },
    delivering: { kind: 'INTERMEDIATE', reason: 'known_intermediate' },
    driver_pickup: { kind: 'INTERMEDIATE', reason: 'known_intermediate' },
    sent_by_seller: { kind: 'INTERMEDIATE', reason: 'known_intermediate' },
    delivered: { kind: 'TRANSITION', to: OrderInternalStatus.FULFILLED },
    cancelled: { kind: 'TRANSITION', to: OrderInternalStatus.CANCELLED },
    canceled: { kind: 'TRANSITION', to: OrderInternalStatus.CANCELLED },
    not_accepted: { kind: 'TRANSITION', to: OrderInternalStatus.CANCELLED },
};

// Терминальные статусы — из них НЕ возвращаемся ни в какой активный.
const TERMINAL_STATES: ReadonlySet<OrderInternalStatus> = new Set([
    OrderInternalStatus.CANCELLED,
    OrderInternalStatus.FULFILLED,
    OrderInternalStatus.DISPLAY_ONLY_FBO,
]);

@Injectable()
export class OrderStatusMapperService {
    private readonly logger = new Logger(OrderStatusMapperService.name);

    /**
     * Маппит внешний статус во внутреннее решение. FBO заказы всегда
     * INTERMEDIATE на уровне mapper'а (их lifecycle статичен:
     * `DISPLAY_ONLY_FBO` фиксируется при первой ингестии и не меняется).
     */
    mapExternalToInternal(
        marketplace: MarketplaceType,
        externalStatus: string | null | undefined,
        fulfillmentMode: OrderFulfillmentMode,
    ): StatusMapDecision {
        if (fulfillmentMode === OrderFulfillmentMode.FBO) {
            // §13: FBO остаётся DISPLAY_ONLY на весь lifecycle. external
            // не должен переводить его в RESERVED/FULFILLED/CANCELLED.
            return { kind: 'INTERMEDIATE', reason: 'known_intermediate' };
        }

        const key = externalStatus?.trim().toLowerCase();
        if (!key) {
            return { kind: 'INTERMEDIATE', reason: 'unknown_status' };
        }

        const dict =
            marketplace === MarketplaceType.WB ? WB_STATUS_MAP : OZON_STATUS_MAP;
        const decision = dict[key];
        if (!decision) {
            // Unknown статус — оставляем external как трассу, internal не трогаем.
            // В §19 dashboard это поднимется как `status_mapping_failures` метрика.
            this.logger.warn(
                JSON.stringify({
                    event: 'order_status_unknown',
                    marketplace,
                    externalStatus: key,
                }),
            );
            return { kind: 'INTERMEDIATE', reason: 'unknown_status' };
        }
        return decision;
    }

    /**
     * Решает initial internalStatus при создании нового заказа.
     *
     * Приоритет:
     *   1. FBO → `DISPLAY_ONLY_FBO` всегда (§13).
     *   2. FBS с unmatched items → `UNRESOLVED` независимо от external
     *      (§14: warehouse/SKU scope не определён → не резервируем
     *      "в никуда").
     *   3. Иначе пытаемся применить mapper. Если он даёт TRANSITION —
     *      используем; INTERMEDIATE → fallback `IMPORTED` (заказ уже
     *      создан, но точный business-critical статус ещё не известен).
     */
    resolveInitialStatus(
        marketplace: MarketplaceType,
        externalStatus: string | null | undefined,
        fulfillmentMode: OrderFulfillmentMode,
        allItemsMatched: boolean,
    ): OrderInternalStatus {
        if (fulfillmentMode === OrderFulfillmentMode.FBO) {
            return OrderInternalStatus.DISPLAY_ONLY_FBO;
        }
        if (!allItemsMatched) {
            return OrderInternalStatus.UNRESOLVED;
        }
        const decision = this.mapExternalToInternal(
            marketplace,
            externalStatus,
            fulfillmentMode,
        );
        if (decision.kind === 'TRANSITION') {
            return decision.to;
        }
        // Intermediate/unknown для нового FBS — заказ оседает в IMPORTED,
        // переход в RESERVED произойдёт следующим event'ом со status_changed.
        return OrderInternalStatus.IMPORTED;
    }

    /**
     * State machine guard §13. Возвращает true, если переход
     * `from → to` разрешён. Терминальные состояния не покидаются
     * (защита от out-of-order и от ошибочных mapping'ов).
     */
    isTransitionAllowed(
        from: OrderInternalStatus,
        to: OrderInternalStatus,
    ): boolean {
        if (from === to) return true; // no-op считается разрешённым
        if (TERMINAL_STATES.has(from)) {
            // Из CANCELLED/FULFILLED/DISPLAY_ONLY_FBO — никуда.
            return false;
        }
        // Из активных состояний разрешены любые переходы по §13:
        //   IMPORTED → RESERVED | CANCELLED | FULFILLED | DISPLAY_ONLY_FBO | UNRESOLVED
        //   UNRESOLVED → RESERVED
        //   RESERVED → CANCELLED | FULFILLED
        // Жёсткая матрица:
        const allowed: Record<OrderInternalStatus, ReadonlyArray<OrderInternalStatus>> = {
            [OrderInternalStatus.IMPORTED]: [
                OrderInternalStatus.RESERVED,
                OrderInternalStatus.CANCELLED,
                OrderInternalStatus.FULFILLED,
                OrderInternalStatus.DISPLAY_ONLY_FBO,
                OrderInternalStatus.UNRESOLVED,
            ],
            [OrderInternalStatus.UNRESOLVED]: [
                OrderInternalStatus.RESERVED,
                OrderInternalStatus.CANCELLED,
                OrderInternalStatus.FULFILLED,
            ],
            [OrderInternalStatus.RESERVED]: [
                OrderInternalStatus.CANCELLED,
                OrderInternalStatus.FULFILLED,
            ],
            // Терминальные — пустой список (на самом деле уже отсечены выше).
            [OrderInternalStatus.CANCELLED]: [],
            [OrderInternalStatus.FULFILLED]: [],
            [OrderInternalStatus.DISPLAY_ONLY_FBO]: [],
        };
        return allowed[from]?.includes(to) ?? false;
    }
}
