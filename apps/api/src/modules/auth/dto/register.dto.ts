import { IsEmail, IsString, MinLength, IsOptional, Matches, MaxLength } from 'class-validator';

export class RegisterDto {
    @IsEmail()
    email: string;

    @IsString()
    @IsOptional()
    @Matches(/^\+?[1-9]\d{7,14}$/, { message: 'phone must be a valid E.164 number' })
    phone?: string;

    @IsString()
    @MinLength(8)
    password: string;

    // ─── TASK_REFERRALS_1: attribution context ────────────────────────
    // Все поля optional — регистрация работает и без referral.

    @IsOptional()
    @IsString()
    @MaxLength(32)
    referralCode?: string;

    @IsOptional()
    @IsString()
    @MaxLength(128)
    utmSource?: string;

    @IsOptional()
    @IsString()
    @MaxLength(128)
    utmMedium?: string;

    @IsOptional()
    @IsString()
    @MaxLength(128)
    utmCampaign?: string;

    @IsOptional()
    @IsString()
    @MaxLength(128)
    utmContent?: string;

    @IsOptional()
    @IsString()
    @MaxLength(128)
    utmTerm?: string;
}
