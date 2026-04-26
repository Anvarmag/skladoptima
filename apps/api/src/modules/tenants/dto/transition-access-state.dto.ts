import { IsEnum, IsString, IsOptional, IsUUID, IsObject } from 'class-validator';
import { AccessState, TenantActorType } from '@prisma/client';

export class TransitionAccessStateDto {
    @IsEnum(AccessState)
    toState: AccessState;

    @IsString()
    reasonCode: string;

    @IsEnum(TenantActorType)
    actorType: TenantActorType;

    @IsOptional()
    @IsUUID()
    actorId?: string;

    @IsOptional()
    @IsObject()
    reasonDetails?: Record<string, unknown>;
}
