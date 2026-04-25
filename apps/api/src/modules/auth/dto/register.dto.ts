import { IsEmail, IsString, MinLength, IsOptional, Matches } from 'class-validator';

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
}
