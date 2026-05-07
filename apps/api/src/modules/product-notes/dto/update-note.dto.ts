import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ProductNoteCategory } from './create-note.dto';

export class UpdateProductNoteDto {
    @IsEnum(ProductNoteCategory)
    @IsOptional()
    category?: ProductNoteCategory;

    @IsString()
    @MaxLength(255)
    @IsOptional()
    title?: string;

    @IsString()
    @IsOptional()
    body?: string;

    @IsString()
    @IsOptional()
    date?: string;
}
