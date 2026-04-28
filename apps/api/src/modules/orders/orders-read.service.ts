import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListOrdersQueryDto } from './dto/list-orders.query';

/**
 * Read-only сервис для GET endpoints orders domain (TASK_ORDERS_5).
 *
 * Принципы:
 *   - все запросы строго по `tenantId` — изоляция per system-analytics §3;
 *   - фильтры из §6/§7 (marketplace, fulfillmentMode, internalStatus,
 *     stockEffectStatus) собираются типобезопасно через Prisma where;
 *   - НИ ОДИН метод НЕ обращается во внешний API — это §10 + §20 риск
 *     "не запускать orders-side polling" (sync остаётся единственным
 *     источником ingestion'а);
 *   - выходные DTO плоские, без Decimal/Date Prisma-инстансов
 *     (`price.toString()`, `date.toISOString()`) — проще для UI.
 */
@Injectable()
export class OrdersReadService {
    constructor(private readonly prisma: PrismaService) {}

    async list(tenantId: string, query: ListOrdersQueryDto) {
        const page = query.page ?? 1;
        const limit = query.limit ?? 20;
        const skip = (page - 1) * limit;

        const where: Prisma.OrderWhereInput = { tenantId };
        if (query.marketplace) where.marketplace = query.marketplace;
        if (query.fulfillmentMode) where.fulfillmentMode = query.fulfillmentMode;
        if (query.internalStatus) where.internalStatus = query.internalStatus;
        if (query.stockEffectStatus) where.stockEffectStatus = query.stockEffectStatus;
        if (query.search) {
            where.marketplaceOrderId = {
                contains: query.search,
                mode: 'insensitive',
            };
        }

        // SLA §18: p95 < 500мс на стандартных фильтрах. Индексы из
        // TASK_ORDERS_1 (`tenantId,internalStatus,createdAt`,
        // `tenantId,marketplaceAccountId,createdAt`,
        // `tenantId,stockEffectStatus,createdAt`) покрывают типичные
        // комбинации фильтров без full scan.
        const [items, total] = await Promise.all([
            this.prisma.order.findMany({
                where,
                orderBy: [{ createdAt: 'desc' }],
                skip,
                take: limit,
                select: this._listSelect(),
            }),
            this.prisma.order.count({ where }),
        ]);

        return {
            items: items.map((o) => this._mapHeader(o)),
            meta: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit) || 1,
            },
        };
    }

    async detail(tenantId: string, orderId: string) {
        const order = await this.prisma.order.findFirst({
            where: { id: orderId, tenantId },
            select: {
                ...this._listSelect(),
                items: {
                    select: {
                        id: true,
                        productId: true,
                        sku: true,
                        name: true,
                        matchStatus: true,
                        warehouseId: true,
                        quantity: true,
                        price: true,
                    },
                },
            },
        });
        if (!order) {
            throw new NotFoundException({ code: 'ORDER_NOT_FOUND' });
        }
        return {
            ...this._mapHeader(order),
            items: order.items.map((it) => ({
                id: it.id,
                productId: it.productId,
                sku: it.sku,
                name: it.name,
                matchStatus: it.matchStatus,
                warehouseId: it.warehouseId,
                quantity: it.quantity,
                price: it.price ? it.price.toString() : null,
            })),
        };
    }

    async timeline(tenantId: string, orderId: string) {
        // Сначала проверяем доступ к заказу — это даёт `404 ORDER_NOT_FOUND`
        // вместо пустого timeline для чужого заказа.
        const exists = await this.prisma.order.findFirst({
            where: { id: orderId, tenantId },
            select: { id: true },
        });
        if (!exists) throw new NotFoundException({ code: 'ORDER_NOT_FOUND' });

        const events = await this.prisma.orderEvent.findMany({
            where: { orderId },
            orderBy: [{ createdAt: 'asc' }],
            select: {
                id: true,
                eventType: true,
                externalEventId: true,
                marketplaceAccountId: true,
                payload: true,
                createdAt: true,
            },
        });

        return {
            orderId,
            events: events.map((e) => ({
                id: e.id,
                eventType: e.eventType,
                externalEventId: e.externalEventId,
                marketplaceAccountId: e.marketplaceAccountId,
                payload: e.payload,
                createdAt: e.createdAt.toISOString(),
            })),
        };
    }

    private _listSelect() {
        return {
            id: true,
            marketplace: true,
            marketplaceAccountId: true,
            marketplaceOrderId: true,
            syncRunId: true,
            fulfillmentMode: true,
            externalStatus: true,
            internalStatus: true,
            affectsStock: true,
            stockEffectStatus: true,
            warehouseId: true,
            orderCreatedAt: true,
            processedAt: true,
            createdAt: true,
            updatedAt: true,
        } as const;
    }

    private _mapHeader(o: any) {
        return {
            id: o.id,
            marketplace: o.marketplace,
            marketplaceAccountId: o.marketplaceAccountId,
            marketplaceOrderId: o.marketplaceOrderId,
            syncRunId: o.syncRunId,
            fulfillmentMode: o.fulfillmentMode,
            externalStatus: o.externalStatus,
            internalStatus: o.internalStatus,
            affectsStock: o.affectsStock,
            stockEffectStatus: o.stockEffectStatus,
            warehouseId: o.warehouseId,
            orderCreatedAt: o.orderCreatedAt
                ? o.orderCreatedAt.toISOString()
                : null,
            processedAt: o.processedAt ? o.processedAt.toISOString() : null,
            createdAt: o.createdAt.toISOString(),
            updatedAt: o.updatedAt.toISOString(),
        };
    }
}
