import {
    IsString,
    IsNotEmpty,
    IsInt,
    IsOptional,
    Min,
    MaxLength,
    IsISO8601,
} from 'class-validator';

export class ReconcileDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    sourceEventId!: string;

    @IsString()
    @IsNotEmpty()
    productId!: string;

    @IsString()
    @IsOptional()
    warehouseId?: string;

    @IsInt()
    @Min(0)
    externalAvailable!: number;

    // ISO-8601 timestamp внешнего события — используется для stale-detection.
    @IsISO8601()
    @IsOptional()
    externalEventAt?: string;

    @IsString()
    @IsOptional()
    @MaxLength(64)
    reasonCode?: string;
}
