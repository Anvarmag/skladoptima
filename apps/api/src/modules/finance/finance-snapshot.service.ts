import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
} from '@nestjs/common';
import {
    FinanceSnapshotPeriodType,
    FinanceSnapshotStatus,
    FinanceWarningType,
    Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
    FinanceCalculatorService,
    SkuFinanceInput,
    FinanceCalculationOutput,
} from './finance-calculator.service';
import { FinancePolicyService, STALE_SOURCE_WINDOW_HOURS } from './finance-policy.service';
import { FinanceMetricsRegistry, FinanceMetricNames } from './finance.metrics';

/**
 * Snapshot/read-model orchestrator (TASK_FINANCE_3).
 *
 * Между голым калькулятором (TASK_FINANCE_2, чистая функция) и REST/UI:
 *   1. Loader — собирает входы из БД (orders + cost profiles + marketplace
 *      reports) в `SkuFinanceInput[]`. Source-freshness считаем здесь же.
 *   2. Calculator — `FinanceCalculatorService.calculatePeriod()`.
 *   3. Persist — `FinanceSnapshot.upsert` по `(tenantId, periodFrom,
 *      periodTo, formulaVersion)` UNIQUE из TASK_FINANCE_1; деактивация
 *      старых warning'ов и создание новых.
 *
 * Контракт §10 + §13 + §15:
 *   - rebuild НЕ запускает sync во внешний API маркетплейсов; он работает
 *     ТОЛЬКО по уже нормализованным внутренним источникам;
 *   - rebuild запрещён при `TRIAL_EXPIRED / SUSPENDED / CLOSED`
 *     (`FINANCE_REBUILD_BLOCKED_BY_TENANT_STATE`);
 *   - идемпотентность гарантируется UNIQUE на snapshot — повторный rebuild
 *     того же периода с той же formulaVersion не плодит дубль;
 *   - `stale` (sourceFreshness старее окна) и `incomplete` (missing critical)
 *     — два разных состояния (см. §14 правило stale snapshot + §128
 *     UI правило).
 */

// STALE_SOURCE_WINDOW_HOURS импортируется из finance-policy.service (TASK_FINANCE_5).
const MAX_CUSTOM_PERIOD_DAYS = 366; // §10 валидация

export interface RebuildSnapshotArgs {
    tenantId: string;
    periodFrom: Date;
    periodTo: Date;
    periodType: FinanceSnapshotPeriodType;
    /** Owner/Admin → актор, NULL для nightly cron job. */
    requestedBy?: string | null;
    /** Опциональный idempotency-key, если caller хочет дополнительный гард. */
    jobKey?: string | null;
}

export interface RebuildSnapshotResult {
    snapshotId: string;
    snapshotStatus: FinanceSnapshotStatus;
    formulaVersion: string;
    skuCount: number;
    incompleteSkuCount: number;
    aggregatedWarnings: FinanceWarningType[];
    sourceFreshness: SourceFreshness;
    /** true — это был upsert поверх существующего snapshot той же версии. */
    wasReplaced: boolean;
}

export interface SourceFreshness {
    orders: SourceFreshnessEntry;
    fees: SourceFreshnessEntry;
    costProfiles: SourceFreshnessEntry;
}

export interface SourceFreshnessEntry {
    /** ISO timestamp или null если источник пустой. */
    lastEventAt: string | null;
    /** true если источник старее STALE_SOURCE_WINDOW_HOURS. */
    isStale: boolean;
}

@Injectable()
export class FinanceSnapshotService {
    private readonly logger = new Logger(FinanceSnapshotService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly calculator: FinanceCalculatorService,
        private readonly policy: FinancePolicyService,
        private readonly metrics: FinanceMetricsRegistry,
    ) {}

