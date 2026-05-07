import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MarketplaceType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
    ANALYTICS_FORMULA_VERSION,
    ANALYTICS_MAX_PERIOD_DAYS,
} from './analytics.constants';
import { MarketplaceKpiBreakdown } from './analytics-aggregator.service';
import {
    AnalyticsPolicyService,
    SnapshotFreshnessVerdict,
} from './analytics-policy.service';
import { AnalyticsMetricNames, AnalyticsMetricsRegistry } from './analytics.metrics';

/**
 * Read APIs analytics (TASK_ANALYTICS_2).
 *
 * §13 правило: dashboard / revenue dynamics / top / drill-down ВСЕ читают
 * готовые агрегаты из `AnalyticsMaterializedDaily`. Realtime joins по
 * `MarketplaceOrder` остаются только в drill-down по конкретному SKU
 * (§13 «допустимо считать онлайн: небольшие drill-down по одному SKU»),
 * и то — окно ограничено `ANALYTICS_MAX_PERIOD_DAYS`.
 *
 * Контракт KPI первого dashboard MVP (§13):
 *   - revenue_net
 *   - orders_count
 *   - units_sold
 *   - avg_check
 *   - returns_count
 *   - top marketplace share
 *
 * Намеренно НЕ возвращаем gross revenue в dashboard первого экрана:
 * UI должен видеть консистентную «чистую» картину; gross живёт в payload
 * каждой строки и доступен в drill-down.
 *
 * Все методы возвращают `null` snapshot при пустом tenant'е без
 * exception — это §16 тест «dashboard на пустом tenant».
 */

export interface AnalyticsPeriodInput {
    periodFrom: Date;
    periodTo: Date;
    marketplace?: MarketplaceType;
}

export interface DashboardResponse {
    period: { from: string; to: string };
    formulaVersion: string;
    snapshotStatus: 'EMPTY' | 'READY' | 'STALE' | 'INCOMPLETE' | 'FAILED';
    sourceFreshness: unknown;
    /**
     * Структурированный verdict из `AnalyticsPolicyService.evaluateStaleness`.
     * UI читает `freshness.classification` для рендера бейджа
     * (FRESH_AND_COMPLETE / STALE_BUT_COMPLETE / INCOMPLETE_BUT_FRESH /
     * STALE_AND_INCOMPLETE) — §19 stale-vs-incomplete board.
     */
    freshness: SnapshotFreshnessVerdict | null;
    kpis: {
        revenueNet: number;
        ordersCount: number;
        unitsSold: number;
        avgCheck: number;
        returnsCount: number;
        topMarketplaceShare: { marketplace: string | null; sharePct: number };
    };
}

export interface RevenueDynamicsResponse {
    formulaVersion: string;
    series: Array<{
        date: string;
        revenueNet: number;
        ordersCount: number;
        byMarketplace: Record<string, MarketplaceKpiBreakdown>;
    }>;
}

export interface TopProductRow {
    productId: string;
    sku: string;
    name: string | null;
    photo: string | null;
    revenueNet: number;
    unitsSold: number;
    ordersCount: number;
    stockTotal: number;
    abcGroup: 'A' | 'B' | 'C' | null;
    daysOfStock: number | null;
}

export interface ClusterStockRow {
    warehouseId: string;
    clusterName: string;
    stockTotal: number;
    salesCount: number;
    daysOfStock: number | null;
    stockSharePct: number;
    salesSharePct: number;
}

export interface ClusterStockResponse {
    rows: ClusterStockRow[];
    totals: { stockTotal: number; salesCount: number };
    period: { from: string; to: string };
}

export interface ProductDrillDown {
    product: { id: string; sku: string; name: string };
    period: { from: string; to: string };
    kpis: {
        revenueNet: number;
        unitsSold: number;
        ordersCount: number;
        returnsCount: number;
        avgPrice: number;
    };
    dailySeries: Array<{ date: string; ordersCount: number; revenueNet: number; unitsSold: number }>;
    /** До 30 последних заказов по этому SKU — для drill-down таблицы. */
    recentOrders: Array<{
        marketplace: string;
        marketplaceOrderId: string;
        marketplaceCreatedAt: string | null;
        quantity: number;
        totalAmount: number | null;
        status: string | null;
    }>;
}

