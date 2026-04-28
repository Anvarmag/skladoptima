import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
    Prisma,
    WarehouseStatus,
    WarehouseType,
    WarehouseSourceMarketplace,
} from '@prisma/client';
import { WarehouseEvents } from './warehouse.events';

/**
 * Read-API сервис справочника складов. Pure read — никаких write/sync;
 * sync делает `WarehouseSyncService` (TASK_WAREHOUSES_2). Создание/удаление
 * через REST в MVP запрещено по §10/§13 system-analytics — единственный
 * write-путь это PATCH `aliasName`/`labels` (TASK_WAREHOUSES_4).
 */
@Injectable()
export class WarehouseService {
    private readonly logger = new Logger(WarehouseService.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * GET /warehouses — список с фильтрами. По умолчанию возвращает все
     * статусы (включая INACTIVE/ARCHIVED), потому что reference layer должен
     * сохранять историческую видимость (§13 invariant). UI сам выбирает,
     * показывать ли архивные через `status` filter.
     */
    async list(
        tenantId: string,
        opts: {
            page?: number;
            limit?: number;
            marketplaceAccountId?: string;
            sourceMarketplace?: WarehouseSourceMarketplace;
            warehouseType?: WarehouseType;
            status?: WarehouseStatus;
            search?: string;
        } = {},
    ) {
        const page = opts.page && opts.page > 0 ? opts.page : 1;
        const limit = opts.limit && opts.limit > 0 && opts.limit <= 200 ? opts.limit : 50;
        const skip = (page - 1) * limit;

        const where: Prisma.WarehouseWhereInput = { tenantId };
        if (opts.marketplaceAccountId) where.marketplaceAccountId = opts.marketplaceAccountId;
        if (opts.sourceMarketplace) where.sourceMarketplace = opts.sourceMarketplace;
        if (opts.warehouseType) where.warehouseType = opts.warehouseType;
        if (opts.status) where.status = opts.status;
        if (opts.search) {
            where.OR = [
                { name: { contains: opts.search, mode: 'insensitive' } },
                { aliasName: { contains: opts.search, mode: 'insensitive' } },
                { city: { contains: opts.search, mode: 'insensitive' } },
            ];
        }

        const [data, total] = await Promise.all([
            this.prisma.warehouse.findMany({
                where,
                skip,
                take: limit,
                // Сортировка: ACTIVE наверх, потом INACTIVE, потом ARCHIVED;
                // внутри статуса — по name. UI ожидает stable order для read-model.
                orderBy: [{ status: 'asc' }, { name: 'asc' }],
                include: {
                    marketplaceAccount: { select: { id: true, name: true, marketplace: true } },
                },
            }),
            this.prisma.warehouse.count({ where }),
        ]);

        return {
            data: data.map((w) => this._toReadModel(w)),
            meta: {
                total,
                page,
                limit,
                lastPage: Math.max(1, Math.ceil(total / limit)),
            },
        };
    }

    /**
     * GET /warehouses/:id — карточка склада.
     */
    async getById(tenantId: string, warehouseId: string) {
        const w = await this.prisma.warehouse.findFirst({
            where: { id: warehouseId, tenantId },
            include: {
                marketplaceAccount: { select: { id: true, name: true, marketplace: true } },
            },
        });
        if (!w) throw new NotFoundException({ code: 'WAREHOUSE_NOT_FOUND' });
        return this._toReadModel(w);
    }

    /**
     * GET /warehouses/:id/stocks — остатки по конкретному складу.
     *
     * Bridge с MVP: `StockBalance.warehouseId` сейчас TEXT без FK. До полной
     * миграции этого поля на UUID-ссылку, мы матчим балансы по
     * `externalWarehouseId` (строковый id, который записывает sync; см.
     * TASK_INVENTORY_5 sentinel `'default'` для tenants без warehouse-домена).
     * После миграции FK логика заменится на простой `where.warehouseId`.
     */
    async getStocks(tenantId: string, warehouseId: string) {
        const w = await this.prisma.warehouse.findFirst({
            where: { id: warehouseId, tenantId },
            select: {
                id: true,
                externalWarehouseId: true,
                name: true,
                aliasName: true,
                warehouseType: true,
                sourceMarketplace: true,
                status: true,
            },
        });
        if (!w) throw new NotFoundException({ code: 'WAREHOUSE_NOT_FOUND' });

        // Bridge match: StockBalance.warehouseId == Warehouse.externalWarehouseId.
        const balances = await this.prisma.stockBalance.findMany({
            where: { tenantId, warehouseId: w.externalWarehouseId },
            include: {
                product: { select: { id: true, sku: true, name: true, deletedAt: true } },
            },
            orderBy: { available: 'asc' },
            take: 500,
        });

        const items = balances
            .filter((b) => b.product && !b.product.deletedAt)
            .map((b) => ({
                productId: b.productId,
                sku: b.product!.sku,
                name: b.product!.name,
                onHand: b.onHand,
                reserved: b.reserved,
                available: b.available,
                fulfillmentMode: b.fulfillmentMode,
                isExternal: b.isExternal,
            }));

        const totals = items.reduce(
            (acc, it) => ({
                onHand: acc.onHand + it.onHand,
                reserved: acc.reserved + it.reserved,
                available: acc.available + Math.max(0, it.available),
            }),
            { onHand: 0, reserved: 0, available: 0 },
        );

        return {
            warehouse: {
                id: w.id,
                externalWarehouseId: w.externalWarehouseId,
                name: w.name,
                aliasName: w.aliasName,
                warehouseType: w.warehouseType,
                sourceMarketplace: w.sourceMarketplace,
                status: w.status,
            },
            totals,
            items,
            count: items.length,
        };
    }

    /**
     * PATCH /warehouses/:id/metadata — единственный write-путь для tenant-local
     * полей. Защищает identity-поля (externalWarehouseId, name, city,
     * warehouseType, sourceMarketplace) от прямого редактирования и пишет
     * audit (`metadataUpdatedAt`, `metadataUpdatedBy`) — §13/§20.
     *
     * Sync ничего не меняет в `aliasName`/`labels` (см. TASK_WAREHOUSES_2 +
     * test `expect.not.objectContaining`), поэтому повторный sync после
     * этого PATCH сохранит локальные правки.
     */
    async updateMetadata(
        tenantId: string,
        warehouseId: string,
        actorUserId: string | null,
        dto: { aliasName?: string | null; labels?: string[] },
    ) {
        // Параноидальная защита: даже если контроллер пропустил лишние поля,
        // service не должен трогать identity. Допускаем только эти ключи.
        const allowedKeys = new Set(['aliasName', 'labels']);
        const incomingKeys = Object.keys(dto ?? {});
        const forbidden = incomingKeys.filter((k) => !allowedKeys.has(k));
        if (forbidden.length > 0) {
            throw new BadRequestException({
                code: 'WAREHOUSE_METADATA_FIELD_NOT_ALLOWED',
                message: 'Only aliasName and labels can be updated',
                forbiddenFields: forbidden,
            });
        }
        if (incomingKeys.length === 0) {
            throw new BadRequestException({
                code: 'WAREHOUSE_METADATA_EMPTY',
                message: 'At least one of aliasName or labels must be provided',
            });
        }

        if (dto.labels !== undefined) {
            if (!Array.isArray(dto.labels)) {
                throw new BadRequestException({ code: 'WAREHOUSE_LABELS_INVALID' });
            }
            if (dto.labels.length > 20) {
                throw new BadRequestException({
                    code: 'WAREHOUSE_LABELS_TOO_MANY',
                    max: 20,
                    received: dto.labels.length,
                });
            }
            const seen = new Set<string>();
            const cleaned: string[] = [];
            for (const raw of dto.labels) {
                if (typeof raw !== 'string') {
                    throw new BadRequestException({ code: 'WAREHOUSE_LABEL_INVALID_TYPE' });
                }
                const v = raw.trim();
                if (v.length === 0) continue;
                if (v.length > 64) {
                    throw new BadRequestException({
                        code: 'WAREHOUSE_METADATA_TOO_LONG',
                        field: 'labels[]',
                        max: 64,
                    });
                }
                if (!/^[A-Za-z0-9_\-]+$/.test(v)) {
                    throw new BadRequestException({
                        code: 'WAREHOUSE_LABEL_FORMAT_INVALID',
                        message: 'labels must match [A-Za-z0-9_-]',
                        value: v,
                    });
                }
                if (seen.has(v)) continue;
                seen.add(v);
                cleaned.push(v);
            }
            dto.labels = cleaned;
        }

        if (dto.aliasName !== undefined && dto.aliasName !== null) {
            if (typeof dto.aliasName !== 'string') {
                throw new BadRequestException({ code: 'WAREHOUSE_ALIAS_INVALID_TYPE' });
            }
            const v = dto.aliasName.trim();
            if (v.length > 255) {
                throw new BadRequestException({
                    code: 'WAREHOUSE_METADATA_TOO_LONG',
                    field: 'aliasName',
                    max: 255,
                });
            }
            // Пустая строка → null (сбрасывает alias).
            dto.aliasName = v.length === 0 ? null : v;
        }

        const existing = await this.prisma.warehouse.findFirst({
            where: { id: warehouseId, tenantId },
        });
        if (!existing) {
            throw new NotFoundException({ code: 'WAREHOUSE_NOT_FOUND' });
        }

        const now = new Date();
        const updated = await this.prisma.warehouse.update({
            where: { id: existing.id },
            data: {
                ...(dto.aliasName !== undefined ? { aliasName: dto.aliasName } : {}),
                ...(dto.labels !== undefined ? { labels: dto.labels } : {}),
                metadataUpdatedAt: now,
                metadataUpdatedBy: actorUserId,
            },
            include: {
                marketplaceAccount: { select: { id: true, name: true, marketplace: true } },
            },
        });

        this.logger.log(JSON.stringify({
            event: WarehouseEvents.METADATA_UPDATED,
            tenantId,
            warehouseId: existing.id,
            externalWarehouseId: existing.externalWarehouseId,
            actorUserId,
            aliasNameChanged: dto.aliasName !== undefined && dto.aliasName !== existing.aliasName,
            labelsChanged: dto.labels !== undefined,
        }));

        return this._toReadModel(updated);
    }

    // ----------------------------------------------------------------
    // PRIVATE
    // ----------------------------------------------------------------

    /**
     * Inventory-friendly read-model контракт §15. UI и downstream-модули
     * получают только нужные поля, без перетекания внутренних audit-меток.
     */
    private _toReadModel(w: any) {
        return {
            id: w.id,
            tenantId: w.tenantId,
            marketplaceAccountId: w.marketplaceAccountId,
            marketplaceAccount: w.marketplaceAccount
                ? {
                    id: w.marketplaceAccount.id,
                    name: w.marketplaceAccount.name,
                    marketplace: w.marketplaceAccount.marketplace,
                }
                : null,
            externalWarehouseId: w.externalWarehouseId,
            name: w.name,
            city: w.city,
            warehouseType: w.warehouseType,
            sourceMarketplace: w.sourceMarketplace,
            aliasName: w.aliasName,
            labels: w.labels,
            status: w.status,
            deactivationReason: w.deactivationReason,
            firstSeenAt: w.firstSeenAt,
            lastSyncedAt: w.lastSyncedAt,
            inactiveSince: w.inactiveSince,
        };
    }
}
