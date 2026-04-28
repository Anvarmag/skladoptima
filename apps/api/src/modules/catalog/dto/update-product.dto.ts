import { IsString, IsOptional, IsNumber, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProductDto {
    @IsString()
    @IsOptional()
    sku?: string;

    @IsString()
    @IsOptional()
    name?: string;

    @IsString()
    @IsOptional()
    brand?: string;

    @IsString()
    @IsOptional()
    barcode?: string;

    @IsString()
    @IsOptional()
    wbBarcode?: string;

    @IsUUID()
    @IsOptional()
    mainImageFileId?: string;

    @IsNumber()
    @IsOptional()
    @Type(() => Number)
    @Min(0)
    ozonFbs?: number;

    @IsNumber()
    @IsOptional()
    @Type(() => Number)
    @Min(0)
    ozonFbo?: number;

    @IsNumber()
    @IsOptional()
    @Type(() => Number)
    @Min(0)
    wbFbs?: number;

    @IsNumber()
    @IsOptional()
    @Type(() => Number)
    @Min(0)
    wbFbo?: number;

    @IsNumber()
    @IsOptional()
    @Type(() => Number)
    @Min(0)
    purchasePrice?: number;

    @IsNumber()
    @IsOptional()
    @Type(() => Number)
    @Min(0)
    commissionRate?: number;

    @IsNumber()
    @IsOptional()
    @Type(() => Number)
    @Min(0)
    logisticsCost?: number;

    @IsString()
    @IsOptional()
    category?: string;

    @IsNumber()
    @IsOptional()
    @Type(() => Number)
    @Min(0)
    width?: number;

    @IsNumber()
    @IsOptional()
    @Type(() => Number)
    @Min(0)
    height?: number;

    @IsNumber()
    @IsOptional()
    @Type(() => Number)
    @Min(0)
    length?: number;

    @IsNumber()
    @IsOptional()
    @Type(() => Number)
    @Min(0)
    weight?: number;
}
