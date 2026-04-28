import { ChannelMarketplace } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AutoMatchDto {
    @IsEnum(ChannelMarketplace)
    marketplace: ChannelMarketplace;

    @IsString()
    @IsNotEmpty()
    externalProductId: string;

    // Внешний SKU для поиска совпадающего внутреннего товара
    @IsString()
    @IsNotEmpty()
    externalSku: string;

    @IsString()
    @IsOptional()
    externalName?: string;
}
