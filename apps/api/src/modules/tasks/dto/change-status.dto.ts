import { IsEnum, IsNotEmpty } from 'class-validator';
import { TaskStatus } from '@prisma/client';

export class ChangeStatusDto {
    @IsEnum(TaskStatus)
    @IsNotEmpty()
    status!: TaskStatus;
}
