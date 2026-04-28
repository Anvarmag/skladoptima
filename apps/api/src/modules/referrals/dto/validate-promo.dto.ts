import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class ValidatePromoDto {
    @IsString()
    @IsNotEmpty()
    code: string;

    @IsString()
    @IsNotEmpty()
    planId: string;

    @IsNumber()
    @Min(0)
    @IsOptional()
    bonusSpend?: number;
}
