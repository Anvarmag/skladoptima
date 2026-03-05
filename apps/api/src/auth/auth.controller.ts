import { Controller, Post, Body, Res, Get, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Public()
    @Post('login')
    async login(@Body() loginDto: LoginDto, @Res({ passthrough: true }) res: any) {
        const user = await this.authService.validateUser(loginDto);
        const { access_token } = await this.authService.login(user);

        const useSecure = process.env.FORCE_HTTPS === 'true';

        // Cookie для авторизации
        res.cookie('Authentication', access_token, {
            httpOnly: true,
            secure: useSecure,
            sameSite: useSecure ? 'strict' : 'lax',
            path: '/',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 дней
        });

        return { message: 'Logged in successfully', user };
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
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        return { message: 'Telegram auth successful', user };
    }

    @Public()
    @Post('logout')
    async logout(@Res({ passthrough: true }) res: any) {
        res.cookie('Authentication', '', {
            httpOnly: true,
            path: '/',
            expires: new Date(0),
        });

        return { message: 'Logged out successfully' };
    }

    @UseGuards(JwtAuthGuard)
    @Get('me')
    getProfile(@Req() req: any) {
        return req.user;
    }
}