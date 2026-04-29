import { IsString, MinLength } from 'class-validator';

export class AdminChangePasswordDto {
    @IsString()
    @MinLength(8)
    currentPassword!: string;

    @IsString()
    @MinLength(12)
    newPassword!: string;
}
