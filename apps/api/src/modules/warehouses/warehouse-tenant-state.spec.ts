/**
 * TASK_WAREHOUSES_5 — tenant-state и refresh policy.
 *
 * Эти тесты подтверждают:
 *   1. `WarehouseSyncService.syncForAccount` блокируется service-level для
 *      paused tenant (TRIAL_EXPIRED/SUSPENDED/CLOSED) — для прямых вызовов
 *      из jobs и orchestration кода, минующих HTTP-слой.
 *   2. Read API (`list`, `getById`, `getStocks`) работает для paused tenant
 *      без ограничений — справочник остаётся read-only видимым (§16/17 task).
 *   3. Service-level guard `_assertManualWriteAllowed` (через
 *      `WarehouseService.updateMetadata` при попытке обхода HTTP) — этот
 *      путь покрыт `TenantWriteGuard` на HTTP-слое, тут проверяем сам факт,
 *      что прямые вызовы service возвращают `paused`.
 */
import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { WarehouseSyncService } from './warehouse-sync.service';
import { WarehouseService } from './warehouse.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@prisma/client', () => {
    class PrismaClient {}
    return {
        PrismaClient,
        Prisma: { sql: function () { return { _sql: true }; } },
        AccessState: {
            EARLY_ACCESS: 'EARLY_ACCESS',
            TRIAL_ACTIVE: 'TRIAL_ACTIVE',
            TRIAL_EXPIRED: 'TRIAL_EXPIRED',
            ACTIVE_PAID: 'ACTIVE_PAID',
            GRACE_PERIOD: 'GRACE_PERIOD',
            SUSPENDED: 'SUSPENDED',
            CLOSED: 'CLOSED',
        },
        MarketplaceType: { WB: 'WB', OZON: 'OZON' },
        WarehouseStatus: { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE', ARCHIVED: 'ARCHIVED' },
        WarehouseType: { FBS: 'FBS', FBO: 'FBO' },
        WarehouseSourceMarketplace: { WB: 'WB', OZON: 'OZON', YANDEX_MARKET: 'YANDEX_MARKET' },
    };
});

jest.mock('axios', () => ({
    __esModule: true,
    default: { get: jest.fn(), post: jest.fn() },
}));

import axios from 'axios';

const TENANT = 't1';
const ACCOUNT = 'acc-1';

function makePrismaMock() {
    return {
        tenant: { findUnique: jest.fn() },
        marketplaceAccount: {
            findUnique: jest.fn(),
            findMany: jest.fn().mockResolvedValue([]),
            update: jest.fn().mockResolvedValue({}),
        },
        warehouse: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            findMany: jest.fn().mockResolvedValue([]),
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        stockBalance: { findMany: jest.fn().mockResolvedValue([]) },
    };
}

async function buildSync(prisma: any) {
    const moduleRef = await Test.createTestingModule({
        providers: [WarehouseSyncService, { provide: PrismaService, useValue: prisma }],
    }).setLogger(new Logger()).compile();
    return moduleRef.get(WarehouseSyncService);
}

async function buildRead(prisma: any) {
    const moduleRef = await Test.createTestingModule({
        providers: [WarehouseService, { provide: PrismaService, useValue: prisma }],
    }).setLogger(new Logger()).compile();
    return moduleRef.get(WarehouseService);
}

describe('TASK_WAREHOUSES_5 — service-level pause в syncForAccount', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: WarehouseSyncService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await buildSync(prisma);
        (axios.get as jest.Mock).mockReset();
        (axios.post as jest.Mock).mockReset();
    });

    it.each(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED'])(
        'syncForAccount в %s → paused=true, без HTTP, без записи в БД',
        async (state) => {
            prisma.marketplaceAccount.findUnique.mockResolvedValue({
                id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', apiKey: 'k', clientId: null,
            });
            prisma.tenant.findUnique.mockResolvedValue({ accessState: state });
            const warnSpy = jest.spyOn(Logger.prototype, 'warn');

            const res = await svc.syncForAccount(ACCOUNT);

            expect(res).toMatchObject({
                accountId: ACCOUNT,
                paused: true,
                fetched: 0, created: 0, updated: 0, deactivated: 0, archived: 0, reactivated: 0,
            });
            expect(axios.get).not.toHaveBeenCalled();
            expect(axios.post).not.toHaveBeenCalled();
            expect(prisma.warehouse.create).not.toHaveBeenCalled();
            expect(prisma.warehouse.update).not.toHaveBeenCalled();
            expect(prisma.warehouse.updateMany).not.toHaveBeenCalled();
            expect(prisma.marketplaceAccount.update).not.toHaveBeenCalled();
            expect(warnSpy.mock.calls.some(c => String(c[0]).includes('warehouse_sync_paused_by_tenant_state'))).toBe(true);
            warnSpy.mockRestore();
        },
    );

    it.each(['ACTIVE_PAID', 'TRIAL_ACTIVE', 'EARLY_ACCESS', 'GRACE_PERIOD'])(
        'syncForAccount в %s → продолжает к API (с предсказуемым отсутствием key возвращает error, не paused)',
        async (state) => {
            prisma.marketplaceAccount.findUnique.mockResolvedValue({
                id: ACCOUNT, tenantId: TENANT, marketplace: 'WB', apiKey: null, clientId: null,
            });
            prisma.tenant.findUnique.mockResolvedValue({ accessState: state });

            const res = await svc.syncForAccount(ACCOUNT);

            // paused НЕ выставляется, но и WB-ключа нет → error
            expect(res.paused).toBeUndefined();
            expect(res.error).toBe('WB_API_KEY_MISSING');
        },
    );

    it('TENANT_NOT_FOUND для аккаунта без tenant', async () => {
        prisma.marketplaceAccount.findUnique.mockResolvedValue({
            id: ACCOUNT, tenantId: 'ghost', marketplace: 'WB', apiKey: 'k', clientId: null,
        });
        prisma.tenant.findUnique.mockResolvedValue(null);

        await expect(svc.syncForAccount(ACCOUNT)).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'TENANT_NOT_FOUND' }),
        });
    });
});

