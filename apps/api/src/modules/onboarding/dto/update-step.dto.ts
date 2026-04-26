import { IsIn, IsNotEmpty } from 'class-validator';

export class UpdateStepDto {
    @IsNotEmpty()
    @IsIn(['done', 'skipped', 'viewed'])
    status: 'done' | 'skipped' | 'viewed';
}
