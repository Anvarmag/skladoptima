import {
    IsString,
    IsNotEmpty,
    IsOptional,
    IsArray,
    ArrayNotEmpty,
    ArrayUnique,
    IsUUID,
    MaxLength,
    IsIn,
} from 'class-validator';

import { SyncTypes, SyncType } from '../../marketplace_sync/sync-run.contract';

/**
 * POST /sync/runs — manual sync now по account.
 *
 * §10 system-analytics: manual MVP-actions ограничены `sync now` по
 * конкретному account; `tenant full sync` в runtime surface не выводим.
 * Поэтому `marketplaceAccountId` обязателен; `triggerScope` всегда ACCOUNT
 * (TENANT_FULL не принимается на input — даже если кто-то передаст,
 * service отвергнёт).
 *
 * `idempotencyKey` опционален: если клиент его передаёт, service строит
 * `jobKey` детерминированно и UNIQUE(tenantId, jobKey) на уровне БД
 * гарантирует, что повторный POST с тем же ключом вернёт уже созданный run.
 */
export class CreateSyncRunDto {
    @IsUUID('4', { message: 'marketplaceAccountId must be a valid UUID' })
    accountId!: string;

    @IsArray()
    @ArrayNotEmpty()
    @ArrayUnique()
    @IsIn(Object.values(SyncTypes), {
        each: true,
        message: 'syncTypes contains unsupported value',
    })
    syncTypes!: SyncType[];

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    idempotencyKey?: string;
}
