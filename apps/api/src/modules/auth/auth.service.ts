import {
    Injectable,
    UnauthorizedException,
    BadRequestException,
    ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { UserService } from '../users/user.service';
import { EmailService } from './email.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 часа
const RESEND_COOLDOWN_MS = 60 * 1000;                   // 60 секунд
const RESEND_HOURLY_LIMIT = 3;

@Injectable()
export class AuthService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly userService: UserService,
        private readonly jwtService: JwtService,
        private readonly emailService: EmailService,
    ) {}

    // ─── Register ────────────────────────────────────────────────────────────────

    async register(dto: RegisterDto) {
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
            const secondsSinceLast = (Date.now() - lastChallenge.createdAt.getTime());
            if (secondsSinceLast < RESEND_COOLDOWN_MS) {
                const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - secondsSinceLast) / 1000);
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

        return { sent: true };
    }

    // ─── Login ────────────────────────────────────────────────────────────────────

    async validateUser(loginDto: LoginDto): Promise<any> {
        const email = loginDto.email.toLowerCase().trim();
        const user = await this.userService.findByEmail(email);

        if (!user || !(await bcrypt.compare(loginDto.password, user.passwordHash))) {
            throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
        }

        if (user.status === 'PENDING_VERIFICATION') {
            throw new UnauthorizedException({
                code: 'AUTH_EMAIL_NOT_VERIFIED',
                nextAction: 'VERIFY_EMAIL',
            });
        }

        if (user.status === 'LOCKED') {
            throw new UnauthorizedException({ code: 'AUTH_ACCOUNT_LOCKED' });
        }

        if (user.status === 'DELETED') {
            throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
        }

        const { passwordHash, ...result } = user;
        return result;
    }

    async login(user: any) {
        const payload = { email: user.email, sub: user.id, tenantId: user.tenantId };
        return { access_token: this.jwtService.sign(payload) };
    }

    // ─── Telegram ─────────────────────────────────────────────────────────────────

    async validateTelegramAuth(initData: string) {
        const telegramId = await this.extractTelegramId(initData);

        const user = await this.userService.findByTelegramId(telegramId);
        if (!user) {
            throw new UnauthorizedException('account_not_linked');
        }

        const { passwordHash, ...result } = user;
        return result;
    }

    async linkTelegramAccount(initData: string, loginDto: LoginDto) {
        const telegramId = await this.extractTelegramId(initData);
        const user = await this.validateUser(loginDto);

        const existingTgUser = await this.userService.findByTelegramId(telegramId);
        if (existingTgUser && existingTgUser.id !== user.id) {
            throw new UnauthorizedException('telegram_already_linked_elsewhere');
        }

        const updatedUser = await this.userService.updateTelegramId(user.id, telegramId);
        const { passwordHash: _, ...result } = updatedUser;
        return result;
    }

    async unlinkTelegramAccount(userId: string) {
        const updatedUser = await this.userService.updateTelegramId(userId, null);
        const { passwordHash: _, ...result } = updatedUser;
        return result;
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────────

    private hashToken(rawToken: string): string {
        return crypto.createHash('sha256').update(rawToken).digest('hex');
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
