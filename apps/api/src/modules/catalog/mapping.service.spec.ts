import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { MappingService } from './mapping.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ActionType, ChannelMarketplace, ProductSourceOfTruth, ProductStatus } from '@prisma/client';

jest.mock('@prisma/client', () => {
    class PrismaClient {}
    return {
        PrismaClient,
        ProductStatus:        { ACTIVE: 'ACTIVE', DELETED: 'DELETED' },
        ProductSourceOfTruth: { MANUAL: 'MANUAL', IMPORT: 'IMPORT', SYNC: 'SYNC' },
        ChannelMarketplace:   { WB: 'WB', OZON: 'OZON', YANDEX_MARKET: 'YANDEX_MARKET', SITE: 'SITE' },
        ActionType: {
            PRODUCT_CREATED:  'PRODUCT_CREATED',
            PRODUCT_UPDATED:  'PRODUCT_UPDATED',
            PRODUCT_DELETED:  'PRODUCT_DELETED',
            PRODUCT_RESTORED: 'PRODUCT_RESTORED',
            STOCK_ADJUSTED:   'STOCK_ADJUSTED',
            IMPORT_COMMITTED: 'IMPORT_COMMITTED',
            MAPPING_CREATED:  'MAPPING_CREATED',
            MAPPING_DELETED:  'MAPPING_DELETED',
            PRODUCT_MERGED:   'PRODUCT_MERGED',
        },
    };
});

// ─── Prisma mock factory ────────────────────────────────────────────────────

