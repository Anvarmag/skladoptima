import { IsString, IsNotEmpty, IsNumberString, IsOptional, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductDto {
    @IsString()
    @IsNotEmpty()
    sku: string;

    @IsString()
    @IsNotEmpty()
    name: string;

    @IsString()
    @IsOptional()
    wbBarcode?: string;  // WB штрихкод (баркод) для синхронизации остатков через WB API

    @IsNumberString()
    @IsOptional()
    initialTotal?: string;

    // note: 'photo' will be handled by multer interceptor

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
