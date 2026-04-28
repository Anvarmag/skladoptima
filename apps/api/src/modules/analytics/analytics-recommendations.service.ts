import { Injectable, Logger } from '@nestjs/common';
import {
    AnalyticsRecommendationPriority,
    AnalyticsRecommendationStatus,
    Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
    ANALYTICS_FORMULA_VERSION,
    ANALYTICS_REASON_CODES,
    ANALYTICS_RULE_KEYS,
    ANALYTICS_STALE_SOURCE_WINDOW_HOURS,
    AnalyticsReasonCode,
    AnalyticsRuleKey,
} from './analytics.constants';
import { AnalyticsPolicyService } from './analytics-policy.service';
import { AnalyticsMetricNames, AnalyticsMetricsRegistry } from './analytics.metrics';
import { ForbiddenException } from '@nestjs/common';

/**
 * Rule-based recommendations engine (TASK_ANALYTICS_4).
 *
 * §15 MVP правило: рекомендации остаются `rule-based read-only`.
 * Пользовательский workflow `dismiss/applied` НЕ внедряется. `status`
 * выставляет ТОЛЬКО engine: `ACTIVE` при срабатывании, `DISMISSED` при
 * автоматическом устаревании сигнала (например, остаток пополнен).
 *
 * §20 правило explainability: каждый сигнал несёт `ruleKey` (правило),
 * `reasonCode` (почему именно сработало), `payload` (контекст для UI),
 * `formulaVersion` (версия набора правил). Magic strings запрещены —
 * всё через константы из `analytics.constants`.
 *
 * §15 идемпотентность через UPSERT по UNIQUE`(tenantId, productId,
 * ruleKey)` — повторный refresh обновляет существующий сигнал, а не
 * плодит дубли.
 *
 * Tenant-state guard (`TRIAL_EXPIRED / SUSPENDED / CLOSED` блокирует
 * refresh) — TASK_ANALYTICS_5; здесь сервис не знает о tenant policy.
 */

/** Порог «низкий рейтинг» (§13 правило MVP). */
const LOW_RATING_THRESHOLD = 4;
/** Окно days_remaining ниже которого срабатывают LOW_STOCK правила. */
const STOCK_DAYS_HIGH_PRIORITY = 7;
const STOCK_DAYS_MEDIUM_PRIORITY = 14;
/** Окно «свежих» продаж для расчёта daily velocity. */
const SALES_WINDOW_DAYS = 30;

export interface RefreshRecommendationsArgs {
    tenantId: string;
    /** ISO date — «сегодня», для тестов; default = now(). */
    asOf?: Date;
}

export interface RefreshRecommendationsResult {
    formulaVersion: string;
    activated: number;
    dismissed: number;
    totalActive: number;
    byRule: Record<string, number>;
}

export interface RecommendationDto {
    id: string;
    productId: string | null;
    sku: string | null;
    name: string | null;
    ruleKey: string;
    reasonCode: string;
    priority: AnalyticsRecommendationPriority;
    status: AnalyticsRecommendationStatus;
    message: string;
    payload: unknown;
    formulaVersion: string;
    createdAt: string;
    updatedAt: string;
    resolvedAt: string | null;
}

interface CandidateSignal {
    productId: string | null;
    ruleKey: AnalyticsRuleKey;
    reasonCode: AnalyticsReasonCode;
    priority: AnalyticsRecommendationPriority;
    message: string;
    payload: Record<string, unknown>;
}

@Injectable()
export class AnalyticsRecommendationsService {
    private readonly logger = new Logger(AnalyticsRecommendationsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly policy: AnalyticsPolicyService,
        private readonly metrics: AnalyticsMetricsRegistry,
    ) {}

