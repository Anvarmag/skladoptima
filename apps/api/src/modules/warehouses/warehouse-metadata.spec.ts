import { Test } from '@nestjs/testing';
import { Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@prisma/client', () => {
    class PrismaClient {}
    return {
        PrismaClient,
        Prisma: { sql: function () { return { _sql: true }; } },
        WarehouseStatus: { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE', ARCHIVED: 'ARCHIVED' },
        WarehouseType: { FBS: 'FBS', FBO: 'FBO' },
        WarehouseSourceMarketplace: { WB: 'WB', OZON: 'OZON', YANDEX_MARKET: 'YANDEX_MARKET' },
    };
});

const TENANT = 't1';
const ACTOR = 'u1';
const WH_ID = 'wh-1';

function makeWarehouse(overrides: any = {}) {
    return {
        id: WH_ID,
        tenantId: TENANT,
        marketplaceAccountId: 'acc',
        externalWarehouseId: '1001',
        name: 'WB Коледино',
        city: 'Москва',
        warehouseType: 'FBS',
        sourceMarketplace: 'WB',
        aliasName: null,
        labels: [],
        status: 'ACTIVE',
        deactivationReason: null,
        firstSeenAt: new Date(),
        lastSyncedAt: new Date(),
        inactiveSince: null,
        marketplaceAccount: { id: 'acc', name: 'WB Main', marketplace: 'WB' },
        ...overrides,
    };
}

function makePrismaMock() {
    return {
        warehouse: {
            findFirst: jest.fn(),
            update: jest.fn(),
        },
    };
}

async function build(prisma: any) {
    const moduleRef = await Test.createTestingModule({
        providers: [
            WarehouseService,
            { provide: PrismaService, useValue: prisma },
        ],
    }).setLogger(new Logger()).compile();
    return moduleRef.get(WarehouseService);
}

describe('WarehouseService.updateMetadata — happy paths', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: WarehouseService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
    });

    it('обновляет aliasName, пишет metadataUpdatedAt/By', async () => {
        prisma.warehouse.findFirst.mockResolvedValue(makeWarehouse());
        prisma.warehouse.update.mockResolvedValue(makeWarehouse({ aliasName: 'main' }));

        const res = await svc.updateMetadata(TENANT, WH_ID, ACTOR, { aliasName: 'main' });

        expect(res.aliasName).toBe('main');
        expect(prisma.warehouse.update).toHaveBeenCalledWith({
            where: { id: WH_ID },
            data: expect.objectContaining({
                aliasName: 'main',
                metadataUpdatedAt: expect.any(Date),
                metadataUpdatedBy: ACTOR,
            }),
            include: expect.any(Object),
        });
    });

    it('обновляет labels с дедупликацией и trim', async () => {
        prisma.warehouse.findFirst.mockResolvedValue(makeWarehouse());
        prisma.warehouse.update.mockResolvedValue(makeWarehouse({ labels: ['hub', 'main'] }));

        await svc.updateMetadata(TENANT, WH_ID, ACTOR, {
            labels: [' hub ', 'main', 'hub', '  ', 'main'],
        });

        expect(prisma.warehouse.update).toHaveBeenCalledWith({
            where: { id: WH_ID },
            data: expect.objectContaining({ labels: ['hub', 'main'] }),
            include: expect.any(Object),
        });
    });

    it('пустая строка aliasName сбрасывается в null', async () => {
        prisma.warehouse.findFirst.mockResolvedValue(makeWarehouse({ aliasName: 'old' }));
        prisma.warehouse.update.mockResolvedValue(makeWarehouse({ aliasName: null }));

        await svc.updateMetadata(TENANT, WH_ID, ACTOR, { aliasName: '   ' });

        expect(prisma.warehouse.update).toHaveBeenCalledWith({
            where: { id: WH_ID },
            data: expect.objectContaining({ aliasName: null }),
            include: expect.any(Object),
        });
    });

    it('null aliasName явно сбрасывает alias', async () => {
        prisma.warehouse.findFirst.mockResolvedValue(makeWarehouse({ aliasName: 'old' }));
        prisma.warehouse.update.mockResolvedValue(makeWarehouse({ aliasName: null }));

        await svc.updateMetadata(TENANT, WH_ID, ACTOR, { aliasName: null });

        expect(prisma.warehouse.update).toHaveBeenCalledWith({
            where: { id: WH_ID },
            data: expect.objectContaining({ aliasName: null }),
            include: expect.any(Object),
        });
    });

    it('actorUserId=null (system call) пишется в metadataUpdatedBy', async () => {
        prisma.warehouse.findFirst.mockResolvedValue(makeWarehouse());
        prisma.warehouse.update.mockResolvedValue(makeWarehouse());

        await svc.updateMetadata(TENANT, WH_ID, null, { aliasName: 'x' });

        expect(prisma.warehouse.update).toHaveBeenCalledWith({
            where: { id: WH_ID },
            data: expect.objectContaining({ metadataUpdatedBy: null }),
            include: expect.any(Object),
        });
    });

    it('эмитит warehouse_metadata_updated event', async () => {
        prisma.warehouse.findFirst.mockResolvedValue(makeWarehouse());
        prisma.warehouse.update.mockResolvedValue(makeWarehouse({ aliasName: 'new' }));
        const logSpy = jest.spyOn(Logger.prototype, 'log');

        await svc.updateMetadata(TENANT, WH_ID, ACTOR, { aliasName: 'new' });

        expect(logSpy.mock.calls.some(c => String(c[0]).includes('warehouse_metadata_updated'))).toBe(true);
        logSpy.mockRestore();
    });
});

