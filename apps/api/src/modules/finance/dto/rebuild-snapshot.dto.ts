import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { FinanceSnapshotPeriodType } from '@prisma/client';

/**
 * DTO для POST /finance/snapshots/rebuild.
 *
 * Owner/Admin only — гард применяется в сервисе через membership lookup.
 * `periodFrom/periodTo` принимаются как ISO date string и парсятся в
 * `Date` на entry-point'е.
 */
export class RebuildSnapshotDto {
    @IsDateString()
    periodFrom!: string;

    @IsDateString()
    periodTo!: string;

    @IsEnum(FinanceSnapshotPeriodType)
    @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
    periodType!: FinanceSnapshotPeriodType;

    @IsOptional()
    @IsString()
    jobKey?: string;
}
