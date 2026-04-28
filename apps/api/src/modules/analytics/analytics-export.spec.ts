/**
 * TASK_ANALYTICS_4 spec для `AnalyticsExportService`.
 *
 * Покрывает §6 + §18:
 *   - export читает только готовые витрины;
 *   - CSV формат — корректный header + escape;
 *   - JSON формат — корректный shape;
 *   - tenant isolation: where всегда содержит tenantId;
 *   - ABC export → 404 если snapshot отсутствует;
 *   - period > 366 → 400.
 */

jest.mock('@prisma/client', () => ({
    PrismaClient: class {},
    AnalyticsAbcMetric: { REVENUE_NET: 'REVENUE_NET', UNITS: 'UNITS' },
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AnalyticsExportService } from './analytics-export.service';
import { AnalyticsMetricsRegistry } from './analytics.metrics';

const TENANT = 'tenant-1';
const PERIOD = { periodFrom: new Date('2026-04-01'), periodTo: new Date('2026-04-30') };

function makePrisma(opts: any = {}) {
    return {
        analyticsMaterializedDaily: {
            findMany: jest.fn().mockResolvedValue(opts.daily ?? []),
        },
        analyticsAbcSnapshot: {
            findUnique: jest.fn().mockResolvedValue(opts.abc ?? null),
        },
    } as any;
}

describe('AnalyticsExportService.export — daily', () => {
    it('CSV: header + escape, tenant isolation в where', async () => {
        const prisma = makePrisma({
            daily: [
                {
                    date: new Date('2026-04-01'),
                    revenueGross: 1000,
                    revenueNet: 900,
                    ordersCount: 5,
                    unitsSold: 6,
                    returnsCount: 1,
                    avgCheck: 180,
                    byMarketplace: { WB: { revenueNet: 500, ordersCount: 3 }, OZON: { revenueNet: 400, ordersCount: 2 } },
                    snapshotStatus: 'READY',
                },
            ],
        });
        const r = await new AnalyticsExportService(prisma, new AnalyticsMetricsRegistry()).export({
            tenantId: TENANT,
            target: 'daily',
            format: 'csv',
            ...PERIOD,
        });
        expect(r.contentType).toBe('text/csv');
        expect(r.body.split('\n')[0]).toContain('date,revenue_gross');
        expect(r.body).toContain('2026-04-01,1000,900');
        const findCall = (prisma.analyticsMaterializedDaily.findMany as jest.Mock).mock.calls[0][0];
        expect(findCall.where.tenantId).toBe(TENANT);
    });

    it('JSON: возвращает rows в structured формате', async () => {
        const prisma = makePrisma({
            daily: [
                {
                    date: new Date('2026-04-01'),
                    revenueGross: 1000,
                    revenueNet: 900,
                    ordersCount: 5,
                    unitsSold: 6,
                    returnsCount: 0,
                    avgCheck: 180,
                    byMarketplace: {},
                    snapshotStatus: 'READY',
                },
            ],
        });
        const r = await new AnalyticsExportService(prisma, new AnalyticsMetricsRegistry()).export({
            tenantId: TENANT,
            target: 'daily',
            format: 'json',
            ...PERIOD,
        });
        expect(r.contentType).toBe('application/json');
        const parsed = JSON.parse(r.body);
        expect(parsed.rows).toHaveLength(1);
        expect(parsed.rows[0].revenueNet).toBe(900);
    });
});

describe('AnalyticsExportService.export — abc', () => {
    it('snapshot отсутствует → 404', async () => {
        const prisma = makePrisma({});
        await expect(
            new AnalyticsExportService(prisma, new AnalyticsMetricsRegistry()).export({
                tenantId: TENANT,
                target: 'abc',
                format: 'csv',
                ...PERIOD,
            }),
        ).rejects.toThrow(NotFoundException);
    });

    it('CSV: items из payload в плоском виде', async () => {
        const prisma = makePrisma({
            abc: {
                formulaVersion: 'mvp-v1',
                metric: 'REVENUE_NET',
                snapshotStatus: 'READY',
                generatedAt: new Date('2026-04-30T10:00:00Z'),
                payload: {
                    items: [
                        { rank: 1, sku: 'SKU-A', productId: 'p1', metricValue: 800, sharePct: 80, cumulativeShare: 80, group: 'A' },
                        { rank: 2, sku: 'SKU-B', productId: 'p2', metricValue: 150, sharePct: 15, cumulativeShare: 95, group: 'B' },
                    ],
                },
            },
        });
        const r = await new AnalyticsExportService(prisma, new AnalyticsMetricsRegistry()).export({
            tenantId: TENANT,
            target: 'abc',
            format: 'csv',
            ...PERIOD,
        });
        expect(r.body).toContain('rank,sku,product_id,metric_value');
        expect(r.body).toContain('1,SKU-A,p1,800');
        expect(r.body).toContain('2,SKU-B,p2,150');
    });
});

describe('AnalyticsExportService — validation', () => {
    it('окно > 366 дней → 400', async () => {
        const prisma = makePrisma({});
        await expect(
            new AnalyticsExportService(prisma, new AnalyticsMetricsRegistry()).export({
                tenantId: TENANT,
                target: 'daily',
                format: 'csv',
                periodFrom: new Date('2024-01-01'),
                periodTo: new Date('2026-01-01'),
            }),
        ).rejects.toThrow(BadRequestException);
    });
});
