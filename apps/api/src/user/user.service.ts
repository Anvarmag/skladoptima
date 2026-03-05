import { Injectable, OnModuleInit, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UserService implements OnModuleInit {
    private readonly logger = new Logger(UserService.name);

    constructor(private readonly prisma: PrismaService) { }

    async onModuleInit() {
        await this.seedAdmin();
    }

    async seedAdmin() {
        const email = process.env.ADMIN_EMAIL || 'admin';
        const password = process.env.ADMIN_PASSWORD || 'admin777';

        const existingAdmin = await this.prisma.user.findUnique({
            where: { email },
        });

        if (!existingAdmin) {
            const hashedPassword = await bcrypt.hash(password, 10);
            await this.prisma.$transaction(async (tx) => {
                const store = await tx.store.create({
                    data: { name: 'Главный Склад Админа' }
                });
                await tx.user.create({
                    data: {
                        email,
                        password: hashedPassword,
                        store: { connect: { id: store.id } }
                    },
                });
            });
            this.logger.log(`Created default admin user: ${email} with its own Store`);
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

    async registerUser(email: string, passwordPlain: string, storeName?: string) {
        const existingUser = await this.prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            throw new BadRequestException('User with this email already exists');
        }

        const hashedPassword = await bcrypt.hash(passwordPlain, 10);

        return this.prisma.$transaction(async (tx) => {
            const store = await tx.store.create({
                data: {
                    name: storeName || `Склад (${email})`,
                }
            });

            const user = await tx.user.create({
                data: {
                    email,
                    password: hashedPassword,
                    store: { connect: { id: store.id } }
                }
            });

            return tx.user.findUnique({
                where: { id: user.id },
                include: { store: true }
            });
        });
    }

    async findByEmail(email: string) {
        return this.prisma.user.findUnique({
            where: { email },
            include: { store: true }
        });
    }

    async findById(id: string) {
        return this.prisma.user.findUnique({
            where: { id },
            include: { store: true }
        });
    }

    async findByTelegramId(telegramId: string) {
        return this.prisma.user.findUnique({
            where: { telegramId },
            include: { store: true }
        });
    }

    async createTelegramUser(telegramId: string, displayName: string) {
        const randomPass = require('crypto').randomBytes(32).toString('hex');
        const hashedPassword = await bcrypt.hash(randomPass, 10);

        return this.prisma.$transaction(async (tx) => {
            const store = await tx.store.create({
                data: { name: `Telegram Склад ${displayName}` }
            });

            const user = await tx.user.create({
                data: {
                    email: `tg_${telegramId}@telegram.local`,
                    password: hashedPassword,
                    telegramId,
                    store: { connect: { id: store.id } }
                },
            });

            return tx.user.findUnique({
                where: { id: user.id },
                include: { store: true }
            });
        });
    }
}
