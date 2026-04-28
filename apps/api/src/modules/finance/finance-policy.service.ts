import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { AccessState } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Centralized policy enforcement для finance domain (TASK_FINANCE_5).
 *
 * Зачем отдельный сервис, а не разрозненные проверки в snapshot/cost-
 * profile/legacy:
 *
 *   1. **Single source of truth по AccessState ⇒ behaviour.** Все
 *      finance операции (rebuild, write cost, future warning resolution
 *      job) обязаны проходить через один guard, чтобы расхождения с
 *      `02-tenant` access policy ловились в одном месте.
 *
 *   2. **Source-of-truth contract** — `MANUAL_COST_FIELDS_WHITELIST` и
 *      `assertManualCostInputAllowed` выражают §13 правило источников
 *      истины как машинно-проверяемый код, а не комментарий. Любая
 *      попытка добавить, например, `marketplaceFees` в whitelist
 *      сразу падает на регрессионном spec'е (см. finance-policy.spec.ts).
 *
 *   3. **Stale vs incomplete distinction** (§14 + §128 UI правило)
 *      зафиксирована как `evaluateStaleness()` — отдельная функция,
 *      возвращающая структурированный verdict, чтобы UI и API могли
 *      одинаково различать «снапшот свежий, но missing critical» и
 *      «снапшот построен, но источники старые».
 *
 * Контракт для caller'ов:
 *   - `assertRebuildAllowed(tenantId)` — кидает 403 при paused, иначе
 *     возвращает `accessState`. Лог `finance_rebuild_blocked` пишет
 *     сам сервис, caller не дублирует.
 *   - `isReadAllowed(tenantId)` — read-доступ к существующим snapshot
 *     остаётся даже при `CLOSED` (§4 сценарий 4: история read-only до
 *     retention-удаления). Возвращает boolean без exception'ов.
 *   - `assertManualCostInputAllowed(field)` — runtime-валидация любых
 *     попыток ручного ввода. Используется в cost-profile service.
 *   - `evaluateStaleness(sourceFreshness)` — чистая функция над
 *     payload'ом snapshot'а, отдаёт `{isStale, isIncomplete, classification}`.
 */

// ─── Source-of-truth policy constants ───────────────────────────────

/**
 * §10 + §13 + §20 риск: **единственный** разрешённый whitelist полей,
 * которые можно вводить вручную через PATCH. Любая попытка расширения
 * этого набора (revenue, marketplace fees, periodic charges, etc.)
 * нарушает §13 ("manual input в MVP допускается только для product-
 * level cost profile, а не для подмены marketplace revenue/fees").
 *
 * Этот массив — **load-bearing**: spec `finance-policy.spec.ts`
 * содержит явный assertion на его содержимое, чтобы случайное
 * расширение whitelist в будущем падало на regression-тесте.
 */
export const MANUAL_COST_FIELDS_WHITELIST = [
    'baseCost',
    'packagingCost',
    'additionalCost',
    'costCurrency',
] as const;
export type ManualCostField = typeof MANUAL_COST_FIELDS_WHITELIST[number];

/**
 * §13 правило источников истины — машинно-описанные источники для
 * каждой категории числа. Это не runtime-проверяется (loader сам
 * читает из правильных таблиц), но служит документацией и базой для
 * spec-теста о том, что loader не использует "неправильную" таблицу.
 */
export const FINANCE_SOURCE_OF_TRUTH = {
    revenue: 'Order/OrderItem (нормализованный orders domain)',
    soldQty: 'Order/OrderItem (нормализованный orders domain)',
    marketplaceFees: 'MarketplaceReport (sync-driven feed)',
    logistics: 'MarketplaceReport (sync-driven feed)',
    returnsImpact: 'MarketplaceReport (sync-driven feed)',
    baseCost: 'ProductFinanceProfile (manual input only)',
    packagingCost: 'ProductFinanceProfile (manual input only)',
    additionalCost: 'ProductFinanceProfile (manual input only)',
    taxImpact: 'TenantSettings.taxSystem (computed, не manual)',
    adsCost: 'Future: ads feed; в MVP всегда null с MISSING_ADS_COST warning',
} as const;

// ─── Tenant state policy ────────────────────────────────────────────

const PAUSED_TENANT_STATES: ReadonlySet<AccessState> = new Set([
    AccessState.TRIAL_EXPIRED,
    AccessState.SUSPENDED,
    AccessState.CLOSED,
]);

/**
 * Stale source freshness threshold. Окно, после которого источник
 * помечается `isStale=true`. Согласовано с TASK_FINANCE_3 loader'ом —
 * единственный источник этой константы теперь здесь.
 */
export const STALE_SOURCE_WINDOW_HOURS = 48;

// ─── Public types ───────────────────────────────────────────────────

