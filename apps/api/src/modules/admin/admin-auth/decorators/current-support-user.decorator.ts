import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface SupportUserContext {
    id: string;
    email: string;
    role: 'SUPPORT_ADMIN' | 'SUPPORT_READONLY';
    sessionId: string;
}

export const CurrentSupportUser = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): SupportUserContext => {
        const request = ctx.switchToHttp().getRequest();
        return request.supportUser;
    },
);
