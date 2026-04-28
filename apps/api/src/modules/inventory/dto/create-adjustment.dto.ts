import {
    IsString,
    IsNotEmpty,
    IsOptional,
    IsInt,
    ValidateIf,
    MaxLength,
    Matches,
} from 'class-validator';

/**
 * Корректировка остатка. Поддерживает два режима:
 *   - `delta`           — относительное изменение (+/- к текущему onHand)
 *   - `targetQuantity`  — абсолютное значение (сервис считает delta = target - current)
 * Обязательно ровно одно из двух полей. `reasonCode` обязателен по политике §10.
 */
export class CreateAdjustmentDto {
    @IsString()
    @IsNotEmpty()
    productId!: string;

    @IsString()
    @IsOptional()
    warehouseId?: string;

    @ValidateIf((o) => o.targetQuantity === undefined || o.targetQuantity === null)
    @IsInt()
    delta?: number;

    @ValidateIf((o) => o.delta === undefined || o.delta === null)
    @IsInt()
    targetQuantity?: number;

    // reasonCode — короткий машинный код (LOSS, FOUND, INVENTORY, RECOUNT, ...).
    // Бизнес-правило: обязательно для всех manual-корректировок.
    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    @Matches(/^[A-Z0-9_]+$/, {
        message: 'reasonCode must be UPPER_SNAKE_CASE',
    })
    reasonCode!: string;

    @IsString()
    @IsOptional()
    @MaxLength(2000)
    comment?: string;

    // Опциональный idempotencyKey для защиты повторного применения той же корректировки
    // (UI с retry, double-click, и т.д.).
    @IsString()
    @IsOptional()
    @MaxLength(128)
    idempotencyKey?: string;
}