    /**
     * Прогон всех правил по tenant'у. Идемпотентно перетряхивает
     * `AnalyticsRecommendation`:
     *   - новые сигналы → upsert `ACTIVE`;
     *   - устаревшие активные сигналы (правило больше не срабатывает) →
     *     `DISMISSED` + `resolvedAt = now`;
     *   - полностью отсутствующие в кандидатах → не трогаются (могут быть
     *     уже DISMISSED ранее).
     *
     * Tenant policy: refresh блокируется при `TRIAL_EXPIRED / SUSPENDED /
     * CLOSED` (TASK_ANALYTICS_5).
     */
    async refresh(args: RefreshRecommendationsArgs): Promise<RefreshRecommendationsResult> {
        const { tenantId } = args;
        try {
            await this.policy.assertRebuildAllowed(tenantId);
        } catch (err) {
            if (err instanceof ForbiddenException) {
                this.metrics.increment(AnalyticsMetricNames.REBUILD_BLOCKED_BY_TENANT, {
                    tenantId,
                    target: 'recommendations',
                    reason: (err.getResponse() as any)?.message ?? 'PAUSED',
                });
            }
            throw err;
        }
        const asOf = args.asOf ?? new Date();

        const candidates = await this._evaluateRules(tenantId, asOf);

        // Текущие активные сигналы — для определения «устаревших».
        const activeBefore = await this.prisma.analyticsRecommendation.findMany({
            where: { tenantId, status: AnalyticsRecommendationStatus.ACTIVE },
            select: { id: true, productId: true, ruleKey: true },
        });
        const activeKey = (productId: string | null, ruleKey: string) =>
            `${productId ?? '*'}::${ruleKey}`;
        const candidateKeys = new Set(
            candidates.map((c) => activeKey(c.productId, c.ruleKey)),
        );

        const byRule: Record<string, number> = {};
        let activated = 0;

        for (const c of candidates) {
            byRule[c.ruleKey] = (byRule[c.ruleKey] ?? 0) + 1;
            await this.prisma.analyticsRecommendation.upsert({
                where: {
                    tenantId_productId_ruleKey: {
                        tenantId,
                        productId: c.productId as string,
                        ruleKey: c.ruleKey,
                    },
                },
                create: {
                    tenantId,
                    productId: c.productId,
                    ruleKey: c.ruleKey,
                    reasonCode: c.reasonCode,
                    priority: c.priority,
                    status: AnalyticsRecommendationStatus.ACTIVE,
                    message: c.message,
                    payload: c.payload as unknown as Prisma.InputJsonValue,
                    formulaVersion: ANALYTICS_FORMULA_VERSION,
                },
                update: {
                    reasonCode: c.reasonCode,
                    priority: c.priority,
                    status: AnalyticsRecommendationStatus.ACTIVE,
                    message: c.message,
                    payload: c.payload as unknown as Prisma.InputJsonValue,
                    formulaVersion: ANALYTICS_FORMULA_VERSION,
                    resolvedAt: null,
                },
            });
            activated += 1;
        }

        // Деактивируем активные сигналы, которые больше не в кандидатах.
        const stale = activeBefore.filter(
            (a) => !candidateKeys.has(activeKey(a.productId, a.ruleKey)),
        );
        if (stale.length > 0) {
            await this.prisma.analyticsRecommendation.updateMany({
                where: { id: { in: stale.map((s) => s.id) } },
                data: {
                    status: AnalyticsRecommendationStatus.DISMISSED,
                    resolvedAt: asOf,
                },
            });
        }

        const totalActive = candidates.length;

        this.logger.log(
            `analytics recommendations refresh tenant=${tenantId} ` +
                `activated=${activated} dismissed=${stale.length} total=${totalActive}`,
        );

        // §19 metric: распределение по правилам — UI/observability видят
        // какое правило сработало чаще всего.
        for (const [ruleKey, count] of Object.entries(byRule)) {
            this.metrics.increment(
                AnalyticsMetricNames.RECOMMENDATIONS_GENERATED,
                { tenantId, target: 'recommendations', ruleKey },
                count,
            );
        }
        if (stale.length > 0) {
            this.metrics.increment(
                AnalyticsMetricNames.RECOMMENDATIONS_DISMISSED,
                { tenantId, target: 'recommendations', reason: 'engine_auto_dismiss' },
                stale.length,
            );
        }

        return {
            formulaVersion: ANALYTICS_FORMULA_VERSION,
            activated,
            dismissed: stale.length,
            totalActive,
            byRule,
        };
    }

