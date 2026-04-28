import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
    AccessState,
    MarketplaceType,
    WarehouseStatus,
    WarehouseSourceMarketplace,
} from '@prisma/client';
import axios, { AxiosError } from 'axios';
import { WarehouseSnapshot } from './warehouse-snapshot';
import { normalizeWbWarehouseList } from './normalizers/wb.normalizer';
import { normalizeOzonWarehouseList } from './normalizers/ozon.normalizer';

/** Безопасный безумный safe-window: 30 дней без возврата → ARCHIVED. */
const ARCHIVE_AFTER_DAYS = 30;

const PAUSED_ACCESS_STATES: ReadonlySet<AccessState> = new Set([
    AccessState.TRIAL_EXPIRED,
    AccessState.SUSPENDED,
    AccessState.CLOSED,
]);

/**
 * Каноничные имена events — для observability §19 и алертов.
 * Объявлены в `warehouse.events.ts` как single source of truth (TASK_7).
 * Здесь оставляем re-export под прежним именем для обратной совместимости
 * с существующими тестами/импортами.
 */
import { WarehouseEvents } from './warehouse.events';
export const WarehouseSyncEvents = WarehouseEvents;

export type WarehouseSyncResult = {
    accountId: string;
    sourceMarketplace: WarehouseSourceMarketplace;
    fetched: number;
    created: number;
    updated: number;
    deactivated: number;
    archived: number;
    reactivated: number;
    error?: string;
    paused?: boolean;
};

/** Свет ipython-friendly fetcher для тестов: можно подменить axios без HTTP. */
type WarehouseFetcher = (
    account: { apiKey: string | null; clientId: string | null },
) => Promise<{ raw: any[] | null; error?: string }>;

@Injectable()
export class WarehouseSyncService {
    private readonly logger = new Logger(WarehouseSyncService.name);

