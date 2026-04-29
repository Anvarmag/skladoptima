import {
    IsString,
    IsOptional,
    IsEnum,
    MaxLength,
    IsDateString,
    IsArray,
    ValidateIf,
} from 'class-validator';
import { TaskCategory, TaskPriority } from '@prisma/client';

export class UpdateTaskDto {
    @IsString()
    @IsOptional()
    @MaxLength(255)
    title?: string;

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

    // null — снять дедлайн, строка — установить новый, undefined — не менять
    @IsOptional()
    @ValidateIf((o) => o.dueAt !== null)
    @IsDateString()
    dueAt?: string | null;

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    tags?: string[];
}
