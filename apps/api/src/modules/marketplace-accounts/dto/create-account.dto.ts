import {
    IsString,
    IsNotEmpty,
    IsOptional,
    IsObject,
    MaxLength,
    IsIn,
} from 'class-validator';

/**
 * POST /marketplace-accounts. Поля credentials валидируются на уровне сервиса
 * под marketplace (см. §13 system-analytics) — DTO принимает opaque object,
 * чтобы не плодить DTO на каждый канал.
 */
export class CreateMarketplaceAccountDto {
    @IsString()
    @IsIn(['WB', 'OZON'], { message: 'marketplace must be WB or OZON' })
    marketplace!: 'WB' | 'OZON';

    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    label!: string;

    @IsObject()
    credentials!: Record<string, unknown>;
}