@Injectable()
export class AnalyticsReadService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly policy: AnalyticsPolicyService,
        private readonly metrics: AnalyticsMetricsRegistry,
    ) {}

    // ─── Dashboard ────────────────────────────────────────────────────

    async getDashboard(tenantId: string, input: AnalyticsPeriodInput): Promise<DashboardResponse> {
        this.metrics.increment(AnalyticsMetricNames.DASHBOARD_OPENS, { tenantId });
        const { from, to } = this._validatePeriod(input);
        const mp = input.marketplace ?? null;

        const rows = await this.prisma.analyticsMaterializedDaily.findMany({
            where: {
                tenantId,
                date: { gte: from, lte: to },
            },
            select: {
                date: true,
                revenueNet: true,
                ordersCount: true,
                unitsSold: true,
                returnsCount: true,
                byMarketplace: true,
                snapshotStatus: true,
                sourceFreshness: true,
            },
            orderBy: { date: 'asc' },
        });

        if (rows.length === 0) {
            return {
                period: isoRange(from, to),
                formulaVersion: ANALYTICS_FORMULA_VERSION,
                snapshotStatus: 'EMPTY',
                sourceFreshness: null,
                freshness: null,
                kpis: {
                    revenueNet: 0,
                    ordersCount: 0,
                    unitsSold: 0,
                    avgCheck: 0,
                    returnsCount: 0,
                    topMarketplaceShare: { marketplace: null, sharePct: 0 },
                },
            };
        }

        let revenueNet = 0;
        let ordersCount = 0;
        let unitsSold = 0;
        let returnsCount = 0;
        const byMpRevenue: Record<string, number> = {};

        for (const r of rows) {
            const mpMap = (r.byMarketplace ?? {}) as unknown as Record<string, MarketplaceKpiBreakdown>;

            if (mp) {
                // Filter to single marketplace from pre-aggregated byMarketplace breakdown
                const kpi = mpMap[mp];
                revenueNet  += kpi?.revenueNet  ?? 0;
                ordersCount += kpi?.ordersCount ?? 0;
                unitsSold   += kpi?.unitsSold   ?? 0;
                returnsCount += 0; // returns not stored per-mp in daily layer
            } else {
                revenueNet  += toNumber(r.revenueNet);
                ordersCount += r.ordersCount;
                unitsSold   += r.unitsSold;
                returnsCount += r.returnsCount;
            }

            for (const [key, kpi] of Object.entries(mpMap)) {
                byMpRevenue[key] = (byMpRevenue[key] ?? 0) + (kpi?.revenueNet ?? 0);
            }
        }

        const topEntry = Object.entries(byMpRevenue).sort((a, b) => b[1] - a[1])[0];
        const topShare =
            revenueNet > 0 && topEntry ? round2((topEntry[1] / revenueNet) * 100) : 0;

        const aggStatus = this._aggregateStatus(rows.map((r) => r.snapshotStatus));
        const sourceFreshness = rows[rows.length - 1].sourceFreshness ?? null;
        const verdict = this.policy.evaluateStaleness({
            sourceFreshness: sourceFreshness as { orders?: { isStale: boolean } } | null,
            snapshotStatus: aggStatus,
        });
        if (verdict.isStale || verdict.isIncomplete) {
            this.metrics.increment(AnalyticsMetricNames.STALE_VIEWS, {
                tenantId,
                target: 'dashboard',
                reason: verdict.classification,
            });
        }
        return {
            period: isoRange(from, to),
            formulaVersion: ANALYTICS_FORMULA_VERSION,
            snapshotStatus: aggStatus,
            sourceFreshness,
            freshness: verdict,
            kpis: {
                revenueNet: round2(revenueNet),
                ordersCount,
                unitsSold,
                avgCheck: ordersCount > 0 ? round2(revenueNet / ordersCount) : 0,
                returnsCount,
                topMarketplaceShare: {
                    marketplace: topEntry?.[0] ?? null,
                    sharePct: topShare,
                },
            },
        };
    }

    // ─── Revenue Dynamics ─────────────────────────────────────────────

    async getRevenueDynamics(
        tenantId: string,
        input: AnalyticsPeriodInput,
    ): Promise<RevenueDynamicsResponse> {
        const { from, to } = this._validatePeriod(input);
        const mp = input.marketplace ?? null;

        const rows = await this.prisma.analyticsMaterializedDaily.findMany({
            where: { tenantId, date: { gte: from, lte: to } },
            select: {
                date: true,
                revenueNet: true,
                ordersCount: true,
                byMarketplace: true,
            },
            orderBy: { date: 'asc' },
        });

        return {
            formulaVersion: ANALYTICS_FORMULA_VERSION,
            series: rows.map((r) => {
                const mpMap = (r.byMarketplace ?? {}) as unknown as Record<string, MarketplaceKpiBreakdown>;
                const mpKpi = mp ? (mpMap[mp] ?? null) : null;
                return {
                    date: r.date.toISOString().slice(0, 10),
                    revenueNet: mp
                        ? round2(mpKpi?.revenueNet ?? 0)
                        : round2(toNumber(r.revenueNet)),
                    ordersCount: mp
                        ? (mpKpi?.ordersCount ?? 0)
                        : r.ordersCount,
                    byMarketplace: mpMap,
                };
            }),
        };
    }

    // ─── Top Products ─────────────────────────────────────────────────

    /**
     * Top SKU за период по `revenueNet` (можно расширить enum'ом метрики
     * в TASK_ANALYTICS_3 — пока MVP §13 фиксирует именно revenue).
     *
     * Источник: `MarketplaceOrder` напрямую с groupBy. Это ограниченный
     * realtime join, который мы оставляем намеренно — материализованная
     * per-SKU таблица в MVP не описана; ABC снапшот (TASK_ANALYTICS_3)
     * закроет тяжёлые случаи отдельно.
     */
    async getTopProducts(
        tenantId: string,
        input: AnalyticsPeriodInput & {
            limit?: number;
            marketplace?: MarketplaceType;
        },
    ): Promise<{ items: TopProductRow[]; period: { from: string; to: string } }> {
        const { from, to } = this._validatePeriod(input);
        const limit = Math.min(Math.max(input.limit ?? 10, 1), 100);

        const grouped = await this.prisma.marketplaceOrder.groupBy({
            by: ['productSku'],
            where: {
                tenantId,
                marketplaceCreatedAt: { gte: from, lt: addDays(to, 1) },
                NOT: { productSku: null },
                ...(input.marketplace ? { marketplace: input.marketplace } : {}),
            },
            _sum: { totalAmount: true, quantity: true },
            _count: { _all: true },
            orderBy: { _sum: { totalAmount: 'desc' } },
            take: limit,
        });

        const skus = grouped
            .map((g) => g.productSku)
            .filter((s): s is string => !!s);

        const [products, abcSnap] = await Promise.all([
            this.prisma.product.findMany({
                where: { tenantId, sku: { in: skus }, deletedAt: null },
                select: { id: true, sku: true, name: true, total: true, photo: true },
            }),
            this.prisma.analyticsAbcSnapshot.findFirst({
                where: { tenantId },
                orderBy: { generatedAt: 'desc' },
                select: { payload: true },
            }),
        ]);

        const productBySku = new Map(products.map((p) => [p.sku, p]));

        // Build abcGroup map: productId → group
        const abcGroupById = new Map<string, 'A' | 'B' | 'C'>();
        const snapPayload = abcSnap?.payload as any;
        if (snapPayload?.items && Array.isArray(snapPayload.items)) {
            for (const item of snapPayload.items) {
                if (item.productId && item.group) {
                    abcGroupById.set(item.productId, item.group as 'A' | 'B' | 'C');
                }
            }
        }

        // Period in days for daysOfStock calculation
        const periodDays = Math.max(
            1,
            Math.round((to.getTime() - from.getTime()) / 86_400_000),
        );

        const items: TopProductRow[] = grouped.map((g) => {
            const p = productBySku.get(g.productSku!);
            const unitsSold = g._sum.quantity ?? 0;
            const stockTotal = p?.total ?? 0;
            const dailyRate = unitsSold / periodDays;
            const daysOfStock = dailyRate > 0 ? Math.round(stockTotal / dailyRate) : null;
            return {
                productId: p?.id ?? '',
                sku: g.productSku!,
                name: p?.name ?? null,
                photo: p?.photo ?? null,
                revenueNet: round2(g._sum.totalAmount ?? 0),
                unitsSold,
                ordersCount: g._count._all,
                stockTotal,
                abcGroup: p ? (abcGroupById.get(p.id) ?? null) : null,
                daysOfStock,
            };
        });

        return { items, period: isoRange(from, to) };
    }

    // ─── Cluster Stock ────────────────────────────────────────────────

    async getClusterStock(
        tenantId: string,
        input: AnalyticsPeriodInput,
    ): Promise<ClusterStockResponse> {
        const { from, to } = this._validatePeriod(input);
        const mp = input.marketplace ?? null;

        // Filter warehouses by sourceMarketplace when mp filter is active
        const warehouses = await this.prisma.warehouse.findMany({
            where: {
                tenantId,
                ...(mp ? { sourceMarketplace: mp as any } : {}),
            },
            select: { id: true, name: true, city: true },
        });
        const warehouseMap = new Map(warehouses.map(w => [w.id, w]));
        const warehouseIds = warehouses.map(w => w.id);

        // Stock balances grouped by warehouse
        const stockBalances = await this.prisma.stockBalance.groupBy({
            by: ['warehouseId'],
            where: { tenantId, warehouseId: { in: warehouseIds } },
            _sum: { onHand: true },
        });

        // Sales (order items) grouped by warehouseId over period.
        // OrderItem has no tenantId — filter via the parent order using `is:`.
        const orderItems = await this.prisma.orderItem.groupBy({
            by: ['warehouseId'],
            where: {
                warehouseId: { in: warehouseIds },
                order: {
                    is: {
                        tenantId,
                        orderCreatedAt: { gte: from, lt: addDays(to, 1) },
                    },
                },
            },
            _sum: { quantity: true },
        });

        const salesByWarehouse = new Map<string, number>();
        for (const s of orderItems) {
            if (s.warehouseId) salesByWarehouse.set(s.warehouseId, (s._sum?.quantity ?? 0));
        }

        const periodDays = Math.max(
            1,
            Math.round((to.getTime() - from.getTime()) / 86_400_000),
        );

        const rows: ClusterStockRow[] = stockBalances.map(b => {
            const wh = warehouseMap.get(b.warehouseId);
            const stock = b._sum.onHand ?? 0;
            const sales = salesByWarehouse.get(b.warehouseId) ?? 0;
            const dailyRate = sales / periodDays;
            return {
                warehouseId: b.warehouseId,
                clusterName: wh?.name ?? b.warehouseId,
                stockTotal: stock,
                salesCount: sales,
                daysOfStock: dailyRate > 0 ? Math.round(stock / dailyRate) : null,
                stockSharePct: 0,
                salesSharePct: 0,
            };
        });

        // Sort by stock desc, then compute shares
        rows.sort((a, b) => b.stockTotal - a.stockTotal);
        const totalStock = rows.reduce((s, r) => s + r.stockTotal, 0);
        const totalSales = rows.reduce((s, r) => s + r.salesCount, 0);

        for (const r of rows) {
            r.stockSharePct = totalStock > 0 ? round2((r.stockTotal / totalStock) * 100) : 0;
            r.salesSharePct = totalSales > 0 ? round2((r.salesCount / totalSales) * 100) : 0;
        }

        return {
            rows,
            totals: { stockTotal: totalStock, salesCount: totalSales },
            period: isoRange(from, to),
        };
    }

    // ─── Drill-down ───────────────────────────────────────────────────

    async getProductDrillDown(
        tenantId: string,
        productId: string,
        input: AnalyticsPeriodInput,
    ): Promise<ProductDrillDown> {
        const { from, to } = this._validatePeriod(input);

        const product = await this.prisma.product.findFirst({
            where: { id: productId, tenantId, deletedAt: null },
            select: { id: true, sku: true, name: true },
        });
        if (!product) {
            throw new NotFoundException({
                code: 'PRODUCT_ANALYTICS_NOT_FOUND',
                message: `product ${productId} not found in tenant`,
            });
        }

        const orders = await this.prisma.marketplaceOrder.findMany({
            where: {
                tenantId,
                productSku: product.sku,
                marketplaceCreatedAt: { gte: from, lt: addDays(to, 1) },
            },
            select: {
                marketplace: true,
                marketplaceOrderId: true,
                marketplaceCreatedAt: true,
                quantity: true,
                totalAmount: true,
                status: true,
            },
            orderBy: { marketplaceCreatedAt: 'desc' },
            take: 200,
        });

        let revenueNet = 0;
        let unitsSold = 0;
        let ordersCount = 0;
        let returnsCount = 0;
        const byDay = new Map<string, { ordersCount: number; revenueNet: number; unitsSold: number }>();
        for (const o of orders) {
            const isReturn = isReturnStatus(o.status);
            const dayKey = o.marketplaceCreatedAt
                ? o.marketplaceCreatedAt.toISOString().slice(0, 10)
                : null;
            if (isReturn) {
                returnsCount += 1;
                revenueNet -= o.totalAmount ?? 0;
                if (dayKey) {
                    const d = byDay.get(dayKey) ?? { ordersCount: 0, revenueNet: 0, unitsSold: 0 };
                    d.revenueNet -= o.totalAmount ?? 0;
                    byDay.set(dayKey, d);
                }
                continue;
            }
            revenueNet += o.totalAmount ?? 0;
            unitsSold += o.quantity ?? 0;
            ordersCount += 1;
            if (dayKey) {
                const d = byDay.get(dayKey) ?? { ordersCount: 0, revenueNet: 0, unitsSold: 0 };
                d.ordersCount += 1;
                d.revenueNet += o.totalAmount ?? 0;
                d.unitsSold += o.quantity ?? 0;
                byDay.set(dayKey, d);
            }
        }

        // Build complete daily series filling gaps with zeros
        const dailySeries: ProductDrillDown['dailySeries'] = [];
        const cur = new Date(from);
        while (cur <= to) {
            const key = cur.toISOString().slice(0, 10);
            const d = byDay.get(key) ?? { ordersCount: 0, revenueNet: 0, unitsSold: 0 };
            dailySeries.push({ date: key, ordersCount: d.ordersCount, revenueNet: round2(d.revenueNet), unitsSold: d.unitsSold });
            cur.setUTCDate(cur.getUTCDate() + 1);
        }

        const recentOrders = orders.slice(0, 30).map((o) => ({
            marketplace: String(o.marketplace),
            marketplaceOrderId: o.marketplaceOrderId,
            marketplaceCreatedAt: o.marketplaceCreatedAt
                ? o.marketplaceCreatedAt.toISOString()
                : null,
            quantity: o.quantity,
            totalAmount: o.totalAmount,
            status: o.status,
        }));

        return {
            product: { id: product.id, sku: product.sku, name: product.name },
            period: isoRange(from, to),
            kpis: {
                revenueNet: round2(revenueNet),
                unitsSold,
                ordersCount,
                returnsCount,
                avgPrice: unitsSold > 0 ? round2(revenueNet / unitsSold) : 0,
            },
            dailySeries,
            recentOrders,
        };
    }

    // ─── helpers ──────────────────────────────────────────────────────

    private _validatePeriod(input: AnalyticsPeriodInput): { from: Date; to: Date } {
        const from = startOfUtcDay(input.periodFrom);
        const to = startOfUtcDay(input.periodTo);
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

    private _aggregateStatus(
        statuses: string[],
    ): 'READY' | 'STALE' | 'INCOMPLETE' | 'FAILED' {
        if (statuses.includes('FAILED')) return 'FAILED';
        if (statuses.includes('STALE')) return 'STALE';
        if (statuses.includes('INCOMPLETE')) return 'INCOMPLETE';
        return 'READY';
    }
}

// ─── helpers ─────────────────────────────────────────────────────────

function startOfUtcDay(d: Date): Date {
    const r = new Date(d);
    r.setUTCHours(0, 0, 0, 0);
    return r;
}

function addDays(d: Date, n: number): Date {
    const r = new Date(d);
    r.setUTCDate(r.getUTCDate() + n);
    return r;
}

function isoRange(from: Date, to: Date): { from: string; to: string } {
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

function toNumber(d: unknown): number {
    if (d === null || d === undefined) return 0;
    if (typeof d === 'number') return d;
    if (typeof (d as { toString: () => string }).toString === 'function') {
        const n = Number((d as { toString: () => string }).toString());
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}

function isReturnStatus(status: string | null): boolean {
    if (!status) return false;
    const s = status.toLowerCase();
    return s.includes('return') || s.includes('cancel') || s.includes('возврат');
}
