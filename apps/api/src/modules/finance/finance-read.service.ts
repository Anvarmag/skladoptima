import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FinanceCalculatorService } from './finance-calculator.service';

/**
 * Read-only сервис для finance UI (TASK_FINANCE_4).
 *
 * Все list/detail/dashboard читают из последнего `FinanceSnapshot`
 * текущей `formulaVersion` — это §18 SLA: snapshot/read-model вместо
 * realtime join. Если snapshot текущей версии нет — возвращаем
 * "no_snapshot" placeholder, не дёргаем тяжёлый realtime пересчёт
 * (это явное operational состояние, UI рендерит призыв к rebuild).
 *
 * Все методы tenant-scoped и paused-tenant-friendly (read доступен и
 * при TRIAL_EXPIRED/SUSPENDED — §4 сценарий 4).
 */

export interface UnitEconomicsListItem {
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
    marginPct: number | null;
    roiPct: number | null;
    isIncomplete: boolean;
    warnings: string[];
}

export interface UnitEconomicsListResponse {
    items: UnitEconomicsListItem[];
    snapshot: SnapshotMeta | null;
}

export interface UnitEconomicsDetailResponse {
    item: UnitEconomicsListItem;
    snapshot: SnapshotMeta;
    productProfile: {
        baseCost: string | null;
        packagingCost: string | null;
        additionalCost: string | null;
        costCurrency: string;
        isCostManual: boolean;
        updatedAt: string | null;
    } | null;
}

export interface DashboardResponse {
    snapshot: SnapshotMeta | null;
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
    aggregatedWarnings: string[];
    /** Топ-3 SKU по profit (positive). */
    topProfitable: Array<{ productId: string; sku: string; profit: number }>;
    /** SKU с отрицательным profit — самые проблемные. */
    negativeMarginSkus: Array<{ productId: string; sku: string; profit: number; marginPct: number | null }>;
}

interface SnapshotMeta {
    id: string;
    periodFrom: string;
    periodTo: string;
    periodType: string;
    formulaVersion: string;
    snapshotStatus: string;
    generatedAt: string;
    sourceFreshness: any;
}

