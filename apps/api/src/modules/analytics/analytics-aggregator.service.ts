import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { AnalyticsSnapshotStatus, MarketplaceType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
    ANALYTICS_FORMULA_VERSION,
    ANALYTICS_MAX_PERIOD_DAYS,
} from './analytics.constants';
import { AnalyticsPolicyService } from './analytics-policy.service';
import { AnalyticsMetricNames, AnalyticsMetricsRegistry } from './analytics.metrics';
import { ForbiddenException } from '@nestjs/common';

/**
 * Daily aggregation pipeline (TASK_ANALYTICS_2 — поддерживает read APIs).
 *
 * §13 правило: dashboard и revenue dynamics НЕ должны считаться on-the-fly
 * из OLTP. Этот сервис заполняет `AnalyticsMaterializedDaily` upsert'ом
 * по `(tenantId, date)` — read-сервис читает уже готовые агрегаты.
 *
 * Источник в MVP — `MarketplaceOrder` (плоская legacy-модель, по которой
 * уже исторически собирался revenue). Доменная `Order` модель ещё
 * заполняется параллельно (см. TASK_ORDERS_*) — переключение источника
 * на `Order/OrderItem` запланировано отдельно, чтобы не сломать
 * существующий пайплайн пока в нём ещё не во всех tenant'ах есть данные.
 *
 * Контракт §10 + §13:
 *   - агрегация НЕ инициирует sync во внешний API маркетплейсов;
 *     работает только по уже нормализованным внутренним заказам;
 *   - идемпотентность через UNIQUE(tenantId, date) UPSERT — повторный
 *     запуск job'а на тот же день переписывает строку, не создавая дубль;
 *   - если в день не было заказов — строка всё равно создаётся с нулями
 *     (это нужно, чтобы revenue dynamics показывал «пустые» дни графика
 *     явно, а не пропуском оси X).
 *   - `snapshotStatus` отделяет `STALE` (источник перестал обновляться
 *     дольше окна) vs `INCOMPLETE` (часть данных отсутствует) — §19.
 *
 * Tenant-state guard (`TRIAL_EXPIRED / SUSPENDED / CLOSED` блокируют
 * rebuild) — TASK_ANALYTICS_5; здесь сервис не знает о tenant policy.
 */

const SUPPORTED_MARKETPLACES: MarketplaceType[] = [
    MarketplaceType.WB,
    MarketplaceType.OZON,
];

export interface RebuildDailyArgs {
    tenantId: string;
    /** Начало периода (включительно), календарная дата без времени. */
    periodFrom: Date;
    /** Конец периода (включительно), календарная дата без времени. */
    periodTo: Date;
}

export interface RebuildDailyResult {
    daysProcessed: number;
    rowsUpserted: number;
    formulaVersion: string;
    snapshotStatus: AnalyticsSnapshotStatus;
    sourceFreshness: AnalyticsSourceFreshness;
}

export interface AnalyticsSourceFreshness {
    orders: { lastEventAt: string | null; isStale: boolean };
}

export interface DailyKpiRow {
    revenueGross: number;
    revenueNet: number;
    ordersCount: number;
    unitsSold: number;
    returnsCount: number;
    avgCheck: number;
    byMarketplace: Record<string, MarketplaceKpiBreakdown>;
}

export interface MarketplaceKpiBreakdown {
    revenueGross: number;
    revenueNet: number;
    ordersCount: number;
    unitsSold: number;
}

@Injectable()
export class AnalyticsAggregatorService {
    private readonly logger = new Logger(AnalyticsAggregatorService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly policy: AnalyticsPolicyService,
        private readonly metrics: AnalyticsMetricsRegistry,
    ) {}

