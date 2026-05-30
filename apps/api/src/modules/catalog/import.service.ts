import {
    Injectable,
    Logger,
    NotFoundException,
    ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ImportPreviewDto, ImportRowDto } from './dto/import-preview.dto';
import { ImportCommitDto } from './dto/import-commit.dto';
import {
    ImportJobStatus,
    ImportJobSource,
    ImportItemAction,
    ProductSourceOfTruth,
    ProductStatus,
    Prisma,
} from '@prisma/client';
import { AUDIT_EVENTS } from '../audit/audit-event-catalog';

// Запись в validationErrors с type-дискриминатором.
// type='error'          → валидационная ошибка → action=MANUAL_REVIEW
// type='source_conflict' → предупреждение о перезаписи MANUAL-продукта → action=UPDATE
type ValidationEntry =
    | { type: 'error'; field: string; message: string }
    | { type: 'source_conflict'; field: string; message: string; existingSource: string };

type ResolvedItem = {
    action: ImportItemAction;
    entries: ValidationEntry[];
};

type ProductSnapshot = {
    id: string;
    sku: string;
    deletedAt: Date | null;
    sourceOfTruth: ProductSourceOfTruth;
};

@Injectable()
export class ImportService {
    private readonly logger = new Logger(ImportService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly auditService: AuditService,
    ) {}

    // ------------------------------------------------------------------
    // PREVIEW
    // ------------------------------------------------------------------

    async preview(dto: ImportPreviewDto, tenantId: string, userId?: string) {
        const job = await this.prisma.catalogImportJob.create({
            data: {
                tenantId,
                source: ImportJobSource.EXCEL,
                status: ImportJobStatus.PREVIEW,
                totalRows: dto.rows.length,
                createdBy: userId ?? null,
            },
        });

        this.logger.log(JSON.stringify({
            event: 'import_preview_started',
            jobId: job.id,
            totalRows: dto.rows.length,
            tenantId,
        }));

        // Батч-запрос существующих продуктов по SKU с sourceOfTruth для conflict detection
        const skus = dto.rows.map(r => r.sku).filter(Boolean);
        const existingProducts = await this.prisma.product.findMany({
            where: { tenantId, sku: { in: skus } },
            select: { id: true, sku: true, deletedAt: true, sourceOfTruth: true },
        });
        const skuMap = new Map<string, ProductSnapshot>(existingProducts.map(p => [p.sku, p]));

        const itemsData = dto.rows.map((row, idx) => {
            const { action, entries } = this._resolveAction(row, skuMap);
            const hasEntries = entries.length > 0;
            return {
                jobId: job.id,
                rowNumber: idx + 1,
                rawPayload: row as object,
                validationErrors: hasEntries ? entries : Prisma.JsonNull,
                action,
            };
        });

        await this.prisma.catalogImportJobItem.createMany({ data: itemsData });

        const summary = this._buildSummary(itemsData.map(i => i.action));

        this.logger.log(JSON.stringify({
            event: 'import_preview_completed',
            jobId: job.id,
            tenantId,
            summary,
            invalidRows: summary.manualReview,
        }));

        return {
            jobId: job.id,
            status: job.status,
            totalRows: job.totalRows,
            summary,
            items: itemsData.map((item, idx) => {
                const entries = (item.validationErrors ?? []) as ValidationEntry[];
                return {
                    rowNumber: item.rowNumber,
                    action: item.action,
                    raw: dto.rows[idx],
                    errors: entries.filter(e => e.type === 'error'),
                    sourceConflict: entries.find(e => e.type === 'source_conflict') ?? null,
                };
            }),
        };
    }

    // ------------------------------------------------------------------
    // COMMIT
    // ------------------------------------------------------------------

