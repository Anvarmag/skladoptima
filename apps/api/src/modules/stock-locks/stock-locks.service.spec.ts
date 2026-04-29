import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { StockLocksService } from './stock-locks.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

jest.mock('@prisma/client', () => {
    class PrismaClient {}
    return {
        PrismaClient,
        StockLockType: { ZERO: 'ZERO', FIXED: 'FIXED', PAUSED: 'PAUSED' },
        MarketplaceType: { WB: 'WB', OZON: 'OZON' },
        MarketplaceLifecycleStatus: { ACTIVE: 'ACTIVE' },
        AuditActorType: { user: 'user' },
        AuditSource: { api: 'api' },
    };
});

// ─── Prisma mock factory ─────────────────────────────────────────────────────

function makePrismaMock() {
    return {
        product: {
            findFirst: jest.fn(),
        },
        marketplaceAccount: {
            findFirst: jest.fn(),
        },
        stockChannelLock: {
            upsert: jest.fn(),
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            findMany: jest.fn(),
            delete: jest.fn(),
        },
    };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TENANT = 'tenant-1';
const ACTOR_ID = 'user-1';

const PRODUCT = { id: 'prod-1', sku: 'SKU-001', tenantId: TENANT, deletedAt: null };
const ACTIVE_ACCOUNT = { id: 'acc-1' };

const LOCK_ZERO = {
    id: 'lock-1',
    tenantId: TENANT,
    productId: 'prod-1',
    marketplace: 'WB',
    lockType: 'ZERO',
    fixedValue: null,
    note: null,
    createdBy: ACTOR_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
};

const LOCK_FIXED = {
    ...LOCK_ZERO,
    id: 'lock-2',
    productId: 'prod-2',
    lockType: 'FIXED',
    fixedValue: 10,
};

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('StockLocksService', () => {
    let service: StockLocksService;
    let prisma: ReturnType<typeof makePrismaMock>;
    let audit: jest.Mocked<Pick<AuditService, 'writeEvent'>>;
    let logSpy: jest.SpyInstance;

    beforeEach(async () => {
        prisma = makePrismaMock();
        audit = { writeEvent: jest.fn().mockResolvedValue(undefined) };

        const module = await Test.createTestingModule({
            providers: [
                StockLocksService,
                { provide: PrismaService, useValue: prisma },
                { provide: AuditService, useValue: audit },
            ],
        }).compile();

        service = module.get(StockLocksService);
        logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    });

    afterEach(() => jest.clearAllMocks());

    // ─── createOrUpdate ──────────────────────────────────────────────────────

    describe('createOrUpdate', () => {
        it('создаёт новую ZERO-блокировку и пишет audit-событие', async () => {
            prisma.product.findFirst.mockResolvedValue(PRODUCT);
            prisma.marketplaceAccount.findFirst.mockResolvedValue(ACTIVE_ACCOUNT);
            prisma.stockChannelLock.upsert.mockResolvedValue(LOCK_ZERO);

            const result = await service.createOrUpdate(TENANT, ACTOR_ID, {
                productId: 'prod-1',
                marketplace: 'WB' as any,
                lockType: 'ZERO' as any,
            });

            expect(result.id).toBe(LOCK_ZERO.id);
            expect(prisma.stockChannelLock.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    create: expect.objectContaining({ lockType: 'ZERO', fixedValue: null }),
                }),
            );
            expect(audit.writeEvent).toHaveBeenCalledWith(
                expect.objectContaining({ eventType: 'STOCK_LOCK_CREATED' }),
            );
        });

        it('повторный вызов с теми же (productId, marketplace) обновляет тип и fixedValue (upsert)', async () => {
            prisma.product.findFirst.mockResolvedValue(PRODUCT);
            prisma.marketplaceAccount.findFirst.mockResolvedValue(ACTIVE_ACCOUNT);
            prisma.stockChannelLock.upsert.mockResolvedValue(LOCK_FIXED);

            const result = await service.createOrUpdate(TENANT, ACTOR_ID, {
                productId: 'prod-1',
                marketplace: 'WB' as any,
                lockType: 'FIXED' as any,
                fixedValue: 10,
            });

            expect(result.lockType).toBe('FIXED');
            expect(result.fixedValue).toBe(10);
            expect(prisma.stockChannelLock.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    update: expect.objectContaining({ lockType: 'FIXED', fixedValue: 10 }),
                }),
            );
        });

        it('выбрасывает BadRequestException если FIXED без fixedValue', async () => {
            await expect(
                service.createOrUpdate(TENANT, ACTOR_ID, {
                    productId: 'prod-1',
                    marketplace: 'WB' as any,
                    lockType: 'FIXED' as any,
                }),
            ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'VALIDATION_ERROR' }) });

            expect(prisma.stockChannelLock.upsert).not.toHaveBeenCalled();
        });

        it('выбрасывает NotFoundException если товар не найден в тенанте', async () => {
            prisma.product.findFirst.mockResolvedValue(null);

            await expect(
                service.createOrUpdate(TENANT, ACTOR_ID, {
                    productId: 'unknown',
                    marketplace: 'WB' as any,
                    lockType: 'ZERO' as any,
                }),
            ).rejects.toThrow(NotFoundException);

            expect(prisma.stockChannelLock.upsert).not.toHaveBeenCalled();
        });

        it('выбрасывает ForbiddenException если маркетплейс-аккаунт не активен', async () => {
            prisma.product.findFirst.mockResolvedValue(PRODUCT);
            prisma.marketplaceAccount.findFirst.mockResolvedValue(null);

            await expect(
                service.createOrUpdate(TENANT, ACTOR_ID, {
                    productId: 'prod-1',
                    marketplace: 'WB' as any,
                    lockType: 'ZERO' as any,
                }),
            ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'FORBIDDEN' }) });
        });

        it('логирует структурированный metric stock_lock_created', async () => {
            prisma.product.findFirst.mockResolvedValue(PRODUCT);
            prisma.marketplaceAccount.findFirst.mockResolvedValue(ACTIVE_ACCOUNT);
            prisma.stockChannelLock.upsert.mockResolvedValue(LOCK_ZERO);

            await service.createOrUpdate(TENANT, ACTOR_ID, {
                productId: 'prod-1',
                marketplace: 'WB' as any,
                lockType: 'ZERO' as any,
            });

            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"metric":"stock_lock_created"'),
            );
        });
    });

    // ─── remove ──────────────────────────────────────────────────────────────

    describe('remove', () => {
        it('удаляет блокировку и пишет audit-событие STOCK_LOCK_REMOVED', async () => {
            prisma.stockChannelLock.findFirst.mockResolvedValue(LOCK_ZERO);
            prisma.stockChannelLock.delete.mockResolvedValue(LOCK_ZERO);

            await service.remove(TENANT, LOCK_ZERO.id, ACTOR_ID);

            expect(prisma.stockChannelLock.delete).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: LOCK_ZERO.id } }),
            );
            expect(audit.writeEvent).toHaveBeenCalledWith(
                expect.objectContaining({ eventType: 'STOCK_LOCK_REMOVED' }),
            );
        });

        it('выбрасывает NotFoundException при удалении несуществующей блокировки', async () => {
            prisma.stockChannelLock.findFirst.mockResolvedValue(null);

            await expect(service.remove(TENANT, 'ghost-lock', ACTOR_ID))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'NOT_FOUND' }) });

            expect(prisma.stockChannelLock.delete).not.toHaveBeenCalled();
        });

        it('не удаляет блокировку чужого тенанта (findFirst по tenantId)', async () => {
            prisma.stockChannelLock.findFirst.mockResolvedValue(null);

            await expect(service.remove('other-tenant', LOCK_ZERO.id, ACTOR_ID))
                .rejects.toThrow(NotFoundException);
        });

        it('логирует metric stock_lock_removed', async () => {
            prisma.stockChannelLock.findFirst.mockResolvedValue(LOCK_ZERO);
            prisma.stockChannelLock.delete.mockResolvedValue(LOCK_ZERO);

            await service.remove(TENANT, LOCK_ZERO.id, ACTOR_ID);

            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"metric":"stock_lock_removed"'),
            );
        });
    });

    // ─── findByMarketplace ───────────────────────────────────────────────────

    describe('findByMarketplace', () => {
        it('возвращает Map только для блокировок заданного тенанта и маркетплейса', async () => {
            const locks = [LOCK_ZERO, LOCK_FIXED];
            prisma.stockChannelLock.findMany.mockResolvedValue(locks);

            const result = await service.findByMarketplace(TENANT, 'WB' as any);

            expect(prisma.stockChannelLock.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { tenantId: TENANT, marketplace: 'WB' } }),
            );
            expect(result.size).toBe(2);
            expect(result.get('prod-1')).toBe(LOCK_ZERO);
            expect(result.get('prod-2')).toBe(LOCK_FIXED);
        });

        it('возвращает пустой Map если блокировок нет', async () => {
            prisma.stockChannelLock.findMany.mockResolvedValue([]);

            const result = await service.findByMarketplace(TENANT, 'OZON' as any);

            expect(result.size).toBe(0);
        });

        it('не включает блокировки других тенантов (SELECT с WHERE tenantId)', async () => {
            prisma.stockChannelLock.findMany.mockResolvedValue([]);

            await service.findByMarketplace('other-tenant', 'WB' as any);

            expect(prisma.stockChannelLock.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { tenantId: 'other-tenant', marketplace: 'WB' } }),
            );
        });
    });
});
