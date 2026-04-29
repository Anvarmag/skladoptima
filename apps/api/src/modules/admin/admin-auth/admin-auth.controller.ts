import {
    Body,
    Controller,
    Get,
    Post,
    Req,
    Res,
    UnauthorizedException,
    UseGuards,
} from '@nestjs/common';
import { CsrfService } from '../../auth/csrf.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminEndpoint } from './decorators/admin-endpoint.decorator';
import { AdminPublic } from './decorators/admin-public.decorator';
import { CurrentSupportUser } from './decorators/current-support-user.decorator';
import type { SupportUserContext } from './decorators/current-support-user.decorator';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminChangePasswordDto } from './dto/admin-change-password.dto';

const ACCESS_COOKIE = 'AdminAuthentication';
const REFRESH_COOKIE = 'AdminRefresh';
const CSRF_COOKIE = 'admin-csrf-token';

const ACCESS_TOKEN_COOKIE_TTL_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_COOKIE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CSRF_COOKIE_TTL_MS = 24 * 60 * 60 * 1000;

const REFRESH_COOKIE_PATH = '/api/admin/auth/refresh';

@AdminEndpoint()
@UseGuards(AdminAuthGuard)
@Controller('admin/auth')
export class AdminAuthController {
    constructor(
        private readonly adminAuthService: AdminAuthService,
        private readonly csrfService: CsrfService,
    ) {}

    // ─── CSRF token (double-submit) ─────────────────────────────────────────

    @AdminPublic()
    @Get('csrf-token')
    getCsrfToken(@Res({ passthrough: true }) res: any) {
        const token = this.csrfService.generateToken();
        const secure = process.env.FORCE_HTTPS === 'true';
        res.cookie(CSRF_COOKIE, token, {
            httpOnly: false, // double-submit pattern требует читаемости JS
            secure,
            sameSite: secure ? 'strict' : 'lax',
            path: '/',
            maxAge: CSRF_COOKIE_TTL_MS,
        });
        return { csrfToken: token };
    }

    // ─── Login ──────────────────────────────────────────────────────────────

    @AdminPublic()
    @Post('login')
    async login(
        @Body() dto: AdminLoginDto,
        @Req() req: any,
        @Res({ passthrough: true }) res: any,
    ) {
        const ip = this.extractIp(req);
        const userAgent = this.extractUserAgent(req);

        const result = await this.adminAuthService.login(
            dto.email,
            dto.password,
            ip,
            userAgent,
        );

        this.setAuthCookies(res, result.accessToken, result.rawRefreshToken);

        return {
            ok: true,
            supportUser: result.supportUser,
        };
    }

    // ─── Refresh ────────────────────────────────────────────────────────────

    @AdminPublic()
    @Post('refresh')
    async refresh(@Req() req: any, @Res({ passthrough: true }) res: any) {
        const raw = req.cookies?.[REFRESH_COOKIE];
        if (!raw) {
            throw new UnauthorizedException({ code: 'ADMIN_AUTH_REFRESH_MISSING' });
        }
        const ip = this.extractIp(req);
        const userAgent = this.extractUserAgent(req);
        const result = await this.adminAuthService.refresh(raw, ip, userAgent);
        this.setAuthCookies(res, result.accessToken, result.rawRefreshToken);
        return { ok: true };
    }

    // ─── Me ─────────────────────────────────────────────────────────────────

    @Get('me')
    me(@CurrentSupportUser() actor: SupportUserContext) {
        return {
            supportUser: {
                id: actor.id,
                role: actor.role,
            },
            sessionId: actor.sessionId,
        };
    }

    // ─── Logout ─────────────────────────────────────────────────────────────

    @Post('logout')
    async logout(
        @CurrentSupportUser() actor: SupportUserContext,
        @Req() req: any,
        @Res({ passthrough: true }) res: any,
    ) {
        await this.adminAuthService.revokeSession(
            actor.sessionId,
            actor.id,
            this.extractIp(req),
        );
        this.clearAuthCookies(res);
        return { ok: true };
    }

    // ─── Change password ────────────────────────────────────────────────────

    @Post('change-password')
    async changePassword(
        @CurrentSupportUser() actor: SupportUserContext,
        @Body() dto: AdminChangePasswordDto,
        @Req() req: any,
    ) {
        await this.adminAuthService.changePassword(
            actor.id,
            actor.sessionId,
            dto.currentPassword,
            dto.newPassword,
            this.extractIp(req),
        );
        return { ok: true };
    }

    // ─── helpers ───────────────────────────────────────────────────────────

    private extractIp(req: any): string | null {
        return (
            ((req.headers?.['x-forwarded-for'] as string) ?? '')
                .split(',')[0]
                ?.trim() ||
            req.ip ||
            req.socket?.remoteAddress ||
            null
        );
    }

    private extractUserAgent(req: any): string | null {
        return (req.headers?.['user-agent'] as string) ?? null;
    }

    private setAuthCookies(res: any, accessToken: string, refreshToken: string) {
        const secure = process.env.FORCE_HTTPS === 'true';
        const sameSite = secure ? 'strict' : 'lax';

        res.cookie(ACCESS_COOKIE, accessToken, {
            httpOnly: true,
            secure,
            sameSite,
            path: '/',
            maxAge: ACCESS_TOKEN_COOKIE_TTL_MS,
        });
        res.cookie(REFRESH_COOKIE, refreshToken, {
            httpOnly: true,
            secure,
            sameSite,
            path: REFRESH_COOKIE_PATH,
            maxAge: REFRESH_TOKEN_COOKIE_TTL_MS,
        });
    }

    private clearAuthCookies(res: any) {
        const secure = process.env.FORCE_HTTPS === 'true';
        res.cookie(ACCESS_COOKIE, '', {
            httpOnly: true,
            secure,
            path: '/',
            expires: new Date(0),
        });
        res.cookie(REFRESH_COOKIE, '', {
            httpOnly: true,
            secure,
            path: REFRESH_COOKIE_PATH,
            expires: new Date(0),
        });
    }
}