    /**
     * On-demand или cron-инициированный rebuild.
     *
     * §15 идемпотентность через UPSERT на UNIQUE(tenant, periodFrom,
     * periodTo, formulaVersion). Если snapshot уже существовал — мы его
     * перезаписываем (`wasReplaced=true`); новая formulaVersion даст
     * новую запись, не задев старую (§12 reproducibility).
     */
    async rebuild(args: RebuildSnapshotArgs): Promise<RebuildSnapshotResult> {
        // TASK_FINANCE_7: latency и count метрики на каждом исходе.
        const startedAt = Date.now();
        const labels = {
            tenantId: args.tenantId,
            formulaVersion: this.calculator.formulaVersion,
        };
        try {
            const result = await this._rebuildInner(args);
            this.metrics.observeLatency(Date.now() - startedAt, labels);
            this.metrics.increment(FinanceMetricNames.SNAPSHOTS_GENERATED, {
                ...labels,
                reason: result.snapshotStatus,
            });
            if (result.snapshotStatus === 'INCOMPLETE') {
                this.metrics.increment(FinanceMetricNames.WARNING_INCOMPLETE_COUNT, {
                    ...labels,
                    reason: result.aggregatedWarnings.join(',') || 'unspecified',
                });
            }
            // §19 negative_margin_sku_count: считаем из payload'а.
            const negativeCount = await this._countNegativeMargin(result.snapshotId);
            if (negativeCount > 0) {
                this.metrics.increment(
                    FinanceMetricNames.NEGATIVE_MARGIN_SKU_COUNT,
                    labels,
                    negativeCount,
                );
            }
            return result;
        } catch (err: any) {
            this.metrics.observeLatency(Date.now() - startedAt, labels);
            // Different reason для разных типов exception'ов.
            const reason =
                err?.response?.code ?? err?.code ?? err?.constructor?.name ?? 'unknown';
            if (reason === 'FINANCE_REBUILD_BLOCKED_BY_TENANT_STATE') {
                this.metrics.increment(
                    FinanceMetricNames.REBUILD_BLOCKED_BY_TENANT,
                    { ...labels, reason },
                );
            } else {
                this.metrics.increment(
                    FinanceMetricNames.SNAPSHOT_GENERATION_FAILURES,
                    { ...labels, reason },
                );
            }
            throw err;
        }
    }

    private async _countNegativeMargin(snapshotId: string): Promise<number> {
        const s = await this.prisma.financeSnapshot.findUnique({
            where: { id: snapshotId },
            select: { payload: true },
        });
        const items = (s?.payload as any)?.items ?? [];
        return items.filter((it: any) => it.profit < 0).length;
    }

