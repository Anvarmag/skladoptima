import {
    IsString,
    IsNotEmpty,
    IsEnum,
    IsOptional,
    IsUUID,
    IsDateString,
    MaxLength,
    IsArray,
} from 'class-validator';
import { TaskCategory, TaskPriority } from '@prisma/client';

export class CreateTaskDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    title!: string;

    @IsString()
    @IsOptional()
    @MaxLength(10000)
    description?: string;

    @IsEnum(TaskCategory)
    @IsOptional()
    category?: TaskCategory;

    @IsEnum(TaskPriority)
    @IsOptional()
    priority?: TaskPriority;

    @IsUUID()
    @IsNotEmpty()
    assigneeUserId!: string;

    @IsUUID()
    @IsOptional()
    relatedOrderId?: string;

    @IsUUID()
    @IsOptional()
    relatedProductId?: string;

    @IsDateString()
    @IsOptional()
    dueAt?: string;

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    tags?: string[];
}
