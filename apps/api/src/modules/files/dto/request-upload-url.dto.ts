import { IsEnum, IsUUID, IsString, IsInt, Min, Max, IsOptional, Length } from 'class-validator';
import { FileEntityType } from '@prisma/client';
import { MAX_FILE_SIZE_BYTES } from '../files.constants';

export class RequestUploadUrlDto {
    @IsEnum(FileEntityType)
    entityType: FileEntityType;

    @IsUUID()
    entityId: string;

    // Клиент декларирует MIME-тип до загрузки. Проверяется по allowlist (jpg/png/webp).
    @IsString()
    mimeType: string;

    // Декларируемый размер в байтах. Проверяется <= MAX_FILE_SIZE_BYTES и сравнивается с S3 HeadObject при confirm.
    @IsInt()
    @Min(1)
    @Max(MAX_FILE_SIZE_BYTES)
    sizeBytes: number;

    // Сохраняется как metadata ТОЛЬКО в БД. Никогда не попадает в object key.
    @IsString()
    @IsOptional()
    @Length(1, 255)
    originalFilename?: string;
}
