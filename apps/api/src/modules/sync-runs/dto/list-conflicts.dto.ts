import { IsOptional, IsString, IsInt, Min, Max, IsUUID, IsIn, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * GET /sync/conflicts query параметры. По умолчанию `status=open` (только
 * незакрытые конфликты).
 */
export class ListConflictsDto {
    @IsOptional()
    @IsString()
    @IsIn(['open', 'resolved', 'all'])
    status?: 'open' | 'resolved' | 'all';

    @IsOptional()
    @IsString()
    @MaxLength(64)
    entityType?: string;

    @IsOptional()
    @IsUUID('4')
    runId?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number;
}
