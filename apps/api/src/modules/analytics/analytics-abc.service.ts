import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
    AnalyticsAbcMetric,
    AnalyticsSnapshotStatus,
    Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
    ANALYTICS_FORMULA_VERSION,
    ANALYTICS_MAX_PERIOD_DAYS,
} from './analytics.constants';
import {
    AnalyticsAbcCalculatorService,
    AbcCalculationResult,
    AbcInputRow,
} from './analytics-abc-calculator.service';
import { AnalyticsPolicyService } from './analytics-policy.service';
import { AnalyticsMetricNames, AnalyticsMetricsRegistry } from './analytics.metrics';
import { ForbiddenException } from '@nestjs/common';

/**
 * ABC snapshot orchestrator (TASK_ANALYTICS_3).
 *
 * §13 + §14 + §20 контракт:
 *   - метрика — `revenue_net` (для MVP; `UNITS` зарезервирован под
 *     будущий drill-down);
 *   - идемпотентный rebuild через UNIQUE(tenantId, periodFrom, periodTo,
 *     metric, formulaVersion) UPSERT — пересчёт того же периода с той же
 *     версией формулы перезаписывает payload, а смена metric/formula
 *     создаёт отдельный snapshot, чтобы не терять историю интерпретации;
 *   - расчёт НЕ инициирует sync во внешний API маркетплейсов; работает
 *     только по уже нормализованным `MarketplaceOrder` per tenant;
 *   - формула и thresholds зафиксированы константами
 *     (`ANALYTICS_FORMULA_VERSION`, `ABC_GROUP_THRESHOLDS`) — смена
 *     любой из них требует rebuild и порождает новый snapshot.
 *
 * Tenant-state guard (`TRIAL_EXPIRED / SUSPENDED / CLOSED` блокирует
 * rebuild) — TASK_ANALYTICS_5; здесь сервис не знает о tenant policy.
 */

export interface RebuildAbcArgs {
    tenantId: string;
    periodFrom: Date;
    periodTo: Date;
    metric?: AnalyticsAbcMetric; // default REVENUE_NET
}

export interface RebuildAbcResult {
    snapshotId: string;
    formulaVersion: string;
    metric: AnalyticsAbcMetric;
    snapshotStatus: AnalyticsSnapshotStatus;
    skuCount: number;
    groupCounts: { A: number; B: number; C: number };
    wasReplaced: boolean;
}

@Injectable()
export class AnalyticsAbcService {
    private readonly logger = new Logger(AnalyticsAbcService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly calculator: AnalyticsAbcCalculatorService,
        private readonly policy: AnalyticsPolicyService,
        private readonly metrics: AnalyticsMetricsRegistry,
    ) {}

    /**
     * Rebuild ABC snapshot за период `[periodFrom, periodTo]`.
     *
     * Tenant policy: rebuild блокируется при `TRIAL_EXPIRED / SUSPENDED /
     * CLOSED` (TASK_ANALYTICS_5).
     */
    async rebuild(args: RebuildAbcArgs): Promise<RebuildAbcResult> {
        const { tenantId } = args;
        const startedAt = Date.now();
        try {
            await this.policy.assertRebuildAllowed(tenantId);
        } catch (err) {
            if (err instanceof ForbiddenException) {
                this.metrics.increment(AnalyticsMetricNames.REBUILD_BLOCKED_BY_TENANT, {
                    tenantId,
                    target: 'abc',
                    reason: (err.getResponse() as any)?.message ?? 'PAUSED',
                });
            }
            throw err;
        }
        const metric = args.metric ?? AnalyticsAbcMetric.REVENUE_NET;
        const { from, to } = this._validatePeriod(args.periodFrom, args.periodTo);

        const inputRows = await this._loadPerSkuMetric(tenantId, from, to, metric);
        const calc = this.calculator.calculate(inputRows);
        const sourceFreshness = await this._evaluateSourceFreshness(tenantId);
        const snapshotStatus =
            calc.totals.skuCount === 0
                ? AnalyticsSnapshotStatus.INCOMPLETE
                : sourceFreshness.orders.isStale
                  ? AnalyticsSnapshotStatus.STALE
                  : AnalyticsSnapshotStatus.READY;

        // Проверим, существует ли уже snapshot — для wasReplaced флага.
        const existing = await this.prisma.analyticsAbcSnapshot.findUnique({
            where: {
                tenantId_periodFrom_periodTo_metric_formulaVersion: {
                    tenantId,
                    periodFrom: from,
                    periodTo: to,
                    metric,
                    formulaVersion: ANALYTICS_FORMULA_VERSION,
                },
            },
            select: { id: true },
        });

        const payload = this._buildPayload(calc);

        const upserted = await this.prisma.analyticsAbcSnapshot.upsert({
            where: {
                tenantId_periodFrom_periodTo_metric_formulaVersion: {
                    tenantId,
                    periodFrom: from,
                    periodTo: to,
                    metric,
                    formulaVersion: ANALYTICS_FORMULA_VERSION,
                },
            },
            create: {
                tenantId,
                periodFrom: from,
                periodTo: to,
                metric,
                formulaVersion: ANALYTICS_FORMULA_VERSION,
                snapshotStatus,
                payload: payload as unknown as Prisma.InputJsonValue,
                sourceFreshness: sourceFreshness as unknown as Prisma.InputJsonValue,
            },
            update: {
                snapshotStatus,
                payload: payload as unknown as Prisma.InputJsonValue,
                sourceFreshness: sourceFreshness as unknown as Prisma.InputJsonValue,
                generatedAt: new Date(),
            },
            select: { id: true },
        });

        this.logger.log(
            `analytics ABC rebuild tenant=${tenantId} period=${dateOnly(from)}..${dateOnly(to)} ` +
                `metric=${metric} sku=${calc.totals.skuCount} ` +
                `groups={A:${calc.totals.groupCounts.A},B:${calc.totals.groupCounts.B},C:${calc.totals.groupCounts.C}} ` +
                `status=${snapshotStatus}`,
        );

        this.metrics.observeLatency(Date.now() - startedAt, {
            tenantId,
            target: 'abc',
            reason: snapshotStatus,
        });
        this.metrics.increment(AnalyticsMetricNames.ABC_RECOMPUTE_COUNT, {
            tenantId,
            target: 'abc',
            reason: snapshotStatus,
        });

        return {
            snapshotId: upserted.id,
            formulaVersion: ANALYTICS_FORMULA_VERSION,
            metric,
            snapshotStatus,
            skuCount: calc.totals.skuCount,
            groupCounts: calc.totals.groupCounts,
            wasReplaced: !!existing,
        };
    }

