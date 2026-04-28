import { Test } from '@nestjs/testing';
import { Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { SyncDiagnosticsService } from './sync-diagnostics.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    Prisma: {},
    SyncRunStatus: {
        QUEUED: 'QUEUED',
        IN_PROGRESS: 'IN_PROGRESS',
        SUCCESS: 'SUCCESS',
        PARTIAL_SUCCESS: 'PARTIAL_SUCCESS',
        FAILED: 'FAILED',
        BLOCKED: 'BLOCKED',
        CANCELLED: 'CANCELLED',
    },
    SyncRunItemStatus: {
        SUCCESS: 'SUCCESS',
        FAILED: 'FAILED',
        SKIPPED: 'SKIPPED',
        CONFLICT: 'CONFLICT',
        BLOCKED: 'BLOCKED',
    },
    SyncRunItemType: {
        STOCK: 'STOCK',
        ORDER: 'ORDER',
        PRODUCT: 'PRODUCT',
        WAREHOUSE: 'WAREHOUSE',
    },
    SyncRunItemStage: {
        PREFLIGHT: 'PREFLIGHT',
        PULL: 'PULL',
        TRANSFORM: 'TRANSFORM',
        APPLY: 'APPLY',
        PUSH: 'PUSH',
    },
}));

const TENANT = 't1';
const RUN_ID = 'run-1';

function makePrisma() {
    return {
        syncRun: {
            findUnique: jest.fn(),
            findFirst: jest.fn(),
            update: jest.fn().mockResolvedValue({}),
        },
        syncRunItem: {
            create: jest.fn(),
        },
        syncConflict: {
            create: jest.fn(),
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            findMany: jest.fn(),
            count: jest.fn(),
            update: jest.fn(),
        },
    };
}

async function build(prisma: any) {
    const ref = await Test.createTestingModule({
        providers: [SyncDiagnosticsService, { provide: PrismaService, useValue: prisma }],
    })
        .setLogger(new Logger())
        .compile();
    return ref.get(SyncDiagnosticsService);
}

describe('SyncDiagnosticsService.recordItem', () => {
    test('записывает FAILED item', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findUnique.mockResolvedValue({ id: RUN_ID, tenantId: TENANT, status: 'IN_PROGRESS' });
        prisma.syncRunItem.create.mockResolvedValue({ id: 'item-1' });
        const svc = await build(prisma);
        const r = await svc.recordItem({
            runId: RUN_ID,
            itemType: 'STOCK' as any,
            itemKey: 'sku-123',
            stage: 'PUSH' as any,
            status: 'FAILED' as any,
            externalEventId: 'ext-456',
            error: { code: 'TIMEOUT' },
        });
        expect(r.id).toBe('item-1');
        expect(prisma.syncRunItem.create).toHaveBeenCalledTimes(1);
        const data = prisma.syncRunItem.create.mock.calls[0][0].data;
        expect(data.status).toBe('FAILED');
        expect(data.externalEventId).toBe('ext-456');
    });

    test('CONFLICT и BLOCKED тоже допустимы', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findUnique.mockResolvedValue({ id: RUN_ID, tenantId: TENANT, status: 'IN_PROGRESS' });
        prisma.syncRunItem.create.mockResolvedValue({ id: 'i' });
        const svc = await build(prisma);

        await expect(svc.recordItem({
            runId: RUN_ID, itemType: 'ORDER' as any, itemKey: 'o-1',
            stage: 'APPLY' as any, status: 'CONFLICT' as any,
        })).resolves.toBeTruthy();

        await expect(svc.recordItem({
            runId: RUN_ID, itemType: 'STOCK' as any, itemKey: 'sku-2',
            stage: 'PUSH' as any, status: 'BLOCKED' as any,
        })).resolves.toBeTruthy();
    });

    test('SUCCESS отвергается — MVP §8: success path хранится агрегатами', async () => {
        const prisma = makePrisma();
        const svc = await build(prisma);
        await expect(svc.recordItem({
            runId: RUN_ID, itemType: 'STOCK' as any, itemKey: 'sku-1',
            stage: 'PUSH' as any, status: 'SUCCESS' as any,
        })).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.syncRunItem.create).not.toHaveBeenCalled();
    });

    test('SKIPPED отвергается (MVP)', async () => {
        const prisma = makePrisma();
        const svc = await build(prisma);
        await expect(svc.recordItem({
            runId: RUN_ID, itemType: 'ORDER' as any, itemKey: 'o',
            stage: 'PULL' as any, status: 'SKIPPED' as any,
        })).rejects.toBeInstanceOf(BadRequestException);
    });

    test('несуществующий run → 404', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findUnique.mockResolvedValue(null);
        const svc = await build(prisma);
        await expect(svc.recordItem({
            runId: RUN_ID, itemType: 'STOCK' as any, itemKey: 'k',
            stage: 'PUSH' as any, status: 'FAILED' as any,
        })).rejects.toBeInstanceOf(NotFoundException);
    });

    test('itemKey усекается до 128 символов', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findUnique.mockResolvedValue({ id: RUN_ID, tenantId: TENANT });
        prisma.syncRunItem.create.mockResolvedValue({ id: 'i' });
        const svc = await build(prisma);
        await svc.recordItem({
            runId: RUN_ID, itemType: 'STOCK' as any, itemKey: 'x'.repeat(200),
            stage: 'PUSH' as any, status: 'FAILED' as any,
        });
        const data = prisma.syncRunItem.create.mock.calls[0][0].data;
        expect(data.itemKey.length).toBe(128);
    });
});

