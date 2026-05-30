import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductGroupRole, ProductStatus } from '@prisma/client';

@Injectable()
export class GroupService {
    constructor(private readonly prisma: PrismaService) {}

    // ── GET LIST ─────────────────────────────────────────────────────────────
    // Возвращает все группы тенанта с товарами внутри каждой.
    // Ungrouped товары возвращаются отдельно в поле ungrouped.

    async findAll(tenantId: string) {
        const groups = await this.prisma.productGroup.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            include: {
                products: {
                    where: { deletedAt: null, status: ProductStatus.ACTIVE },
                    select: {
                        id: true, sku: true, name: true, brand: true,
                        photo: true, mainImageFileId: true,
                        total: true, groupRole: true,
                        channelMappings: {
                            select: { id: true, marketplace: true, externalProductId: true, externalSku: true },
                        },
                    },
                    orderBy: { groupRole: 'asc' }, // PRIMARY first
                },
            },
        });

        // Фильтруем пустые группы (все товары удалены)
        return groups.filter(g => g.products.length > 0);
    }

    // ── GET GROUP MEMBERS ────────────────────────────────────────────────────
    // Возвращает участников конкретной группы (для модала редактирования товара).

    async findGroupMembers(tenantId: string, groupId: string) {
        const group = await this.prisma.productGroup.findFirst({
            where: { id: groupId, tenantId },
            include: {
                products: {
                    where: { deletedAt: null, status: ProductStatus.ACTIVE },
                    select: {
                        id: true, sku: true, name: true, brand: true,
                        photo: true, mainImageFileId: true,
                        total: true, groupRole: true,
                        channelMappings: {
                            select: { id: true, marketplace: true, externalProductId: true },
                        },
                    },
                    orderBy: { groupRole: 'asc' },
                },
            },
        });
        if (!group) throw new NotFoundException({ code: 'GROUP_NOT_FOUND' });
        return group;
    }

    // ── SEARCH PRODUCTS (для пикера при связке) ──────────────────────────────

    async searchProducts(tenantId: string, query: string, excludeProductId?: string) {
        const products = await this.prisma.product.findMany({
            where: {
                tenantId,
                deletedAt: null,
                status: ProductStatus.ACTIVE,
                ...(excludeProductId ? { id: { not: excludeProductId } } : {}),
                OR: [
                    { name: { contains: query, mode: 'insensitive' } },
                    { sku: { contains: query, mode: 'insensitive' } },
                    { brand: { contains: query, mode: 'insensitive' } },
                ],
            },
            take: 20,
            select: {
                id: true, sku: true, name: true, brand: true,
                photo: true, mainImageFileId: true,
                groupId: true, groupRole: true,
            },
        });
        return products;
    }

    // ── LINK ─────────────────────────────────────────────────────────────────
    // Связать два товара. Если ни у одного нет группы — создать новую.
    // Если у одного уже есть группа — добавить второй в неё.
    // Нельзя объединять товары из разных существующих групп без явного merge.

    async link(tenantId: string, productAId: string, productBId: string) {
        if (productAId === productBId) {
            throw new BadRequestException({ code: 'SAME_PRODUCT', message: 'Cannot link a product with itself' });
        }

        const [a, b] = await Promise.all([
            this.prisma.product.findFirst({ where: { id: productAId, tenantId, deletedAt: null } }),
            this.prisma.product.findFirst({ where: { id: productBId, tenantId, deletedAt: null } }),
        ]);

        if (!a) throw new NotFoundException({ code: 'PRODUCT_A_NOT_FOUND' });
        if (!b) throw new NotFoundException({ code: 'PRODUCT_B_NOT_FOUND' });

        // Оба уже в разных группах — запрещаем без явного действия
        if (a.groupId && b.groupId && a.groupId !== b.groupId) {
            throw new ConflictException({
                code: 'BOTH_IN_DIFFERENT_GROUPS',
                message: 'Both products already belong to different groups. Unlink one first.',
                groupAId: a.groupId,
                groupBId: b.groupId,
            });
        }

        // Уже в одной группе
        if (a.groupId && b.groupId && a.groupId === b.groupId) {
            throw new ConflictException({ code: 'ALREADY_LINKED', message: 'Products are already in the same group' });
        }

        // Определяем группу: берём существующую или создаём новую
        let groupId = a.groupId ?? b.groupId ?? null;

        if (!groupId) {
            const group = await this.prisma.productGroup.create({ data: { tenantId } });
            groupId = group.id;
        }

        // Определяем роли до транзакции:
        // — если в группе уже есть PRIMARY — новый добавляемый становится SECONDARY
        // — если группа только что создана — A (инициатор) = PRIMARY, B = SECONDARY
        const existingPrimary = await this.prisma.product.findFirst({
            where: { groupId, groupRole: ProductGroupRole.PRIMARY },
        });

        // A — инициатор связки (тот кто нажал "Привязать"), всегда PRIMARY если нет другого
        const roleA = a.groupRole ?? (existingPrimary ? ProductGroupRole.SECONDARY : ProductGroupRole.PRIMARY);
        const roleB = b.groupRole ?? ProductGroupRole.SECONDARY;

        const primaryProduct = roleA === ProductGroupRole.PRIMARY ? a : (existingPrimary ?? a);
        const primaryTotal = primaryProduct.total;

        // SECONDARY зеркалит total PRIMARY при связке
        await this.prisma.$transaction([
            this.prisma.product.update({ where: { id: a.id }, data: { groupId, groupRole: roleA } }),
            this.prisma.product.update({
                where: { id: b.id },
                data: {
                    groupId,
                    groupRole: roleB,
                    ...(roleB === ProductGroupRole.SECONDARY ? { total: primaryTotal } : {}),
                },
            }),
        ]);

        return this.prisma.productGroup.findUnique({
            where: { id: groupId },
            include: {
                products: {
                    where: { deletedAt: null },
                    select: { id: true, sku: true, name: true, groupRole: true },
                },
            },
        });
    }

    // ── UNLINK ───────────────────────────────────────────────────────────────
    // Убрать товар из группы. Если в группе остался один товар — распустить группу.

    async unlink(tenantId: string, productId: string) {
        const product = await this.prisma.product.findFirst({
            where: { id: productId, tenantId, deletedAt: null },
        });
        if (!product) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND' });
        if (!product.groupId) throw new BadRequestException({ code: 'NOT_IN_GROUP', message: 'Product is not in any group' });

        const groupId = product.groupId;

        // Убираем товар из группы
        await this.prisma.product.update({
            where: { id: productId },
            data: { groupId: null, groupRole: null },
        });

        // Считаем оставшихся
        const remaining = await this.prisma.product.findMany({
            where: { groupId, deletedAt: null },
            select: { id: true, groupRole: true },
        });

        if (remaining.length === 0) {
            // Группа пустая — удалить
            await this.prisma.productGroup.delete({ where: { id: groupId } });
        } else if (remaining.length === 1) {
            // Один остался — распустить группу, убрать роль
            await this.prisma.product.update({
                where: { id: remaining[0].id },
                data: { groupId: null, groupRole: null },
            });
            await this.prisma.productGroup.delete({ where: { id: groupId } });
        } else {
            // Если убрали PRIMARY — назначить нового PRIMARY из оставшихся
            const hasPrimary = remaining.some(r => r.groupRole === ProductGroupRole.PRIMARY);
            if (!hasPrimary) {
                await this.prisma.product.update({
                    where: { id: remaining[0].id },
                    data: { groupRole: ProductGroupRole.PRIMARY },
                });
            }
        }

        return { ok: true };
    }

    // ── SET PRIMARY ──────────────────────────────────────────────────────────
    // Сменить PRIMARY в группе (какой товар считается главным).

    async setPrimary(tenantId: string, productId: string) {
        const product = await this.prisma.product.findFirst({
            where: { id: productId, tenantId, deletedAt: null },
        });
        if (!product) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND' });
        if (!product.groupId) throw new BadRequestException({ code: 'NOT_IN_GROUP' });

        const groupId = product.groupId;

        // Все в группе → SECONDARY, выбранный → PRIMARY
        const members = await this.prisma.product.findMany({
            where: { groupId, deletedAt: null },
            select: { id: true },
        });

        await this.prisma.$transaction([
            ...members.map(m =>
                this.prisma.product.update({
                    where: { id: m.id },
                    data: { groupRole: m.id === productId ? ProductGroupRole.PRIMARY : ProductGroupRole.SECONDARY },
                })
            ),
        ]);

        return { ok: true, primaryProductId: productId };
    }
}
