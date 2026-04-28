import { IsString, IsNotEmpty, IsNumberString, IsOptional, IsNumber, IsUUID, Min } from 'class-validator';
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
    brand?: string;

    @IsString()
    @IsOptional()
    barcode?: string;

    @IsString()
    @IsOptional()
    wbBarcode?: string;

    @IsNumberString()
    @IsOptional()
    initialTotal?: string;

    // Если передан — сервис свяжет главное фото через Files/S3 (UUID файла)
    @IsUUID()
    @IsOptional()
    mainImageFileId?: string;

    // Явное подтверждение восстановления soft-deleted товара с тем же SKU.
    // Должен совпадать с id удалённого товара из ответа SKU_SOFT_DELETED.
    @IsUUID()
    @IsOptional()
    confirmRestoreId?: string;

    // note: 'photo' обрабатывается multer interceptor (legacy upload)

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
