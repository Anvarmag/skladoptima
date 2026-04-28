import {
    IsString,
    IsOptional,
    MaxLength,
    IsArray,
    ArrayMaxSize,
} from 'class-validator';

/**
 * PATCH /warehouses/:id/metadata — единственный write-путь для tenant-local
 * полей `aliasName` и `labels` (см. §13/§20 system-analytics).
 *
 * Лимиты заданы в соответствии с DB schema (TASK_WAREHOUSES_1):
 *   - aliasName: VARCHAR(255), nullable;
 *   - labels: TEXT[] DEFAULT [], в MVP ограничиваем до 20 элементов и 64 chars
 *     каждый, чтобы UI search/groupping оставались читабельными.
 *
 * Внешние идентификационные поля (`externalWarehouseId`, `name`, `city`,
 * `warehouseType`, `sourceMarketplace`) НЕЛЬЗЯ менять через это API —
 * они принимаются только sync-сервисом.
 */
export class UpdateMetadataDto {
    @IsOptional()
    @IsString()
    @MaxLength(255, { context: { code: 'WAREHOUSE_METADATA_TOO_LONG', field: 'aliasName' } })
    aliasName?: string | null;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(20, { context: { code: 'WAREHOUSE_LABELS_TOO_MANY' } })
    labels?: string[];
}
