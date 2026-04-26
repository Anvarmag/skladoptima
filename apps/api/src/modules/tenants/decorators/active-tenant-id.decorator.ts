import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const ActiveTenantId = createParamDecorator(
    (_: unknown, ctx: ExecutionContext): string | null => {
        const request = ctx.switchToHttp().getRequest();
        return request.activeTenantId ?? null;
    },
);