    async commit(dto: ImportCommitDto, tenantId: string, actorEmail: string, userId?: string) {
        // Idempotency: если есть ключ и уже есть COMPLETED-job с ним — вернуть его
        if (dto.idempotencyKey) {
            const done = await this.prisma.catalogImportJob.findFirst({
                where: { tenantId, idempotencyKey: dto.idempotencyKey, status: ImportJobStatus.COMPLETED },
            });
            if (done) return this._formatJob(done);
        }

        const job = await this.prisma.catalogImportJob.findUnique({
            where: { id: dto.jobId },
            include: { items: true },
        });

        if (!job || job.tenantId !== tenantId) {
            throw new NotFoundException({ code: 'IMPORT_JOB_NOT_FOUND' });
        }

        if (job.status === ImportJobStatus.COMPLETED) {
            return this._formatJob(job);
        }

        if (job.status === ImportJobStatus.PROCESSING) {
            throw new ConflictException({
                code: 'IMPORT_JOB_ALREADY_PROCESSING',
                message: 'Import job is already being processed',
            });
        }

        if (job.status !== ImportJobStatus.PREVIEW) {
            throw new ConflictException({
                code: 'IMPORT_JOB_NOT_IN_PREVIEW',
                message: `Import job status is ${job.status}, expected PREVIEW`,
            });
        }

        await this.prisma.catalogImportJob.update({
            where: { id: job.id },
            data: {
                status: ImportJobStatus.PROCESSING,
                idempotencyKey: dto.idempotencyKey ?? job.idempotencyKey,
            },
        });

        this.logger.log(JSON.stringify({
            event: 'import_commit_started',
            jobId: job.id,
            totalItems: job.items.length,
            tenantId,
        }));

        let createdCount = 0;
        let updatedCount = 0;
        let errorCount = 0;
        let sourceConflictCount = 0;

        for (const item of job.items) {
            if (item.action === ImportItemAction.MANUAL_REVIEW) {
                errorCount++;
                continue;
            }
            if (item.action === ImportItemAction.SKIP) {
                continue;
            }

            const row = item.rawPayload as unknown as ImportRowDto;

            // Проверяем source-conflict в stored entries (чтобы аудировать его при commit)
            const entries = (item.validationErrors ?? []) as ValidationEntry[];
            const hasSourceConflict = entries.some(e => e.type === 'source_conflict');

            if (hasSourceConflict) {
                this.logger.warn(JSON.stringify({
                    event: 'import_source_conflict_overwrite',
                    jobId: job.id,
                    sku: row.sku,
                    rowNumber: item.rowNumber,
                    tenantId,
                }));
            }

            try {
                if (item.action === ImportItemAction.CREATE) {
                    const result = await this._applyCreate(row, tenantId, actorEmail, userId, hasSourceConflict);
                    if (result === 'created') createdCount++;
                    else if (result === 'updated') updatedCount++;
                    else errorCount++;
                } else if (item.action === ImportItemAction.UPDATE) {
                    const result = await this._applyUpdate(row, tenantId, actorEmail, userId, hasSourceConflict);
                    if (result === 'updated') {
                        updatedCount++;
                        if (hasSourceConflict) sourceConflictCount++;
                    } else if (result === 'created') {
                        createdCount++;
                    } else {
                        errorCount++;
                    }
                }
            } catch {
                errorCount++;
            }
        }

        const completed = await this.prisma.catalogImportJob.update({
            where: { id: job.id },
            data: {
                status: ImportJobStatus.COMPLETED,
                createdCount,
                updatedCount,
                errorCount,
                finishedAt: new Date(),
            },
        });

        this.logger.log(JSON.stringify({
            event: 'import_commit_completed',
            jobId: job.id,
            tenantId,
            createdCount,
            updatedCount,
            errorCount,
            sourceConflictCount,
        }));

        if (errorCount > 0) {
            this.logger.warn(JSON.stringify({
                event: 'import_commit_has_errors',
                jobId: job.id,
                tenantId,
                errorCount,
            }));
        }

        // Сводный аудит на весь commit
        await this.auditService.writeEvent({
            tenantId,
            eventType: AUDIT_EVENTS.CATALOG_IMPORT_COMMITTED,
            actorType: 'user',
            actorId: userId,
            source: 'ui',
            metadata: {
                jobId: job.id,
                created: createdCount,
                updated: updatedCount,
                errors: errorCount,
                sourceConflicts: sourceConflictCount,
            },
        });

        return this._formatJob(completed);
    }

    // ------------------------------------------------------------------
    // GET JOB
    // ------------------------------------------------------------------

