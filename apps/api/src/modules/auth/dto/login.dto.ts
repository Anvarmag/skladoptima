import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class LoginDto {
    @IsString()
    @IsNotEmpty()
    email: string; // Used as generic username field now

    @IsNotEmpty()
    @MinLength(4)
    password: string;
}