    /**
     * Полный rebuild daily layer'а за период `[periodFrom, periodTo]`
     * включительно.
     *
     * Используется:
     *   - nightly job'ом (rebuild «вчера»);
     *   - on-demand эндпоинтом `POST /analytics/daily/rebuild` (Owner/Admin)
     *     — подключение endpoint'а в analytics.controller через TASK_ANALYTICS_2.
     *
     * Tenant policy: rebuild блокируется при `TRIAL_EXPIRED / SUSPENDED /
     * CLOSED` (TASK_ANALYTICS_5) — `AnalyticsPolicyService.assertRebuildAllowed`.
     */
    async rebuildDailyRange(args: RebuildDailyArgs): Promise<RebuildDailyResult> {
        const { tenantId, periodFrom, periodTo } = args;
        const startedAt = Date.now();
        try {
            await this.policy.assertRebuildAllowed(tenantId);
        } catch (err) {
            if (err instanceof ForbiddenException) {
                this.metrics.increment(AnalyticsMetricNames.REBUILD_BLOCKED_BY_TENANT, {
                    tenantId,
                    target: 'daily',
                    reason: (err.getResponse() as any)?.message ?? 'PAUSED',
                });
            }
            throw err;
        }

        const fromDay = startOfUtcDay(periodFrom);
        const toDay = startOfUtcDay(periodTo);

        if (toDay < fromDay) {
            throw new BadRequestException({
                code: 'ANALYTICS_PERIOD_INVALID',
                message: 'periodTo must be >= periodFrom',
            });
        }

        const days = diffInDays(fromDay, toDay) + 1;
        if (days > ANALYTICS_MAX_PERIOD_DAYS) {
            throw new BadRequestException({
                code: 'ANALYTICS_PERIOD_TOO_LARGE',
                message: `period must be <= ${ANALYTICS_MAX_PERIOD_DAYS} days`,
            });
        }

        // Загружаем заказы за весь период одной выборкой — это дешевле,
        // чем N запросов по дням, и позволяет агрегировать в памяти.
        const periodEndExclusive = addDays(toDay, days);
        const orders = await this.prisma.marketplaceOrder.findMany({
            where: {
                tenantId,
                marketplaceCreatedAt: { gte: fromDay, lt: periodEndExclusive },
            },
            select: {
                marketplace: true,
                marketplaceCreatedAt: true,
                quantity: true,
                totalAmount: true,
                status: true,
                productSku: true,
            },
        });

        const buckets = this._bucketByDay(orders, fromDay, days);

        let rowsUpserted = 0;
        for (const [dayKey, kpi] of buckets.entries()) {
            await this.prisma.analyticsMaterializedDaily.upsert({
                where: { tenantId_date: { tenantId, date: new Date(dayKey) } },
                create: {
                    tenantId,
                    date: new Date(dayKey),
                    revenueGross: new Prisma.Decimal(kpi.revenueGross.toFixed(2)),
                    revenueNet: new Prisma.Decimal(kpi.revenueNet.toFixed(2)),
                    ordersCount: kpi.ordersCount,
                    unitsSold: kpi.unitsSold,
                    returnsCount: kpi.returnsCount,
                    avgCheck: new Prisma.Decimal(kpi.avgCheck.toFixed(2)),
                    byMarketplace: kpi.byMarketplace as unknown as Prisma.InputJsonValue,
                    formulaVersion: ANALYTICS_FORMULA_VERSION,
                    snapshotStatus: AnalyticsSnapshotStatus.READY,
                },
                update: {
                    revenueGross: new Prisma.Decimal(kpi.revenueGross.toFixed(2)),
                    revenueNet: new Prisma.Decimal(kpi.revenueNet.toFixed(2)),
                    ordersCount: kpi.ordersCount,
                    unitsSold: kpi.unitsSold,
                    returnsCount: kpi.returnsCount,
                    avgCheck: new Prisma.Decimal(kpi.avgCheck.toFixed(2)),
                    byMarketplace: kpi.byMarketplace as unknown as Prisma.InputJsonValue,
                    formulaVersion: ANALYTICS_FORMULA_VERSION,
                    snapshotStatus: AnalyticsSnapshotStatus.READY,
                },
            });
            rowsUpserted++;
        }

        const sourceFreshness = await this._evaluateOrdersFreshness(tenantId);
        const overallStatus = sourceFreshness.orders.isStale
            ? AnalyticsSnapshotStatus.STALE
            : AnalyticsSnapshotStatus.READY;

        // Прокинем sourceFreshness и snapshotStatus в строки последнего дня,
        // чтобы UI бейдж имел источник истины. Раньше мы писали READY на
        // каждой строке, потому что freshness может измениться между
        // rebuild'ами; сейчас этого достаточно для MVP.
        if (overallStatus === AnalyticsSnapshotStatus.STALE && rowsUpserted > 0) {
            await this.prisma.analyticsMaterializedDaily.updateMany({
                where: {
                    tenantId,
                    date: { gte: fromDay, lt: periodEndExclusive },
                },
                data: {
                    snapshotStatus: AnalyticsSnapshotStatus.STALE,
                    sourceFreshness: sourceFreshness as unknown as Prisma.InputJsonValue,
                },
            });
        }

        this.logger.log(
            `analytics daily rebuild tenant=${tenantId} from=${fromDay.toISOString().slice(0, 10)} ` +
                `to=${toDay.toISOString().slice(0, 10)} rows=${rowsUpserted} status=${overallStatus}`,
        );

        this.metrics.observeLatency(Date.now() - startedAt, {
            tenantId,
            target: 'daily',
            reason: overallStatus,
        });
        this.metrics.increment(AnalyticsMetricNames.DAILY_REBUILD_COUNT, {
            tenantId,
            target: 'daily',
            reason: overallStatus,
        });

        return {
            daysProcessed: days,
            rowsUpserted,
            formulaVersion: ANALYTICS_FORMULA_VERSION,
            snapshotStatus: overallStatus,
            sourceFreshness,
        };
    }

