import { IsUUID, IsOptional, IsString, Length } from 'class-validator';

export class ConfirmUploadDto {
    @IsUUID()
    fileId: string;

    // SHA-256 hex digest файла (lowercase, без разделителей). Если передан — сравнивается с S3 ETag/checksum.
    @IsString()
    @IsOptional()
    @Length(64, 64)
    checksumSha256?: string;
}
