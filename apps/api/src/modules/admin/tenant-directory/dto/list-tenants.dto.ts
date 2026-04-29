import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { AccessState, TenantStatus } from '@prisma/client';

/// Query DTO для GET /api/admin/tenants. Все поля опциональны.
/// `q` — общий поиск по id (UUID), name (ILIKE), owner email (ILIKE).
/// Bounded `limit` защищает summary read-path от случайного "вытащить всех".
export class ListTenantsDto {
    @IsOptional()
    @IsString()
    @MaxLength(256)
    q?: string;

    @IsOptional()
    @IsEnum(AccessState as object)
    accessState?: AccessState;

    @IsOptional()
    @IsEnum(TenantStatus as object)
    status?: TenantStatus;

    @IsOptional()
    @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number;

    @IsOptional()
    @IsString()
    @MaxLength(64)
    cursor?: string;
}
