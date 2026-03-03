import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
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
            await this.prisma.user.create({
                data: {
                    email,
                    password: hashedPassword,
                },
            });
            this.logger.log(`Created default admin user: ${email}`);
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

    async findByEmail(email: string) {
        return this.prisma.user.findUnique({ where: { email } });
    }

    async findById(id: string) {
        return this.prisma.user.findUnique({ where: { id } });
    }
}
