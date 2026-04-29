import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

jest.mock('@prisma/client', () => {
    class PrismaClient {}
    return {
        PrismaClient,
        StockMovementType: {
            MANUAL_ADD: 'MANUAL_ADD', MANUAL_REMOVE: 'MANUAL_REMOVE',
            ORDER_RESERVED: 'ORDER_RESERVED', ORDER_RELEASED: 'ORDER_RELEASED',
            ORDER_DEDUCTED: 'ORDER_DEDUCTED', INVENTORY_ADJUSTMENT: 'INVENTORY_ADJUSTMENT',
            RETURN_LOGGED: 'RETURN_LOGGED', CONFLICT_DETECTED: 'CONFLICT_DETECTED',
        },
        StockMovementSource: { USER: 'USER', SYSTEM: 'SYSTEM', MARKETPLACE: 'MARKETPLACE' },
        InventoryFulfillmentMode: { FBS: 'FBS', FBO: 'FBO' },
        ActionType: { STOCK_ADJUSTED: 'STOCK_ADJUSTED' },
        AccessState: {
            EARLY_ACCESS: 'EARLY_ACCESS',
            TRIAL_ACTIVE: 'TRIAL_ACTIVE',
            TRIAL_EXPIRED: 'TRIAL_EXPIRED',
            ACTIVE_PAID: 'ACTIVE_PAID',
            GRACE_PERIOD: 'GRACE_PERIOD',
            SUSPENDED: 'SUSPENDED',
            CLOSED: 'CLOSED',
        },
        InventoryEffectType: {
            ORDER_RESERVE: 'ORDER_RESERVE', ORDER_RELEASE: 'ORDER_RELEASE',
            ORDER_DEDUCT: 'ORDER_DEDUCT', SYNC_RECONCILE: 'SYNC_RECONCILE',
        },
        InventoryEffectStatus: {
            PROCESSING: 'PROCESSING', APPLIED: 'APPLIED',
            IGNORED: 'IGNORED', FAILED: 'FAILED',
        },
        MarketplaceType: { WB: 'WB', OZON: 'OZON' },
        Role: { OWNER: 'OWNER', ADMIN: 'ADMIN', MANAGER: 'MANAGER' },
        Prisma: { sql: function () { return { _sql: true }; } },
    };
});

// ─── Minimal prisma mock ─────────────────────────────────────────────────────

function makePrismaMock() {
    return {
        product: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn() },
        stockBalance: { findMany: jest.fn(), upsert: jest.fn(), update: jest.fn() },
        stockMovement: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn() },
        inventorySettings: {
            findUnique: jest.fn(),
            upsert: jest.fn(),
        },
        tenant: {
            findUnique: jest.fn().mockResolvedValue({ accessState: 'ACTIVE_PAID' }),
        },
        membership: {
            findFirst: jest.fn(),
        },
        inventoryEffectLock: { upsert: jest.fn().mockResolvedValue({}) },
        $transaction: jest.fn(),
        $queryRaw: jest.fn(),
    };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TENANT = 'tenant-1';
const ACTOR_ID = 'user-1';

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('InventoryService — Channel Visibility Settings', () => {
    let service: InventoryService;
    let prisma: ReturnType<typeof makePrismaMock>;
    let logSpy: jest.SpyInstance;

    beforeEach(async () => {
        prisma = makePrismaMock();
        prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));

        const audit = { logAction: jest.fn().mockResolvedValue({}) };

        const module = await Test.createTestingModule({
            providers: [
                InventoryService,
                { provide: PrismaService, useValue: prisma },
                { provide: AuditService, useValue: audit },
            ],
        })
            .setLogger(new Logger())
            .compile();

        service = module.get(InventoryService);
        logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    });

    afterEach(() => jest.clearAllMocks());

    // ─── getChannelVisibility ────────────────────────────────────────────────

    describe('getChannelVisibility', () => {
        it('возвращает все маркетплейсы по умолчанию при отсутствии настроек', async () => {
            prisma.inventorySettings.findUnique.mockResolvedValue(null);

            const result = await service.getChannelVisibility(TENANT);

            expect(result.visibleMarketplaces).toEqual(expect.arrayContaining(['WB', 'OZON']));
        });

        it('возвращает все маркетплейсы если channelVisibilitySettings пустой', async () => {
            prisma.inventorySettings.findUnique.mockResolvedValue({
                tenantId: TENANT,
                channelVisibilitySettings: null,
            });

            const result = await service.getChannelVisibility(TENANT);

            expect(result.visibleMarketplaces).toEqual(expect.arrayContaining(['WB', 'OZON']));
        });

        it('возвращает только сохранённые маркетплейсы если настройка задана', async () => {
            prisma.inventorySettings.findUnique.mockResolvedValue({
                tenantId: TENANT,
                channelVisibilitySettings: { visibleMarketplaces: ['WB'] },
            });

            const result = await service.getChannelVisibility(TENANT);

            expect(result.visibleMarketplaces).toEqual(['WB']);
        });
    });

    // ─── updateChannelVisibility ─────────────────────────────────────────────

    describe('updateChannelVisibility', () => {
        beforeEach(() => {
            prisma.membership.findFirst.mockResolvedValue({ role: 'OWNER' });
            prisma.inventorySettings.upsert.mockResolvedValue({
                tenantId: TENANT,
                channelVisibilitySettings: { visibleMarketplaces: ['WB'] },
            });
        });

        it('сохраняет выбранные каналы и возвращает их', async () => {
            const result = await service.updateChannelVisibility(TENANT, ACTOR_ID, ['WB'] as any);

            expect(prisma.inventorySettings.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    update: expect.objectContaining({ channelVisibilitySettings: { visibleMarketplaces: ['WB'] } }),
                }),
            );
            expect(result.visibleMarketplaces).toEqual(['WB']);
        });

        it('выбрасывает BadRequestException если массив пустой', async () => {
            await expect(
                service.updateChannelVisibility(TENANT, ACTOR_ID, [] as any),
            ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'VISIBLE_MARKETPLACES_CANNOT_BE_EMPTY' }) });

            expect(prisma.inventorySettings.upsert).not.toHaveBeenCalled();
        });

        it('выбрасывает ForbiddenException если роль MANAGER (не OWNER/ADMIN)', async () => {
            prisma.membership.findFirst.mockResolvedValue({ role: 'MANAGER' });

            await expect(
                service.updateChannelVisibility(TENANT, ACTOR_ID, ['WB'] as any),
            ).rejects.toThrow(ForbiddenException);

            expect(prisma.inventorySettings.upsert).not.toHaveBeenCalled();
        });

        it('выбрасывает ForbiddenException если пользователь не член тенанта', async () => {
            prisma.membership.findFirst.mockResolvedValue(null);

            await expect(
                service.updateChannelVisibility(TENANT, ACTOR_ID, ['WB'] as any),
            ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'TENANT_ACCESS_DENIED' }) });
        });

        it('логирует channel_visibility_updated после успешного сохранения', async () => {
            await service.updateChannelVisibility(TENANT, ACTOR_ID, ['WB', 'OZON'] as any);

            expect(logSpy).toHaveBeenCalledWith(
                expect.stringContaining('"event":"channel_visibility_updated"'),
            );
        });
    });
});
