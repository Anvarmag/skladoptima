import { Injectable, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ActionType, Product } from '@prisma/client';

@Injectable()
export class ProductService implements OnModuleInit {
    constructor(
        private readonly prisma: PrismaService,
        private readonly auditService: AuditService,
    ) { }

    async onModuleInit() {
        // Runtime migration: add wbBarcode column if not exists
        try {
            await this.prisma.$executeRawUnsafe(
                `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "wbBarcode" TEXT`
            );
        } catch (e: any) {
            console.warn('[ProductService] wbBarcode migration:', e?.message);
        }
    }

    async create(createProductDto: CreateProductDto, photoPath: string | null, actorEmail: string) {
        const existingSku = await this.prisma.product.findUnique({ where: { sku: createProductDto.sku } });
        if (existingSku) {
            throw new BadRequestException('SKU already exists');
        }

        const total = createProductDto.initialTotal ? parseInt(createProductDto.initialTotal, 10) : 0;

        const product = await this.prisma.product.create({
            data: {
                sku: createProductDto.sku,
                name: createProductDto.name,
                photo: photoPath,
                total,
                reserved: 0,
            },
        });

        // Save wbBarcode via raw SQL (column not in Prisma schema)
        if (createProductDto.wbBarcode) {
            await this.prisma.$executeRawUnsafe(
                `UPDATE "Product" SET "wbBarcode" = $1 WHERE id = $2`,
                createProductDto.wbBarcode, product.id
            );
        }

        await this.auditService.logAction({
            actionType: ActionType.PRODUCT_CREATED,
            productId: product.id,
            productSku: product.sku,
            afterTotal: product.total,
            afterName: product.name,
            actorEmail,
        });

        return product;
    }

    async findAll(page = 1, limit = 20, search?: string) {
        const skip = (page - 1) * limit;
        let whereClause = `WHERE p."deletedAt" IS NULL`;
        const params: any[] = [];

        if (search) {
            params.push(`%${search}%`);
            whereClause += ` AND (p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`;
        }

        const countResult = await this.prisma.$queryRawUnsafe<{ count: bigint }[]>(
            `SELECT COUNT(*) as count FROM "Product" p ${whereClause}`,
            ...params
        );
        const totalCount = Number(countResult[0]?.count ?? 0);

        params.push(limit, skip);
        const data = await this.prisma.$queryRawUnsafe<any[]>(
            `SELECT p.*, p."wbBarcode",
                    GREATEST(0, p.total - p.reserved) as available
             FROM "Product" p ${whereClause}
             ORDER BY p."createdAt" DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}`,
            ...params
        );

        return {
            data,
            meta: {
                total: totalCount,
                page,
                lastPage: Math.ceil(totalCount / limit),
            },
        };
    }

    async findOne(id: string) {
        const product = await this.prisma.product.findUnique({ where: { id, deletedAt: null } });
        if (!product) throw new NotFoundException('Product not found');
        return {
            ...product,
            available: Math.max(0, product.total - product.reserved),
        };
    }

    async update(id: string, updateDto: UpdateProductDto, photoPath: string | null, actorEmail: string) {
        const product = await this.findOne(id);

        if (updateDto.sku && updateDto.sku !== product.sku) {
            const existingSku = await this.prisma.product.findUnique({ where: { sku: updateDto.sku } });
            if (existingSku) throw new BadRequestException('SKU already exists');
        }

        const updated = await this.prisma.product.update({
            where: { id },
            data: {
                sku: updateDto.sku ?? product.sku,
                name: updateDto.name ?? product.name,
                ...(photoPath && { photo: photoPath }),
                ...(updateDto.ozonFbs !== undefined && { ozonFbs: updateDto.ozonFbs }),
                ...(updateDto.ozonFbo !== undefined && { ozonFbo: updateDto.ozonFbo }),
                ...(updateDto.wbFbs !== undefined && { wbFbs: updateDto.wbFbs }),
                ...(updateDto.wbFbo !== undefined && { wbFbo: updateDto.wbFbo }),
            },
        });

        // Save wbBarcode via raw SQL if provided
        if (updateDto.wbBarcode !== undefined) {
            await this.prisma.$executeRawUnsafe(
                `UPDATE "Product" SET "wbBarcode" = $1 WHERE id = $2`,
                updateDto.wbBarcode || null, id
            );
        }

        await this.auditService.logAction({
            actionType: ActionType.PRODUCT_UPDATED,
            productId: updated.id,
            productSku: updated.sku,
            beforeName: product.name,
            afterName: updated.name,
            actorEmail,
        });

        return updated;
    }

    async adjustStock(id: string, delta: number, actorEmail: string, note?: string) {
        const product = await this.findOne(id);
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
            actorEmail,
            note,
        });

        return updated;
    }

    async remove(id: string, actorEmail: string) {
        const product = await this.findOne(id);

        await this.prisma.product.update({
            where: { id },
            data: { deletedAt: new Date() },
        });

        await this.auditService.logAction({
            actionType: ActionType.PRODUCT_DELETED,
            productId: product.id,
            productSku: product.sku,
            actorEmail,
        });

        return { message: 'Product deleted successfully' };
    }

    async importFromWb(items: Array<{ sku: string; name: string; wbBarcode?: string }>, actorEmail: string) {
        let created = 0;
        let updatedCount = 0;

        for (const item of items) {
            if (!item.sku) continue;

            const existing = await this.prisma.product.findUnique({
                where: { sku: item.sku }
            });

            if (existing) {
                // Update existing
                await this.prisma.product.update({
                    where: { id: existing.id },
                    data: { name: item.name || existing.name }
                });

                if (item.wbBarcode) {
                    await this.prisma.$executeRawUnsafe(
                        `UPDATE "Product" SET "wbBarcode" = $1 WHERE id = $2`,
                        item.wbBarcode, existing.id
                    );
                }
                updatedCount++;
            } else {
                // Create new
                const product = await this.prisma.product.create({
                    data: {
                        sku: item.sku,
                        name: item.name || item.sku,
                        total: 0,
                        reserved: 0,
                    }
                });

                if (item.wbBarcode) {
                    await this.prisma.$executeRawUnsafe(
                        `UPDATE "Product" SET "wbBarcode" = $1 WHERE id = $2`,
                        item.wbBarcode, product.id
                    );
                }
                created++;
            }
        }

        return { success: true, created, updated: updatedCount };
    }
}