describe('WarehouseService.updateMetadata — защита идентичности и валидация', () => {
    let prisma: ReturnType<typeof makePrismaMock>;
    let svc: WarehouseService;

    beforeEach(async () => {
        prisma = makePrismaMock();
        svc = await build(prisma);
    });

    it.each([
        'externalWarehouseId',
        'name',
        'city',
        'warehouseType',
        'sourceMarketplace',
        'status',
        'deactivationReason',
    ])('запрещает изменять %s через metadata patch', async (field) => {
        const dto: any = { aliasName: 'x', [field]: 'attempt' };

        await expect(
            svc.updateMetadata(TENANT, WH_ID, ACTOR, dto),
        ).rejects.toMatchObject({
            response: expect.objectContaining({
                code: 'WAREHOUSE_METADATA_FIELD_NOT_ALLOWED',
                forbiddenFields: expect.arrayContaining([field]),
            }),
        });

        expect(prisma.warehouse.findFirst).not.toHaveBeenCalled();
        expect(prisma.warehouse.update).not.toHaveBeenCalled();
    });

    it('пустой DTO → WAREHOUSE_METADATA_EMPTY', async () => {
        await expect(svc.updateMetadata(TENANT, WH_ID, ACTOR, {})).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'WAREHOUSE_METADATA_EMPTY' }),
        });
    });

    it('aliasName длиннее 255 → WAREHOUSE_METADATA_TOO_LONG (field=aliasName)', async () => {
        await expect(
            svc.updateMetadata(TENANT, WH_ID, ACTOR, { aliasName: 'x'.repeat(256) }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({
                code: 'WAREHOUSE_METADATA_TOO_LONG',
                field: 'aliasName',
                max: 255,
            }),
        });
    });

    it('label длиннее 64 → WAREHOUSE_METADATA_TOO_LONG (field=labels[])', async () => {
        await expect(
            svc.updateMetadata(TENANT, WH_ID, ACTOR, { labels: ['x'.repeat(65)] }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({
                code: 'WAREHOUSE_METADATA_TOO_LONG',
                field: 'labels[]',
                max: 64,
            }),
        });
    });

    it('label с недопустимым форматом (пробелы/спецсимволы) → WAREHOUSE_LABEL_FORMAT_INVALID', async () => {
        await expect(
            svc.updateMetadata(TENANT, WH_ID, ACTOR, { labels: ['hub main'] }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({
                code: 'WAREHOUSE_LABEL_FORMAT_INVALID',
            }),
        });

        await expect(
            svc.updateMetadata(TENANT, WH_ID, ACTOR, { labels: ['🚀'] }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'WAREHOUSE_LABEL_FORMAT_INVALID' }),
        });
    });

    it('больше 20 labels → WAREHOUSE_LABELS_TOO_MANY', async () => {
        const many = Array.from({ length: 21 }, (_, i) => `tag${i}`);
        await expect(
            svc.updateMetadata(TENANT, WH_ID, ACTOR, { labels: many }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'WAREHOUSE_LABELS_TOO_MANY', max: 20 }),
        });
    });

    it('labels не массив → WAREHOUSE_LABELS_INVALID', async () => {
        await expect(
            svc.updateMetadata(TENANT, WH_ID, ACTOR, { labels: 'not-an-array' as any }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'WAREHOUSE_LABELS_INVALID' }),
        });
    });

    it('label не строка → WAREHOUSE_LABEL_INVALID_TYPE', async () => {
        await expect(
            svc.updateMetadata(TENANT, WH_ID, ACTOR, { labels: [123 as any, 'ok'] }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'WAREHOUSE_LABEL_INVALID_TYPE' }),
        });
    });

    it('aliasName не строка → WAREHOUSE_ALIAS_INVALID_TYPE', async () => {
        await expect(
            svc.updateMetadata(TENANT, WH_ID, ACTOR, { aliasName: 42 as any }),
        ).rejects.toMatchObject({
            response: expect.objectContaining({ code: 'WAREHOUSE_ALIAS_INVALID_TYPE' }),
        });
    });

    it('WAREHOUSE_NOT_FOUND для чужого/несуществующего склада', async () => {
        prisma.warehouse.findFirst.mockResolvedValue(null);
        await expect(
            svc.updateMetadata(TENANT, WH_ID, ACTOR, { aliasName: 'x' }),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('одновременное обновление aliasName и labels — оба пишутся', async () => {
        prisma.warehouse.findFirst.mockResolvedValue(makeWarehouse());
        prisma.warehouse.update.mockResolvedValue(makeWarehouse({ aliasName: 'main', labels: ['hub'] }));

        await svc.updateMetadata(TENANT, WH_ID, ACTOR, { aliasName: 'main', labels: ['hub'] });

        expect(prisma.warehouse.update).toHaveBeenCalledWith({
            where: { id: WH_ID },
            data: expect.objectContaining({
                aliasName: 'main',
                labels: ['hub'],
                metadataUpdatedAt: expect.any(Date),
                metadataUpdatedBy: ACTOR,
            }),
            include: expect.any(Object),
        });
    });

    it('не трогает identity-поля даже если update сам бы пропустил их в data', async () => {
        prisma.warehouse.findFirst.mockResolvedValue(makeWarehouse());
        prisma.warehouse.update.mockResolvedValue(makeWarehouse({ aliasName: 'a' }));

        await svc.updateMetadata(TENANT, WH_ID, ACTOR, { aliasName: 'a' });

        const updateCall = prisma.warehouse.update.mock.calls[0][0];
        expect(updateCall.data).not.toHaveProperty('externalWarehouseId');
        expect(updateCall.data).not.toHaveProperty('name');
        expect(updateCall.data).not.toHaveProperty('city');
        expect(updateCall.data).not.toHaveProperty('warehouseType');
        expect(updateCall.data).not.toHaveProperty('sourceMarketplace');
        expect(updateCall.data).not.toHaveProperty('status');
    });
});
