import {
    Injectable,
    Logger,
    NotFoundException,
    BadRequestException,
    ConflictException,
    ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CredentialsCipher } from './credentials-cipher.service';
import { CredentialValidator, CredentialValidationResult } from './credential-validator.service';
import {
    MarketplaceType,
    MarketplaceLifecycleStatus,
    MarketplaceCredentialStatus,
    MarketplaceSyncHealthStatus,
    AccessState,
    Prisma,
} from '@prisma/client';
import { CreateMarketplaceAccountDto } from './dto/create-account.dto';
import { UpdateMarketplaceAccountDto } from './dto/update-account.dto';
import {
    validateCredentialsForCreate,
    validateCredentialsForPartialUpdate,
    SECRET_FIELDS,
    isSupportedMarketplace,
} from './credential-schema';

/**
 * Канонические имена событий для журнала `MarketplaceAccountEvent` (§15).
 * Single source of truth, переиспользуется тестами и observability-runbook'ом.
 */
/**
 * Каноничные имена событий для журнала `MarketplaceAccountEvent` (§15).
 * Объявлены в `marketplace-account.events.ts` как single source of truth (TASK_7).
 * Здесь реэкспортируются под историческим именем для обратной совместимости
 * с существующими тестами/импортами.
 */
import { MarketplaceAccountEventNames } from './marketplace-account.events';
export const MarketplaceAccountEvents = MarketplaceAccountEventNames;

/** Effective runtime state — единый ответ «может ли account работать прямо сейчас». */
export type EffectiveRuntimeState =
    | 'OPERATIONAL'
    | 'PAUSED_BY_TENANT'
    | 'CREDENTIAL_BLOCKED'
    | 'SYNC_DEGRADED'
    | 'INACTIVE';