    /**
     * Read для UI / `GET /analytics/recommendations`. Возвращает только
     * `ACTIVE`, отсортированные по приоритету (HIGH → MEDIUM → LOW) и
     * времени создания.
     */
    async list(
        tenantId: string,
        opts: { priority?: AnalyticsRecommendationPriority; limit?: number } = {},
    ): Promise<RecommendationDto[]> {
        const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
        const items = await this.prisma.analyticsRecommendation.findMany({
            where: {
                tenantId,
                status: AnalyticsRecommendationStatus.ACTIVE,
                ...(opts.priority ? { priority: opts.priority } : {}),
            },
            orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
            take: limit,
        });

        if (items.length === 0) return [];

        const productIds = items
            .map((i) => i.productId)
            .filter((id): id is string => !!id);
        const products = productIds.length
            ? await this.prisma.product.findMany({
                  where: { id: { in: productIds } },
                  select: { id: true, sku: true, name: true },
              })
            : [];
        const byId = new Map(products.map((p) => [p.id, p]));

        return items.map((i) => {
            const p = i.productId ? byId.get(i.productId) : undefined;
            return {
                id: i.id,
                productId: i.productId,
                sku: p?.sku ?? null,
                name: p?.name ?? null,
                ruleKey: i.ruleKey,
                reasonCode: i.reasonCode,
                priority: i.priority,
                status: i.status,
                message: i.message,
                payload: i.payload,
                formulaVersion: i.formulaVersion,
                createdAt: i.createdAt.toISOString(),
                updatedAt: i.updatedAt.toISOString(),
                resolvedAt: i.resolvedAt ? i.resolvedAt.toISOString() : null,
            };
        });
    }

    // ─── private rule evaluation ──────────────────────────────────────

