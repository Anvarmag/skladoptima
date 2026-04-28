import { Injectable, Logger } from '@nestjs/common';
import {
    FinanceSnapshotStatus,
    FinanceWarningType,
    Prisma,
} from '@prisma/client';

/**
 * Версия формулы расчёта unit-economics. См. 11-finance system-analytics
 * §14 + §20 риск non-reproducible reports: любой smysловой ребайнд
 * формулы (например, изменили вычитание/добавление компонента) обязан
 * инкрементировать версию. Старые snapshot'ы хранят свой `formulaVersion`
 * — UI рендерит исторические периоды стабильно.
 *
 * Формат строки: `mvp-v<major>` для базы; `mvp-v1.1`, `mvp-v2` и т.д.
 * для последующих ревизий. Сравнение строкой, не SemVer-диффом, чтобы
 * не разрешать "auto-upgrade" — это всегда осознанное решение.
 */
export const FINANCE_FORMULA_VERSION = 'mvp-v1' as const;

/**
 * Чистый калькулятор юнит-экономики (TASK_FINANCE_2). Никакой работы с БД
 * — только агрегация уже подгруженных входов. Это даёт три преимущества:
 *
 *   1. **Воспроизводимость (§12 DoD)**: одинаковые входы → одинаковый
 *      результат. Можно прогнать формулу на исторических snapshot.payload
 *      без обращения к live `orders` и убедиться, что мы не сломали
 *      обратную совместимость.
 *   2. **Тестируемость**: spec покрывает все ветки без mock'ов Prisma.
 *   3. **Composability**: snapshot job (TASK_FINANCE_4) и runtime
 *      `unit-economics` endpoint используют один и тот же calculator —
 *      никакого drift'а между двумя расчётами.
 *
 * Что НЕ делает (намеренно — следующие задачи модуля):
 *   - не ходит в БД (этим занимается loader в TASK_FINANCE_3 / nightly
 *     job в TASK_FINANCE_4);
 *   - не пишет snapshot и не сохраняет warning'и в `FinanceDataWarning`
 *     (это зона `FinanceSnapshotService` из TASK_FINANCE_4);
 *   - не вызывает inventory или sync — только pure computation.
 */

// ─── Public types ───────────────────────────────────────────────────

/** Per-SKU вход для расчёта (loader подготовит). */
export interface SkuFinanceInput {
    productId: string;
    sku: string;
    soldQty: number;
    /** Сумма выручки, нормализованная из `orders.totalAmount`. */
    revenue: number;

    // Cost profile (любое из полей может быть null = не задано).
    baseCost: number | null;
    packagingCost: number | null;
    additionalCost: number | null;

    /** Marketplace fees per SKU за период. NULL = источник отсутствует. */
    marketplaceFees: number | null;
    /** Logistics per SKU. NULL = источник отсутствует. */
    logistics: number | null;

    // Optional improving inputs (§14: не блокируют расчёт, только warning).
    adsCost: number | null;
    returnsImpact: number | null;
    taxImpact: number | null;
}

/** Per-SKU результат расчёта. */
export interface SkuFinanceResult {
    productId: string;
    sku: string;
    soldQty: number;

    revenue: number;
    cogs: number;
    marketplaceFees: number;
    logistics: number;
    adsCost: number;
    returnsImpact: number;
    taxImpact: number;
    additionalCharges: number;

    profit: number;
    /** Pct, два знака после запятой. null если revenue=0 (деление на ноль). */
    marginPct: number | null;
    /** Pct, два знака после запятой. null если cogs=0. */
    roiPct: number | null;

    /** §14 правило неполного расчёта: missing критичный → isIncomplete=true. */
    isIncomplete: boolean;
    warnings: FinanceWarningType[];
}

/** Сводный результат периода (для snapshot.payload и unit-economics list). */
export interface FinanceCalculationOutput {
    formulaVersion: string;
    snapshotStatus: FinanceSnapshotStatus;
    items: SkuFinanceResult[];
    totals: {
        revenue: number;
        cogs: number;
        marketplaceFees: number;
        logistics: number;
        adsCost: number;
        returnsImpact: number;
        taxImpact: number;
        additionalCharges: number;
        profit: number;
        marginPct: number | null;
        roiPct: number | null;
        skuCount: number;
        incompleteSkuCount: number;
    };
    /** Уникальный набор warning-типов по всему периоду — для §19 алертов. */
    aggregatedWarnings: FinanceWarningType[];
}