const PAUSED_TENANT_STATES: ReadonlySet<string> = new Set(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED']);

/**
 * Действия с marketplace-account по уровню доступа в paused tenant state
 * (см. §10 system-analytics + DoD TASK_5):
 *
 *   TRIAL_EXPIRED:
 *     - разрешено: PATCH label, deactivate (внутренние, без external API).
 *     - запрещено: validate, reactivate, credentials update, sync now,
 *                  любые external API calls.
 *
 *   SUSPENDED / CLOSED:
 *     - read-only diagnostic mode: ВСЕ write-операции (включая label/deactivate)
 *       блокируются. Read API остаётся доступным.
 */
const READ_ONLY_TENANT_STATES: ReadonlySet<string> = new Set(['SUSPENDED', 'CLOSED']);

@Injectable()
export class MarketplaceAccountsService {
    private readonly logger = new Logger(MarketplaceAccountsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly cipher: CredentialsCipher,
        private readonly validator: CredentialValidator,
    ) {}

    /**
     * POST /marketplace-accounts. Создаёт подключение, шифрует credentials,
     * пишет maskedPreview, эмитит CREATED event. Single-active enforce —
     * через partial UNIQUE INDEX (TASK_1) + явный pre-check.
     */
    async create(tenantId: string, dto: CreateMarketplaceAccountDto) {
        const marketplace = dto.marketplace as MarketplaceType;
        if (!isSupportedMarketplace(marketplace)) {
            throw new BadRequestException({ code: 'MARKETPLACE_NOT_SUPPORTED', marketplace });
        }

        const label = (dto.label ?? '').trim();
        if (!label) throw new BadRequestException({ code: 'LABEL_REQUIRED' });

        // create — external-API action (precursor к validation после CREATE).
        // Запрещён во всех paused tenant states.
        await this._assertExternalApiAllowed(tenantId, 'new-account', 'create');

        // 1. Валидация credentials под schema marketplace.
        const credentials = validateCredentialsForCreate(marketplace, dto.credentials);

        // 2. Pre-check single active (DB-level страховка остаётся через partial UNIQUE).
        const activeExisting = await this.prisma.marketplaceAccount.findFirst({
            where: { tenantId, marketplace, lifecycleStatus: MarketplaceLifecycleStatus.ACTIVE },
            select: { id: true, label: true },
        });
        if (activeExisting) {
            throw new ConflictException({
                code: 'ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE',
                marketplace,
                conflictAccountId: activeExisting.id,
            });
        }

        // 3. Pre-check label uniqueness в (tenant, marketplace).
        const labelTaken = await this.prisma.marketplaceAccount.findFirst({
            where: { tenantId, marketplace, label },
            select: { id: true },
        });
        if (labelTaken) {
            throw new ConflictException({ code: 'ACCOUNT_LABEL_ALREADY_EXISTS' });
        }

        // 4. Шифруем + строим masked preview.
        const encrypted = this.cipher.encrypt(credentials);
        const maskedPreview = this._buildMaskedPreview(marketplace, credentials);
        const keyVersion = this.cipher.getCurrentKeyVersion();

        // 5. Транзакция: account + credential + event.
        const result = await this.prisma.$transaction(async (tx) => {
            try {
                const account = await tx.marketplaceAccount.create({
                    data: {
                        tenantId,
                        marketplace,
                        name: label,
                        label,
                        lifecycleStatus: MarketplaceLifecycleStatus.ACTIVE,
                        credentialStatus: MarketplaceCredentialStatus.VALIDATING,
                        syncHealthStatus: MarketplaceSyncHealthStatus.UNKNOWN,
                    },
                });

                await tx.marketplaceCredential.create({
                    data: {
                        accountId: account.id,
                        encryptedPayload: encrypted,
                        encryptionKeyVersion: keyVersion,
                        schemaVersion: 1,
                        maskedPreview: maskedPreview as Prisma.InputJsonValue,
                    },
                });

                await tx.marketplaceAccountEvent.create({
                    data: {
                        tenantId,
                        accountId: account.id,
                        eventType: MarketplaceAccountEvents.CREATED,
                        payload: {
                            marketplace,
                            label,
                            keyVersion,
                        } as Prisma.InputJsonValue,
                    },
                });

                return account;
            } catch (err: any) {
                // P2002 — нарушение partial UNIQUE WHERE lifecycleStatus='ACTIVE'
                // (race с другим запросом, который только что создал аккаунт).
                if (err?.code === 'P2002') {
                    throw new ConflictException({
                        code: 'ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE',
                        marketplace,
                    });
                }
                throw err;
            }
        });

        this.logger.log(JSON.stringify({
            event: MarketplaceAccountEvents.CREATED,
            tenantId,
            accountId: result.id,
            marketplace,
        }));

        return this._toReadModel({
            ...result,
            credential: { maskedPreview, encryptionKeyVersion: keyVersion, schemaVersion: 1, rotatedAt: null },
        });
    }

    /**
     * PATCH /marketplace-accounts/:id. Обновление label и/или partial
     * credentials. Если меняются credentials — credentialStatus сбрасывается
     * в VALIDATING (re-validate будет запущена отдельной задачей TASK_3).
     */
    async update(tenantId: string, accountId: string, dto: UpdateMarketplaceAccountDto) {
        if (!dto || (dto.label === undefined && dto.credentials === undefined)) {
            throw new BadRequestException({ code: 'UPDATE_EMPTY' });
        }

        // Tenant-state-aware policy (TASK_5):
        //   - credentials update → external-api action (precursor к re-validate),
        //     блок при TRIAL_EXPIRED + SUSPENDED + CLOSED;
        //   - label-only update → internal action, разрешён в TRIAL_EXPIRED,
        //     блок только при SUSPENDED/CLOSED.
        if (dto.credentials !== undefined) {
            await this._assertExternalApiAllowed(tenantId, accountId, 'update_credentials');
        } else {
            await this._assertInternalWriteAllowed(tenantId, accountId, 'update_label');
        }

        const account = await this.prisma.marketplaceAccount.findFirst({
            where: { id: accountId, tenantId },
            include: { credential: true },
        });
        if (!account) throw new NotFoundException({ code: 'ACCOUNT_NOT_FOUND' });

        const updates: Prisma.MarketplaceAccountUpdateInput = {};

        if (dto.label !== undefined) {
            const label = dto.label.trim();
            if (!label) throw new BadRequestException({ code: 'LABEL_REQUIRED' });
            if (label !== account.label) {
                const labelTaken = await this.prisma.marketplaceAccount.findFirst({
                    where: { tenantId, marketplace: account.marketplace, label, id: { not: accountId } },
                    select: { id: true },
                });
                if (labelTaken) {
                    throw new ConflictException({ code: 'ACCOUNT_LABEL_ALREADY_EXISTS' });
                }
                updates.label = label;
                updates.name = label; // sync legacy name field
            }
        }

        let newEncryptedPayload: Buffer | null = null;
        let newMaskedPreview: Record<string, string | null> | null = null;
        let newCredentialPayload: Record<string, string> | null = null;

        if (dto.credentials !== undefined) {
            // Decrypt existing для merge.
            let existingPayload: Record<string, string> = {};
            if (account.credential?.encryptedPayload) {
                const dec = this.cipher.decrypt(account.credential.encryptedPayload as any);
                // приводим к { key: string } после decrypt.
                for (const [k, v] of Object.entries(dec)) {
                    if (typeof v === 'string') existingPayload[k] = v;
                }
            }

            // Валидируем новые поля как partial (но без required check).
            const incoming = validateCredentialsForPartialUpdate(account.marketplace, dto.credentials);
            const merged: Record<string, string> = { ...existingPayload, ...incoming };

            // После merge required-поля должны быть на месте — иначе попытка
            // частичного создания подключения. Запускаем full-валидацию для
            // финальной проверки.
            validateCredentialsForCreate(account.marketplace, merged);

            newEncryptedPayload = this.cipher.encrypt(merged);
            newMaskedPreview = this._buildMaskedPreview(account.marketplace, merged);
            newCredentialPayload = merged;
            updates.credentialStatus = MarketplaceCredentialStatus.VALIDATING;
            updates.lastValidatedAt = null;
            updates.lastValidationErrorCode = null;
            updates.lastValidationErrorMessage = null;
        }

        const keyVersion = this.cipher.getCurrentKeyVersion();
        const result = await this.prisma.$transaction(async (tx) => {
            const updated = await tx.marketplaceAccount.update({
                where: { id: accountId },
                data: updates,
            });

            if (newEncryptedPayload && newMaskedPreview) {
                if (account.credential) {
                    await tx.marketplaceCredential.update({
                        where: { accountId },
                        data: {
                            encryptedPayload: newEncryptedPayload,
                            encryptionKeyVersion: keyVersion,
                            schemaVersion: 1,
                            maskedPreview: newMaskedPreview as Prisma.InputJsonValue,
                            rotatedAt: new Date(),
                        },
                    });
                } else {
                    await tx.marketplaceCredential.create({
                        data: {
                            accountId,
                            encryptedPayload: newEncryptedPayload,
                            encryptionKeyVersion: keyVersion,
                            schemaVersion: 1,
                            maskedPreview: newMaskedPreview as Prisma.InputJsonValue,
                        },
                    });
                }
                await tx.marketplaceAccountEvent.create({
                    data: {
                        tenantId,
                        accountId,
                        eventType: MarketplaceAccountEvents.CREDENTIALS_ROTATED,
                        payload: {
                            keyVersion,
                            // payload содержит только список полей, что менялись —
                            // НЕ значения. Безопасно для аудита.
                            fieldsRotated: Object.keys(dto.credentials!),
                        } as Prisma.InputJsonValue,
                    },
                });
            }

            if (updates.label) {
                await tx.marketplaceAccountEvent.create({
                    data: {
                        tenantId,
                        accountId,
                        eventType: MarketplaceAccountEvents.LABEL_UPDATED,
                        payload: { from: account.label, to: updates.label } as Prisma.InputJsonValue,
                    },
                });
            }

            return updated;
        });

        this.logger.log(JSON.stringify({
            event: 'marketplace_account_updated',
            tenantId,
            accountId,
            labelChanged: !!updates.label,
            credentialsRotated: !!newEncryptedPayload,
        }));

        const finalCredential = newMaskedPreview
            ? {
                maskedPreview: newMaskedPreview,
                encryptionKeyVersion: keyVersion,
                schemaVersion: 1,
                rotatedAt: new Date(),
            }
            : account.credential
                ? {
                    maskedPreview: account.credential.maskedPreview,
                    encryptionKeyVersion: account.credential.encryptionKeyVersion,
                    schemaVersion: account.credential.schemaVersion,
                    rotatedAt: account.credential.rotatedAt,
                }
                : null;

        return this._toReadModel({ ...result, credential: finalCredential });
    }

    // ----------------------------------------------------------------
    // LIFECYCLE — validate / deactivate / reactivate
    // ----------------------------------------------------------------

    /**
     * POST /marketplace-accounts/:id/validate.
     *
     * Decrypt credentials → дёрнуть external API → обновить только credential
     * fields (`credentialStatus`, `lastValidatedAt`, `lastValidationError*`).
     * Operational sync health НЕ трогается — это §20 invariant: credential
     * validity и sync health — независимые слои.
     */
    async validate(tenantId: string, accountId: string) {
        // External-API action: запрещено в TRIAL_EXPIRED/SUSPENDED/CLOSED.
        await this._assertExternalApiAllowed(tenantId, accountId, 'validate');

        const account = await this.prisma.marketplaceAccount.findFirst({
            where: { id: accountId, tenantId },
            include: { credential: true },
        });
        if (!account) throw new NotFoundException({ code: 'ACCOUNT_NOT_FOUND' });

        if (account.lifecycleStatus !== MarketplaceLifecycleStatus.ACTIVE) {
            throw new ConflictException({
                code: 'ACCOUNT_INACTIVE',
                message: 'Cannot validate inactive account; reactivate it first',
            });
        }
        if (!account.credential?.encryptedPayload) {
            throw new ConflictException({
                code: 'ACCOUNT_HAS_NO_CREDENTIALS',
                message: 'Account exists but credentials were not stored — recreate via PATCH',
            });
        }

        // Поднимаем credentialStatus до VALIDATING ДО внешнего вызова, чтобы UI
        // мог показать «идёт проверка», даже если процесс упадёт.
        await this.prisma.marketplaceAccount.update({
            where: { id: accountId },
            data: { credentialStatus: MarketplaceCredentialStatus.VALIDATING },
        });

        // Decrypt — bridge между шифр-хранилищем и validator.
        const payload = this.cipher.decrypt(account.credential.encryptedPayload as any);
        const credentials: Record<string, string> = {};
        for (const [k, v] of Object.entries(payload)) {
            if (typeof v === 'string') credentials[k] = v;
        }

        let result: CredentialValidationResult;
        try {
            result = await this.validator.validate(account.marketplace, credentials);
        } catch (err: any) {
            // Validator не должен throw'ить — но на всякий случай защищаемся.
            result = {
                ok: false,
                errorCode: 'VALIDATOR_INTERNAL_ERROR',
                errorMessage: err?.message ?? 'unknown',
            };
        }

        const now = new Date();
        const updateData: Prisma.MarketplaceAccountUpdateInput = {
            lastValidatedAt: now,
            lastValidationErrorCode: result.errorCode ?? null,
            lastValidationErrorMessage: result.errorMessage ?? null,
        };
        if (result.ok) {
            updateData.credentialStatus = MarketplaceCredentialStatus.VALID;
        } else if (result.needsReconnect) {
            updateData.credentialStatus = MarketplaceCredentialStatus.NEEDS_RECONNECT;
        } else if (result.errorCode === 'AUTH_UNAUTHORIZED' || result.errorCode?.startsWith('CREDENTIAL_')) {
            updateData.credentialStatus = MarketplaceCredentialStatus.INVALID;
        } else if (result.errorCode?.startsWith('HTTP_4')) {
            updateData.credentialStatus = MarketplaceCredentialStatus.INVALID;
        } else {
            // Network/5xx/timeout — не уверены, что credentials битые.
            updateData.credentialStatus = MarketplaceCredentialStatus.UNKNOWN;
        }

        const updated = await this.prisma.$transaction(async (tx) => {
            const upd = await tx.marketplaceAccount.update({
                where: { id: accountId },
                data: updateData,
                include: { credential: true },
            });
            await tx.marketplaceAccountEvent.create({
                data: {
                    tenantId,
                    accountId,
                    eventType: result.ok
                        ? MarketplaceAccountEvents.VALIDATED
                        : MarketplaceAccountEvents.VALIDATION_FAILED,
                    payload: {
                        ok: result.ok,
                        errorCode: result.errorCode ?? null,
                    } as Prisma.InputJsonValue,
                },
            });
            return upd;
        });

        this.logger.log(JSON.stringify({
            event: result.ok
                ? MarketplaceAccountEvents.VALIDATED
                : MarketplaceAccountEvents.VALIDATION_FAILED,
            tenantId,
            accountId,
            credentialStatus: updateData.credentialStatus,
            errorCode: result.errorCode ?? null,
        }));

        return this._toReadModel(updated);
    }

    /**
     * POST /marketplace-accounts/:id/deactivate.
     *
     * `lifecycleStatus → INACTIVE`, `deactivatedAt = now`, `deactivatedBy = userId`.
     * Историю sync/orders/warehouses НЕ трогаем — reference links остаются.
     * Запрещено для уже неактивного аккаунта.
     */
    async deactivate(tenantId: string, accountId: string, actorUserId: string | null) {
        // Internal action — допустим в TRIAL_EXPIRED, заблокирован в SUSPENDED/CLOSED.
        await this._assertInternalWriteAllowed(tenantId, accountId, 'deactivate');

        const account = await this.prisma.marketplaceAccount.findFirst({
            where: { id: accountId, tenantId },
        });
        if (!account) throw new NotFoundException({ code: 'ACCOUNT_NOT_FOUND' });
        if (account.lifecycleStatus === MarketplaceLifecycleStatus.INACTIVE) {
            throw new ConflictException({ code: 'ACCOUNT_ALREADY_INACTIVE' });
        }

        const now = new Date();
        const updated = await this.prisma.$transaction(async (tx) => {
            const upd = await tx.marketplaceAccount.update({
                where: { id: accountId },
                data: {
                    lifecycleStatus: MarketplaceLifecycleStatus.INACTIVE,
                    deactivatedAt: now,
                    deactivatedBy: actorUserId,
                    // Sync health → PAUSED: нет внешних вызовов на inactive account.
                    syncHealthStatus: MarketplaceSyncHealthStatus.PAUSED,
                    syncHealthReason: 'ACCOUNT_DEACTIVATED',
                },
                include: { credential: true },
            });
            await tx.marketplaceAccountEvent.create({
                data: {
                    tenantId,
                    accountId,
                    eventType: MarketplaceAccountEvents.DEACTIVATED,
                    payload: { actorUserId } as Prisma.InputJsonValue,
                },
            });
            return upd;
        });

        this.logger.log(JSON.stringify({
            event: MarketplaceAccountEvents.DEACTIVATED,
            tenantId,
            accountId,
            actorUserId,
        }));

        return this._toReadModel(updated);
    }

    /**
     * POST /marketplace-accounts/:id/reactivate.
     *
     * `lifecycleStatus → ACTIVE`, обнуление deactivation полей. По §10/§14
     * invariant: НЕ возвращаем credentialStatus автоматически в VALID — после
     * reactivate ОБЯЗАТЕЛЬНО запускается re-validate, чтобы убедиться, что
     * credentials всё ещё рабочие после периода inactivity. Single-active
     * enforce — через partial UNIQUE INDEX (P2002 catch).
     */
    async reactivate(tenantId: string, accountId: string, actorUserId: string | null) {
        // External-API action: reactivate триггерит re-validate, поэтому в TRIAL_EXPIRED тоже запрещён.
        await this._assertExternalApiAllowed(tenantId, accountId, 'reactivate');

        const account = await this.prisma.marketplaceAccount.findFirst({
            where: { id: accountId, tenantId },
        });
        if (!account) throw new NotFoundException({ code: 'ACCOUNT_NOT_FOUND' });
        if (account.lifecycleStatus === MarketplaceLifecycleStatus.ACTIVE) {
            throw new ConflictException({ code: 'ACCOUNT_ALREADY_ACTIVE' });
        }

        // Pre-check: нет другого active аккаунта того же marketplace.
        const activeExisting = await this.prisma.marketplaceAccount.findFirst({
            where: {
                tenantId,
                marketplace: account.marketplace,
                lifecycleStatus: MarketplaceLifecycleStatus.ACTIVE,
            },
            select: { id: true, label: true },
        });
        if (activeExisting) {
            throw new ConflictException({
                code: 'ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE',
                marketplace: account.marketplace,
                conflictAccountId: activeExisting.id,
            });
        }

        try {
            await this.prisma.$transaction(async (tx) => {
                await tx.marketplaceAccount.update({
                    where: { id: accountId },
                    data: {
                        lifecycleStatus: MarketplaceLifecycleStatus.ACTIVE,
                        deactivatedAt: null,
                        deactivatedBy: null,
                        // Re-validate обязателен — не считаем credentials валидными автоматически.
                        credentialStatus: MarketplaceCredentialStatus.VALIDATING,
                        lastValidatedAt: null,
                        lastValidationErrorCode: null,
                        lastValidationErrorMessage: null,
                        syncHealthStatus: MarketplaceSyncHealthStatus.UNKNOWN,
                        syncHealthReason: null,
                    },
                });
                await tx.marketplaceAccountEvent.create({
                    data: {
                        tenantId,
                        accountId,
                        eventType: MarketplaceAccountEvents.REACTIVATED,
                        payload: { actorUserId } as Prisma.InputJsonValue,
                    },
                });
            });
        } catch (err: any) {
            if (err?.code === 'P2002') {
                throw new ConflictException({
                    code: 'ACTIVE_ACCOUNT_ALREADY_EXISTS_FOR_MARKETPLACE',
                    marketplace: account.marketplace,
                });
            }
            throw err;
        }

        this.logger.log(JSON.stringify({
            event: MarketplaceAccountEvents.REACTIVATED,
            tenantId,
            accountId,
            actorUserId,
        }));

        // Сразу же запускаем validate. Если внешний API упал — credentialStatus
        // останется VALIDATING с зафиксированной error-info через TASK-3 path.
        return this.validate(tenantId, accountId);
    }

    // ----------------------------------------------------------------
    // READ API — list / detail / diagnostics (TASK_4)
    // ----------------------------------------------------------------

    /**
     * GET /marketplace-accounts. Tenant-scoped листинг с компактным
     * read-model. По §10/§13 возвращает только masked preview, никогда
     * полные секреты.
     */
    async list(
        tenantId: string,
        opts: {
            marketplace?: MarketplaceType;
            lifecycleStatus?: MarketplaceLifecycleStatus;
            credentialStatus?: MarketplaceCredentialStatus;
        } = {},
    ) {
        const where: Prisma.MarketplaceAccountWhereInput = { tenantId };
        if (opts.marketplace) where.marketplace = opts.marketplace;
        if (opts.lifecycleStatus) where.lifecycleStatus = opts.lifecycleStatus;
        if (opts.credentialStatus) where.credentialStatus = opts.credentialStatus;

        const accounts = await this.prisma.marketplaceAccount.findMany({
            where,
            orderBy: [{ lifecycleStatus: 'asc' }, { marketplace: 'asc' }, { label: 'asc' }],
            include: { credential: true },
        });

        return {
            data: accounts.map((a) => this._toReadModel(a)),
            count: accounts.length,
        };
    }

    /**
     * GET /marketplace-accounts/:id — карточка подключения (read-model).
     */
    async getById(tenantId: string, accountId: string) {
        const account = await this.prisma.marketplaceAccount.findFirst({
            where: { id: accountId, tenantId },
            include: { credential: true },
        });
        if (!account) throw new NotFoundException({ code: 'ACCOUNT_NOT_FOUND' });
        return this._toReadModel(account);
    }

    /**
     * GET /marketplace-accounts/:id/diagnostics.
     *
     * Расширенный диагностический view (§19/§20):
     *   - три слоя статуса с error-полями (lifecycle / credential / sync health);
     *   - **effective runtime state** — вычисляется из tenant accessState +
     *     account lifecycle/credential/sync, единый ответ «может ли account
     *     работать сейчас» — UI и support больше не должны делать клиентскую
     *     композицию из 4 полей;
     *   - последние 50 событий из MarketplaceAccountEvent журнала с
     *     payload (БЕЗ значений секретов, только `fieldsRotated` имена) —
     *     audit chain для расследований;
     *   - masked credential preview (тот же, что в read-model).
     *
     * Никаких полей с расшифрованным payload не возвращается.
     */
    async getDiagnostics(tenantId: string, accountId: string) {
        const account = await this.prisma.marketplaceAccount.findFirst({
            where: { id: accountId, tenantId },
            include: { credential: true },
        });
        if (!account) throw new NotFoundException({ code: 'ACCOUNT_NOT_FOUND' });

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { accessState: true },
        });

        const recentEvents = await this.prisma.marketplaceAccountEvent.findMany({
            where: { tenantId, accountId },
            orderBy: { createdAt: 'desc' },
            take: 50,
        });

        const effective = this._computeEffectiveRuntime(account, tenant?.accessState);
        const baseRead = this._toReadModel(account);

        return {
            ...baseRead,
            tenantAccessState: tenant?.accessState ?? null,
            effectiveRuntimeState: effective.state,
            effectiveRuntimeReason: effective.reason,
            statusLayers: {
                lifecycle: {
                    status: account.lifecycleStatus,
                    deactivatedAt: account.deactivatedAt,
                    deactivatedBy: account.deactivatedBy,
                },
                credential: {
                    status: account.credentialStatus,
                    lastValidatedAt: account.lastValidatedAt,
                    lastValidationErrorCode: account.lastValidationErrorCode,
                    lastValidationErrorMessage: account.lastValidationErrorMessage,
                },
                syncHealth: {
                    status: account.syncHealthStatus,
                    reason: account.syncHealthReason,
                    lastSyncAt: account.lastSyncAt,
                    lastSyncResult: account.lastSyncResult,
                    lastSyncErrorCode: account.lastSyncErrorCode,
                    lastSyncErrorMessage: account.lastSyncErrorMessage,
                },
            },
            recentEvents: recentEvents.map((e) => ({
                id: e.id,
                eventType: e.eventType,
                createdAt: e.createdAt,
                payload: e.payload,
            })),
        };
    }

    /**
     * Публичный API для sync.service / worker integration.
     * Записывает результат sync run (только sync-health поля, БЕЗ
     * credential validity — §20 invariant). При ошибке эмитит
     * `marketplace_account_sync_error_detected` event.
     */
    async reportSyncRun(
        tenantId: string,
        accountId: string,
        result: {
            ok: boolean;
            partial?: boolean;
            errorCode?: string;
            errorMessage?: string;
            healthReason?: string;
        },
    ) {
        const account = await this.prisma.marketplaceAccount.findFirst({
            where: { id: accountId, tenantId },
        });
        if (!account) throw new NotFoundException({ code: 'ACCOUNT_NOT_FOUND' });

        // Tenant-state pause: sync.service / worker НЕ должен дёргать external
        // API для paused tenant. Если всё-таки попал сюда — записываем PAUSED_BY_TENANT_STATE
        // event, не трогаем health-поля (sync run «не считается»), возвращаем
        // флаг paused чтобы caller увидел причину.
        const accessState = await this._getTenantAccessState(tenantId);
        if (PAUSED_TENANT_STATES.has(accessState)) {
            await this.prisma.marketplaceAccountEvent.create({
                data: {
                    tenantId,
                    accountId,
                    eventType: MarketplaceAccountEvents.PAUSED_BY_TENANT_STATE,
                    payload: { action: 'sync_run', accessState } as Prisma.InputJsonValue,
                },
            }).catch(() => {});
            this.logger.warn(JSON.stringify({
                event: MarketplaceAccountEvents.PAUSED_BY_TENANT_STATE,
                tenantId,
                accountId,
                accessState,
                action: 'sync_run',
            }));
            return { ...this._toReadModel({ ...account, credential: null }), paused: true } as any;
        }

        const now = new Date();
        const updateData: Prisma.MarketplaceAccountUpdateInput = {
            lastSyncAt: now,
            lastSyncErrorCode: result.errorCode ?? null,
            lastSyncErrorMessage: result.errorMessage ?? null,
        };

        if (result.ok && !result.partial) {
            updateData.lastSyncResult = 'SUCCESS';
            updateData.syncHealthStatus = MarketplaceSyncHealthStatus.HEALTHY;
            updateData.syncHealthReason = null;
        } else if (result.ok && result.partial) {
            updateData.lastSyncResult = 'PARTIAL_SUCCESS';
            updateData.syncHealthStatus = MarketplaceSyncHealthStatus.DEGRADED;
            updateData.syncHealthReason = result.healthReason ?? 'PARTIAL_SUCCESS';
        } else {
            updateData.lastSyncResult = 'FAILED';
            updateData.syncHealthStatus = MarketplaceSyncHealthStatus.ERROR;
            updateData.syncHealthReason = result.healthReason ?? result.errorCode ?? 'SYNC_FAILED';
        }

        const updated = await this.prisma.$transaction(async (tx) => {
            const upd = await tx.marketplaceAccount.update({
                where: { id: accountId },
                data: updateData,
                include: { credential: true },
            });
            if (!result.ok) {
                await tx.marketplaceAccountEvent.create({
                    data: {
                        tenantId,
                        accountId,
                        eventType: MarketplaceAccountEvents.SYNC_ERROR_DETECTED,
                        payload: {
                            errorCode: result.errorCode ?? null,
                            partial: !!result.partial,
                        } as Prisma.InputJsonValue,
                    },
                });
            }
            return upd;
        });

        if (!result.ok) {
            this.logger.warn(JSON.stringify({
                event: MarketplaceAccountEvents.SYNC_ERROR_DETECTED,
                tenantId,
                accountId,
                errorCode: result.errorCode ?? null,
                healthStatus: updateData.syncHealthStatus,
            }));
        }

        return this._toReadModel(updated);
    }

    // ----------------------------------------------------------------
    // TENANT-STATE GUARDS (TASK_5) — defense-in-depth для прямых вызовов
    // из jobs/orchestration кода, минующих HTTP `TenantWriteGuard`.
    // ----------------------------------------------------------------

    /** Загружает accessState; throws TENANT_NOT_FOUND если tenant не существует. */
    private async _getTenantAccessState(tenantId: string): Promise<AccessState> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { accessState: true },
        });
        if (!tenant) {
            throw new NotFoundException({ code: 'TENANT_NOT_FOUND' });
        }
        return tenant.accessState;
    }

    /**
     * Проверяет, что внешние API actions (validate/reactivate/credentials update)
     * разрешены текущим accessState. Все три paused-state блокируют.
     * Записывает `PAUSED_BY_TENANT_STATE` event для audit chain.
     */
    private async _assertExternalApiAllowed(
        tenantId: string,
        accountId: string,
        action: string,
    ): Promise<void> {
        const accessState = await this._getTenantAccessState(tenantId);
        if (PAUSED_TENANT_STATES.has(accessState)) {
            this.logger.warn(JSON.stringify({
                event: MarketplaceAccountEvents.PAUSED_BY_TENANT_STATE,
                tenantId,
                accountId,
                accessState,
                action,
            }));
            // Event пишем только для существующего аккаунта; для create
            // (sentinel `new-account`) аккаунта ещё нет, FK не пройдёт.
            if (accountId !== 'new-account') {
                await this.prisma.marketplaceAccountEvent.create({
                    data: {
                        tenantId,
                        accountId,
                        eventType: MarketplaceAccountEvents.PAUSED_BY_TENANT_STATE,
                        payload: { action, accessState } as Prisma.InputJsonValue,
                    },
                }).catch(() => {/* event log не должен ломать guard */});
            }
            throw new ForbiddenException({
                code: 'ACCOUNT_ACTION_BLOCKED_BY_TENANT_STATE',
                action,
                accessState,
            });
        }
    }

    /**
     * Проверяет, что внутренние write-actions (label rename, deactivate)
     * разрешены. SUSPENDED/CLOSED → read-only mode, всё блокируется.
     * TRIAL_EXPIRED → разрешено (внутренние действия не дёргают external API).
     */
    private async _assertInternalWriteAllowed(
        tenantId: string,
        accountId: string,
        action: string,
    ): Promise<void> {
        const accessState = await this._getTenantAccessState(tenantId);
        if (READ_ONLY_TENANT_STATES.has(accessState)) {
            this.logger.warn(JSON.stringify({
                event: MarketplaceAccountEvents.PAUSED_BY_TENANT_STATE,
                tenantId,
                accountId,
                accessState,
                action,
            }));
            throw new ForbiddenException({
                code: 'ACCOUNT_ACTION_BLOCKED_BY_TENANT_STATE',
                action,
                accessState,
            });
        }
    }

    /**
     * Вычисляет effective runtime state из 4 источников:
     *   1. tenant.accessState — пауза перебивает всё;
     *   2. lifecycleStatus — INACTIVE → не работает;
     *   3. credentialStatus — INVALID/NEEDS_RECONNECT блокируют;
     *   4. syncHealthStatus — ERROR / DEGRADED — не блокирует, но виден в UI.
     *
     * Возвращает причину текстом для UI hint'а.
     */
    private _computeEffectiveRuntime(
        account: { lifecycleStatus: any; credentialStatus: any; syncHealthStatus: any },
        accessState: string | undefined,
    ): { state: EffectiveRuntimeState; reason: string | null } {
        if (accessState && PAUSED_TENANT_STATES.has(accessState)) {
            return { state: 'PAUSED_BY_TENANT', reason: `tenant_access_state=${accessState}` };
        }
        if (account.lifecycleStatus !== MarketplaceLifecycleStatus.ACTIVE) {
            return { state: 'INACTIVE', reason: 'account_deactivated' };
        }
        if (
            account.credentialStatus === MarketplaceCredentialStatus.INVALID ||
            account.credentialStatus === MarketplaceCredentialStatus.NEEDS_RECONNECT
        ) {
            return {
                state: 'CREDENTIAL_BLOCKED',
                reason: `credential_status=${account.credentialStatus}`,
            };
        }
        if (
            account.syncHealthStatus === MarketplaceSyncHealthStatus.ERROR ||
            account.syncHealthStatus === MarketplaceSyncHealthStatus.DEGRADED
        ) {
            return {
                state: 'SYNC_DEGRADED',
                reason: `sync_health=${account.syncHealthStatus}`,
            };
        }
        return { state: 'OPERATIONAL', reason: null };
    }

    // ----------------------------------------------------------------
    // PRIVATE
    // ----------------------------------------------------------------

    /**
     * Строит maskedPreview для UI: secret-поля → `***xxxx`, не-секретные
     * (например, `warehouseId`) — без маскировки. Никогда не возвращает
     * полные значения secret-полей.
     */
    private _buildMaskedPreview(
        marketplace: MarketplaceType,
        payload: Record<string, string>,
    ): Record<string, string | null> {
        if (!isSupportedMarketplace(marketplace)) return {};
        const secrets = SECRET_FIELDS[marketplace];
        const out: Record<string, string | null> = {};
        for (const [k, v] of Object.entries(payload)) {
            if (secrets.has(k)) {
                out[k] = this.cipher.maskValue(v);
            } else {
                out[k] = v;
            }
        }
        return out;
    }

    /**
     * Безопасный response shape: identity + статусы + masked credential preview.
     * Никаких полей encryptedPayload/encryptionKeyVersion внутри `credentials`
     * вне диагностических metadata.
     */
    private _toReadModel(account: any) {
        return {
            id: account.id,
            tenantId: account.tenantId,
            marketplace: account.marketplace,
            label: account.label,
            lifecycleStatus: account.lifecycleStatus,
            credentialStatus: account.credentialStatus,
            syncHealthStatus: account.syncHealthStatus,
            syncHealthReason: account.syncHealthReason,
            lastValidatedAt: account.lastValidatedAt,
            lastValidationErrorCode: account.lastValidationErrorCode,
            lastValidationErrorMessage: account.lastValidationErrorMessage,
            lastSyncAt: account.lastSyncAt,
            lastSyncResult: account.lastSyncResult,
            lastSyncErrorCode: account.lastSyncErrorCode,
            lastSyncErrorMessage: account.lastSyncErrorMessage,
            deactivatedAt: account.deactivatedAt,
            deactivatedBy: account.deactivatedBy,
            createdAt: account.createdAt,
            updatedAt: account.updatedAt,
            credential: account.credential
                ? {
                    maskedPreview: account.credential.maskedPreview,
                    encryptionKeyVersion: account.credential.encryptionKeyVersion,
                    schemaVersion: account.credential.schemaVersion,
                    rotatedAt: account.credential.rotatedAt,
                }
                : null,
        };
    }
}
