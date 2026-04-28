/**
 * TASK_ORDERS_7 regression spec для `OrdersIngestionService`.
 *
 * Покрывает §16 тестовую матрицу:
 *   - новый FBS / FBO order;
 *   - duplicate event (UNIQUE на OrderEvent);
 *   - out-of-order event (старше processedAt);
 *   - unmatched SKU (UNRESOLVED);
 *   - paused tenant blocks ingestion (BLOCKED_BY_POLICY);
 *   - FBS new + matched + warehouseId → effects.applyTransitionEffect
 *     вызывается для RESERVED transition.
 */

jest.mock('@prisma/client', () => {
    class PrismaClient {}
    return {
        PrismaClient,
        Prisma: { Decimal: class { constructor(public n: any) {} } },
        MarketplaceType: { WB: 'WB', OZON: 'OZON' },
        OrderFulfillmentMode: { FBS: 'FBS', FBO: 'FBO' },
        OrderInternalStatus: {
            IMPORTED: 'IMPORTED',
            RESERVED: 'RESERVED',
            CANCELLED: 'CANCELLED',
            FULFILLED: 'FULFILLED',
            DISPLAY_ONLY_FBO: 'DISPLAY_ONLY_FBO',
            UNRESOLVED: 'UNRESOLVED',
        },
        OrderItemMatchStatus: { MATCHED: 'MATCHED', UNMATCHED: 'UNMATCHED' },
        OrderStockEffectStatus: {
            NOT_REQUIRED: 'NOT_REQUIRED',
            PENDING: 'PENDING',
            APPLIED: 'APPLIED',
            BLOCKED: 'BLOCKED',
            FAILED: 'FAILED',
        },
        OrderEventType: {
            RECEIVED: 'RECEIVED',
            STATUS_CHANGED: 'STATUS_CHANGED',
            RESERVED: 'RESERVED',
            RESERVE_RELEASED: 'RESERVE_RELEASED',
            DEDUCTED: 'DEDUCTED',
            RETURN_LOGGED: 'RETURN_LOGGED',
            DUPLICATE_IGNORED: 'DUPLICATE_IGNORED',
            OUT_OF_ORDER_IGNORED: 'OUT_OF_ORDER_IGNORED',
            STOCK_EFFECT_FAILED: 'STOCK_EFFECT_FAILED',
        },
        AccessState: {
            EARLY_ACCESS: 'EARLY_ACCESS',
            TRIAL_ACTIVE: 'TRIAL_ACTIVE',
            TRIAL_EXPIRED: 'TRIAL_EXPIRED',
            ACTIVE_PAID: 'ACTIVE_PAID',
            GRACE_PERIOD: 'GRACE_PERIOD',
            SUSPENDED: 'SUSPENDED',
            CLOSED: 'CLOSED',
        },
    };
});

import { OrdersIngestionService } from './orders-ingestion.service';
import { OrderStatusMapperService } from './order-status-mapper.service';
import { OrderIngestEventInput } from './orders-ingestion.contract';

const TENANT = 'tenant-1';
const ACCOUNT = 'acc-1';
const ORDER_ID = 'ord-uuid-1';

function buildEvent(overrides: Partial<OrderIngestEventInput> = {}): OrderIngestEventInput {
    return {
        tenantId: TENANT,
        marketplaceAccountId: ACCOUNT,
        marketplace: 'OZON' as any,
        marketplaceOrderId: 'POSTING-123',
        externalEventId: 'ozon_POSTING-123@awaiting_packaging',
        externalStatus: 'awaiting_packaging',
        fulfillmentMode: 'FBS' as any,
        occurredAt: new Date('2026-04-26T10:00:00Z'),
        items: [
            { productId: 'prod-1', sku: 'SKU-1', name: 'Foo', quantity: 2, price: 100 },
        ],
        ...overrides,
    };
}

function makeMocks() {
    const prisma: any = {
        orderEvent: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({}),
        },
        order: {
            findUnique: jest.fn().mockResolvedValue(null),
            update: jest.fn().mockResolvedValue({}),
            upsert: jest.fn(),
        },
        $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    const preflight: any = {
        runPreflight: jest.fn().mockResolvedValue({ allowed: true }),
    };
    const effects: any = {
        applyTransitionEffect: jest.fn().mockResolvedValue('APPLIED'),
    };
    return { prisma, preflight, effects };
}

function makeMetrics() {
    return {
        increment: jest.fn(),
        observeLatency: jest.fn(),
    };
}

function makeSvc(mocks: ReturnType<typeof makeMocks>, metrics: any = makeMetrics()) {
    return new OrdersIngestionService(
        mocks.prisma,
        mocks.preflight,
        new OrderStatusMapperService(),
        mocks.effects,
        metrics,
    );
}