    /**
     * Чтение последнего snapshot'а за период по metric/formulaVersion.
     * Если не найден — возвращает null (UI рисует пустой ABC), без
     * exception; rebuild — отдельный вызов.
     */
    async getSnapshot(
        tenantId: string,
        periodFrom: Date,
        periodTo: Date,
        metric: AnalyticsAbcMetric = AnalyticsAbcMetric.REVENUE_NET,
    ) {
        const { from, to } = this._validatePeriod(periodFrom, periodTo);
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
            return {
                snapshot: null,
                period: { from: dateOnly(from), to: dateOnly(to) },
                metric,
                formulaVersion: ANALYTICS_FORMULA_VERSION,
            };
        }
        return {
            snapshot: {
                id: snap.id,
                metric: snap.metric,
                formulaVersion: snap.formulaVersion,
                snapshotStatus: snap.snapshotStatus,
                sourceFreshness: snap.sourceFreshness,
                generatedAt: snap.generatedAt.toISOString(),
                payload: snap.payload,
            },
            period: { from: dateOnly(from), to: dateOnly(to) },
            metric,
            formulaVersion: ANALYTICS_FORMULA_VERSION,
        };
    }

    // ─── private ──────────────────────────────────────────────────────

    /**
     * Выгружает per-SKU revenue_net из `MarketplaceOrder` за период.
     * Возвраты учитываются с минусом (см. правила в aggregator'е).
     * Резолвит `productId` через `Product.findMany(in: skus)` — SKU без
     * товара пропускаются (ABC привязан к Product, а не к raw sku).
     */
    private async _loadPerSkuMetric(
        tenantId: string,
        from: Date,
        to: Date,
        metric: AnalyticsAbcMetric,
    ): Promise<AbcInputRow[]> {
        const orders = await this.prisma.marketplaceOrder.findMany({
            where: {
                tenantId,
                marketplaceCreatedAt: { gte: from, lt: addDays(to, 1) },
                NOT: { productSku: null },
            },
            select: {
                productSku: true,
                quantity: true,
                totalAmount: true,
                status: true,
            },
        });

        const perSku = new Map<string, number>();
        for (const o of orders) {
            const sku = o.productSku!;
            const isReturn = isReturnStatus(o.status);
            const value =
                metric === AnalyticsAbcMetric.UNITS
                    ? (isReturn ? -1 : 1) * (o.quantity ?? 0)
                    : (isReturn ? -1 : 1) * (o.totalAmount ?? 0);
            perSku.set(sku, (perSku.get(sku) ?? 0) + value);
        }

        const skus = [...perSku.keys()];
        if (skus.length === 0) return [];
        const products = await this.prisma.product.findMany({
            where: { tenantId, sku: { in: skus }, deletedAt: null },
            select: { id: true, sku: true },
        });
        const idBySku = new Map(products.map((p) => [p.sku, p.id]));

        const rows: AbcInputRow[] = [];
        for (const [sku, value] of perSku.entries()) {
            const productId = idBySku.get(sku);
            if (!productId) continue; // SKU без активного product — игнорируем
            rows.push({ productId, sku, metricValue: value });
        }
        return rows;
    }

    private async _evaluateSourceFreshness(tenantId: string) {
        const last = await this.prisma.marketplaceOrder.findFirst({
            where: { tenantId, NOT: { marketplaceCreatedAt: null } },
            orderBy: { marketplaceCreatedAt: 'desc' },
            select: { marketplaceCreatedAt: true },
        });
        const lastAt = last?.marketplaceCreatedAt ?? null;
        const isStale = AnalyticsPolicyService.isLastEventStale(lastAt);
        return {
            orders: { lastEventAt: lastAt ? lastAt.toISOString() : null, isStale },
        };
    }

    private _buildPayload(calc: AbcCalculationResult) {
        // payload компактен: items по группам + totals для UI без
        // дополнительных запросов.
        const groups: Record<'A' | 'B' | 'C', AbcCalculationResult['rows']> = {
            A: [],
            B: [],
            C: [],
        };
        for (const r of calc.rows) groups[r.group].push(r);
        return {
            generatedFormula: ANALYTICS_FORMULA_VERSION,
            totals: calc.totals,
            groups,
            items: calc.rows, // плоский массив для drill-down таблицы
        };
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

function dateOnly(d: Date): string {
    return d.toISOString().slice(0, 10);
}

function isReturnStatus(status: string | null): boolean {
    if (!status) return false;
    const s = status.toLowerCase();
    return s.includes('return') || s.includes('cancel') || s.includes('возврат');
}
