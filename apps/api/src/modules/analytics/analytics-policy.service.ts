import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AccessState, AnalyticsSnapshotStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ANALYTICS_STALE_SOURCE_WINDOW_HOURS } from './analytics.constants';

/**
 * Centralized policy enforcement для analytics domain (TASK_ANALYTICS_5).
 *
 * Зачем отдельный сервис, а не разрозненные проверки в aggregator/abc/
 * recommendations/export:
 *
 *   1. **Single source of truth по AccessState ⇒ behaviour.** Все
 *      analytics операции, изменяющие состояние (rebuild daily / abc /
 *      recommendations refresh, future nightly cron), обязаны проходить
 *      через один guard, чтобы расхождения с `02-tenant` access policy
 *      ловились в одном месте. Совместимо с `FinancePolicyService` —
 *      одинаковый набор PAUSED состояний и одинаковая семантика 403.
 *
 *   2. **No backdoor integration refresh** — §13 + §20 риск: analytics
 *      слой НЕ должен инициировать sync во внешний API маркетплейсов.
 *      Constant `ANALYTICS_FORBIDS_INTEGRATION_REFRESH=true` зафиксирован
 *      как load-bearing документация — spec проверяет что код не зовёт
 *      sync runner.
 *
 *   3. **Source contracts** — `ANALYTICS_SOURCE_OF_TRUTH` фиксирует
 *      машинно-проверяемой константой, какая витрина читает какие
 *      таблицы. Любая попытка добавить «обходной» источник (например,
 *      смешать `MarketplaceReport` с orders для daily layer'а) сразу
 *      падает на регрессионном spec'е.
 *
 *   4. **Stale vs incomplete distinction** (§19 stale-vs-incomplete
 *      board) — отдельная функция `evaluateStaleness()`, отдающая
 *      structured verdict, чтобы UI и API одинаково различали ситуации.
 *
 * Контракт для caller'ов:
 *   - `assertRebuildAllowed(tenantId)` — кидает 403 при paused, иначе
 *     возвращает `accessState`. Лог `analytics_rebuild_blocked` пишет
 *     сам сервис, caller не дублирует.
 *   - `isReadAllowed(tenantId)` — read-доступ к существующим snapshot
 *     остаётся даже при `CLOSED` (§4 сценарий 4: история read-only
 *     до retention-удаления).
 *   - `evaluateStaleness({sourceFreshness, snapshotStatus})` — чистая
 *     функция над snapshot meta'ой, отдаёт `{isStale, isIncomplete,
 *     classification}`.
 */

// ─── Source-of-truth contracts (§13) ─────────────────────────────────

/**
 * Машинно-описанный контракт источников для каждой витрины analytics.
 * Это документация + база для regression spec'а: если кто-то поменяет
 * loader на «обходной» источник, тест на ANALYTICS_SOURCE_OF_TRUTH
 * сразу падает.
 */
export const ANALYTICS_SOURCE_OF_TRUTH = {
    daily_layer: 'MarketplaceOrder (нормализованные заказы) — НЕ raw marketplace API',
    abc_snapshot: 'MarketplaceOrder + Product — нормализованные заказы, НЕ raw API',
    recommendations_low_stock: 'StockBalance + MarketplaceOrder — нормализованные источники',
    recommendations_low_rating: 'Product.rating — нормализованный каталог',
    recommendations_stale: 'MarketplaceOrder.marketplaceCreatedAt — нормализованный feed, НЕ raw ping',
    export: 'AnalyticsMaterializedDaily / AnalyticsAbcSnapshot — materialized, НЕ live OLTP',
    status: 'Aggregate of materialized views — НЕ raw marketplace API ping',
} as const;

/**
 * §13 + §20: analytics НИКОГДА не инициирует integration refresh.
 * Этот флаг — документация и точка регрессионного теста (поиск вызовов
 * `syncRunner` / `marketplaceClient` в analytics модулях запрещён).
 */
export const ANALYTICS_FORBIDS_INTEGRATION_REFRESH = true as const;

// ─── Tenant state policy ─────────────────────────────────────────────

const PAUSED_TENANT_STATES: ReadonlySet<AccessState> = new Set([
    AccessState.TRIAL_EXPIRED,
    AccessState.SUSPENDED,
    AccessState.CLOSED,
]);

// ─── Public types ────────────────────────────────────────────────────