describe('OrdersIngestionService.ingest', () => {
    it('новый FBS+matched+RESERVED → effects.applyTransitionEffect вызывается, stockEffectStatus=APPLIED', async () => {
        const m = makeMocks();
        m.prisma.order.upsert.mockResolvedValue({ id: ORDER_ID, externalStatus: 'awaiting_packaging' });
        const svc = makeSvc(m);

        const r = await svc.ingest(buildEvent());

        expect(r).toMatchObject({ outcome: 'INGESTED', orderId: ORDER_ID, isNew: true });
        // 1 RECEIVED event для нового заказа
        expect(m.prisma.orderEvent.create).toHaveBeenCalledTimes(1);
        // effect вызван для transition IMPORTED → RESERVED
        expect(m.effects.applyTransitionEffect).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId: TENANT,
                orderId: ORDER_ID,
                transitionFrom: 'IMPORTED',
                transitionTo: 'RESERVED',
            }),
        );
        // итоговый статус записан в Order
        expect(m.prisma.order.update).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: ORDER_ID }, data: { stockEffectStatus: 'APPLIED' } }),
        );
    });

    it('новый FBO заказ → DISPLAY_ONLY_FBO, effects НЕ вызывается', async () => {
        const m = makeMocks();
        m.prisma.order.upsert.mockResolvedValue({ id: ORDER_ID, externalStatus: 'delivered' });
        const svc = makeSvc(m);

        const r = await svc.ingest(buildEvent({
            fulfillmentMode: 'FBO' as any,
            externalStatus: 'delivered',
        }));

        expect(r.outcome).toBe('INGESTED');
        // FBO: нет effect call (нет business-critical статуса)
        expect(m.effects.applyTransitionEffect).not.toHaveBeenCalled();
        // upsert → DISPLAY_ONLY_FBO + NOT_REQUIRED
        expect(m.prisma.order.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                create: expect.objectContaining({
                    internalStatus: 'DISPLAY_ONLY_FBO',
                    affectsStock: false,
                    stockEffectStatus: 'NOT_REQUIRED',
                }),
            }),
        );
    });

    it('новый FBS с unmatched SKU → UNRESOLVED, effects НЕ вызывается', async () => {
        const m = makeMocks();
        m.prisma.order.upsert.mockResolvedValue({ id: ORDER_ID, externalStatus: 'awaiting_packaging' });
        const svc = makeSvc(m);

        const r = await svc.ingest(buildEvent({
            items: [{ productId: null, sku: 'UNKNOWN-SKU', name: '?', quantity: 1 }],
        }));

        expect(r.outcome).toBe('INGESTED');
        expect(m.effects.applyTransitionEffect).not.toHaveBeenCalled();
        expect(m.prisma.order.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                create: expect.objectContaining({
                    internalStatus: 'UNRESOLVED',
                }),
            }),
        );
    });

    it('duplicate event (existing OrderEvent) → DUPLICATE_IGNORED, ничего не пишем', async () => {
        const m = makeMocks();
        m.prisma.orderEvent.findUnique.mockResolvedValue({ orderId: ORDER_ID });
        const svc = makeSvc(m);

        const r = await svc.ingest(buildEvent());

        expect(r).toEqual({ outcome: 'DUPLICATE_IGNORED', orderId: ORDER_ID });
        expect(m.prisma.$transaction).not.toHaveBeenCalled();
        expect(m.effects.applyTransitionEffect).not.toHaveBeenCalled();
    });

    it('out-of-order event (older than processedAt) → OUT_OF_ORDER_IGNORED, состояние не меняем', async () => {
        const m = makeMocks();
        // Заказ существует с более новым processedAt
        m.prisma.order.findUnique.mockResolvedValue({
            id: ORDER_ID,
            externalStatus: 'delivered',
            processedAt: new Date('2026-04-26T12:00:00Z'),
            internalStatus: 'FULFILLED',
        });
        const svc = makeSvc(m);

        const r = await svc.ingest(buildEvent({
            occurredAt: new Date('2026-04-26T08:00:00Z'),  // раньше processedAt
            externalStatus: 'awaiting_packaging',
        }));

        expect(r.outcome).toBe('OUT_OF_ORDER_IGNORED');
        // Записан OUT_OF_ORDER_IGNORED event, НО не upsert и не effects
        expect(m.prisma.orderEvent.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ eventType: 'OUT_OF_ORDER_IGNORED' }),
            }),
        );
        expect(m.prisma.order.upsert).not.toHaveBeenCalled();
        expect(m.effects.applyTransitionEffect).not.toHaveBeenCalled();
    });

    it('paused tenant (preflight blocks) → BLOCKED_BY_POLICY, без записи в БД', async () => {
        const m = makeMocks();
        m.preflight.runPreflight.mockResolvedValue({
            allowed: false,
            reason: 'TENANT_TRIAL_EXPIRED',
        });
        const svc = makeSvc(m);

        const r = await svc.ingest(buildEvent());

        expect(r).toMatchObject({
            outcome: 'BLOCKED_BY_POLICY',
            errorCode: 'ORDER_INGEST_BLOCKED_BY_TENANT_STATE',
            policyReason: 'TENANT_TRIAL_EXPIRED',
        });
        expect(m.prisma.orderEvent.findUnique).not.toHaveBeenCalled();
        expect(m.prisma.$transaction).not.toHaveBeenCalled();
        expect(m.effects.applyTransitionEffect).not.toHaveBeenCalled();
    });

    it('SUSPENDED tenant также блокирует ingestion', async () => {
        const m = makeMocks();
        m.preflight.runPreflight.mockResolvedValue({
            allowed: false,
            reason: 'TENANT_SUSPENDED',
        });
        const svc = makeSvc(m);

        const r = await svc.ingest(buildEvent());

        expect(r.outcome).toBe('BLOCKED_BY_POLICY');
    });

    it('CLOSED tenant также блокирует ingestion', async () => {
        const m = makeMocks();
        m.preflight.runPreflight.mockResolvedValue({
            allowed: false,
            reason: 'TENANT_CLOSED',
        });
        const svc = makeSvc(m);

        const r = await svc.ingest(buildEvent());

        expect(r.outcome).toBe('BLOCKED_BY_POLICY');
    });

    it('Метрики §19: counter "duplicate_order_events" инкрементируется на дубль', async () => {
        const metrics = makeMetrics();
        const m = makeMocks();
        m.prisma.orderEvent.findUnique.mockResolvedValue({ orderId: ORDER_ID });
        const svc = makeSvc(m, metrics);

        await svc.ingest(buildEvent());

        expect(metrics.increment).toHaveBeenCalledWith(
            'duplicate_order_events',
            expect.objectContaining({ marketplace: 'OZON' }),
        );
    });

    it('Метрики §18: observeLatency вызывается на каждом исходе', async () => {
        const metrics = makeMetrics();
        const m = makeMocks();
        m.prisma.order.upsert.mockResolvedValue({ id: ORDER_ID, externalStatus: 'awaiting_packaging' });
        const svc = makeSvc(m, metrics);

        await svc.ingest(buildEvent());

        expect(metrics.observeLatency).toHaveBeenCalledWith(
            expect.any(Number),
            expect.objectContaining({ tenantId: TENANT, source: 'ingestion' }),
        );
    });

    it('Метрики §19: counter "order_ingest_blocked_by_tenant" — для paused', async () => {
        const metrics = makeMetrics();
        const m = makeMocks();
        m.preflight.runPreflight.mockResolvedValue({ allowed: false, reason: 'TENANT_TRIAL_EXPIRED' });
        const svc = makeSvc(m, metrics);

        await svc.ingest(buildEvent());

        expect(metrics.increment).toHaveBeenCalledWith(
            'order_ingest_blocked_by_tenant',
            expect.objectContaining({ reason: 'TENANT_TRIAL_EXPIRED' }),
        );
    });

    it('STATUS_CHANGED для existing заказа со сменой external — пишет два event-а (RECEIVED + STATUS_CHANGED)', async () => {
        const m = makeMocks();
        m.prisma.order.findUnique.mockResolvedValue({
            id: ORDER_ID,
            externalStatus: 'awaiting_packaging',
            processedAt: new Date('2026-04-26T08:00:00Z'),
            internalStatus: 'RESERVED',
        });
        m.prisma.order.upsert.mockResolvedValue({ id: ORDER_ID, externalStatus: 'cancelled' });

        const svc = makeSvc(m);
        const r = await svc.ingest(buildEvent({
            externalStatus: 'cancelled',
            externalEventId: 'ozon_POSTING-123@cancelled',
            occurredAt: new Date('2026-04-26T11:00:00Z'),
        }));

        expect(r.outcome).toBe('INGESTED');
        // RECEIVED + STATUS_CHANGED + RESERVE_RELEASED (transition RESERVED→CANCELLED)
        const types = m.prisma.orderEvent.create.mock.calls.map((c: any) => c[0].data.eventType);
        expect(types).toContain('RECEIVED');
        expect(types).toContain('STATUS_CHANGED');
        expect(types).toContain('RESERVE_RELEASED');
        // Effect на CANCELLED transition
        expect(m.effects.applyTransitionEffect).toHaveBeenCalledWith(
            expect.objectContaining({
                transitionFrom: 'RESERVED',
                transitionTo: 'CANCELLED',
            }),
        );
    });
});
