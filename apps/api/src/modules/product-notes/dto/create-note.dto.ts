import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum ProductNoteCategory {
    PRICE  = 'PRICE',
    CARD   = 'CARD',
    SUPPLY = 'SUPPLY',
    OTHER  = 'OTHER',
}

export class CreateProductNoteDto {
    @IsEnum(ProductNoteCategory)
    @IsOptional()
    category?: ProductNoteCategory;

    @IsString()
    @MaxLength(255)
    title: string;

    @IsString()
    @IsOptional()
    body?: string;

    @IsString()
    @IsOptional()
    date?: string;
}
