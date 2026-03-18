import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UserService } from '../user/user.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
    constructor(
        private readonly userService: UserService,
        private readonly jwtService: JwtService,
    ) { }

    async validateUser(loginDto: LoginDto): Promise<any> {
        const user = await this.userService.findByEmail(loginDto.email);
        if (!user || !(await bcrypt.compare(loginDto.password, user.password))) {
            throw new UnauthorizedException('Invalid email or password');
        }

        const { password, ...result } = user;
        return result;
    }

    async login(user: any) {
        const payload = { email: user.email, sub: user.id, storeId: user.storeId };
        return {
            access_token: this.jwtService.sign(payload),
        };
    }

    async validateTelegramAuth(initData: string) {
        const telegramId = await this.extractTelegramId(initData);

        // Find user by telegramId
        const user = await this.userService.findByTelegramId(telegramId);
        if (!user) {
            // Note: We no longer auto-create users here to allow manual linking
            throw new UnauthorizedException('account_not_linked');
        }

        const { password, ...result } = user;
        return result;
    }

    async linkTelegramAccount(initData: string, loginDto: LoginDto) {
        const telegramId = await this.extractTelegramId(initData);

        // Validate existing user credentials
        const user = await this.validateUser(loginDto);

        // Check if this telegramId is already linked to SOMEONE ELSE
        const existingTgUser = await this.userService.findByTelegramId(telegramId);
        if (existingTgUser && existingTgUser.id !== user.id) {
            throw new UnauthorizedException('telegram_already_linked_elsewhere');
        }

        // Link the account
        const updatedUser = await this.userService.updateTelegramId(user.id, telegramId);
        const { password: _, ...result } = updatedUser;
        return result;
    }

    async unlinkTelegramAccount(userId: string) {
        const updatedUser = await this.userService.updateTelegramId(userId, null);
        const { password: _, ...result } = updatedUser;
        return result;
    }

    private async extractTelegramId(initData: string): Promise<string> {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) {
            throw new UnauthorizedException('Telegram bot token not configured');
        }

        const params = new URLSearchParams(initData);
        const hash = params.get('hash');
        if (!hash) {
            throw new UnauthorizedException('Invalid Telegram initData');
        }

        const dataCheckArr: string[] = [];
        params.forEach((value, key) => {
            if (key !== 'hash') {
                dataCheckArr.push(`${key}=${value}`);
            }
        });
        dataCheckArr.sort();
        const dataCheckString = dataCheckArr.join('\n');

        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
        const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        if (computedHash !== hash) {
            throw new UnauthorizedException('Invalid Telegram signature');
        }

        const userDataStr = params.get('user');
        if (!userDataStr) {
            throw new UnauthorizedException('No user data');
        }

        const tgUser = JSON.parse(userDataStr);
        return tgUser.id.toString();
    }
}