function makePrismaMock() {
    return {
        product: {
            findMany: jest.fn(),
            count: jest.fn(),
            findFirst: jest.fn(),
            update: jest.fn(),
        },
        productChannelMapping: {
            findMany: jest.fn(),
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            count: jest.fn(),
        },
        auditLog: {
            create: jest.fn().mockResolvedValue({}),
        },
    };
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const TENANT = 'tenant-1';
const ACTOR = 'admin@example.com';
const USER_ID = 'user-1';

const ACTIVE_PRODUCT = {
    id: 'prod-1',
    sku: 'SKU-001',
    name: 'Product A',
    brand: null,
    category: null,
    tenantId: TENANT,
    deletedAt: null,
    status: ProductStatus.ACTIVE,
    sourceOfTruth: ProductSourceOfTruth.MANUAL,
    createdAt: new Date(),
    updatedAt: new Date(),
};

const PRODUCT_B = {
    ...ACTIVE_PRODUCT,
    id: 'prod-2',
    sku: 'SKU-002',
    name: 'Product B',
};

const MAPPING_WB = {
    id: 'map-1',
    tenantId: TENANT,
    productId: 'prod-1',
    marketplace: ChannelMarketplace.WB,
    externalProductId: 'WB-EXT-1',
    externalSku: 'SKU-001',
    isAutoMatched: false,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    product: { id: 'prod-1', sku: 'SKU-001', name: 'Product A', brand: null },
};

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('MappingService', () => {
    let service: MappingService;
    let prisma: ReturnType<typeof makePrismaMock>;
    let auditService: jest.Mocked<Pick<AuditService, 'logAction'>>;
    let warnSpy: jest.SpyInstance;
    let logSpy: jest.SpyInstance;

    beforeEach(async () => {
        prisma = makePrismaMock();
        auditService = { logAction: jest.fn().mockResolvedValue({}) };

        const module = await Test.createTestingModule({
            providers: [
                MappingService,
                { provide: PrismaService, useValue: prisma },
                { provide: AuditService, useValue: auditService },
            ],
        }).compile();

        service = module.get(MappingService);
        warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
        logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    });

    afterEach(() => jest.clearAllMocks());

    // ─── createManual ────────────────────────────────────────────────────────

    describe('createManual', () => {
        const dto = {
            productId: 'prod-1',
            marketplace: ChannelMarketplace.WB,
            externalProductId: 'WB-EXT-1',
            externalSku: 'SKU-001',
        };

        it('creates manual mapping and emits MAPPING_CREATED audit', async () => {
            prisma.product.findFirst.mockResolvedValue(ACTIVE_PRODUCT);
            prisma.productChannelMapping.findFirst.mockResolvedValue(null);
            prisma.productChannelMapping.create.mockResolvedValue(MAPPING_WB);

            const result = await service.createManual(dto, TENANT, ACTOR, USER_ID);

            expect(result.id).toBe(MAPPING_WB.id);
            expect(auditService.logAction).toHaveBeenCalledWith(
                expect.objectContaining({ actionType: ActionType.MAPPING_CREATED }),
            );
        });

        it('throws PRODUCT_NOT_FOUND when product does not exist in tenant', async () => {
            prisma.product.findFirst.mockResolvedValue(null);

            await expect(service.createManual(dto, TENANT, ACTOR))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'PRODUCT_NOT_FOUND' }) });

            expect(auditService.logAction).not.toHaveBeenCalled();
        });

        it('throws MAPPING_ALREADY_EXISTS when external product is already mapped', async () => {
            prisma.product.findFirst.mockResolvedValue(ACTIVE_PRODUCT);
            prisma.productChannelMapping.findFirst.mockResolvedValue(MAPPING_WB);

            await expect(service.createManual(dto, TENANT, ACTOR))
                .rejects.toMatchObject({
                    response: expect.objectContaining({
                        code: 'MAPPING_ALREADY_EXISTS',
                        existingMappingId: MAPPING_WB.id,
                    }),
                });

            expect(auditService.logAction).not.toHaveBeenCalled();
        });

        it('logs mapping_conflict_detected warning on MAPPING_ALREADY_EXISTS', async () => {
            prisma.product.findFirst.mockResolvedValue(ACTIVE_PRODUCT);
            prisma.productChannelMapping.findFirst.mockResolvedValue(MAPPING_WB);

            await service.createManual(dto, TENANT, ACTOR).catch(() => {});

            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"mapping_conflict_detected"'),
            );
        });
    });

    // ─── autoMatch ──────────────────────────────────────────────────────────

    describe('autoMatch', () => {
        const dto = {
            marketplace: ChannelMarketplace.WB,
            externalProductId: 'WB-EXT-1',
            externalSku: 'SKU-001',
        };

        it('creates mapping by SKU match and emits MAPPING_CREATED audit', async () => {
            prisma.productChannelMapping.findFirst.mockResolvedValue(null);
            prisma.product.findFirst.mockResolvedValue(ACTIVE_PRODUCT);
            prisma.productChannelMapping.create.mockResolvedValue({ ...MAPPING_WB, isAutoMatched: true, product: ACTIVE_PRODUCT });

            const result = await service.autoMatch(dto, TENANT, ACTOR, USER_ID);

            expect(result.matched).toBe(true);
            expect(result.alreadyExisted).toBe(false);
            expect(auditService.logAction).toHaveBeenCalledWith(
                expect.objectContaining({ actionType: ActionType.MAPPING_CREATED }),
            );
        });

        it('returns alreadyExisted=true without creating new mapping when mapping exists', async () => {
            prisma.productChannelMapping.findFirst.mockResolvedValue({
                ...MAPPING_WB,
                product: ACTIVE_PRODUCT,
            });

            const result = await service.autoMatch(dto, TENANT, ACTOR);

            expect(result.matched).toBe(true);
            expect(result.alreadyExisted).toBe(true);
            expect(prisma.productChannelMapping.create).not.toHaveBeenCalled();
            expect(auditService.logAction).not.toHaveBeenCalled();
        });

        it('returns matched=false when no internal product found for the SKU', async () => {
            prisma.productChannelMapping.findFirst.mockResolvedValue(null);
            prisma.product.findFirst.mockResolvedValue(null);

            const result = await service.autoMatch(dto, TENANT, ACTOR);

            expect(result.matched).toBe(false);
            expect(result.mapping).toBeNull();
        });

        it('logs auto_match_failed when no internal product found', async () => {
            prisma.productChannelMapping.findFirst.mockResolvedValue(null);
            prisma.product.findFirst.mockResolvedValue(null);

            await service.autoMatch(dto, TENANT, ACTOR);

            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"auto_match_failed"'),
            );
        });
    });

    // ─── deleteMapping ───────────────────────────────────────────────────────

    describe('deleteMapping', () => {
        it('deletes mapping and emits MAPPING_DELETED audit', async () => {
            prisma.productChannelMapping.findUnique.mockResolvedValue(MAPPING_WB);
            prisma.productChannelMapping.delete.mockResolvedValue(MAPPING_WB);

            await service.deleteMapping(MAPPING_WB.id, TENANT, ACTOR);

            expect(prisma.productChannelMapping.delete).toHaveBeenCalledWith(
                expect.objectContaining({ where: { id: MAPPING_WB.id } }),
            );
            expect(auditService.logAction).toHaveBeenCalledWith(
                expect.objectContaining({ actionType: ActionType.MAPPING_DELETED }),
            );
        });

        it('throws MAPPING_NOT_FOUND for unknown mappingId', async () => {
            prisma.productChannelMapping.findUnique.mockResolvedValue(null);

            await expect(service.deleteMapping('ghost', TENANT, ACTOR))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'MAPPING_NOT_FOUND' }) });
        });

        it('throws MAPPING_NOT_FOUND when mapping belongs to another tenant', async () => {
            prisma.productChannelMapping.findUnique.mockResolvedValue({ ...MAPPING_WB, tenantId: 'other-tenant' });

            await expect(service.deleteMapping(MAPPING_WB.id, TENANT, ACTOR))
                .rejects.toThrow(NotFoundException);
        });
    });

    // ─── mergeProducts ───────────────────────────────────────────────────────

    describe('mergeProducts', () => {
        const dto = { sourceProductId: 'prod-1', targetProductId: 'prod-2' };

        it('transfers mappings from source to target, soft-deletes source, emits PRODUCT_MERGED audit', async () => {
            const sourceMapping = { ...MAPPING_WB, id: 'map-src', productId: 'prod-1' };
            prisma.product.findFirst
                .mockResolvedValueOnce(ACTIVE_PRODUCT)  // source
                .mockResolvedValueOnce(PRODUCT_B);       // target
            prisma.productChannelMapping.findMany
                .mockResolvedValueOnce([sourceMapping])  // source mappings
                .mockResolvedValueOnce([]);              // target mappings (no conflicts)
            prisma.productChannelMapping.update.mockResolvedValue({ ...sourceMapping, productId: 'prod-2' });
            prisma.product.update.mockResolvedValue({ ...ACTIVE_PRODUCT, deletedAt: new Date() });

            const result = await service.mergeProducts(dto, TENANT, ACTOR, USER_ID);

            expect(result.targetProductId).toBe(PRODUCT_B.id);
            expect(result.mappingsTransferred).toBe(1);
            expect(result.mappingsSkipped).toBe(0);
            expect(auditService.logAction).toHaveBeenCalledWith(
                expect.objectContaining({ actionType: ActionType.PRODUCT_MERGED }),
            );
            expect(prisma.product.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ status: ProductStatus.DELETED }) }),
            );
        });

        it('skips conflicting mappings (same marketplace+externalProductId) without error', async () => {
            const sourceMapping = { ...MAPPING_WB, id: 'map-src', productId: 'prod-1' };
            const targetMapping = { ...MAPPING_WB, id: 'map-tgt', productId: 'prod-2' };
            prisma.product.findFirst
                .mockResolvedValueOnce(ACTIVE_PRODUCT)
                .mockResolvedValueOnce(PRODUCT_B);
            prisma.productChannelMapping.findMany
                .mockResolvedValueOnce([sourceMapping])  // source has mapping
                .mockResolvedValueOnce([targetMapping]);  // target already has same mapping → conflict
            prisma.product.update.mockResolvedValue({ ...ACTIVE_PRODUCT, deletedAt: new Date() });

            const result = await service.mergeProducts(dto, TENANT, ACTOR);

            expect(result.mappingsTransferred).toBe(0);
            expect(result.mappingsSkipped).toBe(1);
            expect(prisma.productChannelMapping.update).not.toHaveBeenCalled();
        });

        it('throws MERGE_SAME_PRODUCT when source and target are identical', async () => {
            await expect(
                service.mergeProducts({ sourceProductId: 'prod-1', targetProductId: 'prod-1' }, TENANT, ACTOR),
            ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'MERGE_SAME_PRODUCT' }) });
        });

        it('throws SOURCE_PRODUCT_NOT_FOUND when source does not exist', async () => {
            prisma.product.findFirst
                .mockResolvedValueOnce(null)       // source not found
                .mockResolvedValueOnce(PRODUCT_B); // target exists

            await expect(service.mergeProducts(dto, TENANT, ACTOR))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'SOURCE_PRODUCT_NOT_FOUND' }) });
        });

        it('throws TARGET_PRODUCT_NOT_FOUND when target does not exist', async () => {
            prisma.product.findFirst
                .mockResolvedValueOnce(ACTIVE_PRODUCT) // source exists
                .mockResolvedValueOnce(null);          // target not found

            await expect(service.mergeProducts(dto, TENANT, ACTOR))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'TARGET_PRODUCT_NOT_FOUND' }) });
        });

        it('logs product_merge_completed with transfer stats', async () => {
            prisma.product.findFirst
                .mockResolvedValueOnce(ACTIVE_PRODUCT)
                .mockResolvedValueOnce(PRODUCT_B);
            prisma.productChannelMapping.findMany
                .mockResolvedValueOnce([])  // source has no mappings
                .mockResolvedValueOnce([]); // target has no mappings
            prisma.product.update.mockResolvedValue({ ...ACTIVE_PRODUCT, deletedAt: new Date() });

            await service.mergeProducts(dto, TENANT, ACTOR);

            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"product_merge_completed"'),
            );
        });
    });

    // ─── getUnmatched ────────────────────────────────────────────────────────

    describe('getUnmatched', () => {
        it('returns active products that have no mappings at all', async () => {
            prisma.productChannelMapping.findMany.mockResolvedValue([]);
            prisma.product.findMany.mockResolvedValue([ACTIVE_PRODUCT]);
            prisma.product.count.mockResolvedValue(1);

            const result = await service.getUnmatched(TENANT);

            expect(result.data).toHaveLength(1);
            expect(result.meta.total).toBe(1);
        });

        it('excludes products that already have at least one mapping', async () => {
            prisma.productChannelMapping.findMany.mockResolvedValue([{ productId: 'prod-1' }]);
            prisma.product.findMany.mockResolvedValue([]);
            prisma.product.count.mockResolvedValue(0);

            const result = await service.getUnmatched(TENANT);

            expect(result.data).toHaveLength(0);
        });
    });
});