describe('SyncDiagnosticsService.recordConflict', () => {
    test('записывает конфликт + проверяет ownership run', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findFirst.mockResolvedValue({ id: RUN_ID });
        prisma.syncConflict.create.mockResolvedValue({ id: 'c-1' });
        const svc = await build(prisma);
        const r = await svc.recordConflict(TENANT, {
            runId: RUN_ID,
            entityType: 'order',
            entityId: 'order-42',
            conflictType: 'INVENTORY_MISMATCH',
            payload: { detail: 'qty mismatch' },
        });
        expect(r.id).toBe('c-1');
        const data = prisma.syncConflict.create.mock.calls[0][0].data;
        expect(data.tenantId).toBe(TENANT);
        expect(data.runId).toBe(RUN_ID);
        expect(data.conflictType).toBe('INVENTORY_MISMATCH');
    });

    test('run чужого tenant → 404', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findFirst.mockResolvedValue(null);
        const svc = await build(prisma);
        await expect(svc.recordConflict(TENANT, {
            runId: RUN_ID, entityType: 'order',
            conflictType: 'X',
        })).rejects.toBeInstanceOf(NotFoundException);
    });

    test('entityType/conflictType усекаются до 64 символов', async () => {
        const prisma = makePrisma();
        prisma.syncRun.findFirst.mockResolvedValue({ id: RUN_ID });
        prisma.syncConflict.create.mockResolvedValue({ id: 'c' });
        const svc = await build(prisma);
        await svc.recordConflict(TENANT, {
            runId: RUN_ID,
            entityType: 'a'.repeat(100),
            conflictType: 'b'.repeat(100),
        });
        const data = prisma.syncConflict.create.mock.calls[0][0].data;
        expect(data.entityType.length).toBe(64);
        expect(data.conflictType.length).toBe(64);
    });
});

describe('SyncDiagnosticsService.increment*', () => {
    test('incrementProcessed увеличивает processedCount', async () => {
        const prisma = makePrisma();
        const svc = await build(prisma);
        await svc.incrementProcessed(RUN_ID, 5);
        expect(prisma.syncRun.update).toHaveBeenCalledWith({
            where: { id: RUN_ID },
            data: { processedCount: { increment: 5 } },
        });
    });

    test('incrementErrors увеличивает errorCount', async () => {
        const prisma = makePrisma();
        const svc = await build(prisma);
        await svc.incrementErrors(RUN_ID, 2);
        expect(prisma.syncRun.update).toHaveBeenCalledWith({
            where: { id: RUN_ID },
            data: { errorCount: { increment: 2 } },
        });
    });

    test('incrementProcessed(0) — no-op', async () => {
        const prisma = makePrisma();
        const svc = await build(prisma);
        await svc.incrementProcessed(RUN_ID, 0);
        expect(prisma.syncRun.update).not.toHaveBeenCalled();
    });
});

