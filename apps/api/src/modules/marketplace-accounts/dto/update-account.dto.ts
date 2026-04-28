import {
    IsString,
    IsOptional,
    IsObject,
    MaxLength,
} from 'class-validator';

/**
 * PATCH /marketplace-accounts/:id. Любое поле опционально:
 *   - `label` — переименование подключения;
 *   - `credentials` — partial update секрет-полей (значения мерджатся с уже
 *     зашифрованными в БД, в response старые значения НЕ возвращаются).
 *
 * Marketplace через PATCH менять нельзя — это identity-поле подключения.
 */
export class UpdateMarketplaceAccountDto {
    @IsOptional()
    @IsString()
    @MaxLength(128)
    label?: string;

    @IsOptional()
    @IsObject()
    credentials?: Record<string, unknown>;
}
