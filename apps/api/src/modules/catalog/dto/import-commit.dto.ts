import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ImportCommitDto {
    @IsUUID()
    jobId: string;

    // Клиент генерирует этот ключ. Повторный commit с тем же ключом вернёт
    // результат первого выполнения без повторного создания товаров.
    @IsString()
    @IsOptional()
    idempotencyKey?: string;
}
