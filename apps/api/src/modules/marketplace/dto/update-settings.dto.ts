import { IsString, IsOptional } from 'class-validator';

export class UpdateSettingsDto {
    @IsOptional()
    @IsString()
    ozonClientId?: string;

    @IsOptional()
    @IsString()
    ozonApiKey?: string;

    @IsOptional()
    @IsString()
    ozonWarehouseId?: string;

    @IsOptional()
    @IsString()
    wbApiKey?: string;

    @IsOptional()
    @IsString()
    wbStatApiKey?: string;

    @IsOptional()
    @IsString()
    wbWarehouseId?: string;
}
