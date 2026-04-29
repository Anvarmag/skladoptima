import { IsEnum, ArrayMinSize } from 'class-validator';
import { MarketplaceType } from '@prisma/client';

export class UpdateChannelVisibilityDto {
    @IsEnum(MarketplaceType, { each: true })
    @ArrayMinSize(1, { message: 'visibleMarketplaces must contain at least one marketplace' })
    visibleMarketplaces!: MarketplaceType[];
}
