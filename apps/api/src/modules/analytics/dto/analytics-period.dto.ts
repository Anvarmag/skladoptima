import { IsDateString, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AnalyticsAbcMetric, MarketplaceType } from '@prisma/client';

/**
 * Базовый period query: `from / to` как ISO date string (YYYY-MM-DD).
 *
 * §10 ограничение длины окна валидируется в сервисе через
 * `ANALYTICS_MAX_PERIOD_DAYS` — DTO не дублирует его, чтобы единый
 * источник истины для бизнес-правила оставался в `analytics.constants`.
 */
export class AnalyticsPeriodDto {
    @IsDateString()
    from!: string;

    @IsDateString()
    to!: string;
}

export class TopProductsQueryDto extends AnalyticsPeriodDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number;

    @IsOptional()
    @IsEnum(MarketplaceType)
    marketplace?: MarketplaceType;
}

export class RebuildDailyDto extends AnalyticsPeriodDto {}

export class AbcQueryDto extends AnalyticsPeriodDto {
    @IsOptional()
    @IsEnum(AnalyticsAbcMetric)
    metric?: AnalyticsAbcMetric;
}

export class RebuildAbcDto extends AbcQueryDto {}

export class ExportQueryDto extends AnalyticsPeriodDto {
    @IsEnum(['daily', 'abc'] as any)
    target!: 'daily' | 'abc';

    @IsOptional()
    @IsEnum(['csv', 'json'] as any)
    format?: 'csv' | 'json';

    @IsOptional()
    @IsEnum(AnalyticsAbcMetric)
    metric?: AnalyticsAbcMetric;
}