    /**
     * Раскладывает orders по календарным дням и считает KPI.
     * Создаёт пустые строки для дней без заказов — revenue dynamics
     * должен показывать ось X непрерывно.
     */
    private _bucketByDay(
        orders: Array<{
            marketplace: MarketplaceType;
            marketplaceCreatedAt: Date | null;
            quantity: number;
            totalAmount: number | null;
            status: string | null;
            productSku: string | null;
        }>,
        fromDay: Date,
        days: number,
    ): Map<string, DailyKpiRow> {
        const buckets = new Map<string, DailyKpiRow>();

        // Засеиваем нулями все дни диапазона.
        for (let i = 0; i < days; i++) {
            const day = addDays(fromDay, i);
            buckets.set(day.toISOString(), this._emptyKpi());
        }

        for (const o of orders) {
            if (!o.marketplaceCreatedAt) continue;
            const dayKey = startOfUtcDay(o.marketplaceCreatedAt).toISOString();
            const kpi = buckets.get(dayKey);
            if (!kpi) continue; // вне периода — на всякий случай

            const revenue = o.totalAmount ?? 0;
            const qty = o.quantity ?? 0;
            const isReturn = isReturnStatus(o.status);

            if (isReturn) {
                kpi.returnsCount += 1;
                // Возврат уменьшает revenueNet, но НЕ revenueGross —
                // §13 правило: gross остаётся «как продали», net учитывает
                // возвраты/удержания.
                kpi.revenueNet -= revenue;
                continue;
            }

            kpi.revenueGross += revenue;
            kpi.revenueNet += revenue; // в MVP без удержаний из marketplace fees
            kpi.ordersCount += 1;
            kpi.unitsSold += qty;

            const mpKey = String(o.marketplace);
            if (!kpi.byMarketplace[mpKey]) {
                kpi.byMarketplace[mpKey] = {
                    revenueGross: 0,
                    revenueNet: 0,
                    ordersCount: 0,
                    unitsSold: 0,
                };
            }
            const mp = kpi.byMarketplace[mpKey];
            mp.revenueGross += revenue;
            mp.revenueNet += revenue;
            mp.ordersCount += 1;
            mp.unitsSold += qty;
        }

        // Постобработка: avg_check = revenueNet / ordersCount.
        for (const kpi of buckets.values()) {
            kpi.avgCheck = kpi.ordersCount > 0 ? kpi.revenueNet / kpi.ordersCount : 0;
        }

        return buckets;
    }

    private _emptyKpi(): DailyKpiRow {
        const byMarketplace: Record<string, MarketplaceKpiBreakdown> = {};
        for (const mp of SUPPORTED_MARKETPLACES) {
            byMarketplace[String(mp)] = {
                revenueGross: 0,
                revenueNet: 0,
                ordersCount: 0,
                unitsSold: 0,
            };
        }
        return {
            revenueGross: 0,
            revenueNet: 0,
            ordersCount: 0,
            unitsSold: 0,
            returnsCount: 0,
            avgCheck: 0,
            byMarketplace,
        };
    }

    /**
     * Свежесть orders-источника: смотрим самый свежий
     * `marketplaceCreatedAt` по tenant'у и сравниваем с окном
     * `ANALYTICS_STALE_SOURCE_WINDOW_HOURS`.
     */
    private async _evaluateOrdersFreshness(tenantId: string): Promise<AnalyticsSourceFreshness> {
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

function diffInDays(a: Date, b: Date): number {
    return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

/** §13: статусы, которые мы считаем возвратом. Список консервативный —
 *  marketplace-специфичные коды: WB `canceled_by_client/canceled` и т.п. */
function isReturnStatus(status: string | null): boolean {
    if (!status) return false;
    const s = status.toLowerCase();
    return s.includes('return') || s.includes('cancel') || s.includes('возврат');
}
