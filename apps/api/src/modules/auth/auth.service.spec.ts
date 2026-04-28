import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UserService } from '../users/user.service';
import { EmailService } from './email.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { ReferralAttributionService } from '../referrals/referral-attribution.service';
import * as bcrypt from 'bcrypt';

// bcrypt is slow at cost 12 — mock it for unit tests
jest.mock('bcrypt', () => ({
    hash: jest.fn().mockResolvedValue('$hashed$'),
    compare: jest.fn().mockResolvedValue(true),
}));
const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

// ─── Prisma mock factory ──────────────────────────────────────────────────────

function makePrismaMock() {
    const mock = {
        user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
        authIdentity: { create: jest.fn() },
        emailVerificationChallenge: {
            findUnique: jest.fn(), findFirst: jest.fn(), count: jest.fn(),
            create: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
        },
        passwordResetChallenge: {
            findUnique: jest.fn(), findFirst: jest.fn(), count: jest.fn(),
            create: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
        },
        authSession: {
            findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
        },
        loginAttempt: { count: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
        invitation: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
        membership: { create: jest.fn() },
        $transaction: jest.fn().mockImplementation((arg: any) =>
            typeof arg === 'function' ? arg(mock) : Promise.all(arg),
        ),
    };
    return mock;
}

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const ACTIVE_USER = {
    id: 'user-1',
    email: 'user@example.com',
    phone: '+79991234567',
    passwordHash: '$hashed$',
    status: 'ACTIVE',
    emailVerifiedAt: new Date('2026-01-01'),
    lastLoginAt: null,
    memberships: [],
    preferences: null,
};

const PENDING_USER = { ...ACTIVE_USER, id: 'user-2', status: 'PENDING_VERIFICATION', emailVerifiedAt: null };
const LOCKED_USER  = { ...ACTIVE_USER, id: 'user-3', status: 'LOCKED' };

const ACTIVE_SESSION = {
    id: 'session-1',
    userId: 'user-1',
    refreshTokenHash: 'hash-abc',
    status: 'ACTIVE',
    expiresAt: new Date(Date.now() + 86400_000),
    user: ACTIVE_USER,
};

const PENDING_CHALLENGE = {
    id: 'chall-1',
    userId: 'user-1',
    emailSnapshot: 'user@example.com',
    tokenHash: 'token-hash',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 86400_000),
    user: { ...ACTIVE_USER, emailVerifiedAt: null },
};

