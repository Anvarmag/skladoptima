import { IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

/**
 * DTO для PATCH /finance/products/:productId/cost.
 *
 * §10 + §13: разрешены только три поля. Любые другие поля в payload
 * проигнорируются (whitelist через class-validator + ValidationPipe
 * `whitelist: true` в main.ts).
 *
 * `null` явно разрешён → стирание значения. `undefined` (поле не
 * передано) → оставить как есть. Это два разных интента — DTO их
 * различает.
 */
export class UpdateProductCostDto {
    @IsOptional()
    @IsNumber()
    @Min(0)
    baseCost?: number | null;

    @IsOptional()
    @IsNumber()
    @Min(0)
    packagingCost?: number | null;

    @IsOptional()
    @IsNumber()
    @Min(0)
    additionalCost?: number | null;

    @IsOptional()
    @IsString()
    @Length(3, 3)
    costCurrency?: string;
}
