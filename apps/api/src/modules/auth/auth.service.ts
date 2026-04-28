import {
    Injectable,
    UnauthorizedException,
    BadRequestException,
    ConflictException,
    Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { UserService } from '../users/user.service';
import { EmailService } from './email.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { OnboardingService } from '../onboarding/onboarding.service';
import { ReferralAttributionService } from '../referrals/referral-attribution.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 часа
const RESEND_COOLDOWN_MS = 60 * 1000;                   // 60 секунд
const RESEND_HOURLY_LIMIT = 3;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 дней (sync с cookie и BRD)
const ACCESS_TOKEN_TTL_S = 15 * 60;                     // 15 минут
const RESET_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;        // 24 часа
const RESET_RESEND_COOLDOWN_MS = 60 * 1000;             // 60 секунд между запросами reset
const RESET_HOURLY_LIMIT = 3;                           // не более 3 reset-запросов в час
const SOFT_LOCK_WINDOW_MS = 15 * 60 * 1000;            // окно soft-lock: 15 минут
const SOFT_LOCK_MAX_ATTEMPTS = 5;                       // порог блокировки

// Структурно валидный bcrypt-хеш для защиты от timing-атак при несуществующем email.
// bcrypt.compare всегда вернёт false — пароль заведомо неизвестен.
const TIMING_DUMMY_HASH = '$2b$12$abcdefghijklmnopqrstu.ABCDEFGHIJKLMNOPQRSTUVWXYZ12345';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly userService: UserService,
        private readonly jwtService: JwtService,
        private readonly emailService: EmailService,
        private readonly onboardingService: OnboardingService,
        private readonly referralAttributionService: ReferralAttributionService,
    ) {}

    // ─── Register ────────────────────────────────────────────────────────────────

    async register(
        dto: RegisterDto,
        context?: { sourceIp?: string | null; userAgent?: string | null },
    ) {
        const email = dto.email.toLowerCase().trim();

        const existing = await this.prisma.user.findUnique({ where: { email } });
        if (existing) {
            throw new ConflictException({ code: 'AUTH_EMAIL_TAKEN', message: 'Email already registered' });
        }

        if (dto.phone) {
            const existingPhone = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
            if (existingPhone) {
                throw new ConflictException({ code: 'AUTH_PHONE_TAKEN', message: 'Phone already registered' });
            }
        }

        const passwordHash = await bcrypt.hash(dto.password, 12);

        const user = await this.prisma.$transaction(async (tx) => {
            const newUser = await tx.user.create({
                data: {
                    email,
                    phone: dto.phone ?? null,
                    passwordHash,
                    status: 'PENDING_VERIFICATION',
                },
            });

            await tx.authIdentity.create({
                data: {
                    userId: newUser.id,
                    provider: 'LOCAL',
                    providerSubject: email,
                    isPrimary: true,
                },
            });

            return newUser;
        });

        await this.createAndSendVerificationChallenge(user.id, email);

        // TASK_REFERRALS_1 §13: capture attribution context на этапе
        // успешной регистрации. Не блокируем регистрацию, если код битый
        // или сервис упал — referral это growth-механика, не критичный
        // путь signup.
        if (dto.referralCode) {
            try {
                await this.referralAttributionService.captureRegistration({
                    referralCode: dto.referralCode,
                    referredUserId: user.id,
                    utmSource: dto.utmSource ?? null,
                    utmMedium: dto.utmMedium ?? null,
                    utmCampaign: dto.utmCampaign ?? null,
                    utmContent: dto.utmContent ?? null,
                    utmTerm: dto.utmTerm ?? null,
                    sourceIp: context?.sourceIp ?? null,
                    userAgent: context?.userAgent ?? null,
                });
            } catch (err: unknown) {
                this.logger.warn(
                    JSON.stringify({
                        event: 'referral_capture_failed_soft',
                        userId: user.id,
                        err: (err as any)?.message,
                    }),
                );
            }
        }

        this.auditLog('auth_user_registered', { userId: user.id, email });

        return {
            userId: user.id,
            status: 'PENDING_VERIFICATION',
            nextAction: 'VERIFY_EMAIL',
        };
    }

    // ─── Email Verification ───────────────────────────────────────────────────────

    async verifyEmail(rawToken: string) {
        const tokenHash = this.hashToken(rawToken);

        const challenge = await this.prisma.emailVerificationChallenge.findUnique({
            where: { tokenHash },
            include: { user: true },
        });

        if (!challenge) {
            throw new BadRequestException({ code: 'AUTH_VERIFICATION_TOKEN_INVALID' });
        }

        if (challenge.status === 'USED') {
            return { status: 'ALREADY_VERIFIED' };
        }

        if (challenge.status === 'EXPIRED' || challenge.expiresAt < new Date()) {
            await this.prisma.emailVerificationChallenge.update({
                where: { id: challenge.id },
                data: { status: 'EXPIRED' },
            });
            throw new BadRequestException({ code: 'AUTH_VERIFICATION_TOKEN_EXPIRED' });
        }

        if (challenge.status === 'CANCELLED') {
            throw new BadRequestException({ code: 'AUTH_VERIFICATION_TOKEN_INVALID' });
        }

        if (challenge.user.emailVerifiedAt) {
            await this.prisma.emailVerificationChallenge.update({
                where: { id: challenge.id },
                data: { status: 'USED', usedAt: new Date() },
            });
            return { status: 'ALREADY_VERIFIED' };
        }

        await this.prisma.$transaction([
            this.prisma.emailVerificationChallenge.update({
                where: { id: challenge.id },
                data: { status: 'USED', usedAt: new Date() },
            }),
            this.prisma.user.update({
                where: { id: challenge.userId },
                data: { status: 'ACTIVE', emailVerifiedAt: new Date() },
            }),
        ]);

        this.auditLog('auth_email_verified', { userId: challenge.userId, email: challenge.emailSnapshot });

        // Auto-link: принимаем все pending инвайты для этого email
        await this.autoLinkPendingInvites(challenge.userId, challenge.emailSnapshot);

        // T4-03: инициализируем USER_BOOTSTRAP — fire-and-forget, не блокируем верификацию
        this.onboardingService.initUserBootstrap(challenge.userId).catch((err: unknown) =>
            this.logger.warn(
                JSON.stringify({
                    event: 'onboarding_bootstrap_init_failed',
                    userId: challenge.userId,
                    err: (err as any)?.message,
                }),
            ),
        );

        return { status: 'VERIFIED', email: challenge.emailSnapshot };
    }

    // ─── Resend Verification ─────────────────────────────────────────────────────

    async resendVerification(email: string) {
        const normalizedEmail = email.toLowerCase().trim();

        // Ответ всегда нейтральный — не раскрываем существование email
        const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (!user || user.status === 'DELETED') {
            return { sent: true };
        }

        if (user.emailVerifiedAt) {
            return { sent: true };
        }

        // Cooldown: не чаще раз в 60 секунд
        const lastChallenge = await this.prisma.emailVerificationChallenge.findFirst({
            where: { userId: user.id },
            orderBy: { createdAt: 'desc' },
        });

        if (lastChallenge) {
            const elapsed = Date.now() - lastChallenge.createdAt.getTime();
            if (elapsed < RESEND_COOLDOWN_MS) {
                const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
                throw new BadRequestException({
                    code: 'AUTH_RESEND_TOO_SOON',
                    retryAfterSeconds: retryAfter,
                });
            }
        }

        // Лимит: не более 3 раз в час
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentCount = await this.prisma.emailVerificationChallenge.count({
            where: { userId: user.id, createdAt: { gte: oneHourAgo } },
        });

        if (recentCount >= RESEND_HOURLY_LIMIT) {
            throw new BadRequestException({ code: 'AUTH_RESEND_LIMIT_EXCEEDED' });
        }

        // Отменяем старые PENDING challenges
        await this.prisma.emailVerificationChallenge.updateMany({
            where: { userId: user.id, status: 'PENDING' },
            data: { status: 'CANCELLED' },
        });

        await this.createAndSendVerificationChallenge(user.id, normalizedEmail);

        this.auditLog('auth_email_verification_requested', { userId: user.id, email: normalizedEmail });

        return { sent: true };
    }

    // ─── Login ────────────────────────────────────────────────────────────────────

    async validateUser(loginDto: LoginDto, ip?: string): Promise<any> {
        const email = loginDto.email.toLowerCase().trim();
        const clientIp = ip ?? 'unknown';

        // ── Soft-lock: 5 неуспешных попыток для пары (email + IP) за 15 мин ────────
        const windowStart = new Date(Date.now() - SOFT_LOCK_WINDOW_MS);
        const failedCount = await this.prisma.loginAttempt.count({
            where: { normalizedEmail: email, ip: clientIp, createdAt: { gte: windowStart } },
        });

        if (failedCount >= SOFT_LOCK_MAX_ATTEMPTS) {
            const oldest = await this.prisma.loginAttempt.findFirst({
                where: { normalizedEmail: email, ip: clientIp, createdAt: { gte: windowStart } },
                orderBy: { createdAt: 'asc' },
                select: { createdAt: true },
            });
            const retryAfterMs = oldest
                ? Math.max(0, oldest.createdAt.getTime() + SOFT_LOCK_WINDOW_MS - Date.now())
                : SOFT_LOCK_WINDOW_MS;

            this.auditLog('auth_login_blocked', {
                normalizedEmail: email, ip: clientIp, failedCount, reason: 'soft_lock',
            });
            throw new UnauthorizedException({
                code: 'AUTH_ACCOUNT_SOFT_LOCKED',
                retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
            });
        }

        // ── Timing-safe password check: bcrypt всегда выполняется ──────────────────
        const user = await this.userService.findByEmail(email);
        const hash = user?.passwordHash ?? TIMING_DUMMY_HASH;
        const passwordOk = await bcrypt.compare(loginDto.password, hash);

        if (!user || !passwordOk) {
            await this.prisma.loginAttempt.create({ data: { normalizedEmail: email, ip: clientIp } });
            this.auditLog('auth_login_failed', {
                normalizedEmail: email, ip: clientIp, reason: 'invalid_credentials',
            });
            throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
        }

        // ── Проверка статуса (пароль верен) ──────────────────────────────────────
        if (user.status === 'PENDING_VERIFICATION') {
            this.auditLog('auth_login_failed', {
                userId: user.id, ip: clientIp, reason: 'email_not_verified',
            });
            throw new UnauthorizedException({
                code: 'AUTH_EMAIL_NOT_VERIFIED',
                nextAction: 'VERIFY_EMAIL',
            });
        }

        if (user.status === 'LOCKED') {
            this.auditLog('auth_login_failed', {
                userId: user.id, ip: clientIp, reason: 'account_locked',
            });
            throw new UnauthorizedException({ code: 'AUTH_ACCOUNT_LOCKED' });
        }

        if (user.status === 'DELETED') {
            throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
        }

        return user;
    }

    async loginUser(userId: string, ip?: string, userAgent?: string) {
        const { sessionId, accessToken, rawRefreshToken } = await this.createSession(userId, ip, userAgent);

        await this.prisma.user.update({
            where: { id: userId },
            data: { lastLoginAt: new Date() },
        });

        this.auditLog('auth_login_succeeded', { userId, ip, sessionId });

        return { sessionId, accessToken, rawRefreshToken };
    }

    // ─── Refresh ──────────────────────────────────────────────────────────────────

    async refreshSession(rawRefreshToken: string, ip?: string, userAgent?: string) {
        const tokenHash = this.hashToken(rawRefreshToken);

        const session = await this.prisma.authSession.findUnique({
            where: { refreshTokenHash: tokenHash },
            include: { user: true },
        });

        if (!session) {
            throw new UnauthorizedException({ code: 'AUTH_REFRESH_TOKEN_INVALID' });
        }

        // Reuse detection: если сессия не ACTIVE — кто-то переиспользует старый токен
        if (session.status !== 'ACTIVE') {
            if (session.status === 'ROTATED' || session.status === 'COMPROMISED') {
                await this.prisma.authSession.updateMany({
                    where: { userId: session.userId, status: 'ACTIVE' },
                    data: { status: 'COMPROMISED', revokedAt: new Date(), revokeReason: 'REFRESH_TOKEN_REUSE' },
                });
                this.auditLog('auth_refresh_token_reuse_detected', {
                    userId: session.userId, sessionId: session.id, ip,
                });
            }
            throw new UnauthorizedException({ code: 'AUTH_REFRESH_TOKEN_INVALID' });
        }

        if (session.expiresAt < new Date()) {
            await this.prisma.authSession.update({
                where: { id: session.id },
                data: { status: 'EXPIRED' },
            });
            throw new UnauthorizedException({ code: 'AUTH_REFRESH_TOKEN_EXPIRED' });
        }

        if (session.user.status !== 'ACTIVE') {
            throw new UnauthorizedException({ code: 'AUTH_ACCOUNT_LOCKED' });
        }

        await this.prisma.authSession.update({
            where: { id: session.id },
            data: { status: 'ROTATED', revokedAt: new Date(), revokeReason: 'ROTATION' },
        });

        const { sessionId, accessToken, rawRefreshToken: newRawRefreshToken } =
            await this.createSession(session.userId, ip, userAgent);

        return { sessionId, accessToken, rawRefreshToken: newRawRefreshToken };
    }

    // ─── Logout ───────────────────────────────────────────────────────────────────

    async revokeSession(sessionId: string, meta?: { userId?: string; ip?: string }) {
        await this.prisma.authSession.updateMany({
            where: { id: sessionId, status: 'ACTIVE' },
            data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: 'USER_LOGOUT' },
        });
        this.auditLog('auth_session_revoked', {
            sessionId, userId: meta?.userId, ip: meta?.ip, reason: 'USER_LOGOUT',
        });
    }

    async revokeAllSessions(userId: string, ip?: string) {
        await this.prisma.authSession.updateMany({
            where: { userId, status: 'ACTIVE' },
            data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: 'USER_LOGOUT_ALL' },
        });
        this.auditLog('auth_session_revoked', { userId, ip, reason: 'USER_LOGOUT_ALL' });
    }

    // ─── Me / Auth Context ────────────────────────────────────────────────────────

    async getMe(userId: string, sessionId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: {
                memberships: {
                    where: { status: 'ACTIVE' },
                    include: {
                        tenant: { select: { id: true, name: true, accessState: true, status: true } },
                    },
                },
                preferences: { select: { lastUsedTenantId: true, locale: true, timezone: true } },
            },
        });

        if (!user) throw new UnauthorizedException();

        const { passwordHash, ...userSafe } = user;

        const lastUsedId = user.preferences?.lastUsedTenantId;

        // Тенанты доступны, если не закрыты ни по status, ни по accessState
        const availableMemberships = user.memberships.filter(
            (m) => m.tenant.status !== 'CLOSED' && m.tenant.accessState !== 'CLOSED',
        );

        // Активный тенант: сначала lastUsed, иначе первый доступный
        const activeMembership =
            (lastUsedId && availableMemberships.find((m) => m.tenantId === lastUsedId)) ||
            availableMemberships[0] ||
            null;

        const activeTenant = activeMembership
            ? {
                id: activeMembership.tenant.id,
                name: activeMembership.tenant.name,
                accessState: activeMembership.tenant.accessState,
                role: activeMembership.role,
              }
            : null;

        // Все компании пользователя для tenant picker (закрытые видны как недоступные)
        const tenants = user.memberships.map((m) => ({
            id: m.tenant.id,
            name: m.tenant.name,
            accessState: m.tenant.accessState,
            status: m.tenant.status,
            role: m.role,
            isAvailable: m.tenant.status !== 'CLOSED' && m.tenant.accessState !== 'CLOSED',
        }));

        const hasValidLastUsed = !!(lastUsedId && availableMemberships.find((m) => m.tenantId === lastUsedId));

        let nextRoute: string;
        if (!user.memberships.length || availableMemberships.length === 0) {
            nextRoute = '/onboarding';
        } else if (availableMemberships.length === 1 || hasValidLastUsed) {
            nextRoute = '/app';
        } else {
            nextRoute = '/tenant-picker';
        }

        return { user: userSafe, sessionId, nextRoute, activeTenant, tenants };
    }

    // ─── Forgot / Reset / Change Password ────────────────────────────────────────

    async forgotPassword(email: string, ip?: string): Promise<{ sent: boolean }> {
        const normalizedEmail = email.toLowerCase().trim();

        const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (!user || user.status === 'DELETED') {
            return { sent: true };
        }

        // Cooldown: не чаще раза в 60 секунд
        const lastChallenge = await this.prisma.passwordResetChallenge.findFirst({
            where: { userId: user.id },
            orderBy: { createdAt: 'desc' },
        });

        if (lastChallenge && Date.now() - lastChallenge.createdAt.getTime() < RESET_RESEND_COOLDOWN_MS) {
            return { sent: true };
        }

        // Лимит: не более 3 reset-запросов в час
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentCount = await this.prisma.passwordResetChallenge.count({
            where: { userId: user.id, createdAt: { gte: oneHourAgo } },
        });

        if (recentCount >= RESET_HOURLY_LIMIT) {
            return { sent: true };
        }

        await this.prisma.passwordResetChallenge.updateMany({
            where: { userId: user.id, status: 'PENDING' },
            data: { status: 'CANCELLED' },
        });

        await this.createAndSendResetChallenge(user.id, normalizedEmail);

        this.auditLog('auth_password_reset_requested', { userId: user.id, ip });

        return { sent: true };
    }

    async resetPassword(rawToken: string, newPassword: string, ip?: string): Promise<{ ok: boolean }> {
        const tokenHash = this.hashToken(rawToken);

        const challenge = await this.prisma.passwordResetChallenge.findUnique({
            where: { tokenHash },
        });

        if (!challenge || challenge.status === 'USED' || challenge.status === 'CANCELLED') {
            throw new BadRequestException({ code: 'AUTH_RESET_TOKEN_INVALID' });
        }

        if (challenge.status === 'EXPIRED' || challenge.expiresAt < new Date()) {
            await this.prisma.passwordResetChallenge.update({
                where: { id: challenge.id },
                data: { status: 'EXPIRED' },
            });
            throw new BadRequestException({ code: 'AUTH_RESET_TOKEN_EXPIRED' });
        }

        const passwordHash = await bcrypt.hash(newPassword, 12);

        await this.prisma.$transaction([
            this.prisma.passwordResetChallenge.update({
                where: { id: challenge.id },
                data: { status: 'USED', usedAt: new Date() },
            }),
            this.prisma.user.update({
                where: { id: challenge.userId },
                data: { passwordHash },
            }),
            this.prisma.authSession.updateMany({
                where: { userId: challenge.userId, status: 'ACTIVE' },
                data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: 'PASSWORD_RESET' },
            }),
        ]);

        this.auditLog('auth_password_reset_completed', { userId: challenge.userId, ip });

        return { ok: true };
    }

    async changePassword(
        userId: string,
        sessionId: string,
        currentPassword: string,
        newPassword: string,
        ip?: string,
    ): Promise<{ ok: boolean }> {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new UnauthorizedException();

        const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!isValid) {
            throw new BadRequestException({ code: 'AUTH_INVALID_CURRENT_PASSWORD' });
        }

        const isSame = await bcrypt.compare(newPassword, user.passwordHash);
        if (isSame) {
            throw new BadRequestException({ code: 'AUTH_NEW_PASSWORD_SAME_AS_CURRENT' });
        }

        const passwordHash = await bcrypt.hash(newPassword, 12);

        await this.prisma.$transaction([
            this.prisma.user.update({
                where: { id: userId },
                data: { passwordHash },
            }),
            this.prisma.authSession.updateMany({
                where: { userId, status: 'ACTIVE', id: { not: sessionId } },
                data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: 'PASSWORD_CHANGE' },
            }),
        ]);

        this.auditLog('auth_password_changed', { userId, sessionId, ip });

        return { ok: true };
    }

    // ─── Telegram (legacy) ────────────────────────────────────────────────────────

    async validateTelegramAuth(initData: string) {
        const telegramId = await this.extractTelegramId(initData);

        const user = await this.userService.findByTelegramId(telegramId);
        if (!user) {
            throw new UnauthorizedException('account_not_linked');
        }

        return user;
    }

    async linkTelegramAccount(initData: string, loginDto: LoginDto) {
        const telegramId = await this.extractTelegramId(initData);
        const user = await this.validateUser(loginDto);

        const existingTgUser = await this.userService.findByTelegramId(telegramId);
        if (existingTgUser && existingTgUser.id !== user.id) {
            throw new UnauthorizedException('telegram_already_linked_elsewhere');
        }

        return this.userService.updateTelegramId(user.id, telegramId);
    }

    async unlinkTelegramAccount(userId: string) {
        return this.userService.updateTelegramId(userId, null);
    }

    // ─── Private helpers ─────────────────────────────────────────────────────────

    private auditLog(event: string, data: Record<string, unknown> = {}): void {
        this.logger.log(JSON.stringify({ event, ...data, ts: new Date().toISOString() }));
    }

    private hashToken(rawToken: string): string {
        return crypto.createHash('sha256').update(rawToken).digest('hex');
    }

    private async createSession(userId: string, ip?: string, userAgent?: string) {
        const rawRefreshToken = crypto.randomBytes(32).toString('hex');
        const refreshTokenHash = this.hashToken(rawRefreshToken);
        const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

        const [session, userCtx] = await Promise.all([
            this.prisma.authSession.create({
                data: {
                    userId,
                    refreshTokenHash,
                    ip: ip ?? null,
                    userAgent: userAgent ?? null,
                    expiresAt,
                    lastSeenAt: new Date(),
                },
            }),
            this.prisma.user.findUnique({
                where: { id: userId },
                select: {
                    membershipVersion: true,
                    preferences: { select: { lastUsedTenantId: true } },
                },
            }),
        ]);

        const activeTenantId = userCtx?.preferences?.lastUsedTenantId ?? undefined;
        const membershipVersion = userCtx?.membershipVersion ?? 0;

        const accessToken = this.jwtService.sign(
            { sub: userId, sessionId: session.id, activeTenantId, membershipVersion },
            { expiresIn: ACCESS_TOKEN_TTL_S },
        );

        return { sessionId: session.id, accessToken, rawRefreshToken };
    }

    private async createAndSendVerificationChallenge(userId: string, email: string): Promise<void> {
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = this.hashToken(rawToken);
        const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);

        await this.prisma.emailVerificationChallenge.create({
            data: { userId, emailSnapshot: email, tokenHash, expiresAt },
        });

        await this.emailService.sendVerificationEmail(email, rawToken);
    }

    private async createAndSendResetChallenge(userId: string, email: string): Promise<void> {
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = this.hashToken(rawToken);
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

        await this.prisma.passwordResetChallenge.create({
            data: { userId, tokenHash, expiresAt },
        });

        await this.emailService.sendPasswordResetEmail(email, rawToken);
    }

    private async autoLinkPendingInvites(userId: string, email: string): Promise<void> {
        const now = new Date();
        const pendingInvites = await this.prisma.invitation.findMany({
            where: { email, status: 'PENDING', expiresAt: { gt: now } },
        });

        for (const invite of pendingInvites) {
            const existingMembership = await this.prisma.membership.findFirst({
                where: { userId, tenantId: invite.tenantId, status: 'ACTIVE' },
            });

            if (existingMembership) {
                await this.prisma.invitation.update({
                    where: { id: invite.id },
                    data: { status: 'ACCEPTED', acceptedAt: now, acceptedByUserId: userId },
                });
            } else {
                await this.prisma.$transaction([
                    this.prisma.membership.create({
                        data: {
                            userId,
                            tenantId: invite.tenantId,
                            role: invite.role,
                            status: 'ACTIVE',
                            joinedAt: now,
                        },
                    }),
                    this.prisma.invitation.update({
                        where: { id: invite.id },
                        data: { status: 'ACCEPTED', acceptedAt: now, acceptedByUserId: userId },
                    }),
                    this.prisma.user.update({
                        where: { id: userId },
                        data: { membershipVersion: { increment: 1 } },
                    }),
                ]);
            }

            await this.prisma.teamEvent.create({
                data: {
                    tenantId: invite.tenantId,
                    actorUserId: userId,
                    eventType: 'team_invitation_accepted',
                    payload: { invitationId: invite.id, email, via: 'auto_link' },
                },
            });

            this.auditLog('team_invite_auto_linked', {
                userId,
                email,
                invitationId: invite.id,
                tenantId: invite.tenantId,
            });
        }
    }

    private async extractTelegramId(initData: string): Promise<string> {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) {
            throw new UnauthorizedException('Telegram bot token not configured');
        }

        const params = new URLSearchParams(initData);
        const hash = params.get('hash');
        if (!hash) throw new UnauthorizedException('Invalid Telegram initData');

        const dataCheckArr: string[] = [];
        params.forEach((value, key) => {
            if (key !== 'hash') dataCheckArr.push(`${key}=${value}`);
        });
        dataCheckArr.sort();

        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
        const computedHash = crypto.createHmac('sha256', secretKey)
            .update(dataCheckArr.join('\n'))
            .digest('hex');

        if (computedHash !== hash) throw new UnauthorizedException('Invalid Telegram signature');

        const userDataStr = params.get('user');
        if (!userDataStr) throw new UnauthorizedException('No user data');

        const tgUser = JSON.parse(userDataStr);
        return tgUser.id.toString();
    }
}
