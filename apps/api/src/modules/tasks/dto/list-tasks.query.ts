import {
    IsOptional,
    IsString,
    IsUUID,
    IsEnum,
    IsBoolean,
    IsInt,
    Min,
    Max,
    IsIn,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { TaskCategory, TaskPriority, TaskStatus } from '@prisma/client';

export class ListTasksQueryDto {
    /** "me" или UUID пользователя */
    @IsOptional()
    @IsString()
    assignee?: string;

    /** "me" или UUID пользователя */
    @IsOptional()
    @IsString()
    createdBy?: string;

    /** Comma-separated статусы: OPEN,IN_PROGRESS,WAITING */
    @IsOptional()
    @Transform(({ value }) => {
        if (!value) return undefined;
        const arr = typeof value === 'string'
            ? value.split(',').map((s: string) => s.trim().toUpperCase())
            : Array.isArray(value)
            ? (value as string[]).map((s) => String(s).toUpperCase())
            : [];
        return arr.filter(Boolean);
    })
    @IsEnum(TaskStatus, { each: true })
    status?: TaskStatus[];

    @IsOptional()
    @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
    @IsEnum(TaskCategory)
    category?: TaskCategory;

    @IsOptional()
    @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
    @IsEnum(TaskPriority)
    priority?: TaskPriority;

    /** overdue=true → dueAt < now AND status NOT IN (DONE, ARCHIVED) */
    @IsOptional()
    @Transform(({ value }) => value === 'true' || value === true)
    @IsBoolean()
    overdue?: boolean;

    @IsOptional()
    @IsUUID()
    relatedOrderId?: string;

    /** Поиск по title (case-insensitive contains) */
    @IsOptional()
    @IsString()
    search?: string;

    /** inbox → dueAt asc nulls last, createdAt desc; kanban → updatedAt desc */
    @IsOptional()
    @IsIn(['inbox', 'kanban'])
    view?: 'inbox' | 'kanban';

    @IsOptional()
    @Transform(({ value }) => parseInt(value, 10))
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Transform(({ value }) => parseInt(value, 10))
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number;
}
