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
        if (user && (await bcrypt.compare(loginDto.password, user.password))) {
            const { password, ...result } = user;
            return result;
        }
        throw new UnauthorizedException('Invalid email or password');
    }

    async login(user: any) {
        const payload = { email: user.email, sub: user.id };
        return {
            access_token: this.jwtService.sign(payload),
        };
    }

    async validateTelegramAuth(initData: string) {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) {
            throw new UnauthorizedException('Telegram bot token not configured');
        }

        // Parse initData as URLSearchParams
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');
        if (!hash) {
            throw new UnauthorizedException('Invalid Telegram initData: no hash');
        }

        // Build data-check-string (sorted alphabetically, excluding hash)
        const dataCheckArr: string[] = [];
        params.forEach((value, key) => {
            if (key !== 'hash') {
                dataCheckArr.push(`${key}=${value}`);
            }
        });
        dataCheckArr.sort();
        const dataCheckString = dataCheckArr.join('\n');

        // HMAC-SHA256 validation per Telegram spec
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
        const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        if (computedHash !== hash) {
            throw new UnauthorizedException('Invalid Telegram signature');
        }

        // Check auth_date is not too old (5 minutes)
        const authDate = parseInt(params.get('auth_date') || '0', 10);
        const now = Math.floor(Date.now() / 1000);
        if (now - authDate > 300) {
            throw new UnauthorizedException('Telegram auth data expired');
        }

        // Extract user from initData
        const userDataStr = params.get('user');
        if (!userDataStr) {
            throw new UnauthorizedException('No user data in Telegram initData');
        }

        const tgUser = JSON.parse(userDataStr);
        const telegramId = tgUser.id.toString();
        const displayName = tgUser.first_name || tgUser.username || `tg_${telegramId}`;

        // Find or create user
        let user = await this.userService.findByTelegramId(telegramId);
        if (!user) {
            user = await this.userService.createTelegramUser(telegramId, displayName);
        }

        const { password, ...result } = user;
        return result;
    }
}
