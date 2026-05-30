import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductNoteDto } from './dto/create-note.dto';
import { UpdateProductNoteDto } from './dto/update-note.dto';

@Injectable()
export class ProductNotesService {
    constructor(private readonly prisma: PrismaService) {}

    async list(tenantId: string, productId: string) {
        await this.assertProductBelongsToTenant(tenantId, productId);
        return this.prisma.productNote.findMany({
            where: { tenantId, productId },
            orderBy: { date: 'desc' },
            include: { author: { select: { id: true, email: true } } },
        });
    }

    async create(tenantId: string, productId: string, userId: string, dto: CreateProductNoteDto) {
        await this.assertProductBelongsToTenant(tenantId, productId);
        return this.prisma.productNote.create({
            data: {
                tenantId,
                productId,
                createdBy: userId,
                category: dto.category ?? 'OTHER',
                title: dto.title,
                body: dto.body ?? null,
                date: dto.date ? new Date(dto.date) : new Date(),
            },
            include: { author: { select: { id: true, email: true } } },
        });
    }

    async update(tenantId: string, productId: string, noteId: string, userId: string, dto: UpdateProductNoteDto) {
        const note = await this.findNoteOrThrow(tenantId, productId, noteId);
        if (note.createdBy && note.createdBy !== userId) {
            throw new ForbiddenException('Можно редактировать только свои заметки');
        }
        return this.prisma.productNote.update({
            where: { id: noteId },
            data: {
                ...(dto.category !== undefined && { category: dto.category }),
                ...(dto.title !== undefined && { title: dto.title }),
                ...(dto.body !== undefined && { body: dto.body }),
                ...(dto.date !== undefined && { date: new Date(dto.date) }),
            },
            include: { author: { select: { id: true, email: true } } },
        });
    }

    async remove(tenantId: string, productId: string, noteId: string, userId: string) {
        const note = await this.findNoteOrThrow(tenantId, productId, noteId);
        if (note.createdBy && note.createdBy !== userId) {
            throw new ForbiddenException('Можно удалять только свои заметки');
        }
        await this.prisma.productNote.delete({ where: { id: noteId } });
    }

    async countByIds(tenantId: string, productIds: string[]): Promise<Record<string, number>> {
        if (productIds.length === 0) return {};
        const rows = await this.prisma.productNote.groupBy({
            by: ['productId'],
            where: { tenantId, productId: { in: productIds } },
            _count: { id: true },
        });
        const result: Record<string, number> = {};
        for (const r of rows) result[r.productId] = r._count.id;
        return result;
    }

    private async assertProductBelongsToTenant(tenantId: string, productId: string) {
        const product = await this.prisma.product.findFirst({ where: { id: productId, tenantId } });
        if (!product) throw new NotFoundException('Товар не найден');
    }

    private async findNoteOrThrow(tenantId: string, productId: string, noteId: string) {
        const note = await this.prisma.productNote.findFirst({
            where: { id: noteId, tenantId, productId },
        });
        if (!note) throw new NotFoundException('Заметка не найдена');
        return note;
    }
}
