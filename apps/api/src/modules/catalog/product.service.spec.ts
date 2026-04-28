import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { ProductService } from './product.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { ActionType, ProductStatus, ProductSourceOfTruth } from '@prisma/client';

jest.mock('@prisma/client', () => {
    class PrismaClient {}
    return {
        PrismaClient,
        ProductStatus:        { ACTIVE: 'ACTIVE', DELETED: 'DELETED' },
        ProductSourceOfTruth: { MANUAL: 'MANUAL', IMPORT: 'IMPORT', SYNC: 'SYNC' },
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
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            findMany: jest.fn(),
            count: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
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
    tenantId: TENANT,
    sku: 'SKU-001',
    name: 'Product A',
    brand: null,
    barcode: null,
    mainImageFileId: null,
    photo: null,
    total: 10,
    reserved: 0,
    wbBarcode: null,
    deletedAt: null,
    status: ProductStatus.ACTIVE,
    sourceOfTruth: ProductSourceOfTruth.MANUAL,
    createdBy: null,
    updatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
};

const DELETED_PRODUCT = {
    ...ACTIVE_PRODUCT,
    id: 'prod-del',
    deletedAt: new Date('2026-01-01'),
    status: ProductStatus.DELETED,
};

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('ProductService', () => {
    let service: ProductService;
    let prisma: ReturnType<typeof makePrismaMock>;
    let auditService: jest.Mocked<Pick<AuditService, 'logAction'>>;
    let logSpy: jest.SpyInstance;

    beforeEach(async () => {
        prisma = makePrismaMock();
        auditService = { logAction: jest.fn().mockResolvedValue({}) };

        const module = await Test.createTestingModule({
            providers: [
                ProductService,
                { provide: PrismaService, useValue: prisma },
                { provide: AuditService, useValue: auditService },
                {
                    provide: OnboardingService,
                    useValue: { markStepDone: jest.fn().mockResolvedValue(undefined) },
                },
            ],
        }).compile();

        service = module.get(ProductService);
        logSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    });

    afterEach(() => jest.clearAllMocks());

    // ─── create ─────────────────────────────────────────────────────────────

    describe('create', () => {
        const dto = { sku: 'SKU-NEW', name: 'New Product' };

        it('creates a new product and emits PRODUCT_CREATED audit', async () => {
            prisma.product.findFirst.mockResolvedValue(null);
            prisma.product.create.mockResolvedValue({ ...ACTIVE_PRODUCT, id: 'prod-new', sku: dto.sku, name: dto.name });

            const result = await service.create(dto as any, null, ACTOR, TENANT, USER_ID);

            expect(result.sku).toBe(dto.sku);
            expect(auditService.logAction).toHaveBeenCalledWith(
                expect.objectContaining({ actionType: ActionType.PRODUCT_CREATED, tenantId: TENANT }),
            );
        });

        it('throws SKU_ALREADY_EXISTS for an active product with the same SKU', async () => {
            prisma.product.findFirst.mockResolvedValue(ACTIVE_PRODUCT);

            await expect(service.create(dto as any, null, ACTOR, TENANT))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'SKU_ALREADY_EXISTS' }) });

            expect(auditService.logAction).not.toHaveBeenCalled();
        });

        it('throws SKU_SOFT_DELETED when soft-deleted product exists and no confirmRestoreId provided', async () => {
            prisma.product.findFirst.mockResolvedValue(DELETED_PRODUCT);

            await expect(service.create({ sku: 'SKU-001', name: 'X' } as any, null, ACTOR, TENANT))
                .rejects.toMatchObject({
                    response: expect.objectContaining({
                        code: 'SKU_SOFT_DELETED',
                        deletedProductId: DELETED_PRODUCT.id,
                    }),
                });
        });

        it('throws CONFIRM_RESTORE_ID_MISMATCH when confirmRestoreId does not match deleted product id', async () => {
            prisma.product.findFirst.mockResolvedValue(DELETED_PRODUCT);

            await expect(
                service.create({ sku: 'SKU-001', name: 'X', confirmRestoreId: 'wrong-id' } as any, null, ACTOR, TENANT),
            ).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'CONFIRM_RESTORE_ID_MISMATCH' }),
            });
        });

        it('restores soft-deleted product and emits PRODUCT_RESTORED when confirmRestoreId matches', async () => {
            prisma.product.findFirst.mockResolvedValue(DELETED_PRODUCT);
            prisma.product.update.mockResolvedValue({
                ...ACTIVE_PRODUCT,
                id: DELETED_PRODUCT.id,
                deletedAt: null,
                status: ProductStatus.ACTIVE,
            });

            const result = await service.create(
                { sku: 'SKU-001', name: 'Restored', confirmRestoreId: DELETED_PRODUCT.id } as any,
                null,
                ACTOR,
                TENANT,
                USER_ID,
            );

            expect(result.status).toBe(ProductStatus.ACTIVE);
            expect(auditService.logAction).toHaveBeenCalledWith(
                expect.objectContaining({ actionType: ActionType.PRODUCT_RESTORED }),
            );
        });
    });

    // ─── update ─────────────────────────────────────────────────────────────

    describe('update', () => {
        beforeEach(() => {
            prisma.product.findUnique.mockResolvedValue(ACTIVE_PRODUCT);
        });

        it('updates product and emits PRODUCT_UPDATED audit', async () => {
            const updated = { ...ACTIVE_PRODUCT, name: 'Updated Name', sourceOfTruth: ProductSourceOfTruth.MANUAL };
            prisma.product.update.mockResolvedValue(updated);

            const result = await service.update(ACTIVE_PRODUCT.id, { name: 'Updated Name' } as any, null, ACTOR, TENANT, USER_ID);

            expect(result.name).toBe('Updated Name');
            expect(auditService.logAction).toHaveBeenCalledWith(
                expect.objectContaining({ actionType: ActionType.PRODUCT_UPDATED }),
            );
        });

        it('throws SKU_ALREADY_EXISTS when changing to a SKU that belongs to another product', async () => {
            prisma.product.findFirst.mockResolvedValue({ ...ACTIVE_PRODUCT, id: 'prod-other' });

            await expect(
                service.update(ACTIVE_PRODUCT.id, { sku: 'SKU-OTHER' } as any, null, ACTOR, TENANT),
            ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'SKU_ALREADY_EXISTS' }) });

            expect(auditService.logAction).not.toHaveBeenCalled();
        });

        it('allows updating with the same SKU (no conflict check)', async () => {
            const updated = { ...ACTIVE_PRODUCT };
            prisma.product.update.mockResolvedValue(updated);

            await expect(
                service.update(ACTIVE_PRODUCT.id, { sku: ACTIVE_PRODUCT.sku } as any, null, ACTOR, TENANT),
            ).resolves.not.toThrow();
        });
    });

    // ─── remove (soft delete) ────────────────────────────────────────────────

    describe('remove', () => {
        it('soft-deletes active product and emits PRODUCT_DELETED audit', async () => {
            prisma.product.findUnique.mockResolvedValue(ACTIVE_PRODUCT);
            prisma.product.update.mockResolvedValue({ ...ACTIVE_PRODUCT, deletedAt: new Date(), status: ProductStatus.DELETED });

            await service.remove(ACTIVE_PRODUCT.id, ACTOR, TENANT, USER_ID);

            expect(prisma.product.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ status: ProductStatus.DELETED }) }),
            );
            expect(auditService.logAction).toHaveBeenCalledWith(
                expect.objectContaining({ actionType: ActionType.PRODUCT_DELETED }),
            );
        });

        it('throws PRODUCT_NOT_FOUND for unknown product', async () => {
            prisma.product.findUnique.mockResolvedValue(null);

            await expect(service.remove('ghost', ACTOR, TENANT))
                .rejects.toThrow(NotFoundException);
        });

        it('throws PRODUCT_NOT_FOUND when accessing another tenant\'s product', async () => {
            prisma.product.findUnique.mockResolvedValue({ ...ACTIVE_PRODUCT, tenantId: 'other-tenant' });

            await expect(service.remove(ACTIVE_PRODUCT.id, ACTOR, TENANT))
                .rejects.toThrow(NotFoundException);
        });
    });

    // ─── restore ────────────────────────────────────────────────────────────

    describe('restore', () => {
        it('restores deleted product and emits PRODUCT_RESTORED audit', async () => {
            prisma.product.findUnique.mockResolvedValue(DELETED_PRODUCT);
            prisma.product.update.mockResolvedValue({ ...ACTIVE_PRODUCT, deletedAt: null, status: ProductStatus.ACTIVE });

            const result = await service.restore(DELETED_PRODUCT.id, ACTOR, TENANT, USER_ID);

            expect(result.status).toBe(ProductStatus.ACTIVE);
            expect(auditService.logAction).toHaveBeenCalledWith(
                expect.objectContaining({ actionType: ActionType.PRODUCT_RESTORED }),
            );
        });

        it('throws PRODUCT_ALREADY_ACTIVE when product is not deleted', async () => {
            prisma.product.findUnique.mockResolvedValue(ACTIVE_PRODUCT);

            await expect(service.restore(ACTIVE_PRODUCT.id, ACTOR, TENANT))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'PRODUCT_ALREADY_ACTIVE' }) });
        });

        it('throws PRODUCT_NOT_FOUND for unknown product', async () => {
            prisma.product.findUnique.mockResolvedValue(null);

            await expect(service.restore('ghost', ACTOR, TENANT))
                .rejects.toThrow(NotFoundException);
        });
    });

    // ─── findAll ─────────────────────────────────────────────────────────────

    describe('findAll', () => {
        it('returns active products by default with pagination meta', async () => {
            prisma.product.findMany.mockResolvedValue([ACTIVE_PRODUCT]);
            prisma.product.count.mockResolvedValue(1);

            const result = await service.findAll(TENANT, 1, 20);

            expect(prisma.product.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: expect.objectContaining({ status: ProductStatus.ACTIVE }) }),
            );
            expect(result.meta.total).toBe(1);
        });

        it('filters by status=deleted to show archived products', async () => {
            prisma.product.findMany.mockResolvedValue([DELETED_PRODUCT]);
            prisma.product.count.mockResolvedValue(1);

            await service.findAll(TENANT, 1, 20, undefined, 'deleted');

            expect(prisma.product.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: expect.objectContaining({ status: ProductStatus.DELETED }) }),
            );
        });

        it('applies search filter across name, sku and brand', async () => {
            prisma.product.findMany.mockResolvedValue([]);
            prisma.product.count.mockResolvedValue(0);

            await service.findAll(TENANT, 1, 20, 'Nike');

            expect(prisma.product.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ OR: expect.arrayContaining([expect.objectContaining({ name: expect.objectContaining({ contains: 'Nike' }) })]) }),
                }),
            );
        });
    });

    // ─── importFromWb (source-of-change policy) ──────────────────────────────

    describe('importFromWb — source-of-change policy', () => {
        it('skips MANUAL-sourced products and logs sync_source_conflict_skipped', async () => {
            prisma.product.findFirst.mockResolvedValue({
                ...ACTIVE_PRODUCT,
                sourceOfTruth: ProductSourceOfTruth.MANUAL,
            });

            const result = await service.importFromWb(
                [{ sku: 'SKU-001', name: 'Updated from WB' }],
                ACTOR,
                TENANT,
            );

            expect(result.skipped).toBe(1);
            expect(result.updated).toBe(0);
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"sync_source_conflict_skipped"'),
            );
        });

        it('skips IMPORT-sourced products (only SYNC may be overwritten by sync layer)', async () => {
            prisma.product.findFirst.mockResolvedValue({
                ...ACTIVE_PRODUCT,
                sourceOfTruth: ProductSourceOfTruth.IMPORT,
            });

            const result = await service.importFromWb(
                [{ sku: 'SKU-001', name: 'Updated from WB' }],
                ACTOR,
                TENANT,
            );

            expect(result.skipped).toBe(1);
        });

        it('updates SYNC-sourced products without conflict', async () => {
            prisma.product.findFirst.mockResolvedValue({
                ...ACTIVE_PRODUCT,
                sourceOfTruth: ProductSourceOfTruth.SYNC,
            });
            prisma.product.update.mockResolvedValue({ ...ACTIVE_PRODUCT, name: 'Updated from WB' });

            const result = await service.importFromWb(
                [{ sku: 'SKU-001', name: 'Updated from WB' }],
                ACTOR,
                TENANT,
            );

            expect(result.updated).toBe(1);
            expect(result.skipped).toBe(0);
        });

        it('creates new product for unknown SKU via sync', async () => {
            prisma.product.findFirst.mockResolvedValue(null);
            prisma.product.create.mockResolvedValue({ ...ACTIVE_PRODUCT, sku: 'SKU-NEW', sourceOfTruth: ProductSourceOfTruth.SYNC });

            const result = await service.importFromWb(
                [{ sku: 'SKU-NEW', name: 'Brand New' }],
                ACTOR,
                TENANT,
            );

            expect(result.created).toBe(1);
        });
    });

    // ─── Observability: audit events ─────────────────────────────────────────

    describe('observability: audit events are emitted for all write operations', () => {
        const dto = { sku: 'SKU-OBS', name: 'Obs Product' };

        it('emits PRODUCT_CREATED on create', async () => {
            prisma.product.findFirst.mockResolvedValue(null);
            prisma.product.create.mockResolvedValue({ ...ACTIVE_PRODUCT });
            await service.create(dto as any, null, ACTOR, TENANT);
            expect(auditService.logAction).toHaveBeenCalledWith(
                expect.objectContaining({ actionType: ActionType.PRODUCT_CREATED }),
            );
        });

        it('emits PRODUCT_RESTORED on create with confirmRestoreId', async () => {
            prisma.product.findFirst.mockResolvedValue(DELETED_PRODUCT);
            prisma.product.update.mockResolvedValue({ ...ACTIVE_PRODUCT, deletedAt: null });
            await service.create({ ...dto, confirmRestoreId: DELETED_PRODUCT.id } as any, null, ACTOR, TENANT);
            expect(auditService.logAction).toHaveBeenCalledWith(
                expect.objectContaining({ actionType: ActionType.PRODUCT_RESTORED }),
            );
        });

        it('emits PRODUCT_UPDATED on update', async () => {
            prisma.product.findUnique.mockResolvedValue(ACTIVE_PRODUCT);
            prisma.product.update.mockResolvedValue(ACTIVE_PRODUCT);
            await service.update(ACTIVE_PRODUCT.id, { name: 'Updated' } as any, null, ACTOR, TENANT);
            expect(auditService.logAction).toHaveBeenCalledWith(
                expect.objectContaining({ actionType: ActionType.PRODUCT_UPDATED }),
            );
        });

        it('emits PRODUCT_DELETED on remove', async () => {
            prisma.product.findUnique.mockResolvedValue(ACTIVE_PRODUCT);
            prisma.product.update.mockResolvedValue({ ...ACTIVE_PRODUCT, deletedAt: new Date() });
            await service.remove(ACTIVE_PRODUCT.id, ACTOR, TENANT);
            expect(auditService.logAction).toHaveBeenCalledWith(
                expect.objectContaining({ actionType: ActionType.PRODUCT_DELETED }),
            );
        });

        it('emits PRODUCT_RESTORED on restore endpoint', async () => {
            prisma.product.findUnique.mockResolvedValue(DELETED_PRODUCT);
            prisma.product.update.mockResolvedValue({ ...ACTIVE_PRODUCT, deletedAt: null });
            await service.restore(DELETED_PRODUCT.id, ACTOR, TENANT);
            expect(auditService.logAction).toHaveBeenCalledWith(
                expect.objectContaining({ actionType: ActionType.PRODUCT_RESTORED }),
            );
        });
    });
});