describe('SyncDiagnosticsService.listConflicts / getConflictById / resolveConflict', () => {
    test('list по умолчанию — только открытые', async () => {
        const prisma = makePrisma();
        prisma.syncConflict.findMany.mockResolvedValue([]);
        prisma.syncConflict.count.mockResolvedValue(0);
        const svc = await build(prisma);
        await svc.listConflicts(TENANT, {});
        const where = prisma.syncConflict.findMany.mock.calls[0][0].where;
        expect(where.tenantId).toBe(TENANT);
        expect(where.resolvedAt).toBeNull();
    });

    test('list status=resolved — фильтр по resolvedAt: { not: null }', async () => {
        const prisma = makePrisma();
        prisma.syncConflict.findMany.mockResolvedValue([]);
        prisma.syncConflict.count.mockResolvedValue(0);
        const svc = await build(prisma);
        await svc.listConflicts(TENANT, { status: 'resolved' });
        const where = prisma.syncConflict.findMany.mock.calls[0][0].where;
        expect(where.resolvedAt).toEqual({ not: null });
    });

    test('list status=all — без фильтра по resolvedAt', async () => {
        const prisma = makePrisma();
        prisma.syncConflict.findMany.mockResolvedValue([]);
        prisma.syncConflict.count.mockResolvedValue(0);
        const svc = await build(prisma);
        await svc.listConflicts(TENANT, { status: 'all' });
        const where = prisma.syncConflict.findMany.mock.calls[0][0].where;
        expect(where.resolvedAt).toBeUndefined();
    });

    test('getConflictById включает run', async () => {
        const prisma = makePrisma();
        prisma.syncConflict.findFirst.mockResolvedValue({ id: 'c1', run: { id: RUN_ID } });
        const svc = await build(prisma);
        const r = await svc.getConflictById(TENANT, 'c1');
        expect(r.id).toBe('c1');
    });

    test('getConflictById чужого tenant → 404', async () => {
        const prisma = makePrisma();
        prisma.syncConflict.findFirst.mockResolvedValue(null);
        const svc = await build(prisma);
        await expect(svc.getConflictById(TENANT, 'c1')).rejects.toBeInstanceOf(NotFoundException);
    });

    test('resolveConflict закрывает open конфликт', async () => {
        const prisma = makePrisma();
        prisma.syncConflict.findFirst.mockResolvedValue({
            id: 'c1', resolvedAt: null, runId: RUN_ID, conflictType: 'X',
        });
        prisma.syncConflict.update.mockResolvedValue({ id: 'c1', resolvedAt: new Date() });
        const svc = await build(prisma);
        const r = await svc.resolveConflict(TENANT, 'c1', 'user-1');
        expect((r as any).resolvedAt).toBeInstanceOf(Date);
        expect(prisma.syncConflict.update).toHaveBeenCalled();
    });

    test('resolveConflict идемпотентен для уже закрытого', async () => {
        const prisma = makePrisma();
        const resolvedAt = new Date('2026-04-01');
        prisma.syncConflict.findFirst.mockResolvedValue({
            id: 'c1', resolvedAt, runId: RUN_ID, conflictType: 'X',
        });
        prisma.syncConflict.findUnique.mockResolvedValue({ id: 'c1', resolvedAt });
        const svc = await build(prisma);
        const r = await svc.resolveConflict(TENANT, 'c1', 'user-1');
        expect((r as any).resolvedAt).toEqual(resolvedAt);
        // update НЕ вызывался — идемпотентность.
        expect(prisma.syncConflict.update).not.toHaveBeenCalled();
    });

    test('resolveConflict чужого tenant → 404', async () => {
        const prisma = makePrisma();
        prisma.syncConflict.findFirst.mockResolvedValue(null);
        const svc = await build(prisma);
        await expect(svc.resolveConflict(TENANT, 'c1', null)).rejects.toBeInstanceOf(NotFoundException);
    });
});
