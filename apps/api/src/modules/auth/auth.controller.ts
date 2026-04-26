import { Controller, Post, Body, Res, Get, Req, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserService } from '../users/user.service';
import { CsrfService } from './csrf.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Public } from './public.decorator';

const ACCESS_TOKEN_COOKIE_TTL = 15 * 60 * 1000;       // 15 минут
const REFRESH_TOKEN_COOKIE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 дней (sync с аналитикой)

@Controller('auth')
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly userService: UserService,
        private readonly csrfService: CsrfService,
    ) {}

    @Public()
    @Get('csrf-token')
    getCsrfToken(@Res({ passthrough: true }) res: any) {
        const token = this.csrfService.generateToken();
        const secure = process.env.FORCE_HTTPS === 'true';
        res.cookie('csrf-token', token, {
            httpOnly: false, // must be readable by JS for double-submit pattern
            secure,
            sameSite: secure ? 'strict' : 'lax',
            path: '/',
            maxAge: 24 * 60 * 60 * 1000,
        });
        return { csrfToken: token };
    }

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
    async login(@Body() loginDto: LoginDto, @Req() req: any, @Res({ passthrough: true }) res: any) {
        const ip = req.ip ?? req.connection?.remoteAddress;
        const userAgent = req.headers['user-agent'];

        const user = await this.authService.validateUser(loginDto, ip);
        const { accessToken, rawRefreshToken } = await this.authService.loginUser(user.id, ip, userAgent);

        this.setAuthCookies(res, accessToken, rawRefreshToken);
        return { ok: true };
    }

    @Public()
    @Post('refresh')
    async refresh(@Req() req: any, @Res({ passthrough: true }) res: any) {
        const rawRefreshToken = req.cookies?.['Refresh'];
        if (!rawRefreshToken) {
            throw new UnauthorizedException({ code: 'AUTH_REFRESH_TOKEN_MISSING' });
        }

        const ip = req.ip ?? req.connection?.remoteAddress;
        const userAgent = req.headers['user-agent'];

        const { accessToken, rawRefreshToken: newRaw } =
            await this.authService.refreshSession(rawRefreshToken, ip, userAgent);

        this.setAuthCookies(res, accessToken, newRaw);
        return { ok: true };
    }

    @Post('logout')
    async logout(@Req() req: any, @Res({ passthrough: true }) res: any) {
        const ip = req.ip ?? req.connection?.remoteAddress;
        if (req.user?.sessionId) {
            await this.authService.revokeSession(req.user.sessionId, { userId: req.user.id, ip });
        }
        this.clearAuthCookies(res);
        return { ok: true };
    }

    @Post('logout-all')
    async logoutAll(@Req() req: any, @Res({ passthrough: true }) res: any) {
        const ip = req.ip ?? req.connection?.remoteAddress;
        await this.authService.revokeAllSessions(req.user.id, ip);
        this.clearAuthCookies(res);
        return { ok: true };
    }

    @Get('me')
    getMe(@Req() req: any) {
        return this.authService.getMe(req.user.id, req.user.sessionId);
    }

    // ─── Password Reset / Change ─────────────────────────────────────────────────

    @Public()
    @Post('password-resets')
    forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: any) {
        const ip = req.ip ?? req.connection?.remoteAddress;
        return this.authService.forgotPassword(dto.email, ip);
    }

    @Public()
    @Post('password-resets/confirm')
    async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: any, @Res({ passthrough: true }) res: any) {
        const ip = req.ip ?? req.connection?.remoteAddress;
        const result = await this.authService.resetPassword(dto.token, dto.newPassword, ip);
        this.clearAuthCookies(res);
        return result;
    }

    @Post('change-password')
    changePassword(@Body() dto: ChangePasswordDto, @Req() req: any) {
        const ip = req.ip ?? req.connection?.remoteAddress;
        return this.authService.changePassword(
            req.user.id,
            req.user.sessionId,
            dto.currentPassword,
            dto.newPassword,
            ip,
        );
    }

    // ─── Telegram (legacy) ────────────────────────────────────────────────────────

    @Public()
    @Post('telegram')
    async telegramAuth(@Body('initData') initData: string, @Req() req: any, @Res({ passthrough: true }) res: any) {
        const user = await this.authService.validateTelegramAuth(initData);
        const ip = req.ip ?? req.connection?.remoteAddress;
        const userAgent = req.headers['user-agent'];

        const { accessToken, rawRefreshToken } = await this.authService.loginUser(user.id, ip, userAgent);
        this.setAuthCookies(res, accessToken, rawRefreshToken);
        return { ok: true };
    }

    @Public()
    @Post('telegram/link')
    async telegramLink(
        @Body('initData') initData: string,
        @Body('email') email: string,
        @Body('password') password: string,
        @Req() req: any,
        @Res({ passthrough: true }) res: any,
    ) {
        const user = await this.authService.linkTelegramAccount(initData, { email, password });
        const ip = req.ip ?? req.connection?.remoteAddress;
        const userAgent = req.headers['user-agent'];

        const { accessToken, rawRefreshToken } = await this.authService.loginUser((user as any).id, ip, userAgent);
        this.setAuthCookies(res, accessToken, rawRefreshToken);
        return { ok: true };
    }

    @Post('telegram/unlink')
    async telegramUnlink(@Req() req: any, @Res({ passthrough: true }) res: any) {
        await this.authService.unlinkTelegramAccount(req.user.id);
        this.clearAuthCookies(res);
        return { ok: true };
    }

    // ─── Cookie helpers ───────────────────────────────────────────────────────────

    private setAuthCookies(res: any, accessToken: string, rawRefreshToken: string) {
        const secure = process.env.FORCE_HTTPS === 'true';
        const sameSite = secure ? 'strict' : 'lax';

        res.cookie('Authentication', accessToken, {
            httpOnly: true,
            secure,
            sameSite,
            path: '/',
            maxAge: ACCESS_TOKEN_COOKIE_TTL,
        });

        res.cookie('Refresh', rawRefreshToken, {
            httpOnly: true,
            secure,
            sameSite,
            path: '/auth/refresh',
            maxAge: REFRESH_TOKEN_COOKIE_TTL,
        });
    }

    private clearAuthCookies(res: any) {
        const secure = process.env.FORCE_HTTPS === 'true';
        res.cookie('Authentication', '', { httpOnly: true, secure, path: '/', expires: new Date(0) });
        res.cookie('Refresh', '', { httpOnly: true, secure, path: '/auth/refresh', expires: new Date(0) });
    }
}
