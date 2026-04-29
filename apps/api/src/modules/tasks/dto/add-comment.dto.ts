import { IsString, IsNotEmpty, IsEnum, IsOptional, MaxLength } from 'class-validator';
import { TaskCommentVisibility } from '@prisma/client';

export class AddCommentDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(10000)
    body!: string;

    @IsEnum(TaskCommentVisibility)
    @IsOptional()
    visibility?: TaskCommentVisibility;
}
