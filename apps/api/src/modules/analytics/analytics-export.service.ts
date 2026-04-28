import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AnalyticsAbcMetric } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
    ANALYTICS_FORMULA_VERSION,
    ANALYTICS_MAX_PERIOD_DAYS,
} from './analytics.constants';
import { AnalyticsMetricNames, AnalyticsMetricsRegistry } from './analytics.metrics';

/**
 * Export API (TASK_ANALYTICS_4).
 *
 * §6 + §18 контракт:
 *   - export читает ТОЛЬКО готовые витрины (`AnalyticsMaterializedDaily`,
 *     `AnalyticsAbcSnapshot`); никаких тяжёлых live queries в OLTP;
 *   - tenant isolation — каждое чтение фильтруется по `tenantId`;
 *   - RBAC — gate'тся в controller'е (Owner/Admin), здесь сервис только
 *     отдаёт данные;
 *   - формат — CSV (для Excel/Google Sheets) или JSON (для интеграций).
 *
 * MVP-набор экспортируемых витрин:
 *   - `daily` — daily KPI слой за период;
 *   - `abc` — ABC snapshot за период по метрике.
 *
 * Drill-down per-SKU и recommendations не экспортируются в MVP, чтобы
 * экспорт оставался ограниченным управленческим артефактом и не
 * превратился в data dump (§20 риск).
 */

export type ExportTarget = 'daily' | 'abc';
export type ExportFormat = 'csv' | 'json';

export interface ExportArgs {
    tenantId: string;
    target: ExportTarget;
    format: ExportFormat;
    periodFrom: Date;
    periodTo: Date;
    /** Только для `target=abc`. */
    metric?: AnalyticsAbcMetric;
}

export interface ExportResult {
    contentType: string;
    filename: string;
    body: string;
}

