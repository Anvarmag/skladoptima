import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';

export class ImportRowDto {
    @IsString()
    @IsNotEmpty()
    sku: string;

    @IsString()
    @IsNotEmpty()
    name: string;

    @IsString()
    @IsOptional()
    brand?: string;

    @IsString()
    @IsOptional()
    barcode?: string;

    @IsString()
    @IsOptional()
    category?: string;
}

export class ImportPreviewDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ImportRowDto)
    rows: ImportRowDto[];
}
