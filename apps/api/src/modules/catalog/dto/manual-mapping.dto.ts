import { ChannelMarketplace } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class ManualMappingDto {
    @IsUUID()
    productId: string;

    @IsEnum(ChannelMarketplace)
    marketplace: ChannelMarketplace;

    @IsString()
    @IsNotEmpty()
    externalProductId: string;

    @IsString()
    @IsOptional()
    externalSku?: string;
}
