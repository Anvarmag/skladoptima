import { MarketplaceType, OrderFulfillmentMode } from '@prisma/client';
import { SyncBlockedReasonCode } from '../marketplace_sync/sync-run.contract';

/**
 * Машинные коды ошибок ingestion (10-orders system-analytics §10).
 *
 * Зачем отдельный enum, а не string literals: TASK_ORDERS_5 (timeline/details
 * API) будет возвращать их в HTTP-ответах; держим коды в одном месте, чтобы
 * web-клиент и тесты могли импортировать тот же source of truth.
 */
export const OrderIngestErrorCode = {
    ORDER_INGEST_BLOCKED_BY_TENANT_STATE: 'ORDER_INGEST_BLOCKED_BY_TENANT_STATE',
    ORDER_EVENT_OUT_OF_ORDER: 'ORDER_EVENT_OUT_OF_ORDER',
    ORDER_ALREADY_PROCESSED: 'ORDER_ALREADY_PROCESSED',
    ORDER_EFFECT_APPLY_FAILED: 'ORDER_EFFECT_APPLY_FAILED',
} as const;
export type OrderIngestErrorCodeT = typeof OrderIngestErrorCode[keyof typeof OrderIngestErrorCode];

/**
 * Нормализованное событие заказа от sync adapter'а. Ingestion service
 * принимает ТОЛЬКО такие события — он не знает про raw WB/Ozon JSON.
 *
 * `externalEventId` — стабильный идентификатор события маркетплейса,
 * по которому проверяется идемпотентность на уровне БД (UNIQUE
 * `(tenantId, marketplaceAccountId, externalEventId)` на `OrderEvent`).
 * Adapter обязан выбрать стабильный ключ: для status_changed это обычно
 * `posting_number@<status_version>` или `(orderId, lastChangeTs)`.
 *
 * `occurredAt` — время, когда событие реально произошло у маркетплейса.
 * По нему ingestion решает, не "старее" ли оно последнего обработанного
 * состояния (out-of-order detection, §9 шаг 4).
 */
export interface OrderIngestEventInput {
    tenantId: string;
    marketplaceAccountId: string;
    marketplace: MarketplaceType;
    marketplaceOrderId: string;

    externalEventId: string;
    externalStatus?: string | null;

    fulfillmentMode: OrderFulfillmentMode;

    occurredAt?: Date | null;
    orderCreatedAt?: Date | null;

    /** ID `SyncRun`, который доставил событие. NULL для legacy poll. */
    syncRunId?: string | null;

    /** Warehouse scope для FBS заказа в целом. */
    warehouseId?: string | null;

    items: ReadonlyArray<OrderIngestItemInput>;

    /** Raw payload для записи в `OrderEvent.payload`. */
    payload?: Record<string, unknown> | null;
}

export interface OrderIngestItemInput {
    /** Если caller сам сматчил товар — передаёт productId. Иначе null. */
    productId?: string | null;
    sku?: string | null;
    name?: string | null;
    warehouseId?: string | null;
    quantity: number;
    /** Цена строки. number → конвертируется в Decimal на стороне БД. */
    price?: number | null;
}

/**
 * Дискриминированный union: caller (sync.service) различает исходы
 * через `outcome` без try/catch на машинных кодах.
 */
export type OrderIngestResult =
    | { outcome: 'INGESTED'; orderId: string; isNew: boolean }
    | { outcome: 'DUPLICATE_IGNORED'; orderId: string }
    | {
          outcome: 'OUT_OF_ORDER_IGNORED';
          orderId: string;
          knownProcessedAt: Date;
          eventOccurredAt: Date;
      }
    | {
          outcome: 'BLOCKED_BY_POLICY';
          errorCode: typeof OrderIngestErrorCode.ORDER_INGEST_BLOCKED_BY_TENANT_STATE;
          policyReason: SyncBlockedReasonCode;
      }
    | {
          outcome: 'FAILED';
          errorCode: OrderIngestErrorCodeT;
          message: string;
      };
