import { IsOptional, IsString, IsInt, Min, Max, IsUUID, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { SyncRunStatus, SyncTriggerType } from '@prisma/client';

/**
 * GET /sync/runs — query параметры. Все опциональны: без фильтра отдаются
 * последние 20 run'ов tenant'а в порядке `createdAt DESC`.
 */
export class ListSyncRunsDto {
    @IsOptional()
    @IsUUID('4')
    accountId?: string;

    @IsOptional()
    @IsString()
    @IsIn(Object.values(SyncRunStatus))
    status?: SyncRunStatus;

    @IsOptional()
    @IsString()
    @IsIn(Object.values(SyncTriggerType))
    triggerType?: SyncTriggerType;

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
