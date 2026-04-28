import { Transform } from 'class-transformer';
import {
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    Max,
    Min,
} from 'class-validator';
import {
    MarketplaceType,
    OrderFulfillmentMode,
    OrderInternalStatus,
    OrderStockEffectStatus,
} from '@prisma/client';

/**
 * Query DTO для GET /api/v1/orders (TASK_ORDERS_5).
 *
 * Поля совпадают с операционными фильтрами §6/§7 system-analytics:
 * marketplace, fulfillmentMode, internalStatus, stockEffectStatus +
 * пагинация. Frontend ожидает camelCase, в URL допустимы lowercase
 * аналоги через @Transform — но валидация всегда нормализует к
 * Prisma enum-значениям.
 */
export class ListOrdersQueryDto {
    @IsOptional()
    @IsEnum(MarketplaceType)
    @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
    marketplace?: MarketplaceType;

    @IsOptional()
    @IsEnum(OrderFulfillmentMode)
    @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
    fulfillmentMode?: OrderFulfillmentMode;

    @IsOptional()
    @IsEnum(OrderInternalStatus)
    @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
    internalStatus?: OrderInternalStatus;

    @IsOptional()
    @IsEnum(OrderStockEffectStatus)
    @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
    stockEffectStatus?: OrderStockEffectStatus;

    /** Поиск по `marketplaceOrderId` (точное совпадение либо ILIKE prefix). */
    @IsOptional()
    @IsString()
    search?: string;

    @IsOptional()
    @Transform(({ value }) => parseInt(value, 10))
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Transform(({ value }) => parseInt(value, 10))
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number;
}