    private async _rebuildInner(args: RebuildSnapshotArgs): Promise<RebuildSnapshotResult> {
        // ── 1. Validate period ───────────────────────────────────────
        if (args.periodFrom > args.periodTo) {
            throw new BadRequestException({
                code: 'INVALID_PERIOD',
                message: 'periodFrom must be <= periodTo',
            });
        }
        if (args.periodType === FinanceSnapshotPeriodType.CUSTOM) {
            const days = Math.ceil(
                (args.periodTo.getTime() - args.periodFrom.getTime()) / (24 * 3600 * 1000),
            );
            if (days > MAX_CUSTOM_PERIOD_DAYS) {
                throw new BadRequestException({
                    code: 'INVALID_PERIOD',
                    message: `Custom period exceeds ${MAX_CUSTOM_PERIOD_DAYS} days`,
                });
            }
        }

        // ── 2. Tenant state guard через централизованную политику ────
        // TASK_FINANCE_5: assertRebuildAllowed кидает 403, если tenant
        // в TRIAL_EXPIRED/SUSPENDED/CLOSED, и сам пишет structured-лог
        // `finance_rebuild_blocked`. Snapshot service больше не дублирует
        // policy логику — единая точка в `FinancePolicyService`.
        await this.policy.assertRebuildAllowed(args.tenantId);

        // ── 3. Concurrency guard (опциональный, через jobKey) ─────────
        // Для nightly cron jobKey стабилен per period — гарантирует, что
        // два worker'а не начнут пересчитывать одновременно. UNIQUE на
        // snapshot — last line of defense, но он сработает только в момент
        // INSERT (тоже рабочий вариант, но более грязный лог).
        if (args.jobKey) {
            const inflight = await this._checkInflight(args.tenantId, args.jobKey);
            if (inflight) {
                throw new ConflictException({
                    code: 'SNAPSHOT_REBUILD_IN_PROGRESS',
                    message: `Rebuild with jobKey=${args.jobKey} already in progress`,
                });
            }
        }

        // ── 4. Load inputs ───────────────────────────────────────────
        const inputs = await this._loadInputs(args.tenantId, args.periodFrom, args.periodTo);
        const sourceFreshness = await this._computeSourceFreshness(
            args.tenantId, args.periodFrom, args.periodTo,
        );

        // ── 5. Calculate ─────────────────────────────────────────────
        const calc = this.calculator.calculatePeriod(inputs);

        // Если хоть один источник stale — добавляем aggregated warning
        // (calculator не знает про freshness, это responsibility loader'а).
        if (sourceFreshness.fees.isStale || sourceFreshness.orders.isStale) {
            if (!calc.aggregatedWarnings.includes(FinanceWarningType.STALE_FINANCIAL_SOURCE)) {
                calc.aggregatedWarnings.push(FinanceWarningType.STALE_FINANCIAL_SOURCE);
            }
        }

        // ── 6. Persist (upsert + warning sync) в одной транзакции ────
        const result = await this.prisma.$transaction(async (tx) => {
            // §15: idempotent upsert по UNIQUE(tenant, period, formula).
            const existing = await tx.financeSnapshot.findUnique({
                where: {
                    tenantId_periodFrom_periodTo_formulaVersion: {
                        tenantId: args.tenantId,
                        periodFrom: args.periodFrom,
                        periodTo: args.periodTo,
                        formulaVersion: calc.formulaVersion,
                    },
                },
                select: { id: true },
            });

            const snapshotData = {
                payload: calc as unknown as Prisma.InputJsonValue,
                snapshotStatus: calc.snapshotStatus,
                sourceFreshness: sourceFreshness as unknown as Prisma.InputJsonValue,
                generatedAt: new Date(),
                generatedBy: args.requestedBy ?? null,
                periodType: args.periodType,
            };

            const snapshot = await tx.financeSnapshot.upsert({
                where: {
                    tenantId_periodFrom_periodTo_formulaVersion: {
                        tenantId: args.tenantId,
                        periodFrom: args.periodFrom,
                        periodTo: args.periodTo,
                        formulaVersion: calc.formulaVersion,
                    },
                },
                create: {
                    tenantId: args.tenantId,
                    periodFrom: args.periodFrom,
                    periodTo: args.periodTo,
                    formulaVersion: calc.formulaVersion,
                    ...snapshotData,
                },
                update: snapshotData,
                select: { id: true },
            });

            // Warning sync: пересоздаём warnings конкретного snapshot.
            // Старые physically delete только в рамках этого snapshot —
            // tenant-wide warning'и (productId=null) не трогаем.
            await tx.financeDataWarning.deleteMany({
                where: { snapshotId: snapshot.id },
            });

            // Per-SKU warnings из calculator items.
            const warningRows: Prisma.FinanceDataWarningCreateManyInput[] = [];
            for (const item of calc.items) {
                for (const w of item.warnings) {
                    warningRows.push({
                        tenantId: args.tenantId,
                        productId: item.productId,
                        snapshotId: snapshot.id,
                        warningType: w,
                        isActive: true,
                        details: {
                            sku: item.sku,
                            soldQty: item.soldQty,
                        } as Prisma.InputJsonValue,
                    });
                }
            }
            // Tenant-wide STALE warning без productId.
            if (calc.aggregatedWarnings.includes(FinanceWarningType.STALE_FINANCIAL_SOURCE)) {
                warningRows.push({
                    tenantId: args.tenantId,
                    productId: null,
                    snapshotId: snapshot.id,
                    warningType: FinanceWarningType.STALE_FINANCIAL_SOURCE,
                    isActive: true,
                    details: sourceFreshness as unknown as Prisma.InputJsonValue,
                });
            }
            if (warningRows.length > 0) {
                await tx.financeDataWarning.createMany({ data: warningRows });
            }

            return { snapshotId: snapshot.id, wasReplaced: !!existing };
        });

        this.logger.log(JSON.stringify({
            event: 'finance_snapshot_built',
            tenantId: args.tenantId,
            snapshotId: result.snapshotId,
            formulaVersion: calc.formulaVersion,
            status: calc.snapshotStatus,
            skuCount: calc.totals.skuCount,
            incomplete: calc.totals.incompleteSkuCount,
            wasReplaced: result.wasReplaced,
        }));

        return {
            snapshotId: result.snapshotId,
            snapshotStatus: calc.snapshotStatus,
            formulaVersion: calc.formulaVersion,
            skuCount: calc.totals.skuCount,
            incompleteSkuCount: calc.totals.incompleteSkuCount,
            aggregatedWarnings: calc.aggregatedWarnings,
            sourceFreshness,
            wasReplaced: result.wasReplaced,
        };
    }

    /**
     * §6 endpoint `GET /finance/snapshots/status` — последний snapshot
     * (любой версии формулы) + diagnostics. Read-only, доступен и при
     * paused tenant (§4 сценарий 4).
     */
    async getStatus(tenantId: string) {
        const last = await this.prisma.financeSnapshot.findFirst({
            where: { tenantId },
            orderBy: [{ periodTo: 'desc' }, { generatedAt: 'desc' }],
            select: {
                id: true,
                periodFrom: true,
                periodTo: true,
                periodType: true,
                formulaVersion: true,
                snapshotStatus: true,
                sourceFreshness: true,
                generatedAt: true,
                generatedBy: true,
            },
        });
        const activeWarnings = await this.prisma.financeDataWarning.count({
            where: { tenantId, isActive: true },
        });
        return {
            latestSnapshot: last
                ? {
                      ...last,
                      periodFrom: last.periodFrom.toISOString().slice(0, 10),
                      periodTo: last.periodTo.toISOString().slice(0, 10),
                      generatedAt: last.generatedAt.toISOString(),
                  }
                : null,
            activeWarnings,
            currentFormulaVersion: this.calculator.formulaVersion,
        };
    }

