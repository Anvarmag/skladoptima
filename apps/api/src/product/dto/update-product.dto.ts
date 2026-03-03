import { IsString, IsOptional, IsNumber, Min } from 'class-validator';
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
    wbBarcode?: string;

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
}
