import {
    Injectable,
    Logger,
    NotFoundException,
    BadRequestException,
    ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductStatus, ProductSourceOfTruth } from '@prisma/client';
import { AUDIT_EVENTS } from '../audit/audit-event-catalog';

@Injectable()
export class ProductService {
    private readonly logger = new Logger(ProductService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly auditService: AuditService,
        private readonly onboardingService: OnboardingService,
    ) { }

    // ----------------------------------------------------------------
    // CREATE
    // ----------------------------------------------------------------

    async create(
        dto: CreateProductDto,
        photoPath: string | null,
        actorEmail: string,
        tenantId: string,
        userId?: string,
    ) {
        const existing = await this.prisma.product.findFirst({
            where: { sku: dto.sku, tenantId },
        });

        const total = dto.initialTotal ? parseInt(dto.initialTotal, 10) : 0;

        if (existing) {
            if (!existing.deletedAt) {
                // Активный товар с таким SKU уже есть
                throw new ConflictException({
                    code: 'SKU_ALREADY_EXISTS',
                    message: 'SKU already exists in your store',
                });
            }

            // Soft-deleted товар — требуем явного подтверждения
            if (!dto.confirmRestoreId) {
                throw new ConflictException({
                    code: 'SKU_SOFT_DELETED',
                    message: 'A deleted product with this SKU exists. Pass confirmRestoreId to restore it with the new data.',
                    deletedProductId: existing.id,
                });
            }

            if (dto.confirmRestoreId !== existing.id) {
                throw new BadRequestException({
                    code: 'CONFIRM_RESTORE_ID_MISMATCH',
                    message: 'confirmRestoreId does not match the deleted product',
                });
            }

            // Явное подтверждение — восстанавливаем с новыми данными
            const product = await this.prisma.product.update({
                where: { id: existing.id },
                data: {
                    name: dto.name,
                    photo: photoPath ?? existing.photo,
                    total,
                    reserved: 0,
                    wbBarcode: dto.wbBarcode ?? null,
                    brand: dto.brand ?? existing.brand,
                    barcode: dto.barcode ?? existing.barcode,
                    mainImageFileId: dto.mainImageFileId ?? existing.mainImageFileId,
                    deletedAt: null,
                    status: ProductStatus.ACTIVE,
                    sourceOfTruth: ProductSourceOfTruth.MANUAL,
                    updatedBy: userId ?? null,
                },
            });

            await this.auditService.writeEvent({
                tenantId,
                eventType: AUDIT_EVENTS.PRODUCT_RESTORED,
                entityType: 'PRODUCT',
                entityId: product.id,
                actorType: 'user',
                actorId: userId,
                source: 'ui',
                after: { sku: product.sku, name: product.name, total: product.total },
                metadata: { via: 'create_with_confirmRestoreId' },
            });

            this._triggerOnboardingAddProducts(tenantId);
            return product;
        }

        // Новый товар
        const product = await this.prisma.product.create({
            data: {
                sku: dto.sku,
                name: dto.name,
                photo: photoPath,
                total,
                reserved: 0,
                wbBarcode: dto.wbBarcode ?? null,
                brand: dto.brand ?? null,
                barcode: dto.barcode ?? null,
                mainImageFileId: dto.mainImageFileId ?? null,
                tenantId,
                status: ProductStatus.ACTIVE,
                sourceOfTruth: ProductSourceOfTruth.MANUAL,
                createdBy: userId ?? null,
                updatedBy: userId ?? null,
            },
        });

        await this.auditService.writeEvent({
            tenantId,
            eventType: AUDIT_EVENTS.PRODUCT_CREATED,
            entityType: 'PRODUCT',
            entityId: product.id,
            actorType: 'user',
            actorId: userId,
            source: 'ui',
            after: { sku: product.sku, name: product.name, total: product.total },
        });

        this._triggerOnboardingAddProducts(tenantId);
        return product;
    }

    // ----------------------------------------------------------------
    // LIST
    // ----------------------------------------------------------------

