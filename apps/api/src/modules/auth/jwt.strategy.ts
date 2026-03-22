import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { UserService } from '../users/user.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(private readonly userService: UserService) {
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
        const user = await this.userService.findById(payload.sub);
        if (!user) {
            throw new UnauthorizedException();
        }
        const { password, ...result } = user;
        
        // Populate tenantId for backward compatibility and simpler controller access
        (result as any).tenantId = user.memberships?.[0]?.tenantId;
        
        return result;
    }
}