export interface SnapshotFreshnessVerdict {
    /** Хотя бы один source за пределами STALE_SOURCE_WINDOW_HOURS. */
    isStale: boolean;
    /** snapshotStatus === INCOMPLETE — критичные cost/fees/logistics missing. */
    isIncomplete: boolean;
    /**
     * Сводный classification:
     *   - `FRESH_AND_COMPLETE` — снапшот можно показывать без disclaimers;
     *   - `STALE_BUT_COMPLETE` — старые источники, но cost-структура полная;
     *   - `INCOMPLETE_BUT_FRESH` — данные свежие, но missing critical;
     *   - `STALE_AND_INCOMPLETE` — обе проблемы; UI рендерит максимум warnings.
     *
     * Это §128 UI правило в одной enum-строке: incomplete data ≠
     * stale snapshot, и UX обязан их различать.
     */
    classification:
        | 'FRESH_AND_COMPLETE'
        | 'STALE_BUT_COMPLETE'
        | 'INCOMPLETE_BUT_FRESH'
        | 'STALE_AND_INCOMPLETE';
}

@Injectable()
export class FinancePolicyService {
    private readonly logger = new Logger(FinancePolicyService.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * §10 — rebuild запрещён при TRIAL_EXPIRED/SUSPENDED/CLOSED. Кидает
     * `403 FINANCE_REBUILD_BLOCKED_BY_TENANT_STATE`. Также пишет
     * structured лог `finance_rebuild_blocked` для §19 dashboards.
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
                code: 'FINANCE_REBUILD_BLOCKED_BY_TENANT_STATE',
                message: 'Tenant not found',
            });
        }
        if (PAUSED_TENANT_STATES.has(tenant.accessState)) {
            this._logBlock(tenantId, 'paused_tenant', tenant.accessState);
            throw new ForbiddenException({
                code: 'FINANCE_REBUILD_BLOCKED_BY_TENANT_STATE',
                message: `Tenant accessState=${tenant.accessState} blocks rebuild`,
            });
        }
        return tenant.accessState;
    }

    /**
     * §4 сценарий 4: read-доступ к существующим snapshot остаётся
     * **даже при CLOSED** (история read-only до retention-удаления).
     * Эта функция возвращает true всегда, если tenant существует —
     * она здесь для консистентности и future-policy hook'а (например,
     * post-retention CLOSED → false).
     */
    async isReadAllowed(tenantId: string): Promise<boolean> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true },
        });
        return !!tenant;
    }

    /**
     * Runtime-проверка whitelist полей для PATCH cost. Любая попытка
     * передать поле вне whitelist (revenue, marketplaceFees, periodic
     * expenses) → 403 `MANUAL_INPUT_NOT_ALLOWED`. Это §13 правило
     * "manual input в MVP допускается только для product-level cost
     * profile" в виде защиты, а не комментария.
     */
    assertManualCostInputAllowed(field: string): asserts field is ManualCostField {
        if (!(MANUAL_COST_FIELDS_WHITELIST as readonly string[]).includes(field)) {
            throw new ForbiddenException({
                code: 'MANUAL_INPUT_NOT_ALLOWED',
                message: `Manual input for field "${field}" is not allowed in MVP. ` +
                    `Whitelist: ${MANUAL_COST_FIELDS_WHITELIST.join(', ')}`,
            });
        }
    }

    /**
     * Чистая функция для UI/API — различает stale/incomplete.
     * `sourceFreshness` ожидается в формате, который пишет
     * `FinanceSnapshotService._computeSourceFreshness` (TASK_FINANCE_3).
     */
    evaluateStaleness(args: {
        sourceFreshness: { orders?: { isStale: boolean }; fees?: { isStale: boolean } } | null;
        snapshotStatus: 'READY' | 'INCOMPLETE' | 'FAILED' | string;
    }): SnapshotFreshnessVerdict {
        const isStale =
            !!args.sourceFreshness?.orders?.isStale ||
            !!args.sourceFreshness?.fees?.isStale;
        const isIncomplete = args.snapshotStatus === 'INCOMPLETE';

        let classification: SnapshotFreshnessVerdict['classification'];
        if (isStale && isIncomplete) classification = 'STALE_AND_INCOMPLETE';
        else if (isStale) classification = 'STALE_BUT_COMPLETE';
        else if (isIncomplete) classification = 'INCOMPLETE_BUT_FRESH';
        else classification = 'FRESH_AND_COMPLETE';

        return { isStale, isIncomplete, classification };
    }

    private _logBlock(tenantId: string, reason: string, accessState: AccessState | null) {
        this.logger.warn(JSON.stringify({
            event: 'finance_rebuild_blocked',
            tenantId,
            reason,
            accessState,
            ts: new Date().toISOString(),
        }));
    }
}
