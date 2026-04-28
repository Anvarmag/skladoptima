import { Injectable } from '@nestjs/common';
import { ABC_GROUP_THRESHOLDS } from './analytics.constants';

/**
 * ABC calculator (TASK_ANALYTICS_3) — чистая функция.
 *
 * §14 правила MVP:
 *   - метрика — `revenue_net` (gross в MVP не используется, чтобы не
 *     смешивать продажи с возвратным шумом);
 *   - сортировка по убыванию метрики;
 *   - накопительная доля: A — первые 80%, B — следующие 15%, C — остаток;
 *   - **deterministic tie-breaker**: при равной метрике — `sku asc`,
 *     при равных sku (теоретически невозможно для одного tenant) —
 *     `productId asc`. Это гарантия §20 «ABC должен быть explainable
 *     и повторяемым» — без tie-breaker'а порядок зависел бы от
 *     undefined Postgres sort и snapshot стал бы non-reproducible.
 *
 * Сервис чистая функция: вход — массив `(productId, sku, metricValue)`,
 * выход — упорядоченный массив с накопительной долей и группой.
 * Никаких побочных эффектов, никаких db-вызовов — это нужно, чтобы
 * unit-тесты могли формулу прогнать без mock'ов БД.
 */

export interface AbcInputRow {
    productId: string;
    sku: string;
    metricValue: number;
}

export interface AbcOutputRow {
    productId: string;
    sku: string;
    metricValue: number;
    sharePct: number;
    cumulativeShare: number;
    group: 'A' | 'B' | 'C';
    rank: number;
}

export interface AbcCalculationResult {
    rows: AbcOutputRow[];
    totals: {
        skuCount: number;
        totalMetric: number;
        groupCounts: { A: number; B: number; C: number };
        groupShares: { A: number; B: number; C: number };
    };
}

@Injectable()
export class AnalyticsAbcCalculatorService {
    /**
     * Чистый расчёт ABC. Игнорирует строки с metricValue<=0 — они НЕ
     * могут попасть ни в одну группу (нулевая выручка не классифицируется,
     * чтобы не размывать процентные доли §14).
     */
    calculate(input: AbcInputRow[]): AbcCalculationResult {
        const positive = input.filter((r) => Number.isFinite(r.metricValue) && r.metricValue > 0);

        // Deterministic sort: metric desc, sku asc, productId asc.
        const sorted = [...positive].sort((a, b) => {
            if (b.metricValue !== a.metricValue) return b.metricValue - a.metricValue;
            if (a.sku !== b.sku) return a.sku < b.sku ? -1 : 1;
            return a.productId < b.productId ? -1 : 1;
        });

        const totalMetric = sorted.reduce((acc, r) => acc + r.metricValue, 0);

        const rows: AbcOutputRow[] = [];
        let cumulative = 0;
        let rank = 0;

        for (const r of sorted) {
            rank += 1;
            const sharePct = totalMetric > 0 ? (r.metricValue / totalMetric) * 100 : 0;

            // Группа определяется по накопительной доле ДО включения
            // текущего SKU. Это даёт два важных свойства §14:
            //   1. Первый SKU всегда A (даже если он один и его доля = 100%);
            //   2. Граница 80% включается в A: при ровном 80% накоплении
            //      следующий SKU попадает в B, не в A — что и ожидается
            //      (A — «первые 80%», следующие 15% уже B).
            const prevFraction = cumulative / 100;
            let group: 'A' | 'B' | 'C';
            if (prevFraction < ABC_GROUP_THRESHOLDS.A - 1e-9) group = 'A';
            else if (prevFraction < ABC_GROUP_THRESHOLDS.B - 1e-9) group = 'B';
            else group = 'C';

            cumulative += sharePct;

            rows.push({
                productId: r.productId,
                sku: r.sku,
                metricValue: round2(r.metricValue),
                sharePct: round4(sharePct),
                cumulativeShare: round4(cumulative),
                group,
                rank,
            });
        }

        const groupCounts = { A: 0, B: 0, C: 0 };
        const groupShares = { A: 0, B: 0, C: 0 };
        for (const r of rows) {
            groupCounts[r.group] += 1;
            groupShares[r.group] += r.sharePct;
        }

        return {
            rows,
            totals: {
                skuCount: rows.length,
                totalMetric: round2(totalMetric),
                groupCounts,
                groupShares: {
                    A: round4(groupShares.A),
                    B: round4(groupShares.B),
                    C: round4(groupShares.C),
                },
            },
        };
    }
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

function round4(n: number): number {
    return Math.round(n * 10000) / 10000;
}
