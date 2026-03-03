import { IsNumber, IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class AdjustStockDto {
    @IsNumber()
    @IsNotEmpty()
    delta: number;

    @IsString()
    @IsOptional()
    note?: string;
}
