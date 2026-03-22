import { Injectable, OnModuleInit, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { Role } from '@prisma/client';

@Injectable()
export class UserService implements OnModuleInit {
    private readonly logger = new Logger(UserService.name);

    constructor(private readonly prisma: PrismaService) { }

    async onModuleInit() {
        await this.seedAdmin();
    }

    async seedAdmin() {
        const email = process.env.ADMIN_EMAIL || 'admin@example.com';
        const password = process.env.ADMIN_PASSWORD || 'admin';

        const existingAdmin = await this.prisma.user.findUnique({
            where: { email },
        });

        if (!existingAdmin) {
            const hashedPassword = await bcrypt.hash(password, 10);
            await this.prisma.$transaction(async (tx) => {
                const tenant = await tx.tenant.create({
                    data: { name: 'Главный Склад Админа' }
                });
                
                const user = await tx.user.create({
                    data: {
                        email,
                        password: hashedPassword,
                    },
                });

                await tx.membership.create({
                    data: {
                        userId: user.id,
                        tenantId: tenant.id,
                        role: Role.OWNER
                    }
                });
            });
            this.logger.log(`Created default admin user: ${email} with its own Tenant`);
        } else {
            // Временно принудительно обновляем пароль, если он изменился
            const hashedPassword = await bcrypt.hash(password, 10);
            await this.prisma.user.update({
                where: { email },
                data: { password: hashedPassword }
            });
            this.logger.log(`Admin user ${email} password updated to ${password}.`);
        }
    }

    async registerUser(email: string, passwordPlain: string, tenantName?: string) {
        const existingUser = await this.prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            throw new BadRequestException('User with this email already exists');
        }

        const hashedPassword = await bcrypt.hash(passwordPlain, 10);

        return this.prisma.$transaction(async (tx) => {
            const tenant = await tx.tenant.create({
                data: {
                    name: tenantName || `Компания (${email})`,
                }
            });

            const user = await tx.user.create({
                data: {
                    email,
                    password: hashedPassword,
                }
            });

            await tx.membership.create({
                data: {
                    userId: user.id,
                    tenantId: tenant.id,
                    role: Role.OWNER
                }
            });

            return tx.user.findUnique({
                where: { id: user.id },
                include: { memberships: { include: { tenant: true } } }
            });
        });
    }

    async findByEmail(email: string) {
        return this.prisma.user.findUnique({
            where: { email },
            include: { memberships: { include: { tenant: true } } }
        });
    }

    async findById(id: string) {
        return this.prisma.user.findUnique({
            where: { id },
            include: { memberships: { include: { tenant: true } } }
        });
    }

    async findByTelegramId(telegramId: string) {
        return this.prisma.user.findUnique({
            where: { telegramId },
            include: { memberships: { include: { tenant: true } } }
        });
    }

    async updateTelegramId(userId: string, telegramId: string | null) {
        return this.prisma.user.update({
            where: { id: userId },
            data: { telegramId },
            include: { memberships: { include: { tenant: true } } }
        });
    }

    async createTelegramUser(telegramId: string, displayName: string) {
        const randomPass = require('crypto').randomBytes(32).toString('hex');
        const hashedPassword = await bcrypt.hash(randomPass, 10);

        return this.prisma.$transaction(async (tx) => {
            const tenant = await tx.tenant.create({
                data: { name: `Telegram Склад ${displayName}` }
            });

            const user = await tx.user.create({
                data: {
                    email: `tg_${telegramId}@telegram.local`,
                    password: hashedPassword,
                    telegramId,
                },
            });

            await tx.membership.create({
                data: {
                    userId: user.id,
                    tenantId: tenant.id,
                    role: Role.OWNER
                }
            });

            return tx.user.findUnique({
                where: { id: user.id },
                include: { memberships: { include: { tenant: true } } }
            });
        });
    }
}
