import {
    IsString,
    IsNotEmpty,
    IsEnum,
    IsOptional,
    IsInt,
    Min,
    MaxLength,
    ValidateIf,
} from 'class-validator';
import { MarketplaceType, StockLockType } from '@prisma/client';

export class CreateStockLockDto {
    @IsString()
    @IsNotEmpty()
    productId!: string;

    @IsEnum(MarketplaceType)
    marketplace!: MarketplaceType;

    @IsEnum(StockLockType)
    lockType!: StockLockType;

    // fixedValue обязателен и неотрицателен только для FIXED
    @ValidateIf((o) => o.lockType === StockLockType.FIXED)
    @IsInt()
    @Min(0, { message: 'fixedValue must be non-negative' })
    fixedValue?: number;

    @IsString()
    @IsOptional()
    @MaxLength(500)
    note?: string;
}
