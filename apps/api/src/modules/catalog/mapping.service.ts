import {
    Injectable,
    Logger,
    NotFoundException,
    ConflictException,
    BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ManualMappingDto } from './dto/manual-mapping.dto';
import { AutoMatchDto } from './dto/auto-match.dto';
import { MergeProductsDto } from './dto/merge-products.dto';
import { ActionType, ChannelMarketplace, ProductStatus } from '@prisma/client';

@Injectable()
export class MappingService {
    private readonly logger = new Logger(MappingService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly auditService: AuditService,
    ) {}

    // ------------------------------------------------------------------
    // GET UNMATCHED — внутренние активные товары без маппинга ни в одном канале
    // ------------------------------------------------------------------

    async getUnmatched(tenantId: string, marketplace?: ChannelMarketplace, page = 1, limit = 20) {
        const skip = (page - 1) * limit;

        // Найти productId-ы, у которых уже есть хотя бы один маппинг
        const mapped = await this.prisma.productChannelMapping.findMany({
            where: {
                tenantId,
                ...(marketplace ? { marketplace } : {}),
            },
            select: { productId: true },
            distinct: ['productId'],
        });
        const mappedIds = mapped.map(m => m.productId);

        const where = {
            tenantId,
            deletedAt: null,
            status: ProductStatus.ACTIVE,
            id: { notIn: mappedIds.length > 0 ? mappedIds : ['__none__'] },
        };

        const [data, total] = await Promise.all([
            this.prisma.product.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                select: { id: true, sku: true, name: true, brand: true, category: true, createdAt: true },
            }),
            this.prisma.product.count({ where }),
        ]);

        return {
            data,
            meta: { total, page, lastPage: Math.ceil(total / limit) || 1 },
        };
    }

    // ------------------------------------------------------------------
    // GET MAPPINGS — все маппинги tenant (с join на product)
    // ------------------------------------------------------------------

    async getMappings(tenantId: string, marketplace?: ChannelMarketplace, page = 1, limit = 20) {
        const skip = (page - 1) * limit;
        const where = {
            tenantId,
            ...(marketplace ? { marketplace } : {}),
        };

        const [data, total] = await Promise.all([
            this.prisma.productChannelMapping.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    product: {
                        select: { id: true, sku: true, name: true, brand: true },
                    },
                },
            }),
            this.prisma.productChannelMapping.count({ where }),
        ]);

        return {
            data,
            meta: { total, page, lastPage: Math.ceil(total / limit) || 1 },
        };
    }

    // ------------------------------------------------------------------
    // POST MANUAL — ручной маппинг внутреннего товара с внешним
    // ------------------------------------------------------------------

    async createManual(dto: ManualMappingDto, tenantId: string, actorEmail: string, userId?: string) {
        const product = await this.prisma.product.findFirst({
            where: { id: dto.productId, tenantId, deletedAt: null },
        });
        if (!product) {
            throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND' });
        }

        // Защита от бесконтрольной перепривязки: если маппинг уже существует — ошибка
        const existing = await this.prisma.productChannelMapping.findFirst({
            where: { tenantId, marketplace: dto.marketplace, externalProductId: dto.externalProductId },
        });
        if (existing) {
            this.logger.warn(JSON.stringify({
                event: 'mapping_conflict_detected',
                marketplace: dto.marketplace,
                externalProductId: dto.externalProductId,
                existingMappingId: existing.id,
                existingProductId: existing.productId,
                tenantId,
            }));
            throw new ConflictException({
                code: 'MAPPING_ALREADY_EXISTS',
                message: `A mapping for this external product already exists (mappingId: ${existing.id}, productId: ${existing.productId}). Delete it first to re-bind.`,
                existingMappingId: existing.id,
                existingProductId: existing.productId,
            });
        }

        const mapping = await this.prisma.productChannelMapping.create({
            data: {
                tenantId,
                productId: dto.productId,
                marketplace: dto.marketplace,
                externalProductId: dto.externalProductId,
                externalSku: dto.externalSku ?? null,
                isAutoMatched: false,
                createdBy: userId ?? null,
            },
        });

        await this.auditService.logAction({
            actionType: ActionType.MAPPING_CREATED,
            productId: product.id,
            productSku: product.sku,
            actorUserId: actorEmail,
            tenantId,
            note: `Manual mapping: ${dto.marketplace} → externalProductId=${dto.externalProductId}`,
        });

        return mapping;
    }

    // ------------------------------------------------------------------
    // POST AUTO-MATCH — автосопоставление внешнего item по SKU
    // Вызывается sync-слоем или вручную. Ищет внутренний товар по externalSku.
    // Если mapping уже существует — возвращает его без изменений (идемпотентен).
    // ------------------------------------------------------------------

    async autoMatch(dto: AutoMatchDto, tenantId: string, actorEmail: string, userId?: string) {
        // Проверить: маппинг уже есть?
        const existingMapping = await this.prisma.productChannelMapping.findFirst({
            where: { tenantId, marketplace: dto.marketplace, externalProductId: dto.externalProductId },
            include: { product: { select: { id: true, sku: true, name: true } } },
        });
        if (existingMapping) {
            return { matched: true, mapping: existingMapping, alreadyExisted: true };
        }

        // Искать внутренний товар по SKU (externalSku → внутренний sku)
        const product = await this.prisma.product.findFirst({
            where: { tenantId, sku: dto.externalSku, deletedAt: null },
        });

        if (!product) {
            this.logger.log(JSON.stringify({
                event: 'auto_match_failed',
                marketplace: dto.marketplace,
                externalSku: dto.externalSku,
                externalProductId: dto.externalProductId,
                tenantId,
            }));
            return { matched: false, mapping: null, alreadyExisted: false };
        }

        const mapping = await this.prisma.productChannelMapping.create({
            data: {
                tenantId,
                productId: product.id,
                marketplace: dto.marketplace,
                externalProductId: dto.externalProductId,
                externalSku: dto.externalSku,
                isAutoMatched: true,
                createdBy: userId ?? null,
            },
        });

        await this.auditService.logAction({
            actionType: ActionType.MAPPING_CREATED,
            productId: product.id,
            productSku: product.sku,
            actorUserId: actorEmail,
            tenantId,
            note: `Auto-match: ${dto.marketplace} → externalProductId=${dto.externalProductId} by SKU=${dto.externalSku}`,
        });

        return { matched: true, mapping, alreadyExisted: false };
    }

    // ------------------------------------------------------------------
    // DELETE MAPPING — удалить маппинг (чтобы можно было перепривязать)
    // ------------------------------------------------------------------

    async deleteMapping(mappingId: string, tenantId: string, actorEmail: string) {
        const mapping = await this.prisma.productChannelMapping.findUnique({
            where: { id: mappingId },
            include: { product: { select: { sku: true } } },
        });

        if (!mapping || mapping.tenantId !== tenantId) {
            throw new NotFoundException({ code: 'MAPPING_NOT_FOUND' });
        }

        await this.prisma.productChannelMapping.delete({ where: { id: mappingId } });

        await this.auditService.logAction({
            actionType: ActionType.MAPPING_DELETED,
            productId: mapping.productId,
            productSku: mapping.product?.sku,
            actorUserId: actorEmail,
            tenantId,
            note: `Mapping removed: ${mapping.marketplace} → externalProductId=${mapping.externalProductId}`,
        });

        return { message: 'Mapping deleted successfully' };
    }

    // ------------------------------------------------------------------
    // POST MERGE — слияние двух дублей
    //
    // Переносит все маппинги из source в target (пропуская конфликтующие),
    // затем soft-delete source. Target остаётся активным.
    // ------------------------------------------------------------------

    async mergeProducts(dto: MergeProductsDto, tenantId: string, actorEmail: string, userId?: string) {
        if (dto.sourceProductId === dto.targetProductId) {
            throw new BadRequestException({ code: 'MERGE_SAME_PRODUCT', message: 'Source and target must be different products' });
        }

        const [source, target] = await Promise.all([
            this.prisma.product.findFirst({ where: { id: dto.sourceProductId, tenantId, deletedAt: null } }),
            this.prisma.product.findFirst({ where: { id: dto.targetProductId, tenantId, deletedAt: null } }),
        ]);

        if (!source) throw new NotFoundException({ code: 'SOURCE_PRODUCT_NOT_FOUND' });
        if (!target) throw new NotFoundException({ code: 'TARGET_PRODUCT_NOT_FOUND' });

        // Маппинги source
        const sourceMappings = await this.prisma.productChannelMapping.findMany({
            where: { productId: dto.sourceProductId, tenantId },
        });

        // Уже существующие маппинги target (ключи: marketplace+externalProductId)
        const targetMappings = await this.prisma.productChannelMapping.findMany({
            where: { productId: dto.targetProductId, tenantId },
        });
        const targetKeys = new Set(targetMappings.map(m => `${m.marketplace}:${m.externalProductId}`));

        let transferred = 0;
        let skipped = 0;

        for (const sm of sourceMappings) {
            const key = `${sm.marketplace}:${sm.externalProductId}`;
            if (targetKeys.has(key)) {
                skipped++;
                continue;
            }
            await this.prisma.productChannelMapping.update({
                where: { id: sm.id },
                data: { productId: dto.targetProductId },
            });
            transferred++;
        }

        // Soft-delete source
        await this.prisma.product.update({
            where: { id: dto.sourceProductId },
            data: {
                deletedAt: new Date(),
                status: ProductStatus.DELETED,
                updatedBy: userId ?? null,
            },
        });

        await this.auditService.logAction({
            actionType: ActionType.PRODUCT_MERGED,
            productId: target.id,
            productSku: target.sku,
            actorUserId: actorEmail,
            tenantId,
            note: `Merged from: ${source.id} (sku=${source.sku}); transferred=${transferred}, skipped=${skipped}`,
        });

        this.logger.log(JSON.stringify({
            event: 'product_merge_completed',
            targetProductId: target.id,
            sourceProductId: source.id,
            mappingsTransferred: transferred,
            mappingsSkipped: skipped,
            tenantId,
        }));

        return {
            targetProductId: target.id,
            sourceProductId: source.id,
            mappingsTransferred: transferred,
            mappingsSkipped: skipped,
        };
    }
}