@Injectable()
export class FinanceCalculatorService {
    private readonly logger = new Logger(FinanceCalculatorService.name);

    /** Текущая активная версия формулы. Snapshot записывает её в `formulaVersion`. */
    readonly formulaVersion = FINANCE_FORMULA_VERSION;

    /**
     * Рассчитывает unit-economics для одного SKU. Чистая функция:
     * (input) → (result). Не имеет состояния и не делает побочных
     * эффектов.
     *
     * §14 правило MVP cost components:
     *   обязательные критичные = `base_cost + marketplace fees + logistics`
     *   при отсутствии любого из них → isIncomplete=true + warning,
     *   но строка всё равно остаётся видимой с расчётом по доступным
     *   полям (§20 риск: missing data — это отдельное состояние,
     *   а не silent default-to-zero).
     */
    calculateSku(input: SkuFinanceInput): SkuFinanceResult {
        const warnings: FinanceWarningType[] = [];

        // ── Critical components: missing → incomplete + warning ──────
        // baseCost null = MISSING_COST. Используем 0 для арифметики,
        // но isIncomplete сигнализирует UI.
        const baseCost = input.baseCost ?? 0;
        if (input.baseCost === null) warnings.push(FinanceWarningType.MISSING_COST);

        const packagingCost = input.packagingCost ?? 0;
        const additionalCost = input.additionalCost ?? 0;

        const marketplaceFees = input.marketplaceFees ?? 0;
        if (input.marketplaceFees === null) warnings.push(FinanceWarningType.MISSING_FEES);

        const logistics = input.logistics ?? 0;
        if (input.logistics === null) warnings.push(FinanceWarningType.MISSING_LOGISTICS);

        // ── Optional improving inputs: missing → warning, но НЕ critical ──
        // §14: ads/tax/returns не блокируют расчёт. Warning создаём, но
        // в isIncomplete его роль слабая — это отмечается через
        // _isCriticalWarning (см. ниже).
        const adsCost = input.adsCost ?? 0;
        if (input.adsCost === null) warnings.push(FinanceWarningType.MISSING_ADS_COST);

        const returnsImpact = input.returnsImpact ?? 0;
        if (input.returnsImpact === null) warnings.push(FinanceWarningType.MISSING_RETURNS_DATA);

        const taxImpact = input.taxImpact ?? 0;
        if (input.taxImpact === null) warnings.push(FinanceWarningType.MISSING_TAX);

        // ── COGS = soldQty * (baseCost + packagingCost) ──────────────
        // §14 формула. additionalCost — отдельная категория operational
        // расходов, добавляется в Profit deduction, но НЕ в COGS (чтобы
        // ROI = Profit/COGS не искажался разовыми операционными расходами).
        const cogs = round2(input.soldQty * (baseCost + packagingCost));
        const additionalCharges = round2(input.soldQty * additionalCost);

        // ── Profit = Revenue - all_costs ─────────────────────────────
        const profit = round2(
            input.revenue - cogs - marketplaceFees - logistics
                - returnsImpact - taxImpact - adsCost - additionalCharges,
        );

        // ── Margin / ROI ─────────────────────────────────────────────
        const marginPct = input.revenue > 0
            ? round2((profit / input.revenue) * 100)
            : null;  // деление на ноль — отдельное состояние, не -Infinity
        const roiPct = cogs > 0
            ? round2((profit / cogs) * 100)
            : null;

        // §14 правило неполного: если хоть одна из 3 критичных warning'и —
        // isIncomplete=true. Optional missing → warning есть, но строка
        // не помечается incomplete.
        const isIncomplete = warnings.some(this._isCriticalWarning);

        return {
            productId: input.productId,
            sku: input.sku,
            soldQty: input.soldQty,
            revenue: round2(input.revenue),
            cogs,
            marketplaceFees: round2(marketplaceFees),
            logistics: round2(logistics),
            adsCost: round2(adsCost),
            returnsImpact: round2(returnsImpact),
            taxImpact: round2(taxImpact),
            additionalCharges,
            profit,
            marginPct,
            roiPct,
            isIncomplete,
            warnings,
        };
    }