    // ─── Loader ──────────────────────────────────────────────────────

    /**
     * Собирает SkuFinanceInput[] из внутренних источников.
     *
     * §13 правило источников истины:
     *   - revenue/soldQty — только из нормализованных Order/OrderItem;
     *   - cost — только из ProductFinanceProfile;
     *   - fees/logistics — только из MarketplaceReport (агрегаты периода).
     *
     * MVP-упрощение: marketplace fees пропорционально распределяются на
     * SKU по доле revenue (нет per-SKU breakdown в MarketplaceReport).
     * Это документировано в §20 риск; полноценный per-SKU fees breakdown
     * требует расширенного report-feed.
     */
    private async _loadInputs(
        tenantId: string,
        periodFrom: Date,
        periodTo: Date,
    ): Promise<SkuFinanceInput[]> {
        // Заказы периода с items + matched product.
        const orders = await this.prisma.order.findMany({
            where: {
                tenantId,
                createdAt: { gte: periodFrom, lte: periodTo },
                // Считаем только фактическую выручку: FULFILLED или RESERVED.
                // CANCELLED не приносит revenue (даже если был); UNRESOLVED
                // — скрываем из расчёта, пока scope не resolved.
                internalStatus: { in: ['RESERVED', 'FULFILLED'] },
            },
            select: {
                items: {
                    select: {
                        productId: true,
                        sku: true,
                        quantity: true,
                        price: true,
                    },
                },
            },
        });

        // Агрегация по productId.
        const perSku = new Map<string, { sku: string; soldQty: number; revenue: number }>();
        for (const order of orders) {
            for (const item of order.items) {
                if (!item.productId) continue; // unmatched — не считаем
                const key = item.productId;
                const cur = perSku.get(key) ?? { sku: item.sku ?? '', soldQty: 0, revenue: 0 };
                cur.soldQty += item.quantity;
                cur.revenue += item.price ? Number(item.price.toString()) * item.quantity : 0;
                perSku.set(key, cur);
            }
        }

        if (perSku.size === 0) return [];

        // Cost profiles батчем.
        const productIds = Array.from(perSku.keys());
        const profiles = await this.prisma.productFinanceProfile.findMany({
            where: { tenantId, productId: { in: productIds } },
            select: {
                productId: true,
                baseCost: true,
                packagingCost: true,
                additionalCost: true,
            },
        });
        const profileMap = new Map(profiles.map((p) => [p.productId, p]));

        // ── WbFinanceReport: per-SKU детализация комиссии и логистики ──
        // TASK_ANALYTICS_8: если есть данные из отчёта реализации WB —
        // используем точные per-SKU значения вместо пропорциональной разбивки.
        const wbReportRows = await this.prisma.wbFinanceReport.findMany({
            where: {
                tenantId,
                periodFrom: { lte: periodTo },
                periodTo: { gte: periodFrom },
            },
            select: { sku: true, commissionRub: true, deliveryRub: true, storageFee: true },
        });

        // Группируем по sku: суммируем все строки отчёта за период.
        const wbPerSku = new Map<string, { commission: number; logistics: number }>();
        for (const row of wbReportRows) {
            if (!row.sku) continue;
            const cur = wbPerSku.get(row.sku) ?? { commission: 0, logistics: 0 };
            cur.commission += row.commissionRub ?? 0;
            cur.logistics += (row.deliveryRub ?? 0) + (row.storageFee ?? 0);
            wbPerSku.set(row.sku, cur);
        }
        const hasWbReport = wbPerSku.size > 0;

        // Marketplace fees / logistics / returns — агрегаты периода (без per-SKU).
        // Используется как fallback для SKU без данных из WbFinanceReport.
        const reports = await this.prisma.marketplaceReport.findMany({
            where: {
                tenantId,
                periodStart: { lte: periodTo },
                periodEnd: { gte: periodFrom },
            },
            select: {
                commissionAmount: true,
                logisticsAmount: true,
                returnsAmount: true,
            },
        });
        const totalFees = reports.reduce((s, r) => s + (r.commissionAmount ?? 0), 0);
        const totalLogistics = reports.reduce((s, r) => s + (r.logisticsAmount ?? 0), 0);
        const totalReturns = reports.reduce((s, r) => s + (r.returnsAmount ?? 0), 0);
        const hasReports = reports.length > 0;
        const totalRevenue = Array.from(perSku.values()).reduce((s, v) => s + v.revenue, 0);

        // Сборка inputs.
        const inputs: SkuFinanceInput[] = [];
        for (const [productId, agg] of perSku.entries()) {
            const profile = profileMap.get(productId);
            const revenueShare = totalRevenue > 0 ? agg.revenue / totalRevenue : 0;

            // TASK_ANALYTICS_8: приоритет — WbFinanceReport per-SKU данные.
            // Fallback — пропорциональное распределение из MarketplaceReport.
            const wbSku = wbPerSku.get(agg.sku);
            const marketplaceFees = wbSku
                ? round2(wbSku.commission)
                : hasReports ? round2(totalFees * revenueShare) : null;
            const logistics = wbSku
                ? round2(wbSku.logistics)
                : hasReports ? round2(totalLogistics * revenueShare) : null;

            inputs.push({
                productId,
                sku: agg.sku,
                soldQty: agg.soldQty,
                revenue: agg.revenue,

                baseCost: FinanceCalculatorService.decimalToNumber(profile?.baseCost ?? null),
                packagingCost: FinanceCalculatorService.decimalToNumber(profile?.packagingCost ?? null),
                additionalCost: FinanceCalculatorService.decimalToNumber(profile?.additionalCost ?? null),

                marketplaceFees,
                logistics,

                // Optional: ads/tax не агрегируем в MVP loader'е (нет источника).
                adsCost: null,
                taxImpact: null,
                returnsImpact: hasReports ? round2(totalReturns * revenueShare) : null,
            });
        }

        // Логируем источник данных для диагностики (hasWbReport используется как маркер).
        if (hasWbReport) {
            this.logger.log(JSON.stringify({
                event: 'finance_loader_wb_report_used',
                tenantId,
                skuCoveredByWb: wbPerSku.size,
                totalSkuCount: perSku.size,
            }));
        }

        return inputs;
    }

