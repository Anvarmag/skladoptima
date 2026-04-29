import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    BadRequestException,
    Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_EVENTS } from '../audit/audit-event-catalog';
import { AuditActorType, AuditSource, MarketplaceLifecycleStatus, MarketplaceType, StockLockType } from '@prisma/client';
import { CreateStockLockDto } from './dto/create-stock-lock.dto';
import { ListStockLocksQuery } from './dto/list-stock-locks.query';

@Injectable()
export class StockLocksService {
    private readonly logger = new Logger(StockLocksService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    async createOrUpdate(tenantId: string, actorId: string | undefined, dto: CreateStockLockDto) {
        const { productId, marketplace, lockType, fixedValue, note } = dto;

        // Validate: FIXED requires fixedValue >= 0 (also enforced in DTO, doubled here for safety)
        if (lockType === StockLockType.FIXED && (fixedValue === undefined || fixedValue === null)) {
            throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'fixedValue is required for FIXED lock type' });
        }

        // Guard: product must belong to this tenant
        const product = await this.prisma.product.findFirst({
            where: { id: productId, tenantId, deletedAt: null },
            select: { id: true },
        });
        if (!product) {
            throw new NotFoundException({ code: 'NOT_FOUND', message: 'PRODUCT_NOT_FOUND' });
        }

        // Guard: marketplace account must be active for this tenant
        const activeAccount = await this.prisma.marketplaceAccount.findFirst({
            where: { tenantId, marketplace, lifecycleStatus: MarketplaceLifecycleStatus.ACTIVE },
            select: { id: true },
        });
        if (!activeAccount) {
            throw new ForbiddenException({ code: 'FORBIDDEN', message: 'MARKETPLACE_ACCOUNT_NOT_ACTIVE' });
        }

        const lock = await this.prisma.stockChannelLock.upsert({
            where: { tenantId_productId_marketplace: { tenantId, productId, marketplace } },
            create: {
                tenantId,
                productId,
                marketplace,
                lockType,
                fixedValue: lockType === StockLockType.FIXED ? fixedValue! : null,
                note: note ?? null,
                createdBy: actorId ?? null,
            },
            update: {
                lockType,
                fixedValue: lockType === StockLockType.FIXED ? fixedValue! : null,
                note: note ?? null,
            },
        });

        await this.audit.writeEvent({
            tenantId,
            eventType: AUDIT_EVENTS.STOCK_LOCK_CREATED,
            entityType: 'StockChannelLock',
            entityId: lock.id,
            actorType: AuditActorType.user,
            actorId: actorId ?? undefined,
            source: AuditSource.api,
            after: { productId, marketplace, lockType, fixedValue: lock.fixedValue, note: lock.note },
        });

        this.logger.log(JSON.stringify({
            metric: 'stock_lock_created',
            lockId: lock.id,
            tenantId,
            productId,
            marketplace,
            lockType,
            ts: new Date().toISOString(),
        }));

        return lock;
    }

    async remove(tenantId: string, lockId: string, actorId: string | undefined) {
        const lock = await this.prisma.stockChannelLock.findFirst({
            where: { id: lockId, tenantId },
        });
        if (!lock) {
            throw new NotFoundException({ code: 'NOT_FOUND', message: 'STOCK_LOCK_NOT_FOUND' });
        }

        await this.prisma.stockChannelLock.delete({ where: { id: lockId } });

        await this.audit.writeEvent({
            tenantId,
            eventType: AUDIT_EVENTS.STOCK_LOCK_REMOVED,
            entityType: 'StockChannelLock',
            entityId: lockId,
            actorType: AuditActorType.user,
            actorId: actorId ?? undefined,
            source: AuditSource.api,
            before: {
                productId: lock.productId,
                marketplace: lock.marketplace,
                lockType: lock.lockType,
                fixedValue: lock.fixedValue,
            },
        });

        this.logger.log(JSON.stringify({
            metric: 'stock_lock_removed',
            lockId,
            tenantId,
            productId: lock.productId,
            marketplace: lock.marketplace,
            ts: new Date().toISOString(),
        }));
    }

    async removeByKey(
        tenantId: string,
        productId: string,
        marketplace: MarketplaceType,
        actorId: string | undefined,
    ) {
        const lock = await this.prisma.stockChannelLock.findUnique({
            where: { tenantId_productId_marketplace: { tenantId, productId, marketplace } },
        });
        if (!lock) {
            throw new NotFoundException({ code: 'NOT_FOUND', message: 'STOCK_LOCK_NOT_FOUND' });
        }
        await this.remove(tenantId, lock.id, actorId);
    }

    async list(tenantId: string, query: ListStockLocksQuery = {}) {
        const { productId, marketplace, page = 1, limit = 20 } = query;
        const skip = (page - 1) * limit;

        const where: any = { tenantId };
        if (productId)   where.productId   = productId;
        if (marketplace) where.marketplace = marketplace;

        const [locks, total] = await Promise.all([
            this.prisma.stockChannelLock.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    product: { select: { id: true, sku: true, name: true } },
                },
            }),
            this.prisma.stockChannelLock.count({ where }),
        ]);

        return {
            data: locks,
            meta: { total, page, lastPage: Math.ceil(total / limit) },
        };
    }

    // Batch-lookup для push_stocks pipeline: один SELECT на весь синк-батч по (tenantId, marketplace).
    // Возвращает Map<productId, StockChannelLock> для in-memory lookup.
    async findByMarketplace(tenantId: string, marketplace: MarketplaceType) {
        const locks = await this.prisma.stockChannelLock.findMany({
            where: { tenantId, marketplace },
        });
        const map = new Map<string, typeof locks[0]>();
        for (const lock of locks) {
            map.set(lock.productId, lock);
        }
        return map;
    }
}