@Injectable()
export class AnalyticsExportService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly metrics: AnalyticsMetricsRegistry,
    ) {}

    async export(args: ExportArgs): Promise<ExportResult> {
        const { tenantId, target, format } = args;
        try {
            const { from, to } = this._validatePeriod(args.periodFrom, args.periodTo);

            let result: ExportResult;
            if (target === 'daily') {
                result = await this._exportDaily(tenantId, from, to, format);
            } else if (target === 'abc') {
                result = await this._exportAbc(
                    tenantId,
                    from,
                    to,
                    args.metric ?? AnalyticsAbcMetric.REVENUE_NET,
                    format,
                );
            } else {
                throw new BadRequestException({
                    code: 'ANALYTICS_EXPORT_UNKNOWN_TARGET',
                    message: `unsupported export target ${target}`,
                });
            }
            this.metrics.increment(AnalyticsMetricNames.EXPORT_SUCCESS, {
                tenantId, target, reason: format,
            });
            return result;
        } catch (err: any) {
            this.metrics.increment(AnalyticsMetricNames.EXPORT_FAILURES, {
                tenantId,
                target,
                reason: err?.response?.code ?? err?.code ?? 'UNKNOWN',
            });
            throw err;
        }
    }

    private async _exportDaily(
        tenantId: string,
        from: Date,
        to: Date,
        format: ExportFormat,
    ): Promise<ExportResult> {
        const rows = await this.prisma.analyticsMaterializedDaily.findMany({
            where: { tenantId, date: { gte: from, lte: to } },
            orderBy: { date: 'asc' },
        });
        const filename = `analytics-daily-${dateOnly(from)}_${dateOnly(to)}.${format}`;
        if (format === 'json') {
            return {
                contentType: 'application/json',
                filename,
                body: JSON.stringify(
                    {
                        formulaVersion: ANALYTICS_FORMULA_VERSION,
                        period: { from: dateOnly(from), to: dateOnly(to) },
                        rows: rows.map((r) => ({
                            date: r.date.toISOString().slice(0, 10),
                            revenueGross: numberOf(r.revenueGross),
                            revenueNet: numberOf(r.revenueNet),
                            ordersCount: r.ordersCount,
                            unitsSold: r.unitsSold,
                            returnsCount: r.returnsCount,
                            avgCheck: numberOf(r.avgCheck),
                            byMarketplace: r.byMarketplace,
                            snapshotStatus: r.snapshotStatus,
                        })),
                    },
                    null,
                    2,
                ),
            };
        }

        // CSV: плоский набор + per-marketplace в отдельные колонки.
        const header = [
            'date',
            'revenue_gross',
            'revenue_net',
            'orders_count',
            'units_sold',
            'returns_count',
            'avg_check',
            'wb_revenue_net',
            'wb_orders_count',
            'ozon_revenue_net',
            'ozon_orders_count',
            'snapshot_status',
        ];
        const lines: string[] = [header.join(',')];
        for (const r of rows) {
            const mp = (r.byMarketplace ?? {}) as Record<
                string,
                { revenueNet?: number; ordersCount?: number }
            >;
            lines.push(
                [
                    r.date.toISOString().slice(0, 10),
                    numberOf(r.revenueGross),
                    numberOf(r.revenueNet),
                    r.ordersCount,
                    r.unitsSold,
                    r.returnsCount,
                    numberOf(r.avgCheck),
                    mp.WB?.revenueNet ?? 0,
                    mp.WB?.ordersCount ?? 0,
                    mp.OZON?.revenueNet ?? 0,
                    mp.OZON?.ordersCount ?? 0,
                    r.snapshotStatus,
                ]
                    .map(csvCell)
                    .join(','),
            );
        }
        return { contentType: 'text/csv', filename, body: lines.join('\n') };
    }

    private async _exportAbc(
        tenantId: string,
        from: Date,
        to: Date,
        metric: AnalyticsAbcMetric,
        format: ExportFormat,
    ): Promise<ExportResult> {
        const snap = await this.prisma.analyticsAbcSnapshot.findUnique({
            where: {
                tenantId_periodFrom_periodTo_metric_formulaVersion: {
                    tenantId,
                    periodFrom: from,
                    periodTo: to,
                    metric,
                    formulaVersion: ANALYTICS_FORMULA_VERSION,
                },
            },
        });
        if (!snap) {
            throw new NotFoundException({
                code: 'ANALYTICS_ABC_SNAPSHOT_NOT_FOUND',
                message: 'no abc snapshot for given period — rebuild first',
            });
        }
        const filename = `analytics-abc-${dateOnly(from)}_${dateOnly(to)}-${metric}.${format}`;
        const payload = snap.payload as unknown as {
            items: Array<{
                productId: string;
                sku: string;
                metricValue: number;
                sharePct: number;
                cumulativeShare: number;
                group: 'A' | 'B' | 'C';
                rank: number;
            }>;
        };

        if (format === 'json') {
            return {
                contentType: 'application/json',
                filename,
                body: JSON.stringify(
                    {
                        formulaVersion: snap.formulaVersion,
                        metric: snap.metric,
                        period: { from: dateOnly(from), to: dateOnly(to) },
                        snapshotStatus: snap.snapshotStatus,
                        generatedAt: snap.generatedAt.toISOString(),
                        items: payload?.items ?? [],
                    },
                    null,
                    2,
                ),
            };
        }

        const header = ['rank', 'sku', 'product_id', 'metric_value', 'share_pct', 'cumulative_share', 'group'];
        const lines: string[] = [header.join(',')];
        for (const r of payload?.items ?? []) {
            lines.push(
                [r.rank, r.sku, r.productId, r.metricValue, r.sharePct, r.cumulativeShare, r.group]
                    .map(csvCell)
                    .join(','),
            );
        }
        return { contentType: 'text/csv', filename, body: lines.join('\n') };
    }

    private _validatePeriod(periodFrom: Date, periodTo: Date) {
        const from = startOfUtcDay(periodFrom);
        const to = startOfUtcDay(periodTo);
        if (to < from) {
            throw new BadRequestException({
                code: 'ANALYTICS_PERIOD_INVALID',
                message: 'periodTo must be >= periodFrom',
            });
        }
        const days = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1;
        if (days > ANALYTICS_MAX_PERIOD_DAYS) {
            throw new BadRequestException({
                code: 'ANALYTICS_PERIOD_TOO_LARGE',
                message: `period must be <= ${ANALYTICS_MAX_PERIOD_DAYS} days`,
            });
        }
        return { from, to };
    }
}

function startOfUtcDay(d: Date): Date {
    const r = new Date(d);
    r.setUTCHours(0, 0, 0, 0);
    return r;
}

function dateOnly(d: Date): string {
    return d.toISOString().slice(0, 10);
}

function numberOf(d: unknown): number {
    if (d === null || d === undefined) return 0;
    if (typeof d === 'number') return d;
    if (typeof (d as { toString: () => string }).toString === 'function') {
        const n = Number((d as { toString: () => string }).toString());
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}

function csvCell(v: unknown): string {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}
