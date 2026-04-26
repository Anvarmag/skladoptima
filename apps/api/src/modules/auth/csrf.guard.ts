import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CsrfService } from './csrf.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SKIP_CSRF_KEY } from './skip-csrf.decorator';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

@Injectable()
export class CsrfGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly csrfService: CsrfService,
    ) {}

    canActivate(context: ExecutionContext): boolean {
        const req = context.switchToHttp().getRequest();

        if (SAFE_METHODS.includes(req.method)) return true;

        // Pre-auth public endpoints don't have a session to protect
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (isPublic) return true;

        const skipCsrf = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (skipCsrf) return true;

        const cookieToken = req.cookies?.['csrf-token'] as string | undefined;
        const headerToken = req.headers['x-csrf-token'] as string | undefined;

        if (!this.csrfService.validateToken(cookieToken, headerToken)) {
            throw new ForbiddenException({ code: 'CSRF_TOKEN_INVALID' });
        }

        return true;
    }
}
