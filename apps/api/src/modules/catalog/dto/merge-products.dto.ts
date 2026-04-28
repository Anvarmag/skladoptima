import { IsUUID } from 'class-validator';

export class MergeProductsDto {
    // Товар-источник: будет soft-deleted, его маппинги переносятся в target
    @IsUUID()
    sourceProductId: string;

    // Товар-цель: остаётся активным, получает маппинги из source
    @IsUUID()
    targetProductId: string;
}
