import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { UserService } from '../users/user.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(
        private readonly prisma: PrismaService,
        private readonly userService: UserService,
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromExtractors([
                (request: Request) => {
                    let token = null;
                    if (request && request.cookies) {
                        token = request.cookies['Authentication'];
                    }
                    return token || ExtractJwt.fromAuthHeaderAsBearerToken()(request);
                },
            ]),
            ignoreExpiration: false,
            secretOrKey: process.env.JWT_SECRET || 'super-secret-key-change-me',
        });
    }

    async validate(payload: any) {
        const sessionId: string | undefined = payload.sessionId;
        if (!sessionId) throw new UnauthorizedException();

        const session = await this.prisma.authSession.findUnique({
            where: { id: sessionId },
        });

        if (!session || session.status !== 'ACTIVE') {
            throw new UnauthorizedException();
        }

        // best-effort lastSeenAt update — не блокируем запрос
        this.prisma.authSession.update({
            where: { id: sessionId },
            data: { lastSeenAt: new Date() },
        }).catch(() => {});

        const user = await this.userService.findById(payload.sub);
        if (!user || user.status !== 'ACTIVE') {
            throw new UnauthorizedException();
        }

        const { passwordHash, ...result } = user;
        (result as any).sessionId = sessionId;

        // activeTenantId из JWT валиден, если membershipVersion не изменился с момента выдачи токена
        if (
            typeof payload.membershipVersion === 'number' &&
            payload.membershipVersion === (user as any).membershipVersion
        ) {
            (result as any).activeTenantId = payload.activeTenantId ?? null;
        }

        return result;
    }
}
