import {
    BadRequestException,
    Injectable,
    Logger,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SupportSecurityEventType, SupportUserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';

const ACCESS_TOKEN_TTL_S = 15 * 60;                       // 15 минут
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;     // 7 дней
const SOFT_LOCK_WINDOW_MS = 15 * 60 * 1000;               // 15 минут
const SOFT_LOCK_MAX_ATTEMPTS = 5;
const TIMING_DUMMY_HASH =
    '$2b$12$abcdefghijklmnopqrstu.ABCDEFGHIJKLMNOPQRSTUVWXYZ12345';

export interface AdminJwtPayload {
    sub: string;             // supportUserId
    sessionId: string;
    role: SupportUserRole;
    aud: 'admin';            // явный audience-маркер для разделения с tenant JWT
}

@Injectable()
export class AdminAuthService {
    private readonly logger = new Logger(AdminAuthService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly jwt: JwtService,
    ) {}

    // ─── Login ──────────────────────────────────────────────────────────────

    async login(
        email: string,
        password: string,
        ip: string | null,
        userAgent: string | null,
    ) {
        const normalizedEmail = email.toLowerCase().trim();
        const clientIp = ip ?? 'unknown';

        // Soft-lock window check
        const windowStart = new Date(Date.now() - SOFT_LOCK_WINDOW_MS);
        const failedCount = await this.prisma.supportLoginAttempt.count({
            where: {
                normalizedEmail,
                ip: clientIp,
                createdAt: { gte: windowStart },
            },
        });

        if (failedCount >= SOFT_LOCK_MAX_ATTEMPTS) {
            const oldest = await this.prisma.supportLoginAttempt.findFirst({
                where: {
                    normalizedEmail,
                    ip: clientIp,
                    createdAt: { gte: windowStart },
                },
                orderBy: { createdAt: 'asc' },
                select: { createdAt: true },
            });
            const retryAfterMs = oldest
                ? Math.max(
                      0,
                      oldest.createdAt.getTime() + SOFT_LOCK_WINDOW_MS - Date.now(),
                  )
                : SOFT_LOCK_WINDOW_MS;

            await this.writeSecurityEvent('admin_login_failed', null, ip, userAgent, {
                normalizedEmail,
                reason: 'soft_lock',
                failedCount,
            });

            throw new UnauthorizedException({
                code: 'ADMIN_AUTH_SOFT_LOCKED',
                retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
            });
        }

        // Timing-safe lookup
        const supportUser = await this.prisma.supportUser.findUnique({
            where: { email: normalizedEmail },
        });
        const hash = supportUser?.passwordHash ?? TIMING_DUMMY_HASH;
        const passwordOk = await bcrypt.compare(password, hash);

        if (!supportUser || !passwordOk) {
            await this.prisma.supportLoginAttempt.create({
                data: { normalizedEmail, ip: clientIp },
            });
            await this.writeSecurityEvent(
                'admin_login_failed',
                supportUser?.id ?? null,
                ip,
                userAgent,
                { normalizedEmail, reason: 'invalid_credentials' },
            );
            throw new UnauthorizedException({ code: 'ADMIN_AUTH_INVALID_CREDENTIALS' });
        }

        if (!supportUser.isActive) {
            await this.writeSecurityEvent(
                'admin_login_failed',
                supportUser.id,
                ip,
                userAgent,
                { reason: 'support_user_inactive' },
            );
            throw new UnauthorizedException({ code: 'ADMIN_AUTH_INACTIVE' });
        }

        const session = await this.createSession(
            supportUser.id,
            supportUser.role,
            ip,
            userAgent,
        );

        await this.prisma.supportUser.update({
            where: { id: supportUser.id },
            data: { lastLoginAt: new Date() },
        });

        await this.writeSecurityEvent(
            'admin_login_success',
            supportUser.id,
            ip,
            userAgent,
            { sessionId: session.sessionId },
        );

        return {
            ...session,
            supportUser: {
                id: supportUser.id,
                email: supportUser.email,
                role: supportUser.role,
            },
        };
    }

    // ─── Refresh ────────────────────────────────────────────────────────────

    async refresh(rawRefreshToken: string, ip: string | null, userAgent: string | null) {
        const tokenHash = this.hashToken(rawRefreshToken);

        const session = await this.prisma.supportAuthSession.findUnique({
            where: { refreshTokenHash: tokenHash },
            include: { supportUser: true },
        });

        if (!session) {
            throw new UnauthorizedException({ code: 'ADMIN_AUTH_REFRESH_INVALID' });
        }

        // Reuse detection
        if (session.status !== 'ACTIVE') {
            if (session.status === 'ROTATED' || session.status === 'COMPROMISED') {
                await this.prisma.supportAuthSession.updateMany({
                    where: { supportUserId: session.supportUserId, status: 'ACTIVE' },
                    data: {
                        status: 'COMPROMISED',
                        revokedAt: new Date(),
                        revokeReason: 'REFRESH_TOKEN_REUSE',
                    },
                });
                await this.writeSecurityEvent(
                    'admin_session_revoked',
                    session.supportUserId,
                    ip,
                    userAgent,
                    { reason: 'token_reuse', sessionId: session.id },
                );
            }
            throw new UnauthorizedException({ code: 'ADMIN_AUTH_REFRESH_INVALID' });
        }

        if (session.expiresAt < new Date()) {
            await this.prisma.supportAuthSession.update({
                where: { id: session.id },
                data: { status: 'EXPIRED' },
            });
            throw new UnauthorizedException({ code: 'ADMIN_AUTH_REFRESH_EXPIRED' });
        }

        if (!session.supportUser.isActive) {
            throw new UnauthorizedException({ code: 'ADMIN_AUTH_INACTIVE' });
        }

        await this.prisma.supportAuthSession.update({
            where: { id: session.id },
            data: { status: 'ROTATED', revokedAt: new Date(), revokeReason: 'ROTATION' },
        });

        return this.createSession(
            session.supportUserId,
            session.supportUser.role,
            ip,
            userAgent,
        );
    }

    // ─── Logout ─────────────────────────────────────────────────────────────

    async revokeSession(sessionId: string, supportUserId: string, ip: string | null) {
        await this.prisma.supportAuthSession.updateMany({
            where: { id: sessionId, status: 'ACTIVE' },
            data: {
                status: 'REVOKED',
                revokedAt: new Date(),
                revokeReason: 'USER_LOGOUT',
            },
        });
        await this.writeSecurityEvent(
            'admin_session_revoked',
            supportUserId,
            ip,
            null,
            { sessionId, reason: 'USER_LOGOUT' },
        );
    }

    // ─── Change password ────────────────────────────────────────────────────

    async changePassword(
        supportUserId: string,
        sessionId: string,
        currentPassword: string,
        newPassword: string,
        ip: string | null,
    ) {
        const supportUser = await this.prisma.supportUser.findUnique({
            where: { id: supportUserId },
        });
        if (!supportUser) throw new UnauthorizedException();

        const valid = await bcrypt.compare(currentPassword, supportUser.passwordHash);
        if (!valid) {
            throw new BadRequestException({
                code: 'ADMIN_AUTH_INVALID_CURRENT_PASSWORD',
            });
        }

        const same = await bcrypt.compare(newPassword, supportUser.passwordHash);
        if (same) {
            throw new BadRequestException({
                code: 'ADMIN_AUTH_NEW_PASSWORD_SAME_AS_CURRENT',
            });
        }

        const passwordHash = await bcrypt.hash(newPassword, 12);

        await this.prisma.$transaction([
            this.prisma.supportUser.update({
                where: { id: supportUserId },
                data: { passwordHash },
            }),
            this.prisma.supportAuthSession.updateMany({
                where: {
                    supportUserId,
                    status: 'ACTIVE',
                    id: { not: sessionId },
                },
                data: {
                    status: 'REVOKED',
                    revokedAt: new Date(),
                    revokeReason: 'PASSWORD_CHANGE',
                },
            }),
        ]);

        await this.writeSecurityEvent(
            'admin_password_changed',
            supportUserId,
            ip,
            null,
            { via: 'self_service', sessionId },
        );
    }

    // ─── Validation (used by guard) ─────────────────────────────────────────

    async validateAccessToken(rawToken: string): Promise<AdminJwtPayload | null> {
        try {
            const payload = await this.jwt.verifyAsync<AdminJwtPayload>(rawToken, {
                secret: this.adminJwtSecret(),
                audience: 'admin',
            });
            if (!payload?.sessionId || payload.aud !== 'admin') return null;

            const session = await this.prisma.supportAuthSession.findUnique({
                where: { id: payload.sessionId },
            });
            if (!session || session.status !== 'ACTIVE') return null;

            const supportUser = await this.prisma.supportUser.findUnique({
                where: { id: payload.sub },
            });
            if (!supportUser || !supportUser.isActive) return null;

            // best-effort lastSeenAt
            this.prisma.supportAuthSession
                .update({
                    where: { id: payload.sessionId },
                    data: { lastSeenAt: new Date() },
                })
                .catch(() => {});

            return { ...payload, role: supportUser.role };
        } catch {
            return null;
        }
    }

    async writeSecurityEvent(
        eventType: SupportSecurityEventType,
        supportUserId: string | null,
        ip: string | null,
        userAgent: string | null,
        metadata: Record<string, unknown> | null,
    ) {
        try {
            await this.prisma.supportSecurityEvent.create({
                data: {
                    supportUserId,
                    eventType,
                    ip,
                    userAgent,
                    metadata: (metadata ?? null) as any,
                },
            });
        } catch (err: unknown) {
            // Audit не должен валить request — только лог
            this.logger.warn(
                JSON.stringify({
                    event: 'admin_security_event_write_failed',
                    eventType,
                    err: (err as any)?.message,
                }),
            );
        }
    }

    // ─── Internal helpers ──────────────────────────────────────────────────

    private async createSession(
        supportUserId: string,
        role: SupportUserRole,
        ip: string | null,
        userAgent: string | null,
    ) {
        const rawRefreshToken = crypto.randomBytes(32).toString('hex');
        const refreshTokenHash = this.hashToken(rawRefreshToken);
        const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

        const session = await this.prisma.supportAuthSession.create({
            data: {
                supportUserId,
                refreshTokenHash,
                ip,
                userAgent,
                expiresAt,
                lastSeenAt: new Date(),
            },
        });

        const accessToken = await this.jwt.signAsync(
            { sub: supportUserId, sessionId: session.id, role, aud: 'admin' },
            {
                secret: this.adminJwtSecret(),
                expiresIn: ACCESS_TOKEN_TTL_S,
            },
        );

        return {
            sessionId: session.id,
            accessToken,
            rawRefreshToken,
            accessTokenExpiresInSeconds: ACCESS_TOKEN_TTL_S,
        };
    }

    private hashToken(rawToken: string): string {
        return crypto.createHash('sha256').update(rawToken).digest('hex');
    }

    private adminJwtSecret(): string {
        // Отдельный secret обязателен — не реюзаем JWT_SECRET, иначе
        // tenant access tokens примут за admin при совпадении полей.
        const secret = process.env.ADMIN_JWT_SECRET;
        if (!secret || secret.length < 16) {
            throw new Error(
                'ADMIN_JWT_SECRET is not configured — admin control plane disabled',
            );
        }
        return secret;
    }
}
