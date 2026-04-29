import { IsString, IsOptional, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { MarketplaceType } from '@prisma/client';

export class ListStockLocksQuery {
    @IsString()
    @IsOptional()
    productId?: string;

    @IsEnum(MarketplaceType)
    @IsOptional()
    marketplace?: MarketplaceType;

    @IsInt()
    @Min(1)
    @IsOptional()
    @Type(() => Number)
    page?: number;

    @IsInt()
    @Min(1)
    @Max(100)
    @IsOptional()
    @Type(() => Number)
    limit?: number;
}