    async getJob(jobId: string, tenantId: string) {
        const job = await this.prisma.catalogImportJob.findUnique({
            where: { id: jobId },
            include: { items: true },
        });

        if (!job || job.tenantId !== tenantId) {
            throw new NotFoundException({ code: 'IMPORT_JOB_NOT_FOUND' });
        }

        return {
            ...this._formatJob(job),
            items: job.items.map(item => {
                const entries = (item.validationErrors ?? []) as ValidationEntry[];
                return {
                    rowNumber: item.rowNumber,
                    action: item.action,
                    raw: item.rawPayload,
                    errors: entries.filter(e => e.type === 'error'),
                    sourceConflict: entries.find(e => e.type === 'source_conflict') ?? null,
                };
            }),
        };
    }

    // ------------------------------------------------------------------
    // PRIVATE — resolve action
    // ------------------------------------------------------------------

    private _resolveAction(
        row: ImportRowDto,
        skuMap: Map<string, ProductSnapshot>,
    ): ResolvedItem {
        const entries: ValidationEntry[] = [];

        if (!row.sku) entries.push({ type: 'error', field: 'sku', message: 'sku is required' });
        if (!row.name) entries.push({ type: 'error', field: 'name', message: 'name is required' });

        if (entries.length > 0) {
            return { action: ImportItemAction.MANUAL_REVIEW, entries };
        }

        const existing = skuMap.get(row.sku);

        if (!existing) {
            return { action: ImportItemAction.CREATE, entries: [] };
        }

        if (existing.deletedAt) {
            return {
                action: ImportItemAction.MANUAL_REVIEW,
                entries: [{
                    type: 'error',
                    field: 'sku',
                    message: `SKU belongs to a deleted product (id: ${existing.id}). Use restore flow or create with confirmRestoreId.`,
                }],
            };
        }

        // Активный товар — action UPDATE.
        // Если он управляется вручную, добавляем source_conflict warning.
        if (existing.sourceOfTruth === ProductSourceOfTruth.MANUAL) {
            entries.push({
                type: 'source_conflict',
                field: 'sourceOfTruth',
                message: 'Product was last modified manually. Import will overwrite manual changes on commit.',
                existingSource: existing.sourceOfTruth,
            });
        }

        return { action: ImportItemAction.UPDATE, entries };
    }

    // ------------------------------------------------------------------
    // PRIVATE — apply CREATE
    // ------------------------------------------------------------------

    private async _applyCreate(
        row: ImportRowDto,
        tenantId: string,
        actorEmail: string,
        userId?: string,
        hasSourceConflict = false,
    ): Promise<'created' | 'updated' | 'skipped'> {
        const existing = await this.prisma.product.findFirst({
            where: { sku: row.sku, tenantId },
        });

        if (existing && !existing.deletedAt) {
            const note = hasSourceConflict
                ? `Import overwrote MANUAL product (source conflict) via import commit`
                : `Updated via import commit (product existed at commit time)`;

            await this.prisma.product.update({
                where: { id: existing.id },
                data: {
                    name: row.name,
                    brand: row.brand ?? existing.brand,
                    barcode: row.barcode ?? existing.barcode,
                    category: row.category ?? existing.category,
                    sourceOfTruth: ProductSourceOfTruth.IMPORT,
                    updatedBy: userId ?? null,
                },
            });

            await this.auditService.writeEvent({
                tenantId,
                eventType: AUDIT_EVENTS.PRODUCT_UPDATED,
                entityType: 'PRODUCT',
                entityId: existing.id,
                actorType: 'user',
                actorId: userId,
                source: 'api',
                before: { name: existing.name },
                after:  { name: row.name },
                changedFields: ['name'],
                metadata: { sku: existing.sku, sourceConflict: hasSourceConflict },
            });

            return 'updated';
        }

        if (existing && existing.deletedAt) {
            // Soft-deleted — пропустить (MANUAL_REVIEW policy)
            return 'skipped';
        }

        const created = await this.prisma.product.create({
            data: {
                sku: row.sku,
                name: row.name,
                brand: row.brand ?? null,
                barcode: row.barcode ?? null,
                category: row.category ?? null,
                total: 0,
                reserved: 0,
                tenantId,
                status: ProductStatus.ACTIVE,
                sourceOfTruth: ProductSourceOfTruth.IMPORT,
                createdBy: userId ?? null,
                updatedBy: userId ?? null,
            },
        });

        await this.auditService.writeEvent({
            tenantId,
            eventType: AUDIT_EVENTS.PRODUCT_CREATED,
            entityType: 'PRODUCT',
            entityId: created.id,
            actorType: 'user',
            actorId: userId,
            source: 'api',
            after: { sku: created.sku, name: created.name, total: created.total },
        });

        return 'created';
    }