const RESET_CHALLENGE = {
    id: 'reset-1',
    userId: 'user-1',
    tokenHash: 'reset-hash',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 86400_000),
};

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('AuthService', () => {
    let service: AuthService;
    let prisma: ReturnType<typeof makePrismaMock>;
    let emailService: jest.Mocked<Pick<EmailService, 'sendVerificationEmail' | 'sendPasswordResetEmail'>>;
    let jwtService: jest.Mocked<Pick<JwtService, 'sign'>>;
    let logSpy: jest.SpyInstance;

    beforeEach(async () => {
        prisma = makePrismaMock();
        emailService = {
            sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
            sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
        };
        jwtService = { sign: jest.fn().mockReturnValue('access-token') };

        // Seed sessions mock so createSession succeeds by default
        prisma.authSession.create.mockResolvedValue({
            id: 'session-new',
            refreshTokenHash: 'hash-new',
            expiresAt: new Date(Date.now() + 86400_000),
        });

        const module = await Test.createTestingModule({
            providers: [
                AuthService,
                { provide: PrismaService, useValue: prisma },
                { provide: UserService, useValue: { findByEmail: jest.fn(), findById: jest.fn() } },
                { provide: JwtService, useValue: jwtService },
                { provide: EmailService, useValue: emailService },
                {
                    provide: OnboardingService,
                    useValue: {
                        markStepDone: jest.fn().mockResolvedValue(undefined),
                        initUserBootstrap: jest.fn().mockResolvedValue(undefined),
                    },
                },
                {
                    // TASK_REFERRALS_1: stub чтобы не тянуть реальный prisma
                    // в auth-spec'е. captureRegistration вызывается только
                    // если dto.referralCode передан — в текущих тестах нет.
                    provide: ReferralAttributionService,
                    useValue: {
                        captureRegistration: jest.fn().mockResolvedValue({
                            captured: false, attributionId: null, reason: null,
                        }),
                        lockOnTenantCreation: jest.fn().mockResolvedValue({
                            locked: false, attributionId: null,
                            status: 'ATTRIBUTED', rejectionReason: null, skipped: true,
                        }),
                    },
                },
            ],
        }).compile();

        service = module.get(AuthService);
        logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    });

    afterEach(() => jest.clearAllMocks());

    // ─── Register ─────────────────────────────────────────────────────────────

    describe('register', () => {
        beforeEach(() => {
            prisma.user.findUnique.mockResolvedValue(null);
            prisma.user.create.mockResolvedValue({ ...PENDING_USER, id: 'user-new' });
            prisma.authIdentity.create.mockResolvedValue({});
            prisma.emailVerificationChallenge.create.mockResolvedValue({});
        });

        it('creates user + identity + sends verification email', async () => {
            const result = await service.register({ email: 'NEW@Example.com', password: 'Pass1234!' });

            expect(result.status).toBe('PENDING_VERIFICATION');
            expect(result.nextAction).toBe('VERIFY_EMAIL');
            expect(prisma.user.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ email: 'new@example.com' }) }),
            );
            expect(emailService.sendVerificationEmail).toHaveBeenCalledWith('new@example.com', expect.any(String));
        });

        it('emits auth_user_registered audit event', async () => {
            await service.register({ email: 'new@example.com', password: 'Pass1234!' });
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"auth_user_registered"'),
            );
        });

        it('throws AUTH_EMAIL_TAKEN on duplicate email', async () => {
            prisma.user.findUnique.mockResolvedValueOnce(ACTIVE_USER);
            await expect(service.register({ email: 'user@example.com', password: 'Pass1234!' }))
                .rejects.toThrow(ConflictException);
        });

        it('throws AUTH_PHONE_TAKEN on duplicate phone', async () => {
            prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(ACTIVE_USER);
            await expect(service.register({ email: 'new@example.com', phone: '+79991234567', password: 'Pass1234!' }))
                .rejects.toThrow(ConflictException);
        });
    });

    // ─── verifyEmail ──────────────────────────────────────────────────────────

    describe('verifyEmail', () => {
        it('marks challenge USED and user ACTIVE on valid pending token', async () => {
            prisma.emailVerificationChallenge.findUnique.mockResolvedValue(PENDING_CHALLENGE);
            prisma.emailVerificationChallenge.update.mockResolvedValue({});
            prisma.user.update.mockResolvedValue({});

            const result = await service.verifyEmail('raw-token');
            expect(result.status).toBe('VERIFIED');
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"event":"auth_email_verified"'));
        });

        it('returns ALREADY_VERIFIED for a USED challenge', async () => {
            prisma.emailVerificationChallenge.findUnique.mockResolvedValue({ ...PENDING_CHALLENGE, status: 'USED' });
            const result = await service.verifyEmail('raw-token');
            expect(result.status).toBe('ALREADY_VERIFIED');
        });

        it('returns ALREADY_VERIFIED when user.emailVerifiedAt is set on PENDING challenge', async () => {
            const alreadyVerified = { ...PENDING_CHALLENGE, user: { ...ACTIVE_USER, emailVerifiedAt: new Date() } };
            prisma.emailVerificationChallenge.findUnique.mockResolvedValue(alreadyVerified);
            prisma.emailVerificationChallenge.update.mockResolvedValue({});

            const result = await service.verifyEmail('raw-token');
            expect(result.status).toBe('ALREADY_VERIFIED');
        });

        it('throws AUTH_VERIFICATION_TOKEN_EXPIRED for expired challenge', async () => {
            const expired = { ...PENDING_CHALLENGE, status: 'PENDING', expiresAt: new Date(Date.now() - 1000) };
            prisma.emailVerificationChallenge.findUnique.mockResolvedValue(expired);
            prisma.emailVerificationChallenge.update.mockResolvedValue({});

            await expect(service.verifyEmail('raw-token')).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'AUTH_VERIFICATION_TOKEN_EXPIRED' }),
            });
        });

        it('throws AUTH_VERIFICATION_TOKEN_INVALID for cancelled challenge', async () => {
            prisma.emailVerificationChallenge.findUnique.mockResolvedValue({ ...PENDING_CHALLENGE, status: 'CANCELLED' });
            await expect(service.verifyEmail('raw-token')).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'AUTH_VERIFICATION_TOKEN_INVALID' }),
            });
        });

        it('throws AUTH_VERIFICATION_TOKEN_INVALID for unknown token', async () => {
            prisma.emailVerificationChallenge.findUnique.mockResolvedValue(null);
            await expect(service.verifyEmail('bad-token')).rejects.toThrow(BadRequestException);
        });
    });

    // ─── resendVerification ───────────────────────────────────────────────────

    describe('resendVerification', () => {
        it('returns { sent: true } for unknown email (neutral — no enumeration)', async () => {
            prisma.user.findUnique.mockResolvedValue(null);
            const result = await service.resendVerification('ghost@example.com');
            expect(result).toEqual({ sent: true });
            expect(emailService.sendVerificationEmail).not.toHaveBeenCalled();
        });

        it('returns { sent: true } for already-verified email (neutral)', async () => {
            prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
            const result = await service.resendVerification('user@example.com');
            expect(result).toEqual({ sent: true });
        });

        it('throws AUTH_RESEND_TOO_SOON within 60s cooldown', async () => {
            prisma.user.findUnique.mockResolvedValue(PENDING_USER);
            prisma.emailVerificationChallenge.findFirst.mockResolvedValue({
                createdAt: new Date(Date.now() - 10_000), // 10 seconds ago
            });
            await expect(service.resendVerification('user@example.com')).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'AUTH_RESEND_TOO_SOON' }),
            });
        });

        it('throws AUTH_RESEND_LIMIT_EXCEEDED when 3+ in last hour', async () => {
            prisma.user.findUnique.mockResolvedValue(PENDING_USER);
            prisma.emailVerificationChallenge.findFirst.mockResolvedValue({
                createdAt: new Date(Date.now() - 120_000), // 2 min ago — past cooldown
            });
            prisma.emailVerificationChallenge.count.mockResolvedValue(3);

            await expect(service.resendVerification('user@example.com')).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'AUTH_RESEND_LIMIT_EXCEEDED' }),
            });
        });

        it('cancels old pending challenges and sends a new one', async () => {
            prisma.user.findUnique.mockResolvedValue(PENDING_USER);
            prisma.emailVerificationChallenge.findFirst.mockResolvedValue({
                createdAt: new Date(Date.now() - 120_000),
            });
            prisma.emailVerificationChallenge.count.mockResolvedValue(1);
            prisma.emailVerificationChallenge.updateMany.mockResolvedValue({ count: 1 });
            prisma.emailVerificationChallenge.create.mockResolvedValue({});

            const result = await service.resendVerification('user@example.com');
            expect(result).toEqual({ sent: true });
            expect(prisma.emailVerificationChallenge.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({ data: { status: 'CANCELLED' } }),
            );
            expect(emailService.sendVerificationEmail).toHaveBeenCalled();
        });
    });

    // ─── validateUser (login gate) ────────────────────────────────────────────

    describe('validateUser', () => {
        beforeEach(() => {
            prisma.loginAttempt.count.mockResolvedValue(0);
            prisma.loginAttempt.create.mockResolvedValue({});
        });

        it('returns user on valid credentials', async () => {
            const userService = service['userService'] as any;
            userService.findByEmail = jest.fn().mockResolvedValue(ACTIVE_USER);
            mockedBcrypt.compare.mockResolvedValue(true as never);

            const result = await service.validateUser({ email: 'user@example.com', password: 'Pass1234!' });
            expect(result).toEqual(ACTIVE_USER);
        });

        it('throws AUTH_ACCOUNT_SOFT_LOCKED after 5+ failed attempts', async () => {
            prisma.loginAttempt.count.mockResolvedValue(5);
            prisma.loginAttempt.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 60_000) });

            await expect(service.validateUser({ email: 'user@example.com', password: 'x' }, '1.2.3.4'))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ code: 'AUTH_ACCOUNT_SOFT_LOCKED' }),
                });

            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"auth_login_blocked"'),
            );
        });

        it('throws AUTH_INVALID_CREDENTIALS for wrong password', async () => {
            const userService = service['userService'] as any;
            userService.findByEmail = jest.fn().mockResolvedValue(ACTIVE_USER);
            mockedBcrypt.compare.mockResolvedValue(false as never);

            await expect(service.validateUser({ email: 'user@example.com', password: 'wrong' }))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ code: 'AUTH_INVALID_CREDENTIALS' }),
                });

            expect(prisma.loginAttempt.create).toHaveBeenCalled();
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"auth_login_failed"'),
            );
        });

        it('runs bcrypt even if user not found (timing-attack protection)', async () => {
            const userService = service['userService'] as any;
            userService.findByEmail = jest.fn().mockResolvedValue(null);
            mockedBcrypt.compare.mockResolvedValue(false as never);

            await expect(service.validateUser({ email: 'ghost@example.com', password: 'x' }))
                .rejects.toThrow(UnauthorizedException);

            expect(mockedBcrypt.compare).toHaveBeenCalled();
        });

        it('throws AUTH_EMAIL_NOT_VERIFIED for unverified user', async () => {
            const userService = service['userService'] as any;
            userService.findByEmail = jest.fn().mockResolvedValue(PENDING_USER);
            mockedBcrypt.compare.mockResolvedValue(true as never);

            await expect(service.validateUser({ email: 'user@example.com', password: 'Pass1234!' }))
                .rejects.toMatchObject({
                    response: expect.objectContaining({
                        code: 'AUTH_EMAIL_NOT_VERIFIED',
                        nextAction: 'VERIFY_EMAIL',
                    }),
                });

            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"auth_login_failed"'),
            );
        });

        it('throws AUTH_ACCOUNT_LOCKED for locked user', async () => {
            const userService = service['userService'] as any;
            userService.findByEmail = jest.fn().mockResolvedValue(LOCKED_USER);
            mockedBcrypt.compare.mockResolvedValue(true as never);

            await expect(service.validateUser({ email: 'user@example.com', password: 'Pass1234!' }))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ code: 'AUTH_ACCOUNT_LOCKED' }),
                });
        });

        it('returns neutral AUTH_INVALID_CREDENTIALS for deleted user (no enumeration)', async () => {
            const userService = service['userService'] as any;
            userService.findByEmail = jest.fn().mockResolvedValue({ ...ACTIVE_USER, status: 'DELETED' });
            mockedBcrypt.compare.mockResolvedValue(true as never);

            await expect(service.validateUser({ email: 'user@example.com', password: 'Pass1234!' }))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ code: 'AUTH_INVALID_CREDENTIALS' }),
                });
        });
    });

    // ─── loginUser ────────────────────────────────────────────────────────────

    describe('loginUser', () => {
        it('creates session, updates lastLoginAt and emits audit event', async () => {
            prisma.user.update.mockResolvedValue({});

            const result = await service.loginUser('user-1', '1.2.3.4', 'Mozilla');
            expect(result.accessToken).toBe('access-token');
            expect(result.rawRefreshToken).toBeDefined();
            expect(prisma.user.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ lastLoginAt: expect.any(Date) }) }),
            );
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"auth_login_succeeded"'),
            );
        });
    });

    // ─── refreshSession ───────────────────────────────────────────────────────

    describe('refreshSession', () => {
        it('rotates token: marks old ROTATED, creates new session', async () => {
            prisma.authSession.findUnique.mockResolvedValue(ACTIVE_SESSION);
            prisma.authSession.update.mockResolvedValue({});

            const result = await service.refreshSession('raw-refresh', '1.2.3.4');
            expect(prisma.authSession.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: 'ROTATED' }),
                }),
            );
            expect(result.accessToken).toBe('access-token');
        });

        it('throws AUTH_REFRESH_TOKEN_INVALID for unknown token', async () => {
            prisma.authSession.findUnique.mockResolvedValue(null);
            await expect(service.refreshSession('bad-token')).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'AUTH_REFRESH_TOKEN_INVALID' }),
            });
        });

        it('compromises all active sessions on refresh token reuse (ROTATED status)', async () => {
            prisma.authSession.findUnique.mockResolvedValue({ ...ACTIVE_SESSION, status: 'ROTATED' });
            prisma.authSession.updateMany.mockResolvedValue({ count: 2 });

            await expect(service.refreshSession('reused-token')).rejects.toThrow(UnauthorizedException);

            expect(prisma.authSession.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: 'COMPROMISED', revokeReason: 'REFRESH_TOKEN_REUSE' }),
                }),
            );
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"auth_refresh_token_reuse_detected"'),
            );
        });

        it('marks session EXPIRED and throws for expired refresh token', async () => {
            prisma.authSession.findUnique.mockResolvedValue({
                ...ACTIVE_SESSION,
                expiresAt: new Date(Date.now() - 1000),
            });
            prisma.authSession.update.mockResolvedValue({});

            await expect(service.refreshSession('expired-token')).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'AUTH_REFRESH_TOKEN_EXPIRED' }),
            });

            expect(prisma.authSession.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: { status: 'EXPIRED' } }),
            );
        });

        it('throws AUTH_ACCOUNT_LOCKED when user is not ACTIVE during refresh', async () => {
            prisma.authSession.findUnique.mockResolvedValue({
                ...ACTIVE_SESSION,
                user: LOCKED_USER,
            });
            await expect(service.refreshSession('valid-token')).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'AUTH_ACCOUNT_LOCKED' }),
            });
        });
    });

    // ─── revokeSession / revokeAllSessions ────────────────────────────────────

    describe('revokeSession (logout)', () => {
        it('marks session REVOKED and emits audit event', async () => {
            prisma.authSession.updateMany.mockResolvedValue({ count: 1 });

            await service.revokeSession('session-1', { userId: 'user-1', ip: '1.2.3.4' });

            expect(prisma.authSession.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ id: 'session-1', status: 'ACTIVE' }),
                    data: expect.objectContaining({ status: 'REVOKED', revokeReason: 'USER_LOGOUT' }),
                }),
            );
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"auth_session_revoked"'),
            );
        });
    });

    describe('revokeAllSessions (logout-all)', () => {
        it('revokes all ACTIVE sessions for user and emits audit', async () => {
            prisma.authSession.updateMany.mockResolvedValue({ count: 3 });

            await service.revokeAllSessions('user-1', '1.2.3.4');

            expect(prisma.authSession.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ userId: 'user-1', status: 'ACTIVE' }),
                    data: expect.objectContaining({ status: 'REVOKED', revokeReason: 'USER_LOGOUT_ALL' }),
                }),
            );
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"auth_session_revoked"'),
            );
        });
    });

    // ─── getMe ────────────────────────────────────────────────────────────────

    describe('getMe', () => {
        it('returns user without passwordHash and nextRoute=/onboarding when no memberships', async () => {
            prisma.user.findUnique.mockResolvedValue({ ...ACTIVE_USER, memberships: [], preferences: null });

            const result = await service.getMe('user-1', 'session-1');
            expect(result.nextRoute).toBe('/onboarding');
            expect((result.user as any).passwordHash).toBeUndefined();
        });

        it('returns nextRoute=/app when user has exactly one membership', async () => {
            prisma.user.findUnique.mockResolvedValue({
                ...ACTIVE_USER,
                memberships: [{ tenantId: 'tenant-1', tenant: { id: 'tenant-1', name: 'T1', accessState: 'ACTIVE_PAID' } }],
                preferences: null,
            });
            const result = await service.getMe('user-1', 'session-1');
            expect(result.nextRoute).toBe('/app');
        });

        it('returns nextRoute=/tenant-picker when multiple tenants and no valid last-used', async () => {
            prisma.user.findUnique.mockResolvedValue({
                ...ACTIVE_USER,
                memberships: [
                    { tenantId: 'tenant-1', tenant: { id: 'tenant-1', name: 'T1', accessState: 'ACTIVE_PAID' } },
                    { tenantId: 'tenant-2', tenant: { id: 'tenant-2', name: 'T2', accessState: 'ACTIVE_PAID' } },
                ],
                preferences: { lastUsedTenantId: 'tenant-99' }, // not in memberships
            });
            const result = await service.getMe('user-1', 'session-1');
            expect(result.nextRoute).toBe('/tenant-picker');
        });

        it('throws UnauthorizedException for unknown userId', async () => {
            prisma.user.findUnique.mockResolvedValue(null);
            await expect(service.getMe('ghost', 'session-1')).rejects.toThrow(UnauthorizedException);
        });
    });

    // ─── forgotPassword ───────────────────────────────────────────────────────

    describe('forgotPassword', () => {
        it('returns { sent: true } for unknown email (neutral — no enumeration)', async () => {
            prisma.user.findUnique.mockResolvedValue(null);
            const result = await service.forgotPassword('ghost@example.com');
            expect(result).toEqual({ sent: true });
            expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
        });

        it('returns { sent: true } silently within 60s cooldown (no enumeration)', async () => {
            prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
            prisma.passwordResetChallenge.findFirst.mockResolvedValue({
                createdAt: new Date(Date.now() - 10_000),
            });
            const result = await service.forgotPassword('user@example.com');
            expect(result).toEqual({ sent: true });
            expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
        });

        it('returns { sent: true } silently when 3/h limit exceeded (no enumeration)', async () => {
            prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
            prisma.passwordResetChallenge.findFirst.mockResolvedValue({
                createdAt: new Date(Date.now() - 120_000),
            });
            prisma.passwordResetChallenge.count.mockResolvedValue(3);

            const result = await service.forgotPassword('user@example.com');
            expect(result).toEqual({ sent: true });
            expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
        });

        it('cancels old PENDING challenges, sends new one, emits audit', async () => {
            prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
            prisma.passwordResetChallenge.findFirst.mockResolvedValue(null);
            prisma.passwordResetChallenge.count.mockResolvedValue(0);
            prisma.passwordResetChallenge.updateMany.mockResolvedValue({ count: 0 });
            prisma.passwordResetChallenge.create.mockResolvedValue({});

            const result = await service.forgotPassword('user@example.com', '1.2.3.4');
            expect(result).toEqual({ sent: true });
            expect(emailService.sendPasswordResetEmail).toHaveBeenCalled();
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"auth_password_reset_requested"'),
            );
        });
    });

    // ─── resetPassword ────────────────────────────────────────────────────────

    describe('resetPassword', () => {
        it('resets password, revokes all active sessions, emits audit', async () => {
            prisma.passwordResetChallenge.findUnique.mockResolvedValue(RESET_CHALLENGE);
            prisma.passwordResetChallenge.update.mockResolvedValue({});
            prisma.user.update.mockResolvedValue({});
            prisma.authSession.updateMany.mockResolvedValue({ count: 2 });

            const result = await service.resetPassword('raw-reset-token', 'NewPass123!', '1.2.3.4');
            expect(result).toEqual({ ok: true });

            // sessions should be revoked
            expect(prisma.authSession.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: 'REVOKED', revokeReason: 'PASSWORD_RESET' }),
                }),
            );
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"auth_password_reset_completed"'),
            );
        });

        it('throws AUTH_RESET_TOKEN_INVALID for unknown token', async () => {
            prisma.passwordResetChallenge.findUnique.mockResolvedValue(null);
            await expect(service.resetPassword('bad', 'NewPass123!')).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'AUTH_RESET_TOKEN_INVALID' }),
            });
        });

        it('throws AUTH_RESET_TOKEN_INVALID for already USED token', async () => {
            prisma.passwordResetChallenge.findUnique.mockResolvedValue({ ...RESET_CHALLENGE, status: 'USED' });
            await expect(service.resetPassword('used-token', 'NewPass123!')).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'AUTH_RESET_TOKEN_INVALID' }),
            });
        });

        it('throws AUTH_RESET_TOKEN_EXPIRED for expired token', async () => {
            prisma.passwordResetChallenge.findUnique.mockResolvedValue({
                ...RESET_CHALLENGE,
                expiresAt: new Date(Date.now() - 1000),
            });
            prisma.passwordResetChallenge.update.mockResolvedValue({});

            await expect(service.resetPassword('expired-token', 'NewPass123!')).rejects.toMatchObject({
                response: expect.objectContaining({ code: 'AUTH_RESET_TOKEN_EXPIRED' }),
            });
        });
    });

    // ─── changePassword ───────────────────────────────────────────────────────

    describe('changePassword', () => {
        beforeEach(() => {
            prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
            prisma.user.update.mockResolvedValue({});
            prisma.authSession.updateMany.mockResolvedValue({ count: 1 });
        });

        it('changes password, revokes OTHER sessions (not current), emits audit', async () => {
            mockedBcrypt.compare
                .mockResolvedValueOnce(true as never)   // currentPassword valid
                .mockResolvedValueOnce(false as never);  // newPassword !== current

            const result = await service.changePassword('user-1', 'session-current', 'OldPass!', 'NewPass123!', '1.2.3.4');
            expect(result).toEqual({ ok: true });

            expect(prisma.authSession.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        userId: 'user-1',
                        status: 'ACTIVE',
                        id: { not: 'session-current' },
                    }),
                    data: expect.objectContaining({ status: 'REVOKED', revokeReason: 'PASSWORD_CHANGE' }),
                }),
            );
            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"auth_password_changed"'),
            );
        });

        it('throws AUTH_INVALID_CURRENT_PASSWORD for wrong current password', async () => {
            mockedBcrypt.compare.mockResolvedValue(false as never);
            await expect(service.changePassword('user-1', 'session-1', 'WrongOld!', 'NewPass123!'))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ code: 'AUTH_INVALID_CURRENT_PASSWORD' }),
                });
        });

        it('throws AUTH_NEW_PASSWORD_SAME_AS_CURRENT when reusing current password', async () => {
            mockedBcrypt.compare
                .mockResolvedValueOnce(true as never)  // currentPassword valid
                .mockResolvedValueOnce(true as never); // newPassword === current

            await expect(service.changePassword('user-1', 'session-1', 'SamePass!', 'SamePass!'))
                .rejects.toMatchObject({
                    response: expect.objectContaining({ code: 'AUTH_NEW_PASSWORD_SAME_AS_CURRENT' }),
                });
        });
    });

    // ─── Observability — audit event coverage ────────────────────────────────

    describe('observability: all critical audit events are emitted', () => {
        const captureEvents = () => {
            const events: string[] = [];
            logSpy.mockImplementation((msg: string) => {
                try { events.push(JSON.parse(msg).event); } catch { /* not JSON */ }
            });
            return events;
        };

        it('covers auth_user_registered', async () => {
            prisma.user.findUnique.mockResolvedValue(null);
            prisma.user.create.mockResolvedValue({ ...PENDING_USER, id: 'u-x' });
            prisma.authIdentity.create.mockResolvedValue({});
            prisma.emailVerificationChallenge.create.mockResolvedValue({});
            const events = captureEvents();
            await service.register({ email: 'x@x.com', password: 'Pass1234!' });
            expect(events).toContain('auth_user_registered');
        });

        it('covers auth_email_verified', async () => {
            prisma.emailVerificationChallenge.findUnique.mockResolvedValue(PENDING_CHALLENGE);
            prisma.emailVerificationChallenge.update.mockResolvedValue({});
            prisma.user.update.mockResolvedValue({});
            const events = captureEvents();
            await service.verifyEmail('raw-token');
            expect(events).toContain('auth_email_verified');
        });

        it('covers auth_login_succeeded', async () => {
            prisma.user.update.mockResolvedValue({});
            const events = captureEvents();
            await service.loginUser('user-1', '1.2.3.4');
            expect(events).toContain('auth_login_succeeded');
        });

        it('covers auth_login_failed (wrong password)', async () => {
            prisma.loginAttempt.count.mockResolvedValue(0);
            prisma.loginAttempt.create.mockResolvedValue({});
            const userService = service['userService'] as any;
            userService.findByEmail = jest.fn().mockResolvedValue(ACTIVE_USER);
            mockedBcrypt.compare.mockResolvedValue(false as never);
            const events = captureEvents();
            await service.validateUser({ email: 'user@example.com', password: 'wrong' }).catch(() => {});
            expect(events).toContain('auth_login_failed');
        });

        it('covers auth_refresh_token_reuse_detected', async () => {
            prisma.authSession.findUnique.mockResolvedValue({ ...ACTIVE_SESSION, status: 'ROTATED' });
            prisma.authSession.updateMany.mockResolvedValue({ count: 1 });
            const events = captureEvents();
            await service.refreshSession('reused').catch(() => {});
            expect(events).toContain('auth_refresh_token_reuse_detected');
        });

        it('covers auth_password_reset_requested', async () => {
            prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
            prisma.passwordResetChallenge.findFirst.mockResolvedValue(null);
            prisma.passwordResetChallenge.count.mockResolvedValue(0);
            prisma.passwordResetChallenge.updateMany.mockResolvedValue({ count: 0 });
            prisma.passwordResetChallenge.create.mockResolvedValue({});
            const events = captureEvents();
            await service.forgotPassword('user@example.com');
            expect(events).toContain('auth_password_reset_requested');
        });

        it('covers auth_password_reset_completed', async () => {
            prisma.passwordResetChallenge.findUnique.mockResolvedValue(RESET_CHALLENGE);
            prisma.passwordResetChallenge.update.mockResolvedValue({});
            prisma.user.update.mockResolvedValue({});
            prisma.authSession.updateMany.mockResolvedValue({ count: 0 });
            const events = captureEvents();
            await service.resetPassword('raw-token', 'NewPass123!');
            expect(events).toContain('auth_password_reset_completed');
        });

        it('covers auth_password_changed', async () => {
            prisma.user.findUnique.mockResolvedValue(ACTIVE_USER);
            prisma.user.update.mockResolvedValue({});
            prisma.authSession.updateMany.mockResolvedValue({ count: 0 });
            mockedBcrypt.compare
                .mockResolvedValueOnce(true as never)
                .mockResolvedValueOnce(false as never);
            const events = captureEvents();
            await service.changePassword('user-1', 'session-1', 'OldPass!', 'NewPass123!');
            expect(events).toContain('auth_password_changed');
        });

        it('covers auth_session_revoked (logout-all)', async () => {
            prisma.authSession.updateMany.mockResolvedValue({ count: 3 });
            const events = captureEvents();
            await service.revokeAllSessions('user-1');
            expect(events).toContain('auth_session_revoked');
        });
    });
});
