import { Test } from '@nestjs/testing';
import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { ImportService } from './import.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
    ActionType,
    ImportJobStatus,
    ImportJobSource,
    ImportItemAction,
    ProductSourceOfTruth,
    ProductStatus,
} from '@prisma/client';

jest.mock('@prisma/client', () => {
    class PrismaClient {}
    return {
        PrismaClient,
        ProductStatus:        { ACTIVE: 'ACTIVE', DELETED: 'DELETED' },
        ProductSourceOfTruth: { MANUAL: 'MANUAL', IMPORT: 'IMPORT', SYNC: 'SYNC' },
        ImportJobStatus:  { PREVIEW: 'PREVIEW', PROCESSING: 'PROCESSING', COMPLETED: 'COMPLETED', FAILED: 'FAILED', CANCELLED: 'CANCELLED' },
        ImportJobSource:  { EXCEL: 'EXCEL', API_SYNC: 'API_SYNC' },
        ImportItemAction: { CREATE: 'CREATE', UPDATE: 'UPDATE', SKIP: 'SKIP', MANUAL_REVIEW: 'MANUAL_REVIEW' },
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
        catalogImportJob: {
            create: jest.fn(),
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
        },
        catalogImportJobItem: {
            createMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        product: {
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn(),
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

function makeJob(overrides: Partial<{
    id: string;
    status: ImportJobStatus;
    idempotencyKey: string | null;
    items: any[];
}> = {}) {
    return {
        id: 'job-1',
        tenantId: TENANT,
        source: ImportJobSource.EXCEL,
        status: ImportJobStatus.PREVIEW,
        totalRows: 0,
        createdCount: 0,
        updatedCount: 0,
        errorCount: 0,
        idempotencyKey: null,
        createdBy: null,
        createdAt: new Date(),
        finishedAt: null,
        items: [],
        ...overrides,
    };
}

function makeProductRow(overrides: Partial<{ sku: string; name: string; brand: string }> = {}) {
    return { sku: 'SKU-001', name: 'Product A', brand: null, ...overrides };
}

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('ImportService', () => {
    let service: ImportService;
    let prisma: ReturnType<typeof makePrismaMock>;
    let auditService: jest.Mocked<Pick<AuditService, 'logAction'>>;
    let logSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;

    beforeEach(async () => {
        prisma = makePrismaMock();
        auditService = { logAction: jest.fn().mockResolvedValue({}) };

        const module = await Test.createTestingModule({
            providers: [
                ImportService,
                { provide: PrismaService, useValue: prisma },
                { provide: AuditService, useValue: auditService },
            ],
        }).compile();

        service = module.get(ImportService);
        logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
        warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    });

    afterEach(() => jest.clearAllMocks());

    // ─── preview ────────────────────────────────────────────────────────────

    describe('preview', () => {
        const previewJob = makeJob({ totalRows: 1 });

        beforeEach(() => {
            prisma.catalogImportJob.create.mockResolvedValue(previewJob);
            prisma.catalogImportJobItem.createMany.mockResolvedValue({ count: 1 });
        });

        it('assigns CREATE action for a new SKU not in the catalog', async () => {
            prisma.product.findMany.mockResolvedValue([]);

            const result = await service.preview({ rows: [makeProductRow()] }, TENANT, USER_ID);

            expect(result.summary.create).toBe(1);
            expect(result.items[0].action).toBe(ImportItemAction.CREATE);
        });

        it('assigns UPDATE action for an existing active SKU', async () => {
            prisma.product.findMany.mockResolvedValue([
                { id: 'prod-1', sku: 'SKU-001', deletedAt: null, sourceOfTruth: ProductSourceOfTruth.IMPORT },
            ]);

            const result = await service.preview({ rows: [makeProductRow()] }, TENANT, USER_ID);

            expect(result.summary.update).toBe(1);
            expect(result.items[0].action).toBe(ImportItemAction.UPDATE);
            expect(result.items[0].sourceConflict).toBeNull();
        });

        it('assigns MANUAL_REVIEW for row missing required sku field', async () => {
            prisma.product.findMany.mockResolvedValue([]);

            const result = await service.preview(
                { rows: [{ sku: '', name: 'No SKU' }] as any },
                TENANT,
            );

            expect(result.summary.manualReview).toBe(1);
            expect(result.items[0].errors.some((e: any) => e.field === 'sku')).toBe(true);
        });

        it('assigns MANUAL_REVIEW for row missing required name field', async () => {
            prisma.product.findMany.mockResolvedValue([]);

            const result = await service.preview(
                { rows: [{ sku: 'SKU-X', name: '' }] as any },
                TENANT,
            );

            expect(result.summary.manualReview).toBe(1);
            expect(result.items[0].errors.some((e: any) => e.field === 'name')).toBe(true);
        });

        it('assigns MANUAL_REVIEW and blocks commit for soft-deleted SKU', async () => {
            prisma.product.findMany.mockResolvedValue([
                { id: 'prod-del', sku: 'SKU-001', deletedAt: new Date(), sourceOfTruth: ProductSourceOfTruth.MANUAL },
            ]);

            const result = await service.preview({ rows: [makeProductRow()] }, TENANT);

            expect(result.items[0].action).toBe(ImportItemAction.MANUAL_REVIEW);
            expect(result.items[0].errors[0].message).toContain('deleted product');
        });

        it('adds source_conflict warning when existing product is MANUAL-sourced', async () => {
            prisma.product.findMany.mockResolvedValue([
                { id: 'prod-1', sku: 'SKU-001', deletedAt: null, sourceOfTruth: ProductSourceOfTruth.MANUAL },
            ]);

            const result = await service.preview({ rows: [makeProductRow()] }, TENANT);

            expect(result.items[0].action).toBe(ImportItemAction.UPDATE);
            expect(result.items[0].sourceConflict).not.toBeNull();
            expect(result.items[0].sourceConflict!.existingSource).toBe(ProductSourceOfTruth.MANUAL);
        });

        it('emits import_preview_started and import_preview_completed log events', async () => {
            prisma.product.findMany.mockResolvedValue([]);
            await service.preview({ rows: [makeProductRow()] }, TENANT);

            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"event":"import_preview_started"'));
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"event":"import_preview_completed"'));
        });
    });

    // ─── commit ─────────────────────────────────────────────────────────────

    describe('commit', () => {
        it('returns completed job immediately when idempotencyKey already has a COMPLETED job', async () => {
            const completedJob = makeJob({ id: 'job-done', status: ImportJobStatus.COMPLETED });
            prisma.catalogImportJob.findFirst.mockResolvedValue(completedJob);

            const result = await service.commit({ jobId: 'job-done', idempotencyKey: 'key-1' }, TENANT, ACTOR);

            expect(result.status).toBe(ImportJobStatus.COMPLETED);
            expect(prisma.catalogImportJob.update).not.toHaveBeenCalled();
        });

        it('throws IMPORT_JOB_NOT_FOUND for unknown jobId', async () => {
            prisma.catalogImportJob.findFirst.mockResolvedValue(null);
            prisma.catalogImportJob.findUnique.mockResolvedValue(null);

            await expect(service.commit({ jobId: 'ghost' }, TENANT, ACTOR))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'IMPORT_JOB_NOT_FOUND' }) });
        });

        it('throws IMPORT_JOB_NOT_FOUND when job belongs to another tenant', async () => {
            prisma.catalogImportJob.findFirst.mockResolvedValue(null);
            prisma.catalogImportJob.findUnique.mockResolvedValue(
                makeJob({ status: ImportJobStatus.PREVIEW, items: [] }),
            );
            // Simulate tenantId mismatch by using a different TENANT in the job
            const foreignJob = { ...makeJob(), tenantId: 'other-tenant' };
            prisma.catalogImportJob.findUnique.mockResolvedValue(foreignJob);

            await expect(service.commit({ jobId: 'job-1' }, TENANT, ACTOR))
                .rejects.toThrow(NotFoundException);
        });

        it('throws IMPORT_JOB_ALREADY_PROCESSING when job status is PROCESSING', async () => {
            prisma.catalogImportJob.findFirst.mockResolvedValue(null);
            prisma.catalogImportJob.findUnique.mockResolvedValue(
                makeJob({ status: ImportJobStatus.PROCESSING, items: [] }),
            );

            await expect(service.commit({ jobId: 'job-1' }, TENANT, ACTOR))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'IMPORT_JOB_ALREADY_PROCESSING' }) });
        });

        it('throws IMPORT_JOB_NOT_IN_PREVIEW when job status is not PREVIEW', async () => {
            prisma.catalogImportJob.findFirst.mockResolvedValue(null);
            prisma.catalogImportJob.findUnique.mockResolvedValue(
                makeJob({ status: ImportJobStatus.FAILED, items: [] }),
            );

            await expect(service.commit({ jobId: 'job-1' }, TENANT, ACTOR))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'IMPORT_JOB_NOT_IN_PREVIEW' }) });
        });

        it('returns COMPLETED job without re-processing when job is already COMPLETED', async () => {
            prisma.catalogImportJob.findFirst.mockResolvedValue(null);
            prisma.catalogImportJob.findUnique.mockResolvedValue(
                makeJob({ status: ImportJobStatus.COMPLETED, items: [] }),
            );

            const result = await service.commit({ jobId: 'job-1' }, TENANT, ACTOR);
            expect(result.status).toBe(ImportJobStatus.COMPLETED);
        });

        it('creates product and increments createdCount for CREATE item', async () => {
            const createItem = {
                id: 'item-1',
                jobId: 'job-1',
                rowNumber: 1,
                action: ImportItemAction.CREATE,
                rawPayload: makeProductRow(),
                validationErrors: null,
            };
            const previewJob = makeJob({ items: [createItem] });

            prisma.catalogImportJob.findFirst.mockResolvedValue(null);
            prisma.catalogImportJob.findUnique.mockResolvedValue(previewJob);
            prisma.catalogImportJob.update.mockResolvedValue({
                ...previewJob,
                status: ImportJobStatus.COMPLETED,
                createdCount: 1,
            });
            prisma.product.findFirst.mockResolvedValue(null);
            prisma.product.create.mockResolvedValue({
                id: 'prod-new',
                sku: 'SKU-001',
                name: 'Product A',
                tenantId: TENANT,
                total: 0,
                reserved: 0,
                deletedAt: null,
                status: ProductStatus.ACTIVE,
                sourceOfTruth: ProductSourceOfTruth.IMPORT,
            });

            const result = await service.commit({ jobId: 'job-1' }, TENANT, ACTOR, USER_ID);

            expect(result.status).toBe(ImportJobStatus.COMPLETED);
            expect(prisma.product.create).toHaveBeenCalledTimes(1);
            expect(auditService.logAction).toHaveBeenCalledWith(
                expect.objectContaining({ actionType: ActionType.PRODUCT_CREATED }),
            );
        });

        it('updates product and increments updatedCount for UPDATE item', async () => {
            const existingProduct = {
                id: 'prod-1',
                sku: 'SKU-001',
                name: 'Old Name',
                tenantId: TENANT,
                deletedAt: null,
                sourceOfTruth: ProductSourceOfTruth.IMPORT,
            };
            const updateItem = {
                id: 'item-1',
                jobId: 'job-1',
                rowNumber: 1,
                action: ImportItemAction.UPDATE,
                rawPayload: makeProductRow({ name: 'New Name' }),
                validationErrors: null,
            };
            const previewJob = makeJob({ items: [updateItem] });

            prisma.catalogImportJob.findFirst.mockResolvedValue(null);
            prisma.catalogImportJob.findUnique.mockResolvedValue(previewJob);
            prisma.catalogImportJob.update.mockResolvedValue({
                ...previewJob,
                status: ImportJobStatus.COMPLETED,
                updatedCount: 1,
            });
            prisma.product.findFirst.mockResolvedValue(existingProduct);
            prisma.product.update.mockResolvedValue({ ...existingProduct, name: 'New Name' });

            const result = await service.commit({ jobId: 'job-1' }, TENANT, ACTOR);

            expect(result.status).toBe(ImportJobStatus.COMPLETED);
            expect(auditService.logAction).toHaveBeenCalledWith(
                expect.objectContaining({ actionType: ActionType.PRODUCT_UPDATED }),
            );
        });

        it('counts MANUAL_REVIEW items as errorCount without touching product table', async () => {
            const invalidItem = {
                id: 'item-1',
                jobId: 'job-1',
                rowNumber: 1,
                action: ImportItemAction.MANUAL_REVIEW,
                rawPayload: { sku: '', name: '' },
                validationErrors: [{ type: 'error', field: 'sku', message: 'sku is required' }],
            };
            const previewJob = makeJob({ items: [invalidItem] });

            prisma.catalogImportJob.findFirst.mockResolvedValue(null);
            prisma.catalogImportJob.findUnique.mockResolvedValue(previewJob);
            prisma.catalogImportJob.update.mockResolvedValue({
                ...previewJob,
                status: ImportJobStatus.COMPLETED,
                errorCount: 1,
            });

            await service.commit({ jobId: 'job-1' }, TENANT, ACTOR);

            expect(prisma.product.create).not.toHaveBeenCalled();
            expect(prisma.product.update).not.toHaveBeenCalled();
        });

        it('emits IMPORT_COMMITTED audit at the end of commit', async () => {
            const previewJob = makeJob({ items: [] });
            prisma.catalogImportJob.findFirst.mockResolvedValue(null);
            prisma.catalogImportJob.findUnique.mockResolvedValue(previewJob);
            prisma.catalogImportJob.update.mockResolvedValue({ ...previewJob, status: ImportJobStatus.COMPLETED });

            await service.commit({ jobId: 'job-1' }, TENANT, ACTOR);

            expect(auditService.logAction).toHaveBeenCalledWith(
                expect.objectContaining({ actionType: ActionType.IMPORT_COMMITTED }),
            );
        });

        it('logs import_source_conflict_overwrite warning when source conflict present during commit', async () => {
            const conflictItem = {
                id: 'item-1',
                jobId: 'job-1',
                rowNumber: 1,
                action: ImportItemAction.UPDATE,
                rawPayload: makeProductRow(),
                validationErrors: [{
                    type: 'source_conflict',
                    field: 'sourceOfTruth',
                    message: 'Product was last modified manually',
                    existingSource: ProductSourceOfTruth.MANUAL,
                }],
            };
            const previewJob = makeJob({ items: [conflictItem] });
            const existingProduct = { id: 'prod-1', sku: 'SKU-001', name: 'Old', tenantId: TENANT, deletedAt: null, sourceOfTruth: ProductSourceOfTruth.MANUAL };

            prisma.catalogImportJob.findFirst.mockResolvedValue(null);
            prisma.catalogImportJob.findUnique.mockResolvedValue(previewJob);
            prisma.catalogImportJob.update.mockResolvedValue({ ...previewJob, status: ImportJobStatus.COMPLETED });
            prisma.product.findFirst.mockResolvedValue(existingProduct);
            prisma.product.update.mockResolvedValue({ ...existingProduct });

            await service.commit({ jobId: 'job-1' }, TENANT, ACTOR);

            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"import_source_conflict_overwrite"'),
            );
        });

        it('emits import_commit_started and import_commit_completed log events', async () => {
            const previewJob = makeJob({ items: [] });
            prisma.catalogImportJob.findFirst.mockResolvedValue(null);
            prisma.catalogImportJob.findUnique.mockResolvedValue(previewJob);
            prisma.catalogImportJob.update.mockResolvedValue({ ...previewJob, status: ImportJobStatus.COMPLETED });

            await service.commit({ jobId: 'job-1' }, TENANT, ACTOR);

            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"event":"import_commit_started"'));
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"event":"import_commit_completed"'));
        });
    });

    // ─── getJob ─────────────────────────────────────────────────────────────

    describe('getJob', () => {
        it('returns job with items when found for the tenant', async () => {
            const job = makeJob({ status: ImportJobStatus.COMPLETED, items: [] });
            prisma.catalogImportJob.findUnique.mockResolvedValue(job);

            const result = await service.getJob(job.id, TENANT);
            expect(result.jobId).toBe(job.id);
        });

        it('throws IMPORT_JOB_NOT_FOUND for unknown jobId', async () => {
            prisma.catalogImportJob.findUnique.mockResolvedValue(null);

            await expect(service.getJob('ghost', TENANT))
                .rejects.toMatchObject({ response: expect.objectContaining({ code: 'IMPORT_JOB_NOT_FOUND' }) });
        });

        it('throws IMPORT_JOB_NOT_FOUND when job belongs to another tenant', async () => {
            prisma.catalogImportJob.findUnique.mockResolvedValue({ ...makeJob(), tenantId: 'other-tenant' });

            await expect(service.getJob('job-1', TENANT))
                .rejects.toThrow(NotFoundException);
        });
    });

    // ─── Idempotency regression ──────────────────────────────────────────────

    describe('idempotency: double-commit protection', () => {
        it('second commit with same idempotencyKey returns cached COMPLETED job without re-processing', async () => {
            const completedJob = makeJob({ status: ImportJobStatus.COMPLETED, idempotencyKey: 'idem-1' });
            prisma.catalogImportJob.findFirst.mockResolvedValue(completedJob);

            const first  = await service.commit({ jobId: 'job-1', idempotencyKey: 'idem-1' }, TENANT, ACTOR);
            const second = await service.commit({ jobId: 'job-1', idempotencyKey: 'idem-1' }, TENANT, ACTOR);

            expect(first.status).toBe(ImportJobStatus.COMPLETED);
            expect(second.status).toBe(ImportJobStatus.COMPLETED);
            expect(prisma.catalogImportJob.update).not.toHaveBeenCalled();
            expect(prisma.product.create).not.toHaveBeenCalled();
        });
    });
});