    async findAll(tenantId: string, page = 1, limit = 20, search?: string, status?: string) {
        const skip = (page - 1) * limit;

        const where: any = { tenantId };

        if (status === 'deleted') {
            where.status = ProductStatus.DELETED;
            where.deletedAt = { not: null };
        } else {
            where.status = ProductStatus.ACTIVE;
            where.deletedAt = null;
        }

        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { sku: { contains: search, mode: 'insensitive' } },
                { brand: { contains: search, mode: 'insensitive' } },
            ];
        }

        const [data, totalCount] = await Promise.all([
            this.prisma.product.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
            this.prisma.product.count({ where }),
        ]);

        return {
            data: data.map(p => ({ ...p, available: Math.max(0, p.total) })),
            meta: {
                total: totalCount,
                page,
                lastPage: Math.ceil(totalCount / limit),
            },
        };
    }

    // ----------------------------------------------------------------
    // DETAIL
    // ----------------------------------------------------------------

    async findOne(id: string, tenantId: string, includeDeleted = false) {
        const product = await this.prisma.product.findUnique({
            where: { id },
            include: {
                channelMappings: {
                    select: {
                        id: true,
                        marketplace: true,
                        externalProductId: true,
                        externalSku: true,
                        isAutoMatched: true,
                        createdAt: true,
                    },
                    orderBy: { createdAt: 'asc' },
                },
            },
        });

        if (!product || product.tenantId !== tenantId) {
            throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND' });
        }

        if (!includeDeleted && product.deletedAt) {
            throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND' });
        }

        return { ...product, available: Math.max(0, product.total) };
    }

    // ----------------------------------------------------------------
    // UPDATE (PATCH)
    // ----------------------------------------------------------------

    async update(
        id: string,
        dto: UpdateProductDto,
        photoPath: string | null,
        actorEmail: string,
        tenantId: string,
        userId?: string,
    ) {
        const product = await this.findOne(id, tenantId);

        if (dto.sku && dto.sku !== product.sku) {
            const existingSku = await this.prisma.product.findFirst({
                where: { sku: dto.sku, tenantId },
            });
            if (existingSku) {
                throw new ConflictException({ code: 'SKU_ALREADY_EXISTS', message: 'SKU already exists in your store' });
            }
        }

        const updated = await this.prisma.product.update({
            where: { id },
            data: {
                ...(dto.sku !== undefined && { sku: dto.sku }),
                ...(dto.name !== undefined && { name: dto.name }),
                ...(dto.brand !== undefined && { brand: dto.brand || null }),
                ...(dto.barcode !== undefined && { barcode: dto.barcode || null }),
                ...(dto.wbBarcode !== undefined && { wbBarcode: dto.wbBarcode || null }),
                ...(photoPath && { photo: photoPath }),
                ...(dto.mainImageFileId !== undefined && { mainImageFileId: dto.mainImageFileId || null }),
                ...(dto.ozonFbs !== undefined && { ozonFbs: dto.ozonFbs }),
                ...(dto.ozonFbo !== undefined && { ozonFbo: dto.ozonFbo }),
                ...(dto.wbFbs !== undefined && { wbFbs: dto.wbFbs }),
                ...(dto.wbFbo !== undefined && { wbFbo: dto.wbFbo }),
                ...(dto.purchasePrice !== undefined && { purchasePrice: dto.purchasePrice }),
                ...(dto.commissionRate !== undefined && { commissionRate: dto.commissionRate }),
                ...(dto.logisticsCost !== undefined && { logisticsCost: dto.logisticsCost }),
                ...(dto.category !== undefined && { category: dto.category }),
                ...(dto.width !== undefined && { width: dto.width }),
                ...(dto.height !== undefined && { height: dto.height }),
                ...(dto.length !== undefined && { length: dto.length }),
                ...(dto.weight !== undefined && { weight: dto.weight }),
                sourceOfTruth: ProductSourceOfTruth.MANUAL,
                updatedBy: userId ?? null,
            },
        });

        await this.auditService.writeEvent({
            tenantId,
            eventType: AUDIT_EVENTS.PRODUCT_UPDATED,
            entityType: 'PRODUCT',
            entityId: updated.id,
            actorType: 'user',
            actorId: userId,
            source: 'ui',
            before: { sku: product.sku, name: product.name },
            after:  { sku: updated.sku, name: updated.name },
            changedFields: Object.keys(dto).filter(k => (dto as any)[k] !== undefined),
        });

        return { ...updated, available: Math.max(0, updated.total) };
    }

    // ----------------------------------------------------------------
    // SOFT DELETE
    // ----------------------------------------------------------------

    async remove(id: string, actorEmail: string, tenantId: string, userId?: string) {
        const product = await this.findOne(id, tenantId);

        await this.prisma.product.update({
            where: { id },
            data: {
                deletedAt: new Date(),
                status: ProductStatus.DELETED,
                updatedBy: userId ?? null,
            },
        });

        await this.auditService.writeEvent({
            tenantId,
            eventType: AUDIT_EVENTS.PRODUCT_ARCHIVED,
            entityType: 'PRODUCT',
            entityId: product.id,
            actorType: 'user',
            actorId: userId,
            source: 'ui',
            before: { sku: product.sku, name: product.name, status: 'ACTIVE' },
            after:  { status: 'DELETED' },
        });

        return { message: 'Product deleted successfully' };
    }

    // ----------------------------------------------------------------
    // RESTORE
    // ----------------------------------------------------------------

    async restore(id: string, actorEmail: string, tenantId: string, userId?: string) {
        // includeDeleted=true чтобы найти архивированный товар
        const product = await this.findOne(id, tenantId, true);

        if (!product.deletedAt) {
            throw new ConflictException({ code: 'PRODUCT_ALREADY_ACTIVE', message: 'Product is not deleted' });
        }

        const restored = await this.prisma.product.update({
            where: { id },
            data: {
                deletedAt: null,
                status: ProductStatus.ACTIVE,
                updatedBy: userId ?? null,
            },
        });

        await this.auditService.writeEvent({
            tenantId,
            eventType: AUDIT_EVENTS.PRODUCT_RESTORED,
            entityType: 'PRODUCT',
            entityId: restored.id,
            actorType: 'user',
            actorId: userId,
            source: 'ui',
            before: { status: 'DELETED' },
            after:  { sku: restored.sku, name: restored.name, status: 'ACTIVE' },
        });

        return { ...restored, available: Math.max(0, restored.total) };
    }

    // ----------------------------------------------------------------
    // STOCK ADJUST
    // ----------------------------------------------------------------

    async adjustStock(id: string, delta: number, actorEmail: string, tenantId: string, note?: string) {
        const product = await this.findOne(id, tenantId);
        const afterTotal = product.total + delta;

        if (afterTotal < 0) {
            throw new BadRequestException({ code: 'STOCK_CANNOT_BE_NEGATIVE', message: 'Total stock cannot be negative' });
        }

        const updated = await this.prisma.product.update({
            where: { id },
            data: { total: afterTotal },
        });

        await this.auditService.writeEvent({
            tenantId,
            eventType: AUDIT_EVENTS.STOCK_MANUALLY_ADJUSTED,
            entityType: 'PRODUCT',
            entityId: updated.id,
            actorType: 'user',
            source: 'ui',
            before: { total: product.total },
            after:  { total: updated.total },
            changedFields: ['total'],
            metadata: { delta, note: note ?? null, sku: updated.sku },
        });

        return { ...updated, available: Math.max(0, updated.total) };
    }

    // ----------------------------------------------------------------
    // IMPORT FROM WB (legacy)
    // ----------------------------------------------------------------

    async importFromWb(
        items: Array<{ sku: string; name: string; wbBarcode?: string }>,
        actorEmail: string,
        tenantId: string,
        userId?: string,
    ) {
        let created = 0;
        let updatedCount = 0;
        let skipped = 0;

        for (const item of items) {
            if (!item.sku) continue;

            const existing = await this.prisma.product.findFirst({
                where: { sku: item.sku, tenantId },
            });

            if (existing) {
                // Source-of-change policy: sync-layer не должен перезаписывать
                // товары, которые управляются вручную (MANUAL) или через structured
                // import (IMPORT). Обновляем только SYNC-управляемые продукты.
                if (existing.sourceOfTruth !== ProductSourceOfTruth.SYNC) {
                    this.logger.warn(JSON.stringify({
                        event: 'sync_source_conflict_skipped',
                        sku: item.sku,
                        existingSourceOfTruth: existing.sourceOfTruth,
                        tenantId,
                    }));
                    skipped++;
                    continue;
                }

                await this.prisma.product.update({
                    where: { id: existing.id },
                    data: {
                        name: item.name || existing.name,
                        wbBarcode: item.wbBarcode || existing.wbBarcode,
                        deletedAt: null,
                        status: ProductStatus.ACTIVE,
                        sourceOfTruth: ProductSourceOfTruth.SYNC,
                        updatedBy: userId ?? null,
                    },
                });
                updatedCount++;
            } else {
                await this.prisma.product.create({
                    data: {
                        sku: item.sku,
                        name: item.name || item.sku,
                        wbBarcode: item.wbBarcode ?? null,
                        total: 0,
                        reserved: 0,
                        tenantId,
                        status: ProductStatus.ACTIVE,
                        sourceOfTruth: ProductSourceOfTruth.SYNC,
                        createdBy: userId ?? null,
                        updatedBy: userId ?? null,
                    },
                });
                created++;
            }
        }

        return { success: true, created, updated: updatedCount, skipped };
    }

    // ----------------------------------------------------------------
    // PRIVATE
    // ----------------------------------------------------------------

    private _triggerOnboardingAddProducts(tenantId: string): void {
        this.onboardingService
            .markStepDone('TENANT_ACTIVATION', tenantId, 'add_products', 'domain_event')
            .catch((err: unknown) =>
                this.logger.warn(JSON.stringify({
                    event: 'onboarding_step_update_failed',
                    stepKey: 'add_products',
                    err: (err as any)?.message,
                })),
            );
    }
}
