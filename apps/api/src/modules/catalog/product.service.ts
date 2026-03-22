import { Injectable, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ActionType, Product } from '@prisma/client';

@Injectable()
export class ProductService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly auditService: AuditService,
    ) { }

    async create(createProductDto: CreateProductDto, photoPath: string | null, actorUserId: string, tenantId: string) {
        // Check for any product with this SKU, including deleted ones
        const existing = await this.prisma.product.findFirst({
            where: { sku: createProductDto.sku, tenantId }
        });

        const total = createProductDto.initialTotal ? parseInt(createProductDto.initialTotal, 10) : 0;

        if (existing) {
            if (!existing.deletedAt) {
                throw new BadRequestException('SKU already exists in your store');
            }
            // If it was deleted, "restore" it with new data
            const product = await this.prisma.product.update({
                where: { id: existing.id },
                data: {
                    name: createProductDto.name,
                    photo: photoPath || existing.photo,
                    total,
                    reserved: 0,
                    wbBarcode: createProductDto.wbBarcode || null,
                    deletedAt: null, // RESTORE
                },
            });

            await this.auditService.logAction({
                actionType: ActionType.PRODUCT_CREATED,
                productId: product.id,
                productSku: product.sku,
                afterTotal: product.total,
                afterName: product.name,
                actorUserId,
                note: 'Product restored after soft-delete',
                tenantId,
            });

            return product;
        }

        const product = await this.prisma.product.create({
            data: {
                sku: createProductDto.sku,
                name: createProductDto.name,
                photo: photoPath,
                total,
                reserved: 0,
                wbBarcode: createProductDto.wbBarcode || null,
                tenantId: tenantId,
            },
        });

        await this.auditService.logAction({
            actionType: ActionType.PRODUCT_CREATED,
            productId: product.id,
            productSku: product.sku,
            afterTotal: product.total,
            afterName: product.name,
            actorUserId,
            tenantId,
        });

        return product;
    }

    async findAll(tenantId: string, page = 1, limit = 20, search?: string) {
        const skip = (page - 1) * limit;

        const where: any = {
            tenantId,
            deletedAt: null,
        };

        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { sku: { contains: search, mode: 'insensitive' } },
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

    async findOne(id: string, tenantId: string) {
        const product = await this.prisma.product.findUnique({
            where: { id }
        });

        if (!product || product.tenantId !== tenantId || product.deletedAt) {
            throw new NotFoundException('Product not found or access denied');
        }

        return {
            ...product,
            available: Math.max(0, product.total),
        };
    }

    async update(id: string, updateDto: UpdateProductDto, photoPath: string | null, actorUserId: string, tenantId: string) {
        const product = await this.findOne(id, tenantId);

        if (updateDto.sku && updateDto.sku !== product.sku) {
            const existingSku = await this.prisma.product.findFirst({
                where: { sku: updateDto.sku, tenantId }
            });
            if (existingSku) throw new BadRequestException('SKU already exists in your store');
        }

        const updated = await this.prisma.product.update({
            where: { id },
            data: {
                sku: updateDto.sku ?? product.sku,
                name: updateDto.name ?? product.name,
                wbBarcode: updateDto.wbBarcode !== undefined ? (updateDto.wbBarcode || null) : product.wbBarcode,
                ...(photoPath && { photo: photoPath }),
                ...(updateDto.ozonFbs !== undefined && { ozonFbs: updateDto.ozonFbs }),
                ...(updateDto.ozonFbo !== undefined && { ozonFbo: updateDto.ozonFbo }),
                ...(updateDto.wbFbs !== undefined && { wbFbs: updateDto.wbFbs }),
                ...(updateDto.wbFbo !== undefined && { wbFbo: updateDto.wbFbo }),
                ...(updateDto.purchasePrice !== undefined && { purchasePrice: updateDto.purchasePrice }),
                ...(updateDto.commissionRate !== undefined && { commissionRate: updateDto.commissionRate }),
                ...(updateDto.logisticsCost !== undefined && { logisticsCost: updateDto.logisticsCost }),
                ...(updateDto.category !== undefined && { category: updateDto.category }),
                ...(updateDto.width !== undefined && { width: updateDto.width }),
                ...(updateDto.height !== undefined && { height: updateDto.height }),
                ...(updateDto.length !== undefined && { length: updateDto.length }),
                ...(updateDto.weight !== undefined && { weight: updateDto.weight }),
            },
        });

        await this.auditService.logAction({
            actionType: ActionType.PRODUCT_UPDATED,
            productId: updated.id,
            productSku: updated.sku,
            beforeName: product.name,
            afterName: updated.name,
            actorUserId,
            tenantId,
        });

        return updated;
    }

    async adjustStock(id: string, delta: number, actorUserId: string, tenantId: string, note?: string) {
        const product = await this.findOne(id, tenantId);
        const afterTotal = product.total + delta;

        if (afterTotal < 0) {
            throw new BadRequestException('Total stock cannot be negative');
        }

        const updated = await this.prisma.product.update({
            where: { id },
            data: { total: afterTotal },
        });

        await this.auditService.logAction({
            actionType: ActionType.STOCK_ADJUSTED,
            productId: updated.id,
            productSku: updated.sku,
            beforeTotal: product.total,
            afterTotal: updated.total,
            delta,
            actorUserId,
            note,
            tenantId,
        });

        return updated;
    }

    async remove(id: string, actorUserId: string, tenantId: string) {
        const product = await this.findOne(id, tenantId);

        await this.prisma.product.update({
            where: { id },
            data: { deletedAt: new Date() },
        });

        await this.auditService.logAction({
            actionType: ActionType.PRODUCT_DELETED,
            productId: product.id,
            productSku: product.sku,
            actorUserId,
            tenantId,
        });

        return { message: 'Product deleted successfully' };
    }

    async importFromWb(items: Array<{ sku: string; name: string; wbBarcode?: string }>, actorUserId: string, tenantId: string) {
        let created = 0;
        let updatedCount = 0;

        for (const item of items) {
            if (!item.sku) continue;

            const existing = await this.prisma.product.findFirst({
                where: { sku: item.sku, tenantId }
            });

            if (existing) {
                await this.prisma.product.update({
                    where: { id: existing.id },
                    data: {
                        name: item.name || existing.name,
                        wbBarcode: item.wbBarcode || existing.wbBarcode,
                        deletedAt: null // Always restore on import if found
                    }
                });
                updatedCount++;
            } else {
                await this.prisma.product.create({
                    data: {
                        sku: item.sku,
                        name: item.name || item.sku,
                        wbBarcode: item.wbBarcode || null,
                        total: 0,
                        reserved: 0,
                        tenantId: tenantId,
                    }
                });
                created++;
            }
        }

        return { success: true, created, updated: updatedCount };
    }
}