@Injectable()
export class FinanceReadService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly calculator: FinanceCalculatorService,
    ) {}

    /**
     * Читает последний snapshot текущей `formulaVersion` и возвращает
     * per-SKU items + meta. UI таблица unit-economics строится отсюда.
     *
     * Фильтры передаются клиентом, но реально применяются на JSON-
     * payload'е снапшота (массив items). Это MVP-упрощение: snapshot
     * хранит весь периодный набор; для большой выборки можно будет
     * сделать индексированную развёртку в отдельную таблицу.
     */
    async listUnitEconomics(
        tenantId: string,
        opts: { search?: string; incompleteOnly?: boolean } = {},
    ): Promise<UnitEconomicsListResponse> {
        const snapshot = await this._latestSnapshot(tenantId);
        if (!snapshot) {
            return { items: [], snapshot: null };
        }

        const payload = snapshot.payload as any;
        let items: UnitEconomicsListItem[] = (payload?.items ?? []).map((it: any) => ({
            productId: it.productId,
            sku: it.sku,
            soldQty: it.soldQty,
            revenue: it.revenue,
            cogs: it.cogs,
            marketplaceFees: it.marketplaceFees,
            logistics: it.logistics,
            adsCost: it.adsCost,
            returnsImpact: it.returnsImpact,
            taxImpact: it.taxImpact,
            additionalCharges: it.additionalCharges,
            profit: it.profit,
            marginPct: it.marginPct,
            roiPct: it.roiPct,
            isIncomplete: it.isIncomplete,
            warnings: it.warnings ?? [],
        }));

        if (opts.search) {
            const q = opts.search.toLowerCase();
            items = items.filter(
                (it) => it.sku?.toLowerCase().includes(q) || it.productId.toLowerCase().includes(q),
            );
        }
        if (opts.incompleteOnly) {
            items = items.filter((it) => it.isIncomplete);
        }

        return {
            items,
            snapshot: this._snapshotMeta(snapshot),
        };
    }

    /**
     * Деталь по SKU: payload-row из последнего snapshot + текущий
     * cost profile (для UI редактирования). Profile отдельно, потому
     * что snapshot хранит уже агрегированные cost'ы, а UI хочет
     * редактируемые поля профиля.
     */
    async getProductDetail(tenantId: string, productId: string): Promise<UnitEconomicsDetailResponse> {
        const snapshot = await this._latestSnapshot(tenantId);
        if (!snapshot) {
            throw new NotFoundException({
                code: 'NO_SNAPSHOT',
                message: 'No finance snapshot available for current formula version',
            });
        }
        const payload = snapshot.payload as any;
        const item = (payload?.items ?? []).find((it: any) => it.productId === productId);
        if (!item) {
            throw new NotFoundException({
                code: 'PRODUCT_NOT_FOUND',
                message: 'Product not found in latest snapshot',
            });
        }

        const profile = await this.prisma.productFinanceProfile.findUnique({
            where: { productId },
            select: {
                baseCost: true,
                packagingCost: true,
                additionalCost: true,
                costCurrency: true,
                isCostManual: true,
                updatedAt: true,
            },
        });

        return {
            item,
            snapshot: this._snapshotMeta(snapshot)!,
            productProfile: profile
                ? {
                      baseCost: profile.baseCost?.toString() ?? null,
                      packagingCost: profile.packagingCost?.toString() ?? null,
                      additionalCost: profile.additionalCost?.toString() ?? null,
                      costCurrency: profile.costCurrency,
                      isCostManual: profile.isCostManual,
                      updatedAt: profile.updatedAt.toISOString(),
                  }
                : null,
        };
    }

    /**
     * Dashboard: totals + топ-3 profitable + negative-margin SKU + warnings.
     * Всё из того же payload.
     */
    async getDashboard(tenantId: string): Promise<DashboardResponse> {
        const snapshot = await this._latestSnapshot(tenantId);
        if (!snapshot) {
            return {
                snapshot: null,
                totals: this._emptyTotals(),
                aggregatedWarnings: [],
                topProfitable: [],
                negativeMarginSkus: [],
            };
        }
        const payload = snapshot.payload as any;
        const items = (payload?.items ?? []) as UnitEconomicsListItem[];

        // Top-3 по positive profit
        const sortedByProfit = [...items].sort((a, b) => b.profit - a.profit);
        const topProfitable = sortedByProfit
            .filter((it) => it.profit > 0)
            .slice(0, 3)
            .map((it) => ({ productId: it.productId, sku: it.sku, profit: it.profit }));

        const negativeMarginSkus = items
            .filter((it) => it.profit < 0)
            .map((it) => ({
                productId: it.productId,
                sku: it.sku,
                profit: it.profit,
                marginPct: it.marginPct,
            }));

        return {
            snapshot: this._snapshotMeta(snapshot),
            totals: payload?.totals ?? this._emptyTotals(),
            aggregatedWarnings: payload?.aggregatedWarnings ?? [],
            topProfitable,
            negativeMarginSkus,
        };
    }

    /**
     * Список активных warning'ов tenant'а — для отдельного UI badge
     * и дрилла "почему данные неполные".
     */
    async listActiveWarnings(tenantId: string) {
        const warnings = await this.prisma.financeDataWarning.findMany({
            where: { tenantId, isActive: true },
            select: {
                id: true,
                productId: true,
                snapshotId: true,
                warningType: true,
                details: true,
                createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
        });
        return warnings.map((w) => ({
            ...w,
            createdAt: w.createdAt.toISOString(),
        }));
    }

    private async _latestSnapshot(tenantId: string) {
        return this.prisma.financeSnapshot.findFirst({
            where: { tenantId, formulaVersion: this.calculator.formulaVersion },
            orderBy: [{ periodTo: 'desc' }, { generatedAt: 'desc' }],
            select: {
                id: true,
                periodFrom: true,
                periodTo: true,
                periodType: true,
                formulaVersion: true,
                snapshotStatus: true,
                payload: true,
                sourceFreshness: true,
                generatedAt: true,
            },
        });
    }

    private _snapshotMeta(s: any): SnapshotMeta {
        return {
            id: s.id,
            periodFrom: s.periodFrom.toISOString().slice(0, 10),
            periodTo: s.periodTo.toISOString().slice(0, 10),
            periodType: s.periodType,
            formulaVersion: s.formulaVersion,
            snapshotStatus: s.snapshotStatus,
            generatedAt: s.generatedAt.toISOString(),
            sourceFreshness: s.sourceFreshness,
        };
    }

    private _emptyTotals() {
        return {
            revenue: 0, cogs: 0, marketplaceFees: 0, logistics: 0, adsCost: 0,
            returnsImpact: 0, taxImpact: 0, additionalCharges: 0,
            profit: 0, marginPct: null, roiPct: null,
            skuCount: 0, incompleteSkuCount: 0,
        };
    }
}
