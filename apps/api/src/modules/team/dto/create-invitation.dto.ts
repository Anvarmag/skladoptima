import { IsEmail, IsEnum, IsNotEmpty } from 'class-validator';
import { Role } from '@prisma/client';

export class CreateInvitationDto {
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @IsEnum(Role)
    role: Role;
}