    // ------------------------------------------------------------------
    // PRIVATE — apply UPDATE
    // ------------------------------------------------------------------

    private async _applyUpdate(
        row: ImportRowDto,
        tenantId: string,
        actorEmail: string,
        userId?: string,
        hasSourceConflict = false,
    ): Promise<'updated' | 'created'> {
        const existing = await this.prisma.product.findFirst({
            where: { sku: row.sku, tenantId, deletedAt: null },
        });

        if (!existing) {
            const created = await this.prisma.product.create({
                data: {
                    sku: row.sku,
                    name: row.name,
                    brand: row.brand ?? null,
                    barcode: row.barcode ?? null,
                    category: row.category ?? null,
                    total: 0,
                    reserved: 0,
                    tenantId,
                    status: ProductStatus.ACTIVE,
                    sourceOfTruth: ProductSourceOfTruth.IMPORT,
                    createdBy: userId ?? null,
                    updatedBy: userId ?? null,
                },
            });

            await this.auditService.writeEvent({
                tenantId,
                eventType: AUDIT_EVENTS.PRODUCT_CREATED,
                entityType: 'PRODUCT',
                entityId: created.id,
                actorType: 'user',
                actorId: userId,
                source: 'api',
                after: { sku: created.sku, name: created.name, total: created.total },
                metadata: { via: 'import_recreate_deleted' },
            });

            return 'created';
        }

        const note = hasSourceConflict
            ? `Import overwrote MANUAL product (source conflict) via import commit`
            : 'Updated via import commit';

        await this.prisma.product.update({
            where: { id: existing.id },
            data: {
                name: row.name,
                brand: row.brand ?? existing.brand,
                barcode: row.barcode ?? existing.barcode,
                category: row.category ?? existing.category,
                sourceOfTruth: ProductSourceOfTruth.IMPORT,
                updatedBy: userId ?? null,
            },
        });

        await this.auditService.writeEvent({
            tenantId,
            eventType: AUDIT_EVENTS.PRODUCT_UPDATED,
            entityType: 'PRODUCT',
            entityId: existing.id,
            actorType: 'user',
            actorId: userId,
            source: 'api',
            before: { name: existing.name },
            after:  { name: row.name },
            changedFields: ['name'],
            metadata: { sku: existing.sku, sourceConflict: hasSourceConflict },
        });

        return 'updated';
    }

    // ------------------------------------------------------------------
    // PRIVATE — helpers
    // ------------------------------------------------------------------

    private _buildSummary(actions: (ImportItemAction | null)[]) {
        return {
            create: actions.filter(a => a === ImportItemAction.CREATE).length,
            update: actions.filter(a => a === ImportItemAction.UPDATE).length,
            skip: actions.filter(a => a === ImportItemAction.SKIP).length,
            manualReview: actions.filter(a => a === ImportItemAction.MANUAL_REVIEW).length,
        };
    }

    private _formatJob(job: {
        id: string;
        status: ImportJobStatus;
        totalRows: number;
        createdCount: number;
        updatedCount: number;
        errorCount: number;
        idempotencyKey: string | null;
        createdAt: Date;
        finishedAt: Date | null;
    }) {
        return {
            jobId: job.id,
            status: job.status,
            totalRows: job.totalRows,
            createdCount: job.createdCount,
            updatedCount: job.updatedCount,
            errorCount: job.errorCount,
            idempotencyKey: job.idempotencyKey,
            createdAt: job.createdAt,
            finishedAt: job.finishedAt,
        };
    }
}
