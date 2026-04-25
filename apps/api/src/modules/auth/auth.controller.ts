import { Controller, Post, Body, Res, Get, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserService } from '../users/user.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly userService: UserService,
    ) {}

    @Public()
    @Post('register')
    register(@Body() dto: RegisterDto) {
        return this.authService.register(dto);
    }

    @Public()
    @Post('email-verifications/confirm')
    verifyEmail(@Body() dto: VerifyEmailDto) {
        return this.authService.verifyEmail(dto.token);
    }

    @Public()
    @Post('email-verifications')
    resendVerification(@Body() dto: ResendVerificationDto) {
        return this.authService.resendVerification(dto.email);
    }

    @Public()
    @Post('login')
    async login(@Body() loginDto: LoginDto, @Res({ passthrough: true }) res: any) {
        const user = await this.authService.validateUser(loginDto);
        const { access_token } = await this.authService.login(user);

        const useSecure = process.env.FORCE_HTTPS === 'true';
        res.cookie('Authentication', access_token, {
            httpOnly: true,
            secure: useSecure,
            sameSite: useSecure ? 'strict' : 'lax',
            path: '/',
            maxAge: 15 * 60 * 1000, // 15 минут (access token TTL)
        });

        return { user, access_token };
    }

    @Public()
    @Post('telegram')
    async telegramAuth(@Body('initData') initData: string, @Res({ passthrough: true }) res: any) {
        const user = await this.authService.validateTelegramAuth(initData);
        const { access_token } = await this.authService.login(user);

        const useSecure = process.env.FORCE_HTTPS === 'true';
        res.cookie('Authentication', access_token, {
            httpOnly: true,
            secure: useSecure,
            sameSite: useSecure ? 'none' : 'lax',
            path: '/',
            maxAge: 15 * 60 * 1000,
        });

        return { user, access_token };
    }

    @Public()
    @Post('telegram/link')
    async telegramLink(
        @Body('initData') initData: string,
        @Body('email') email: string,
        @Body('password') passwordPlain: string,
        @Res({ passthrough: true }) res: any,
    ) {
        const user = await this.authService.linkTelegramAccount(initData, { email, password: passwordPlain });
        const { access_token } = await this.authService.login(user);

        const useSecure = process.env.FORCE_HTTPS === 'true';
        res.cookie('Authentication', access_token, {
            httpOnly: true,
            secure: useSecure,
            sameSite: useSecure ? 'none' : 'lax',
            path: '/',
            maxAge: 15 * 60 * 1000,
        });

        return { message: 'Account linked successfully', user, access_token };
    }

    @Public()
    @Post('logout')
    logout(@Res({ passthrough: true }) res: any) {
        res.cookie('Authentication', '', { httpOnly: true, path: '/', expires: new Date(0) });
        return { message: 'Logged out successfully' };
    }

    @Post('telegram/unlink')
    async telegramUnlink(@Req() req: any, @Res({ passthrough: true }) res: any) {
        await this.authService.unlinkTelegramAccount(req.user.id);
        res.cookie('Authentication', '', { httpOnly: true, path: '/', expires: new Date(0) });
        return { message: 'Account unlinked and logged out' };
    }

    @Get('me')
    getProfile(@Req() req: any) {
        return req.user;
    }
}