export interface SnapshotFreshnessVerdict {
    /** Хотя бы один source за пределами ANALYTICS_STALE_SOURCE_WINDOW_HOURS. */
    isStale: boolean;
    /** snapshotStatus === INCOMPLETE — недостаточно данных для классификации. */
    isIncomplete: boolean;
    /**
     * §19 stale-vs-incomplete board:
     *   - `FRESH_AND_COMPLETE` — снапшот можно показывать без disclaimers;
     *   - `STALE_BUT_COMPLETE` — старые источники, но KPI вычислены;
     *   - `INCOMPLETE_BUT_FRESH` — данные свежие, но missing critical;
     *   - `STALE_AND_INCOMPLETE` — обе проблемы; UI рендерит максимум
     *     warnings, но НЕ скрывает данные (§14 + §16).
     */
    classification:
        | 'FRESH_AND_COMPLETE'
        | 'STALE_BUT_COMPLETE'
        | 'INCOMPLETE_BUT_FRESH'
        | 'STALE_AND_INCOMPLETE';
}

@Injectable()
export class AnalyticsPolicyService {
    private readonly logger = new Logger(AnalyticsPolicyService.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * §10 — rebuild запрещён при TRIAL_EXPIRED/SUSPENDED/CLOSED.
     * Кидает `403 ANALYTICS_REBUILD_BLOCKED_BY_TENANT_STATE`. Также
     * пишет structured лог `analytics_rebuild_blocked` для §19 dashboards.
     *
     * Возвращает `accessState` для caller'ов, которым нужно знать
     * текущее состояние (например, snapshot service может пометить
     * payload metadata).
     */
    async assertRebuildAllowed(tenantId: string): Promise<AccessState> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { accessState: true },
        });
        if (!tenant) {
            this._logBlock(tenantId, 'tenant_not_found', null);
            throw new ForbiddenException({
                code: 'ANALYTICS_REBUILD_BLOCKED_BY_TENANT_STATE',
                message: 'Tenant not found',
            });
        }
        if (PAUSED_TENANT_STATES.has(tenant.accessState)) {
            this._logBlock(tenantId, 'paused_tenant', tenant.accessState);
            throw new ForbiddenException({
                code: 'ANALYTICS_REBUILD_BLOCKED_BY_TENANT_STATE',
                message: `Tenant accessState=${tenant.accessState} blocks rebuild`,
            });
        }
        return tenant.accessState;
    }

    /**
     * §4 сценарий 4: read-доступ к существующим snapshot остаётся
     * **даже при CLOSED** (история read-only до retention-удаления).
     * Возвращает true если tenant существует. Здесь для консистентности
     * и future-policy hook'а (post-retention CLOSED → false).
     */
    async isReadAllowed(tenantId: string): Promise<boolean> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true },
        });
        return !!tenant;
    }

    /**
     * Чистая функция — различает `fresh / stale / incomplete` для UI и
     * API. Не дёргает БД. Совместима с aggregator'ом TASK_ANALYTICS_2 и
     * abc-сервисом TASK_ANALYTICS_3 (одинаковая структура `sourceFreshness`).
     */
    evaluateStaleness(args: {
        sourceFreshness: { orders?: { isStale: boolean } } | null | undefined;
        snapshotStatus:
            | AnalyticsSnapshotStatus
            | 'READY'
            | 'STALE'
            | 'INCOMPLETE'
            | 'FAILED'
            | string;
    }): SnapshotFreshnessVerdict {
        const isStale =
            !!args.sourceFreshness?.orders?.isStale ||
            args.snapshotStatus === AnalyticsSnapshotStatus.STALE ||
            args.snapshotStatus === 'STALE';
        const isIncomplete =
            args.snapshotStatus === AnalyticsSnapshotStatus.INCOMPLETE ||
            args.snapshotStatus === 'INCOMPLETE';

        let classification: SnapshotFreshnessVerdict['classification'];
        if (isStale && isIncomplete) classification = 'STALE_AND_INCOMPLETE';
        else if (isStale) classification = 'STALE_BUT_COMPLETE';
        else if (isIncomplete) classification = 'INCOMPLETE_BUT_FRESH';
        else classification = 'FRESH_AND_COMPLETE';

        return { isStale, isIncomplete, classification };
    }

    /**
     * Вспомогательная функция: применяет одинаковое правило isStale к
     * raw `lastEventAt`. Используется в loader'ах aggregator/abc, чтобы
     * единая константа `ANALYTICS_STALE_SOURCE_WINDOW_HOURS` не
     * расползалась по сервисам.
     */
    static isLastEventStale(lastEventAt: Date | null, asOf: Date = new Date()): boolean {
        if (!lastEventAt) return false;
        return (
            asOf.getTime() - lastEventAt.getTime() >
            ANALYTICS_STALE_SOURCE_WINDOW_HOURS * 60 * 60 * 1000
        );
    }

    private _logBlock(
        tenantId: string,
        reason: string,
        accessState: AccessState | null,
    ) {
        this.logger.warn(
            JSON.stringify({
                event: 'analytics_rebuild_blocked',
                tenantId,
                reason,
                accessState,
                ts: new Date().toISOString(),
            }),
        );
    }
}