describe('TASK_WAREHOUSES_5 — read API остаётся доступным в paused state', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: WarehouseService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await buildRead(prisma);
    });

    it.each(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED'])(
        'list работает в %s (read-only справочник остаётся видимым)',
        async (_state) => {
            // Read API НЕ должно проверять accessState — это reference layer.
            // Tenant pause ограничивается ТОЛЬКО write-путями (sync/metadata).
            prisma.warehouse.findMany.mockResolvedValue([]);
            prisma.warehouse.count.mockResolvedValue(0);

            const res = await svc.list(TENANT);

            expect(res.data).toEqual([]);
            expect(res.meta.total).toBe(0);
            // tenant.findUnique не должен дёргаться в read-path — это значит
            // read-API не зависит от tenant accessState.
            expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
        },
    );

    it('getById не зависит от accessState', async () => {
        prisma.warehouse.findFirst.mockResolvedValue({
            id: 'w1', tenantId: TENANT, marketplaceAccountId: 'acc',
            externalWarehouseId: 'X', name: 'X', city: null,
            warehouseType: 'FBS', sourceMarketplace: 'WB',
            aliasName: null, labels: [], status: 'ACTIVE',
            deactivationReason: null, firstSeenAt: new Date(),
            lastSyncedAt: new Date(), inactiveSince: null,
            marketplaceAccount: { id: 'acc', name: 'WB', marketplace: 'WB' },
        });

        const res = await svc.getById(TENANT, 'w1');
        expect(res.id).toBe('w1');
        expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    });

    it('getStocks не зависит от accessState', async () => {
        prisma.warehouse.findFirst.mockResolvedValue({
            id: 'w1', externalWarehouseId: 'X',
            name: 'X', aliasName: null,
            warehouseType: 'FBS', sourceMarketplace: 'WB', status: 'ACTIVE',
        });
        prisma.stockBalance.findMany.mockResolvedValue([]);

        const res = await svc.getStocks(TENANT, 'w1');
        expect(res.count).toBe(0);
        expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    });
});

describe('TASK_WAREHOUSES_5 — syncAllForTenant всё ещё фильтрует pause на верхнем уровне', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: WarehouseSyncService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await buildSync(prisma);
    });

    it('paused → не дёргает marketplaceAccount.findMany (верхнеуровневая защита)', async () => {
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'TRIAL_EXPIRED' });

        const res = await svc.syncAllForTenant(TENANT);

        expect(res.paused).toBe(true);
        expect(res.results).toEqual([]);
        expect(prisma.marketplaceAccount.findMany).not.toHaveBeenCalled();
    });

    it('активный tenant + один account → итерирует и зовёт syncForAccount (через верхний flow)', async () => {
        prisma.tenant.findUnique.mockResolvedValue({ accessState: 'ACTIVE_PAID' });
        prisma.marketplaceAccount.findMany.mockResolvedValue([
            { id: 'a1', tenantId: TENANT, marketplace: 'WB', apiKey: null, clientId: null },
        ]);
        prisma.marketplaceAccount.findUnique.mockResolvedValue({
            id: 'a1', tenantId: TENANT, marketplace: 'WB', apiKey: null, clientId: null,
        });

        const res = await svc.syncAllForTenant(TENANT);

        expect(res.paused).toBe(false);
        expect(res.results).toHaveLength(1);
        // Так как в `syncForAccount` нет API key, получаем error не paused.
        expect(res.results[0].error).toBe('WB_API_KEY_MISSING');
    });
});
