import { IsString, MinLength, MaxLength } from 'class-validator';

/// High-risk action — reason >= 10 символов (см. 19-admin §10).
export class ExtendTrialDto {
    @IsString()
    @MinLength(10, { message: 'reason must be at least 10 characters' })
    @MaxLength(2000)
    reason: string;
}