    private readonly fetchers: Record<MarketplaceType, WarehouseFetcher> = {
        WB: this._fetchWb.bind(this),
        OZON: this._fetchOzon.bind(this),
    };

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Sync для всех аккаунтов tenant'а. Skip целиком при tenant pause —
     * по §16 system-analytics, чтобы не дёргать marketplace API в
     * TRIAL_EXPIRED/SUSPENDED/CLOSED.
     */
    async syncAllForTenant(tenantId: string): Promise<{
        tenantId: string;
        paused: boolean;
        results: WarehouseSyncResult[];
    }> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { accessState: true },
        });
        if (!tenant) throw new NotFoundException({ code: 'TENANT_NOT_FOUND' });

        if (PAUSED_ACCESS_STATES.has(tenant.accessState)) {
            this.logger.warn(JSON.stringify({
                event: WarehouseSyncEvents.SYNC_PAUSED_BY_TENANT,
                tenantId,
                accessState: tenant.accessState,
            }));
            return { tenantId, paused: true, results: [] };
        }

        const accounts = await this.prisma.marketplaceAccount.findMany({
            where: { tenantId },
        });

        const results: WarehouseSyncResult[] = [];
        for (const account of accounts) {
            try {
                const r = await this.syncForAccount(account.id);
                results.push(r);
            } catch (err: any) {
                results.push({
                    accountId: account.id,
                    sourceMarketplace: this._marketplaceToSource(account.marketplace),
                    fetched: 0, created: 0, updated: 0, deactivated: 0, archived: 0, reactivated: 0,
                    error: err?.message ?? 'unknown_error',
                });
            }
        }

        return { tenantId, paused: false, results };
    }

    /**
     * Sync для одного marketplace account. Lifecycle транзишны применяются
     * ТОЛЬКО при успешном API-ответе — failed call не зануляет склады.
     */
    async syncForAccount(accountId: string): Promise<WarehouseSyncResult> {
        const account = await this.prisma.marketplaceAccount.findUnique({
            where: { id: accountId },
        });
        if (!account) throw new NotFoundException({ code: 'MARKETPLACE_ACCOUNT_NOT_FOUND' });

        // Service-level tenant pause: дублируем проверку для прямых вызовов из
        // jobs/orchestration кода, минующих syncAllForTenant и HTTP-слой.
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: account.tenantId },
            select: { accessState: true },
        });
        if (!tenant) throw new NotFoundException({ code: 'TENANT_NOT_FOUND' });
        if (PAUSED_ACCESS_STATES.has(tenant.accessState)) {
            this.logger.warn(JSON.stringify({
                event: WarehouseSyncEvents.SYNC_PAUSED_BY_TENANT,
                accountId,
                tenantId: account.tenantId,
                accessState: tenant.accessState,
            }));
            return {
                accountId,
                sourceMarketplace: this._marketplaceToSource(account.marketplace),
                fetched: 0, created: 0, updated: 0, deactivated: 0, archived: 0, reactivated: 0,
                paused: true,
            };
        }

        const sourceMarketplace = this._marketplaceToSource(account.marketplace);
        const baseResult: WarehouseSyncResult = {
            accountId,
            sourceMarketplace,
            fetched: 0, created: 0, updated: 0, deactivated: 0, archived: 0, reactivated: 0,
        };

        this.logger.log(JSON.stringify({
            event: WarehouseSyncEvents.SYNC_STARTED,
            accountId,
            tenantId: account.tenantId,
            sourceMarketplace,
        }));

        const fetcher = this.fetchers[account.marketplace];
        const fetched = await fetcher({ apiKey: account.apiKey, clientId: account.clientId });

        if (fetched.error) {
            // Failed API: НЕ применяем lifecycle, чтобы один сбой не зануллил справочник.
            this.logger.warn(JSON.stringify({
                event: WarehouseSyncEvents.SYNC_FAILED,
                accountId,
                tenantId: account.tenantId,
                sourceMarketplace,
                error: fetched.error,
            }));
            return { ...baseResult, error: fetched.error };
        }

        // Нормализация под источник.
        const snapshots: WarehouseSnapshot[] =
            account.marketplace === MarketplaceType.WB
                ? normalizeWbWarehouseList(fetched.raw)
                : normalizeOzonWarehouseList(fetched.raw);

        baseResult.fetched = snapshots.length;

        // Upsert каждого snapshot.
        const seenExternalIds = new Set<string>();
        for (const snap of snapshots) {
            seenExternalIds.add(snap.externalWarehouseId);
            const r = await this._upsertSnapshot(account.tenantId, accountId, snap);
            if (r === 'created') baseResult.created += 1;
            if (r === 'updated') baseResult.updated += 1;
            if (r === 'reactivated') baseResult.reactivated += 1;
        }

        // Lifecycle: помечаем disappeared склады.
        const disappeared = await this._markDisappeared(account.tenantId, accountId, seenExternalIds);
        baseResult.deactivated = disappeared.deactivated;

        // Lifecycle: переводим долго-INACTIVE в ARCHIVED.
        const archivedCount = await this._archiveStale(account.tenantId, accountId);
        baseResult.archived = archivedCount;

        await this.prisma.marketplaceAccount.update({
            where: { id: accountId },
            data: { lastSyncAt: new Date(), lastSyncStatus: 'ok', lastSyncError: null },
        });

        this.logger.log(JSON.stringify({
            event: WarehouseSyncEvents.SYNC_COMPLETED,
            tenantId: account.tenantId,
            ...baseResult,
        }));

        return baseResult;
    }

    // ------------------------------------------------------------------
    // PRIVATE
    // ------------------------------------------------------------------

    private async _upsertSnapshot(
        tenantId: string,
        accountId: string,
        snap: WarehouseSnapshot,
    ): Promise<'created' | 'updated' | 'reactivated'> {
        const existing = await this.prisma.warehouse.findUnique({
            where: {
                tenantId_marketplaceAccountId_externalWarehouseId: {
                    tenantId,
                    marketplaceAccountId: accountId,
                    externalWarehouseId: snap.externalWarehouseId,
                },
            },
        });

        const now = new Date();

        if (!existing) {
            await this.prisma.warehouse.create({
                data: {
                    tenantId,
                    marketplaceAccountId: accountId,
                    externalWarehouseId: snap.externalWarehouseId,
                    name: snap.name,
                    city: snap.city ?? null,
                    warehouseType: snap.warehouseType,
                    sourceMarketplace: snap.sourceMarketplace,
                    status: WarehouseStatus.ACTIVE,
                    firstSeenAt: now,
                    lastSyncedAt: now,
                },
            });
            this.logger.log(JSON.stringify({
                event: WarehouseSyncEvents.UPSERT_CREATED,
                tenantId,
                accountId,
                externalWarehouseId: snap.externalWarehouseId,
            }));
            return 'created';
        }

        // Watch type/source change — это тревожное событие (§19 classification_changes).
        const classificationChanged =
            existing.warehouseType !== snap.warehouseType ||
            existing.sourceMarketplace !== snap.sourceMarketplace;
        if (classificationChanged) {
            this.logger.warn(JSON.stringify({
                event: WarehouseSyncEvents.CLASSIFICATION_CHANGED,
                tenantId,
                accountId,
                externalWarehouseId: snap.externalWarehouseId,
                from: { type: existing.warehouseType, source: existing.sourceMarketplace },
                to: { type: snap.warehouseType, source: snap.sourceMarketplace },
            }));
        }

        const wasInactive = existing.status !== WarehouseStatus.ACTIVE;

        // ВАЖНО: aliasName и labels — tenant-local, sync их НЕ перезаписывает.
        await this.prisma.warehouse.update({
            where: { id: existing.id },
            data: {
                name: snap.name,
                city: snap.city ?? null,
                warehouseType: snap.warehouseType,
                sourceMarketplace: snap.sourceMarketplace,
                lastSyncedAt: now,
                // Возврат из INACTIVE/ARCHIVED — обнуляем lifecycle-поля.
                ...(wasInactive
                    ? {
                        status: WarehouseStatus.ACTIVE,
                        inactiveSince: null,
                        deactivationReason: null,
                    }
                    : {}),
            },
        });

        if (wasInactive) {
            this.logger.log(JSON.stringify({
                event: WarehouseSyncEvents.LIFECYCLE_REACTIVATED,
                tenantId,
                accountId,
                externalWarehouseId: snap.externalWarehouseId,
                fromStatus: existing.status,
            }));
            return 'reactivated';
        }

        this.logger.log(JSON.stringify({
            event: WarehouseSyncEvents.UPSERT_UPDATED,
            tenantId,
            accountId,
            externalWarehouseId: snap.externalWarehouseId,
        }));
        return 'updated';
    }

    /**
     * Disappeared warehouses: те, что были `ACTIVE` и не вернулись в этом
     * sync. Переводим в `INACTIVE`, фиксируем `inactiveSince` и
     * `deactivationReason`. Не удаляем — историческая ссылка остаётся.
     */
    private async _markDisappeared(
        tenantId: string,
        accountId: string,
        seenExternalIds: Set<string>,
    ): Promise<{ deactivated: number }> {
        const candidates = await this.prisma.warehouse.findMany({
            where: {
                tenantId,
                marketplaceAccountId: accountId,
                status: WarehouseStatus.ACTIVE,
            },
            select: { id: true, externalWarehouseId: true },
        });

        const toDeactivate = candidates.filter((c) => !seenExternalIds.has(c.externalWarehouseId));
        if (toDeactivate.length === 0) return { deactivated: 0 };

        const now = new Date();
        await this.prisma.warehouse.updateMany({
            where: { id: { in: toDeactivate.map((c) => c.id) } },
            data: {
                status: WarehouseStatus.INACTIVE,
                inactiveSince: now,
                deactivationReason: 'NOT_RETURNED_BY_API',
            },
        });

        for (const c of toDeactivate) {
            this.logger.warn(JSON.stringify({
                event: WarehouseSyncEvents.LIFECYCLE_INACTIVE,
                tenantId,
                accountId,
                externalWarehouseId: c.externalWarehouseId,
            }));
        }

        return { deactivated: toDeactivate.length };
    }

    /**
     * Long-INACTIVE → ARCHIVED. Safe-window задаётся `ARCHIVE_AFTER_DAYS`.
     */
    private async _archiveStale(tenantId: string, accountId: string): Promise<number> {
        const threshold = new Date(Date.now() - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000);
        const candidates = await this.prisma.warehouse.findMany({
            where: {
                tenantId,
                marketplaceAccountId: accountId,
                status: WarehouseStatus.INACTIVE,
                inactiveSince: { lte: threshold, not: null },
            },
            select: { id: true, externalWarehouseId: true },
        });
        if (candidates.length === 0) return 0;

        await this.prisma.warehouse.updateMany({
            where: { id: { in: candidates.map((c) => c.id) } },
            data: { status: WarehouseStatus.ARCHIVED },
        });

        for (const c of candidates) {
            this.logger.warn(JSON.stringify({
                event: WarehouseSyncEvents.LIFECYCLE_ARCHIVED,
                tenantId,
                accountId,
                externalWarehouseId: c.externalWarehouseId,
            }));
        }
        return candidates.length;
    }

    private _marketplaceToSource(m: MarketplaceType): WarehouseSourceMarketplace {
        return m === MarketplaceType.OZON
            ? WarehouseSourceMarketplace.OZON
            : WarehouseSourceMarketplace.WB;
    }

    // ──── Marketplace fetchers ────────────────────────────────────────

    private async _fetchWb(account: { apiKey: string | null }): Promise<{ raw: any[] | null; error?: string }> {
        if (!account.apiKey) return { raw: null, error: 'WB_API_KEY_MISSING' };
        try {
            const res = await axios.get('https://marketplace-api.wildberries.ru/api/v3/warehouses', {
                headers: { Authorization: account.apiKey },
                timeout: 10_000,
            });
            const data = res.data;
            // WB иногда возвращает массив напрямую, иногда `{ warehouses: [] }`.
            const list = Array.isArray(data) ? data : (Array.isArray(data?.warehouses) ? data.warehouses : []);
            return { raw: list };
        } catch (err) {
            const e = err as AxiosError;
            return { raw: null, error: e.message };
        }
    }

    private async _fetchOzon(account: { apiKey: string | null; clientId: string | null }): Promise<{ raw: any[] | null; error?: string }> {
        if (!account.apiKey || !account.clientId) {
            return { raw: null, error: 'OZON_CREDENTIALS_MISSING' };
        }
        try {
            const res = await axios.post(
                'https://api-seller.ozon.ru/v1/warehouse/list',
                {},
                {
                    headers: { 'Client-Id': account.clientId, 'Api-Key': account.apiKey },
                    timeout: 10_000,
                },
            );
            const result = res.data?.result;
            const list = Array.isArray(result) ? result : [];
            return { raw: list };
        } catch (err) {
            const e = err as AxiosError;
            return { raw: null, error: e.message };
        }
    }
}