    private async _evaluateRules(
        tenantId: string,
        asOf: Date,
    ): Promise<CandidateSignal[]> {
        const signals: CandidateSignal[] = [];

        // 1. Tenant-wide STALE_ANALYTICS_SOURCE.
        const staleSignal = await this._evaluateStaleSource(tenantId, asOf);
        if (staleSignal) signals.push(staleSignal);

        // 2. Per-SKU правила.
        const products = await this.prisma.product.findMany({
            where: { tenantId, deletedAt: null },
            select: { id: true, sku: true, name: true, rating: true },
        });
        if (products.length === 0) return signals;

        // Загружаем 30-дневные продажи одной выборкой для всех SKU.
        const since = new Date(asOf);
        since.setUTCDate(since.getUTCDate() - SALES_WINDOW_DAYS);
        const grouped = await this.prisma.marketplaceOrder.groupBy({
            by: ['productSku'],
            where: {
                tenantId,
                marketplaceCreatedAt: { gte: since },
                NOT: { productSku: null },
            },
            _sum: { quantity: true },
        });
        const qtyBySku = new Map<string, number>();
        for (const g of grouped) {
            if (g.productSku) qtyBySku.set(g.productSku, g._sum.quantity ?? 0);
        }

        // Остатки по всем продуктам — суммируем `available` по складам.
        const stocks = await this.prisma.stockBalance.findMany({
            where: { tenantId, productId: { in: products.map((p) => p.id) } },
            select: { productId: true, available: true, reserved: true, onHand: true },
        });
        const stockByProduct = new Map<string, number>();
        for (const s of stocks) {
            const total = (s.available ?? 0) > 0 ? s.available : Math.max(0, s.onHand - s.reserved);
            stockByProduct.set(s.productId, (stockByProduct.get(s.productId) ?? 0) + total);
        }

        for (const p of products) {
            const sold30 = qtyBySku.get(p.sku) ?? 0;
            const stock = stockByProduct.get(p.id) ?? 0;
            const dailyVelocity = sold30 / SALES_WINDOW_DAYS;
            const daysRemaining = dailyVelocity > 0 ? Math.floor(stock / dailyVelocity) : null;

            // 2.1 LOW_STOCK_HIGH_DEMAND.
            if (stock > 0 && daysRemaining !== null) {
                if (daysRemaining < STOCK_DAYS_HIGH_PRIORITY) {
                    signals.push({
                        productId: p.id,
                        ruleKey: ANALYTICS_RULE_KEYS.LOW_STOCK_HIGH_DEMAND,
                        reasonCode: ANALYTICS_REASON_CODES.STOCK_BELOW_7_DAYS,
                        priority: AnalyticsRecommendationPriority.HIGH,
                        message: `Остаток ${p.sku} закончится через ${daysRemaining} дн. Срочно пополнить.`,
                        payload: {
                            stock,
                            sold30,
                            dailyVelocity: round2(dailyVelocity),
                            daysRemaining,
                            window: STOCK_DAYS_HIGH_PRIORITY,
                        },
                    });
                } else if (daysRemaining < STOCK_DAYS_MEDIUM_PRIORITY) {
                    signals.push({
                        productId: p.id,
                        ruleKey: ANALYTICS_RULE_KEYS.LOW_STOCK_HIGH_DEMAND,
                        reasonCode: ANALYTICS_REASON_CODES.STOCK_BELOW_14_DAYS,
                        priority: AnalyticsRecommendationPriority.MEDIUM,
                        message: `Остаток ${p.sku} закончится через ${daysRemaining} дн. Запланировать поставку.`,
                        payload: {
                            stock,
                            sold30,
                            dailyVelocity: round2(dailyVelocity),
                            daysRemaining,
                            window: STOCK_DAYS_MEDIUM_PRIORITY,
                        },
                    });
                }
            }

            // 2.2 LOW_RATING.
            if (p.rating !== null && p.rating !== undefined && p.rating > 0 && p.rating < LOW_RATING_THRESHOLD) {
                signals.push({
                    productId: p.id,
                    ruleKey: ANALYTICS_RULE_KEYS.LOW_RATING,
                    reasonCode: ANALYTICS_REASON_CODES.RATING_BELOW_4,
                    priority: AnalyticsRecommendationPriority.MEDIUM,
                    message: `Низкий рейтинг ${p.sku}: ${p.rating}. Проверить отзывы.`,
                    payload: {
                        rating: p.rating,
                        threshold: LOW_RATING_THRESHOLD,
                    },
                });
            }
        }

        return signals;
    }

    private async _evaluateStaleSource(
        tenantId: string,
        asOf: Date,
    ): Promise<CandidateSignal | null> {
        const last = await this.prisma.marketplaceOrder.findFirst({
            where: { tenantId, NOT: { marketplaceCreatedAt: null } },
            orderBy: { marketplaceCreatedAt: 'desc' },
            select: { marketplaceCreatedAt: true },
        });
        if (!last?.marketplaceCreatedAt) return null;
        const ageHours =
            (asOf.getTime() - last.marketplaceCreatedAt.getTime()) / (60 * 60 * 1000);
        if (ageHours <= ANALYTICS_STALE_SOURCE_WINDOW_HOURS) return null;
        return {
            productId: null,
            ruleKey: ANALYTICS_RULE_KEYS.STALE_ANALYTICS_SOURCE,
            reasonCode: ANALYTICS_REASON_CODES.SOURCE_STALE_OVER_24H,
            priority: AnalyticsRecommendationPriority.MEDIUM,
            message: `Источник заказов не обновлялся ${Math.round(ageHours)} ч. Проверить sync.`,
            payload: {
                lastEventAt: last.marketplaceCreatedAt.toISOString(),
                ageHours: Math.round(ageHours),
                windowHours: ANALYTICS_STALE_SOURCE_WINDOW_HOURS,
            },
        };
    }
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}
