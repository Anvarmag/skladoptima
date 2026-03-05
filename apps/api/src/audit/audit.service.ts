import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActionType } from '@prisma/client';

@Injectable()
export class AuditService {
    constructor(private readonly prisma: PrismaService) { }

    async logAction(data: {
        actionType: ActionType;
        productId?: string;
        productSku?: string;
        beforeTotal?: number;
        afterTotal?: number;
        delta?: number;
        beforeName?: string;
        afterName?: string;
        actorEmail: string;
        note?: string;
        storeId: string;
    }) {
        return this.prisma.auditLog.create({
            data,
        });
    }

    async getLogs(storeId: string, page = 1, limit = 20, actionType?: ActionType, searchSku?: string) {
        const skip = (page - 1) * limit;
        const where: any = { storeId };

        if (actionType) {
            where.actionType = actionType;
        }
        if (searchSku) {
            where.productSku = { contains: searchSku, mode: 'insensitive' };
        }

        const [logs, total] = await Promise.all([
            this.prisma.auditLog.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
            this.prisma.auditLog.count({ where }),
        ]);

        return {
            data: logs,
            meta: {
                total,
                page,
                lastPage: Math.ceil(total / limit),
            },
        };
    }
}