    /**
     * Считает freshness каждого источника. §14 правило stale: если
     * последнее событие источника старее `STALE_SOURCE_WINDOW_HOURS`,
     * источник помечается `isStale=true`.
     */
    private async _computeSourceFreshness(
        tenantId: string,
        periodFrom: Date,
        periodTo: Date,
    ): Promise<SourceFreshness> {
        const staleThreshold = new Date(Date.now() - STALE_SOURCE_WINDOW_HOURS * 3600 * 1000);

        const lastOrder = await this.prisma.order.findFirst({
            where: { tenantId },
            orderBy: { processedAt: 'desc' },
            select: { processedAt: true },
        });
        const lastReport = await this.prisma.marketplaceReport.findFirst({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
        });
        const lastProfile = await this.prisma.productFinanceProfile.findFirst({
            where: { tenantId },
            orderBy: { updatedAt: 'desc' },
            select: { updatedAt: true },
        });

        return {
            orders: this._freshness(lastOrder?.processedAt ?? null, staleThreshold),
            fees: this._freshness(lastReport?.createdAt ?? null, staleThreshold),
            costProfiles: this._freshness(lastProfile?.updatedAt ?? null, staleThreshold),
        };
    }

    private _freshness(at: Date | null, threshold: Date): SourceFreshnessEntry {
        if (!at) return { lastEventAt: null, isStale: true };
        return {
            lastEventAt: at.toISOString(),
            isStale: at < threshold,
        };
    }

    /**
     * Concurrency guard: ищем in-flight rebuild по тому же jobKey.
     * MVP-реализация — короткое окно (последние 5 минут), потому что в
     * нашей инфре rebuild занимает секунды; для production worker
     * orchestration (TASK_FINANCE_4 и интеграция с 18-worker) — заменим
     * на explicit lock-таблицу или Redis.
     */
    private async _checkInflight(tenantId: string, jobKey: string): Promise<boolean> {
        const recentMs = 5 * 60 * 1000;
        const since = new Date(Date.now() - recentMs);
        const recent = await this.prisma.financeSnapshot.findFirst({
            where: {
                tenantId,
                generatedAt: { gte: since },
                payload: { path: ['jobKey'], equals: jobKey } as any,
            },
            select: { id: true },
        });
        return !!recent;
    }
}

function round2(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return parseFloat(n.toFixed(2));
}