    /**
     * Рассчитывает период целиком: применяет `calculateSku` к каждому
     * входу + аггрегирует totals. snapshot status = INCOMPLETE если
     * хотя бы одна строка incomplete; READY если все полные; FAILED
     * только при пустом наборе входов (нечего считать — это отдельное
     * операционное состояние, snapshot job сам решит, писать ли его).
     */
    calculatePeriod(inputs: SkuFinanceInput[]): FinanceCalculationOutput {
        const items = inputs.map((i) => this.calculateSku(i));

        const totals = items.reduce(
            (acc, it) => {
                acc.revenue += it.revenue;
                acc.cogs += it.cogs;
                acc.marketplaceFees += it.marketplaceFees;
                acc.logistics += it.logistics;
                acc.adsCost += it.adsCost;
                acc.returnsImpact += it.returnsImpact;
                acc.taxImpact += it.taxImpact;
                acc.additionalCharges += it.additionalCharges;
                acc.profit += it.profit;
                acc.skuCount += 1;
                if (it.isIncomplete) acc.incompleteSkuCount += 1;
                return acc;
            },
            {
                revenue: 0,
                cogs: 0,
                marketplaceFees: 0,
                logistics: 0,
                adsCost: 0,
                returnsImpact: 0,
                taxImpact: 0,
                additionalCharges: 0,
                profit: 0,
                marginPct: null as number | null,
                roiPct: null as number | null,
                skuCount: 0,
                incompleteSkuCount: 0,
            },
        );
        // Финальная нормализация
        totals.revenue = round2(totals.revenue);
        totals.cogs = round2(totals.cogs);
        totals.marketplaceFees = round2(totals.marketplaceFees);
        totals.logistics = round2(totals.logistics);
        totals.adsCost = round2(totals.adsCost);
        totals.returnsImpact = round2(totals.returnsImpact);
        totals.taxImpact = round2(totals.taxImpact);
        totals.additionalCharges = round2(totals.additionalCharges);
        totals.profit = round2(totals.profit);
        totals.marginPct = totals.revenue > 0
            ? round2((totals.profit / totals.revenue) * 100)
            : null;
        totals.roiPct = totals.cogs > 0
            ? round2((totals.profit / totals.cogs) * 100)
            : null;

        const status: FinanceSnapshotStatus = items.length === 0
            ? FinanceSnapshotStatus.FAILED
            : totals.incompleteSkuCount > 0
                ? FinanceSnapshotStatus.INCOMPLETE
                : FinanceSnapshotStatus.READY;

        // Уникальный набор всех warning-типов в периоде.
        const aggregated = new Set<FinanceWarningType>();
        for (const it of items) for (const w of it.warnings) aggregated.add(w);

        return {
            formulaVersion: this.formulaVersion,
            snapshotStatus: status,
            items,
            totals,
            aggregatedWarnings: Array.from(aggregated),
        };
    }

    /**
     * Конвертация Decimal/null → number | null. Удобно использовать в
     * loader'ах, которые читают `ProductFinanceProfile.baseCost`
     * (Prisma `Decimal`) и нормализуют в input для калькулятора.
     */
    static decimalToNumber(d: Prisma.Decimal | number | null | undefined): number | null {
        if (d === null || d === undefined) return null;
        if (typeof d === 'number') return d;
        return Number(d.toString());
    }

    /**
     * §14 — какие warning'и считаются критичными для `isIncomplete`.
     * MISSING_COST / MISSING_FEES / MISSING_LOGISTICS — обязательное ядро.
     * Остальные (TAX/ADS/RETURNS/STALE) — improving, не critical.
     */
    private _isCriticalWarning(w: FinanceWarningType): boolean {
        return (
            w === FinanceWarningType.MISSING_COST ||
            w === FinanceWarningType.MISSING_FEES ||
            w === FinanceWarningType.MISSING_LOGISTICS
        );
    }
}

/**
 * Округление до 2 знаков с защитой от float-дрифта (Math.round(x*100)/100
 * имеет известные edge-case'ы для x.005). Используем toFixed → parseFloat,
 * что даёт стабильное banker-style округление в большинстве движков.
 * Для денежных сумм точности достаточно — критичные деньги хранятся в БД
 * как `DECIMAL(12,2)`, calculator работает только в момент агрегации.
 */
function round2(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return parseFloat(n.toFixed(2));
}
