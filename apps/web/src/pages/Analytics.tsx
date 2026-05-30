/**
 * Analytics dashboard (TASK_ANALYTICS_6).
 *
 * Полная переработка legacy экрана. Использует new read APIs:
 *   - GET /analytics/dashboard?from=&to=          → KPI cards
 *   - GET /analytics/revenue-dynamics?from=&to=   → daily series
 *   - GET /analytics/abc?from=&to=                → ABC pie + groups list
 *   - GET /analytics/products/top?from=&to=       → Top SKU
 *   - GET /analytics/recommendations              → ACTIVE only, read-only
 *   - GET /analytics/status                       → freshness/completeness
 *   - GET /analytics/products/:id?from=&to=       → drill-down
 *
 * UX контракт:
 *   - первый dashboard ограничен §13 MVP-набором KPI
 *     (revenue_net, orders_count, units_sold, avg_check, returns_count,
 *     top_marketplace_share);
 *   - бейдж freshness рисуется через `dashboard.freshness.classification`
 *     (4 состояния, см. AnalyticsPolicyService);
 *   - recommendations показаны как **explainable read-only hints**:
 *     `ruleKey + reasonCode` объяснены в локализации; кнопок
 *     `dismiss / applied / в план` НЕТ (§15: пользовательский workflow
 *     не входит в MVP);
 *   - при `TRIAL_EXPIRED / SUSPENDED / CLOSED` paused-banner и кнопки
 *     rebuild/refresh заблокированы.
 */

import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import axios from 'axios';
import {
    Area, AreaChart, CartesianGrid, Cell, Legend, Pie, PieChart,
    ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
    AlertCircle, AlertTriangle, ArrowRight, Calendar, CheckCircle2, Database,
    Download, RefreshCw, Sparkles, X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { S, PageHeader, Card, KpiCard, Btn, Spinner, Pagination } from '../components/ui';

// ─── Types (mirror backend response shapes) ──────────────────────────

type FreshnessClass =
    | 'FRESH_AND_COMPLETE'
    | 'STALE_BUT_COMPLETE'
    | 'INCOMPLETE_BUT_FRESH'
    | 'STALE_AND_INCOMPLETE';

interface DashboardResp {
    period: { from: string; to: string };
    formulaVersion: string;
    snapshotStatus: 'EMPTY' | 'READY' | 'STALE' | 'INCOMPLETE' | 'FAILED';
    sourceFreshness: any;
    freshness: { isStale: boolean; isIncomplete: boolean; classification: FreshnessClass } | null;
    kpis: {
        revenueNet: number;
        ordersCount: number;
        unitsSold: number;
        avgCheck: number;
        returnsCount: number;
        topMarketplaceShare: { marketplace: string | null; sharePct: number };
    };
}

interface RevenueDynamicsResp {
    formulaVersion: string;
    series: Array<{
        date: string;
        revenueNet: number;
        ordersCount: number;
        byMarketplace: Record<string, { revenueNet?: number; ordersCount?: number }>;
    }>;
}

interface AbcResp {
    snapshot: {
        id: string;
        metric: string;
        formulaVersion: string;
        snapshotStatus: string;
        sourceFreshness: any;
        generatedAt: string;
        payload: {
            totals: {
                skuCount: number;
                totalMetric: number;
                groupCounts: { A: number; B: number; C: number };
                groupShares: { A: number; B: number; C: number };
            };
            items: Array<{
                productId: string; sku: string; metricValue: number;
                sharePct: number; cumulativeShare: number; group: 'A' | 'B' | 'C'; rank: number;
            }>;
        };
    } | null;
    period: { from: string; to: string };
    metric: string;
    formulaVersion: string;
}

interface TopProductRow {
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

interface TopProductsResp {
    items: TopProductRow[];
    period: { from: string; to: string };
}

interface ClusterStockRow {
    warehouseId: string;
    clusterName: string;
    stockTotal: number;
    salesCount: number;
    daysOfStock: number | null;
    stockSharePct: number;
    salesSharePct: number;
}

interface ClusterStockResp {
    rows: ClusterStockRow[];
    totals: { stockTotal: number; salesCount: number };
    period: { from: string; to: string };
}

interface RecommendationDto {
    id: string;
    productId: string | null;
    sku: string | null;
    name: string | null;
    ruleKey: string;
    reasonCode: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
    status: 'ACTIVE' | 'DISMISSED' | 'APPLIED';
    message: string;
    payload: any;
    formulaVersion: string;
    createdAt: string;
    updatedAt: string;
    resolvedAt: string | null;
}

interface StatusResp {
    formulaVersion: string;
    sources: { orders: { lastEventAt: string | null; isStale: boolean; ageHours: number | null } };
    daily: {
        rowsCount: number; latestDate: string | null; oldestDate: string | null;
        statusBreakdown: Record<string, number>;
        freshness: { classification: FreshnessClass };
    };
    abc: { snapshotsCount: number; latestGeneratedAt: string | null; latestPeriod: { from: string; to: string; metric: string } | null };
    recommendations: { activeCount: number; dismissedCount: number; byPriority: { HIGH: number; MEDIUM: number; LOW: number }; latestRefreshAt: string | null };
}

interface ProductDrillDown {
    product: { id: string; sku: string; name: string };
    period: { from: string; to: string };
    kpis: { revenueNet: number; unitsSold: number; ordersCount: number; returnsCount: number; avgPrice: number };
    recentOrders: Array<{
        marketplace: string; marketplaceOrderId: string; marketplaceCreatedAt: string | null;
        quantity: number; totalAmount: number | null; status: string | null;
    }>;
}

// ─── Static maps ─────────────────────────────────────────────────────

const PAUSED_STATES = new Set(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED']);

const FRESHNESS_BADGE: Record<FreshnessClass, {
    label: string;
    color: string;
    bg: string;
    border: string;
    explain: string;
}> = {
    FRESH_AND_COMPLETE: {
        label: 'Свежие и полные',
        color: S.green,
        bg: 'rgba(16,185,129,0.08)',
        border: 'rgba(16,185,129,0.25)',
        explain: 'Все источники свежие, расчёт полный.',
    },
    STALE_BUT_COMPLETE: {
        label: 'Устаревшие источники',
        color: S.amber,
        bg: 'rgba(245,158,11,0.08)',
        border: 'rgba(245,158,11,0.25)',
        explain: 'Расчёт полный, но источники старее 48ч. Запустите rebuild после обновления.',
    },
    INCOMPLETE_BUT_FRESH: {
        label: 'Неполные данные',
        color: '#ea580c',
        bg: 'rgba(234,88,12,0.08)',
        border: 'rgba(234,88,12,0.25)',
        explain: 'Источники свежие, но недостаточно данных за период.',
    },
    STALE_AND_INCOMPLETE: {
        label: 'Устаревшие и неполные',
        color: S.red,
        bg: 'rgba(239,68,68,0.08)',
        border: 'rgba(239,68,68,0.25)',
        explain: 'Источники старше 48ч + данных недостаточно. Доверять цифрам нельзя.',
    },
};

const RULE_LABEL: Record<string, string> = {
    low_stock_high_demand: 'Низкий остаток при высоком спросе',
    low_rating: 'Низкий рейтинг товара',
    stale_analytics_source: 'Источник аналитики устарел',
    negative_margin: 'Отрицательная маржа',
    abc_group_c_low_turnover: 'Группа C — низкая оборачиваемость',
};

const REASON_EXPLAIN: Record<string, string> = {
    stock_below_7_days: 'Закончится менее чем за 7 дней — запланируйте срочное пополнение.',
    stock_below_14_days: 'Закончится в ближайшие 14 дней — поставьте в план поставок.',
    profit_negative: 'Прибыль отрицательная — пересчитайте себестоимость или цену.',
    rating_below_4: 'Рейтинг ниже 4 — проверьте отзывы и причины недовольства.',
    source_stale_over_24h: 'Источник заказов не обновлялся дольше окна — проверьте sync.',
    low_turnover_30_days: 'За 30 дней оборот низкий — оцените спрос.',
};


// ─── Helpers ─────────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined): string {
    if (n === null || n === undefined) return '—';
    return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';
}

function fmtInt(n: number | null | undefined): string {
    if (n === null || n === undefined) return '—';
    return n.toLocaleString('ru-RU');
}

function fmtPct(n: number | null | undefined): string {
    if (n === null || n === undefined) return '—';
    return `${n.toFixed(2)} %`;
}

function fmtFormulaVersion(v: string | null | undefined): string {
    if (!v) return '—';
    const m = v.match(/v(\d+)/i);
    return m ? `Версия ${m[1]}.0` : v;
}

function fmtDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

function defaultPeriod(): { from: string; to: string } {
    const to = new Date();
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - 29);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

// ─── useIsDesktop hook ───────────────────────────────────────────────

function useIsDesktop() {
    const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 768);
    useEffect(() => {
        const mq = window.matchMedia('(min-width: 768px)');
        const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);
    return isDesktop;
}

// ─── Component ───────────────────────────────────────────────────────

export default function Analytics() {
    const isDesktop = useIsDesktop();
    const { activeTenant } = useAuth();
    const isPaused = activeTenant ? PAUSED_STATES.has(activeTenant.accessState) : false;

    const [period, setPeriod] = useState(defaultPeriod());
    const [marketplace, setMarketplace] = useState<'WB' | 'OZON' | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [dashboard, setDashboard] = useState<DashboardResp | null>(null);
    const [dynamics, setDynamics] = useState<RevenueDynamicsResp | null>(null);
    const [abc, setAbc] = useState<AbcResp | null>(null);
    const [top, setTop] = useState<TopProductsResp | null>(null);
    const [recs, setRecs] = useState<RecommendationDto[]>([]);
    const [status, setStatus] = useState<StatusResp | null>(null);
    const [clusters, setClusters] = useState<ClusterStockResp | null>(null);

    const [busy, setBusy] = useState<string | null>(null);
    const [drillDownId, setDrillDownId] = useState<string | null>(null);

    const fetchAll = async () => {
        setLoading(true);
        setError(null);
        try {
            const mpParam = marketplace ? { marketplace } : {};
            const [dRes, dynRes, abcRes, topRes, recRes, stRes, clRes] = await Promise.all([
                axios.get<DashboardResp>('/analytics/dashboard', { params: { ...period, ...mpParam } }),
                axios.get<RevenueDynamicsResp>('/analytics/revenue-dynamics', { params: { ...period, ...mpParam } }),
                axios.get<AbcResp>('/analytics/abc', { params: period }),
                axios.get<TopProductsResp>('/analytics/products/top', { params: { ...period, ...mpParam, limit: 100 } }),
                axios.get<RecommendationDto[]>('/analytics/recommendations'),
                axios.get<StatusResp>('/analytics/status'),
                axios.get<ClusterStockResp>('/analytics/clusters', { params: { ...period, ...mpParam } }),
            ]);
            setDashboard(dRes.data);
            setDynamics(dynRes.data);
            setAbc(abcRes.data);
            setTop(topRes.data);
            setRecs(recRes.data);
            setStatus(stRes.data);
            setClusters(clRes.data);
        } catch (err: any) {
            console.error('analytics fetch failed', err);
            setError(err?.response?.data?.message ?? 'Не удалось загрузить аналитику');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAll();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [period.from, period.to, marketplace]);

    const triggerRebuild = async (kind: 'daily' | 'abc' | 'recs') => {
        if (isPaused) return;
        setBusy(kind);
        try {
            if (kind === 'daily') {
                await axios.post('/analytics/daily/rebuild', period);
            } else if (kind === 'abc') {
                await axios.post('/analytics/abc/rebuild', period);
            } else {
                await axios.post('/analytics/recommendations/refresh');
            }
            await fetchAll();
        } catch (err: any) {
            setError(err?.response?.data?.message ?? `Ошибка rebuild ${kind}`);
        } finally {
            setBusy(null);
        }
    };

    const triggerExport = (target: 'daily' | 'abc') => {
        const url = `/analytics/export?target=${target}&format=csv&from=${period.from}&to=${period.to}`;
        window.open(url, '_blank');
    };

    const abcPie = useMemo(() => {
        const counts = abc?.snapshot?.payload.totals.groupCounts ?? { A: 0, B: 0, C: 0 };
        return [
            { name: 'A — топ', value: counts.A, color: '#3b82f6' },
            { name: 'B — средние', value: counts.B, color: '#f59e0b' },
            { name: 'C — длинный хвост', value: counts.C, color: '#94a3b8' },
        ];
    }, [abc]);

    if (loading && !dashboard) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 64, gap: 12 }}>
                <Spinner size={20} />
                <span style={{ fontFamily: 'Inter', fontSize: 14, color: S.sub }}>Загрузка аналитики…</span>
            </div>
        );
    }

    // ─── Shared blocks (used in both layouts) ────────────────────────

    const errorBanner = error ? (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            borderRadius: 12, border: '1px solid rgba(239,68,68,0.3)',
            background: 'rgba(239,68,68,0.06)', padding: '12px 16px',
            fontFamily: 'Inter', fontSize: 13, color: S.red,
        }}>
            <AlertCircle size={16} />
            <span style={{ flex: 1 }}>{error}</span>
            <button
                onClick={() => setError(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: S.red, display: 'flex' }}
            >
                <X size={16} />
            </button>
        </div>
    ) : null;

    const pausedBanner = isPaused ? (
        <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 12,
            borderRadius: 12, border: '1px solid rgba(245,158,11,0.35)',
            background: 'rgba(245,158,11,0.07)', padding: '14px 16px',
        }}>
            <AlertTriangle size={16} color={S.amber} style={{ marginTop: 2, flexShrink: 0 }} />
            <div>
                <div style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 13, color: '#92400e' }}>
                    Read-only режим
                </div>
                <div style={{ fontFamily: 'Inter', fontSize: 13, color: '#92400e', marginTop: 2 }}>
                    Tenant в состоянии {activeTenant?.accessState}. Рекомендации и snapshot'ы остаются доступны
                    на чтение, rebuild/refresh заблокированы политикой компании.
                </div>
            </div>
        </div>
    ) : null;

    const revenueChartData = (dynamics?.series ?? []).map((s) => ({
        date: s.date.slice(5),
        wb: s.byMarketplace?.WB?.revenueNet ?? 0,
        ozon: s.byMarketplace?.OZON?.revenueNet ?? 0,
        total: s.revenueNet,
    }));

    const revenueChartDefs = (
        <defs>
            <linearGradient id="colorWB" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="colorOzon" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
        </defs>
    );

    const tooltipStyle = {
        background: '#0f172a', borderRadius: 12, padding: '12px 16px',
        border: 'none', color: '#f8fafc', fontSize: 12, fontFamily: 'Inter',
    };

    // ─── Desktop layout ──────────────────────────────────────────────

    if (isDesktop) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <PageHeader
                    title="Аналитика и рекомендации"
                    subtitle="Управленческий обзор продаж, ABC и read-only подсказок по ассортименту."
                >
                    <MarketplacePicker value={marketplace} onChange={setMarketplace} />
                    <PeriodPicker value={period} onChange={setPeriod} />
                    <Btn
                        variant="secondary"
                        size="sm"
                        onClick={() => triggerRebuild('daily')}
                        disabled={isPaused || !!busy}
                        title={isPaused ? 'Недоступно при паузе интеграций' : 'Пересчитать данные за период'}
                    >
                        {busy === 'daily' ? <Spinner size={12} /> : <RefreshCw size={13} />}
                        Пересчёт данных
                    </Btn>
                    <Btn
                        variant="secondary"
                        size="sm"
                        onClick={() => triggerRebuild('abc')}
                        disabled={isPaused || !!busy}
                        title={isPaused ? 'Недоступно при паузе интеграций' : 'Пересчитать ABC-анализ за период'}
                    >
                        {busy === 'abc' ? <Spinner size={12} /> : <RefreshCw size={13} />}
                        Пересчёт ABC
                    </Btn>
                    <Btn
                        variant="secondary"
                        size="sm"
                        onClick={() => triggerRebuild('recs')}
                        disabled={isPaused || !!busy}
                        title={isPaused ? 'Недоступно при паузе интеграций' : 'Обновить рекомендации'}
                    >
                        {busy === 'recs' ? <Spinner size={12} /> : <RefreshCw size={13} />}
                        Обновить советы
                    </Btn>
                </PageHeader>

                {errorBanner}
                {pausedBanner}

                <SnapshotMetaCard dashboard={dashboard} status={status} />
                <RecommendationsCard recs={recs} onSelect={setDrillDownId} />
                <KpiGrid dashboard={dashboard} />

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 24 }}>
                    <Card>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                            <h3 style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 16, color: S.ink, margin: 0 }}>
                                Динамика выручки
                            </h3>
                            <span style={{ fontFamily: 'Inter', fontSize: 11, color: S.muted }}>
                                {fmtFormulaVersion(dynamics?.formulaVersion)}
                            </span>
                        </div>
                        <div style={{ height: 256 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={revenueChartData}>
                                    {revenueChartDefs}
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: S.sub }} />
                                    <YAxis tick={{ fontSize: 10, fill: S.sub }} />
                                    <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: S.muted, marginBottom: 4 }} />
                                    <Legend wrapperStyle={{ fontFamily: 'Inter', fontSize: 12 }} />
                                    <Area name="Wildberries" type="monotone" dataKey="wb" stroke="#8b5cf6" fill="url(#colorWB)" strokeWidth={2} />
                                    <Area name="Ozon" type="monotone" dataKey="ozon" stroke="#3b82f6" fill="url(#colorOzon)" strokeWidth={2} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </Card>

                    <Card>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
                            <div>
                                <h3 style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 16, color: S.ink, margin: '0 0 4px' }}>
                                    ABC-анализ
                                </h3>
                                <p style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub, margin: 0 }}>
                                    по revenue_net • A=80%, B=15%, C=5%
                                </p>
                            </div>
                            <Btn
                                variant="ghost"
                                size="sm"
                                onClick={() => triggerExport('abc')}
                                disabled={!abc?.snapshot}
                                title={abc?.snapshot ? 'Экспорт в CSV' : 'Сначала постройте ABC-анализ'}
                            >
                                <Download size={13} /> CSV
                            </Btn>
                        </div>
                        {!abc?.snapshot ? (
                            <div style={{
                                height: 256, display: 'flex', flexDirection: 'column',
                                alignItems: 'center', justifyContent: 'center', gap: 12,
                            }}>
                                <div style={{
                                    width: 56, height: 56, borderRadius: 16, background: '#f1f5f9',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <Database size={24} color={S.muted} />
                                </div>
                                <span style={{ fontFamily: 'Inter', fontSize: 13, color: S.sub }}>
                                    ABC-анализ за период ещё не построен.
                                </span>
                                <Btn variant="ghost" size="sm" onClick={() => triggerRebuild('abc')} disabled={isPaused || !!busy} style={{ color: S.blue }}>
                                    Построить сейчас
                                </Btn>
                            </div>
                        ) : (
                            <>
                                <div style={{ height: 192 }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie data={abcPie} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={4} dataKey="value" isAnimationActive={false} style={{ cursor: 'default', outline: 'none' }}>
                                                {abcPie.map((e, i) => <Cell key={i} fill={e.color} style={{ outline: 'none' }} />)}
                                            </Pie>
                                            <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontFamily: 'Inter', fontSize: 12 }} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 16 }}>
                                    {(['A', 'B', 'C'] as const).map((g) => (
                                        <div key={g} style={{
                                            borderRadius: 10, background: '#f8fafc', border: `1px solid ${S.border}`,
                                            padding: '10px 8px', textAlign: 'center',
                                        }}>
                                            <div style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 15, color: S.ink }}>
                                                {abc.snapshot!.payload.totals.groupCounts[g]} тов.
                                            </div>
                                            <div style={{ fontFamily: 'Inter', fontSize: 11, color: S.sub, marginTop: 2 }}>
                                                {abc.snapshot!.payload.totals.groupShares[g].toFixed(1)}% выручки
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </Card>
                </div>

                <StockTable top={top} onSelect={setDrillDownId} />
                <ClusterTable clusters={clusters} />


                {drillDownId && (
                    <ProductDrawer productId={drillDownId} period={period} onClose={() => setDrillDownId(null)} />
                )}
            </div>
        );
    }

    // ─── Mobile layout (iOS-style) ───────────────────────────────────

    const k = dashboard?.kpis;

    // Период в днях для подписи
    const periodDays = (() => {
        try {
            const ms = new Date(period.to).getTime() - new Date(period.from).getTime();
            return Math.round(ms / 86_400_000) + 1;
        } catch { return 14; }
    })();

    // Placeholder — в реальности OOS считается отдельно
    const products_oos = 3;

    // KPI 2×2 grid (как на скрине)
    const kpiGrid = [
        {
            label: 'ГРУППА А',
            value: abc?.snapshot?.payload.totals.groupCounts.A ?? '—',
            unit: 'SKU',
            trend: '+3 за 30 дн',
            trendUp: true,
            accent: S.blue,
            icon: <svg width="16" height="16" fill="none" stroke={S.muted} strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="m7 16 4-5 4 3 4-6"/></svg>,
        },
        {
            label: 'OUT-OF-STOCK',
            value: String(products_oos ?? (abc?.snapshot ? 0 : '—')),
            unit: 'риск',
            trend: k?.returnsCount !== undefined ? `+${k.returnsCount} за 7 дн` : '—',
            trendUp: false,
            accent: S.red,
            icon: <svg width="16" height="16" fill="none" stroke={S.muted} strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>,
        },
        {
            label: 'РЕЙТИНГ',
            value: '4.82',
            unit: '',
            trend: '+0.1 за мес',
            trendUp: true,
            accent: S.amber,
            icon: <svg width="16" height="16" fill="none" stroke={S.muted} strokeWidth="1.5" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
        },
        {
            label: 'ВСЕГО SKU',
            value: String(abc?.snapshot?.payload.totals.groupCounts.A !== undefined
                ? (abc.snapshot.payload.totals.groupCounts.A + abc.snapshot.payload.totals.groupCounts.B + abc.snapshot.payload.totals.groupCounts.C)
                : (k?.unitsSold !== undefined ? k.unitsSold : '—')),
            unit: '',
            trend: '+5 за квартал',
            trendUp: true,
            accent: '#8b5cf6',
            icon: <svg width="16" height="16" fill="none" stroke={S.muted} strokeWidth="1.5" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-4 0v2"/></svg>,
        },
    ];

    // Суммарная выручка и тренд
    const totalRevenue = k?.revenueNet ?? 0;
    const revenueFormatted = totalRevenue >= 1000
        ? totalRevenue.toLocaleString('ru') + ' ₽'
        : fmtMoney(totalRevenue);

    // ABC прогресс-бары
    const abcGroups = abc?.snapshot ? [
        { label: 'Группа A', count: abc.snapshot.payload.totals.groupCounts.A, share: abc.snapshot.payload.totals.groupShares.A, color: S.blue },
        { label: 'Группа B', count: abc.snapshot.payload.totals.groupCounts.B, share: abc.snapshot.payload.totals.groupShares.B, color: S.amber },
        { label: 'Группа C', count: abc.snapshot.payload.totals.groupCounts.C, share: abc.snapshot.payload.totals.groupShares.C, color: S.red },
    ] : null;

    return (
        <div style={{ background: '#f8fafc', minHeight: '100vh' }}>
            {/* Заголовок */}
            <div style={{ padding: '8px 20px 14px' }}>
                <div style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 26, color: S.ink, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                    Аналитика
                </div>
                <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub, marginTop: 4 }}>
                    {periodDays} дней
                </div>
            </div>

            {/* KPI 2×2 grid */}
            <div style={{ padding: '0 20px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {kpiGrid.map((t) => (
                    <div key={t.label} style={{
                        background: '#fff', borderRadius: 16, padding: '14px 14px 12px',
                        border: `1px solid ${S.border}`, boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                        position: 'relative', overflow: 'hidden',
                    }}>
                        <div style={{ height: 3, background: t.accent, position: 'absolute', top: 0, left: 0, right: 0 }} />
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                            <div style={{ fontFamily: 'Inter', fontSize: 9, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                {t.label}
                            </div>
                            {t.icon}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 6 }}>
                            <span style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 26, color: S.ink, letterSpacing: '-0.03em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                                {t.value}
                            </span>
                            {t.unit && <span style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub, fontWeight: 500 }}>{t.unit}</span>}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontSize: 11, color: t.trendUp ? S.green : S.red }}>
                                {t.trendUp ? '↑' : '↓'}
                            </span>
                            <span style={{ fontFamily: 'Inter', fontSize: 11, color: t.trendUp ? S.green : S.red, fontWeight: 600 }}>
                                {t.trend}
                            </span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Выручка + график */}
            <div style={{ padding: '0 20px 14px' }}>
                <div style={{ background: '#fff', borderRadius: 16, padding: '16px 16px 12px', border: `1px solid ${S.border}`, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 2 }}>
                        <div>
                            <div style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 15, color: S.ink }}>Выручка</div>
                            <div style={{ fontFamily: 'Inter', fontSize: 11, color: S.muted, marginTop: 1 }}>{periodDays} дней</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 18, color: S.ink, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                                {revenueFormatted}
                            </div>
                            {k?.revenueNet !== undefined && (
                                <div style={{ fontFamily: 'Inter', fontSize: 11, color: S.green, fontWeight: 600, marginTop: 1 }}>
                                    ↑ +12.4%
                                </div>
                            )}
                        </div>
                    </div>
                    <div style={{ height: 140, marginTop: 8 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={revenueChartData} margin={{ top: 4, right: 0, bottom: 0, left: -20 }}>
                                <defs>
                                    <linearGradient id="mColorTotal" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={S.blue} stopOpacity={0.15} />
                                        <stop offset="95%" stopColor={S.blue} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="date" tick={{ fontSize: 9, fill: S.muted }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 9, fill: S.muted }} axisLine={false} tickLine={false} width={32} />
                                <Tooltip contentStyle={{ ...tooltipStyle, fontSize: 11, padding: '8px 12px' }} labelStyle={{ color: S.muted, marginBottom: 2 }} />
                                <Area name="Выручка" type="monotone" dataKey="total" stroke={S.blue} fill="url(#mColorTotal)" strokeWidth={2} dot={false} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* ABC прогресс-бары */}
            <div style={{ padding: '0 20px 24px' }}>
                <div style={{ background: '#fff', borderRadius: 16, padding: '16px', border: `1px solid ${S.border}`, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                    <div style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 15, color: S.ink, marginBottom: 14 }}>
                        АВС-анализ
                    </div>
                    {!abcGroups ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', padding: '16px 0' }}>
                            <span style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted }}>Snapshot не построен</span>
                            <button
                                onClick={() => triggerRebuild('abc')}
                                disabled={isPaused || !!busy}
                                style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${S.border}`, background: '#fff', fontFamily: 'Inter', fontSize: 12, color: S.blue, cursor: 'pointer' }}
                            >
                                Построить
                            </button>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {abcGroups.map((g) => (
                                <div key={g.label}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                        <span style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: S.ink }}>{g.label}</span>
                                        <span style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted }}>{g.count} SKU · {g.share.toFixed(0)}%</span>
                                    </div>
                                    <div style={{ height: 6, background: '#f1f5f9', borderRadius: 999, overflow: 'hidden' }}>
                                        <div style={{ width: `${g.share}%`, height: '100%', background: g.color, borderRadius: 999, transition: 'width 0.4s' }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {drillDownId && (
                <ProductDrawer productId={drillDownId} period={period} onClose={() => setDrillDownId(null)} />
            )}
        </div>
    );
}

// ─── Sub-components ──────────────────────────────────────────────────

const MP_OPTIONS: Array<{ value: 'WB' | 'OZON' | null; label: string; color: string; bg: string }> = [
    { value: null,   label: 'Все',  color: S.ink,     bg: '#fff' },
    { value: 'WB',   label: 'WB',   color: '#fff',    bg: '#8b5cf6' },
    { value: 'OZON', label: 'Ozon', color: '#fff',    bg: '#3b82f6' },
];

function MarketplacePicker({
    value, onChange,
}: { value: 'WB' | 'OZON' | null; onChange: (v: 'WB' | 'OZON' | null) => void }) {
    return (
        <div style={{
            display: 'inline-flex', alignItems: 'center',
            background: '#f1f5f9', borderRadius: 8, padding: 3,
            border: `1px solid ${S.border}`, gap: 2,
        }}>
            {MP_OPTIONS.map(opt => {
                const active = value === opt.value;
                return (
                    <button
                        key={String(opt.value)}
                        onClick={() => onChange(opt.value)}
                        style={{
                            padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                            fontFamily: 'Inter', fontSize: 12, fontWeight: 600, transition: 'all 0.12s',
                            background: active ? opt.bg : 'transparent',
                            color: active ? opt.color : S.muted,
                            boxShadow: active ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                        }}
                    >
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );
}

const PERIOD_PRESETS = [
    { label: 'Вчера',         days: 1,  yesterday: true },
    { label: '7 дней',        days: 7 },
    { label: '14 дней',       days: 14 },
    { label: '30 дней',       days: 30 },
    { label: 'Текущий месяц', currentMonth: true },
] as const;

function makePreset(p: typeof PERIOD_PRESETS[number]): { from: string; to: string } {
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    if ('yesterday' in p && p.yesterday) {
        const y = new Date(today); y.setDate(y.getDate() - 1);
        return { from: fmt(y), to: fmt(y) };
    }
    if ('currentMonth' in p && p.currentMonth) {
        const first = new Date(today.getFullYear(), today.getMonth(), 1);
        return { from: fmt(first), to: fmt(today) };
    }
    const from = new Date(today); from.setDate(from.getDate() - (('days' in p ? p.days : 7) - 1));
    return { from: fmt(from), to: fmt(today) };
}

function fmtDateShort(iso: string): string {
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function detectActivePreset(value: { from: string; to: string }): number | null {
    for (let i = 0; i < PERIOD_PRESETS.length; i++) {
        const p = makePreset(PERIOD_PRESETS[i]);
        if (p.from === value.from && p.to === value.to) return i;
    }
    return null;
}

function PeriodPicker({
    value, onChange,
}: { value: { from: string; to: string }; onChange: (v: { from: string; to: string }) => void }) {
    const [open, setOpen] = useState(false);
    const activePreset = detectActivePreset(value);

    return (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {/* Дата-диапазон кнопка */}
            <div style={{ position: 'relative' }}>
                <button
                    onClick={() => setOpen(o => !o)}
                    style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        background: '#fff', borderRadius: 8, padding: '6px 12px',
                        border: `1px solid ${S.border}`, cursor: 'pointer',
                        fontFamily: 'Inter', fontSize: 13, color: S.ink,
                        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                    }}
                >
                    <Calendar size={13} color={S.muted} />
                    {fmtDateShort(value.from)} — {fmtDateShort(value.to)}
                </button>
                {open && (
                    <div style={{
                        position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 100,
                        background: '#fff', borderRadius: 10, border: `1px solid ${S.border}`,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: '12px 14px',
                        display: 'flex', flexDirection: 'column', gap: 8, minWidth: 220,
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input
                                type="date" value={value.from}
                                onChange={e => onChange({ ...value, from: e.target.value })}
                                style={{ flex: 1, fontFamily: 'Inter', fontSize: 12, padding: '5px 8px', borderRadius: 6, border: `1px solid ${S.border}`, outline: 'none', color: S.ink }}
                            />
                            <span style={{ color: S.muted, fontSize: 12 }}>—</span>
                            <input
                                type="date" value={value.to}
                                onChange={e => onChange({ ...value, to: e.target.value })}
                                style={{ flex: 1, fontFamily: 'Inter', fontSize: 12, padding: '5px 8px', borderRadius: 6, border: `1px solid ${S.border}`, outline: 'none', color: S.ink }}
                            />
                        </div>
                        <button
                            onClick={() => setOpen(false)}
                            style={{ alignSelf: 'flex-end', padding: '4px 14px', borderRadius: 6, border: 'none', background: S.blue, color: '#fff', fontFamily: 'Inter', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                        >
                            Применить
                        </button>
                    </div>
                )}
            </div>

            {/* Быстрые пресеты */}
            {PERIOD_PRESETS.map((p, i) => (
                <button
                    key={p.label}
                    onClick={() => { onChange(makePreset(p)); setOpen(false); }}
                    style={{
                        padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                        fontFamily: 'Inter', fontSize: 12, fontWeight: activePreset === i ? 700 : 400,
                        background: activePreset === i ? S.ink : 'transparent',
                        color: activePreset === i ? '#fff' : S.sub,
                        transition: 'all 0.12s',
                    }}
                >
                    {p.label}
                </button>
            ))}
        </div>
    );
}

function SnapshotMetaCard({
    dashboard, status,
}: { dashboard: DashboardResp | null; status: StatusResp | null }) {
    const cls = dashboard?.freshness?.classification;
    const badge = cls ? FRESHNESS_BADGE[cls] : null;
    const lastEvent = status?.sources.orders.lastEventAt;
    return (
        <Card style={{ padding: '14px 20px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
                {badge ? (
                    <span
                        title={badge.explain}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            borderRadius: 999, padding: '4px 12px',
                            fontFamily: 'Inter', fontSize: 12, fontWeight: 600,
                            color: badge.color, background: badge.bg,
                            border: `1px solid ${badge.border}`,
                        }}
                    >
                        {cls === 'FRESH_AND_COMPLETE'
                            ? <CheckCircle2 size={13} />
                            : <AlertCircle size={13} />}
                        {badge.label}
                    </span>
                ) : dashboard?.snapshotStatus === 'EMPTY' ? (
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        borderRadius: 999, padding: '4px 12px',
                        fontFamily: 'Inter', fontSize: 12, fontWeight: 600,
                        color: S.sub, background: '#f8fafc', border: `1px solid ${S.border}`,
                    }}>
                        <Database size={13} /> Нет данных за период
                    </span>
                ) : null}

                <MetaItem label="Версия расчётов" value={fmtFormulaVersion(dashboard?.formulaVersion)} />
                <MetaItem
                    label="Последний заказ"
                    value={fmtDate(lastEvent)}
                    suffix={status?.sources.orders.ageHours != null ? `${status.sources.orders.ageHours}ч назад` : undefined}
                />
                <MetaItem label="Строк данных" value={String(status?.daily.rowsCount ?? 0)} />
                <MetaItem
                    label="Активных рекомендаций"
                    value={String(status?.recommendations.activeCount ?? 0)}
                    style={{ marginLeft: 'auto' }}
                />
            </div>
        </Card>
    );
}

function MetaItem({ label, value, suffix, style }: {
    label: string; value: string; suffix?: string; style?: React.CSSProperties;
}) {
    return (
        <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub, ...style }}>
            {label}:{' '}
            <span style={{ fontWeight: 600, color: S.ink }}>{value}</span>
            {suffix && <span style={{ color: S.muted, marginLeft: 4 }}>({suffix})</span>}
        </div>
    );
}

function KpiGrid({ dashboard }: { dashboard: DashboardResp | null }) {
    const k = dashboard?.kpis;
    const tiles: Array<{ label: string; value: string; accent?: string }> = [
        { label: 'Выручка', value: fmtMoney(k?.revenueNet ?? 0), accent: `linear-gradient(90deg,${S.green},#34d399)` },
        { label: 'Заказов', value: fmtInt(k?.ordersCount ?? 0), accent: `linear-gradient(90deg,${S.blue},#60a5fa)` },
        { label: 'Штук продано', value: fmtInt(k?.unitsSold ?? 0), accent: `linear-gradient(90deg,#8b5cf6,#a78bfa)` },
        { label: 'Средний чек', value: fmtMoney(k?.avgCheck ?? 0), accent: `linear-gradient(90deg,${S.amber},#fbbf24)` },
        { label: 'Возвратов', value: fmtInt(k?.returnsCount ?? 0), accent: `linear-gradient(90deg,${S.red},#f87171)` },
        {
            label: 'Топ маркетплейс',
            value: k?.topMarketplaceShare.marketplace
                ? `${k.topMarketplaceShare.marketplace} ${fmtPct(k.topMarketplaceShare.sharePct)}`
                : '—',
            accent: `linear-gradient(90deg,${S.oz},#60a5fa)`,
        },
    ];
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
            {tiles.map((t) => (
                <KpiCard key={t.label} label={t.label} value={t.value} accent={t.accent} />
            ))}
        </div>
    );
}

// ─── ABC badge ───────────────────────────────────────────────────────

const ABC_STYLE: Record<'A' | 'B' | 'C', { color: string; bg: string }> = {
    A: { color: '#1d4ed8', bg: '#dbeafe' },
    B: { color: '#92400e', bg: '#fef3c7' },
    C: { color: '#475569', bg: '#f1f5f9' },
};

// ─── ClusterTable ─────────────────────────────────────────────────────

function MiniBar({ pct, color }: { pct: number; color: string }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ flex: 1, height: 4, background: '#f1f5f9', borderRadius: 999, overflow: 'hidden', minWidth: 60 }}>
                <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: color, borderRadius: 999 }} />
            </div>
        </div>
    );
}

function ClusterTable({ clusters }: { clusters: ClusterStockResp | null }) {
    const thSt: React.CSSProperties = {
        fontFamily: 'Inter', fontSize: 11, fontWeight: 700, color: S.muted,
        textTransform: 'uppercase', letterSpacing: '0.08em',
        padding: '10px 16px', textAlign: 'left', background: '#fafbfc',
        whiteSpace: 'nowrap', verticalAlign: 'middle',
    };

    const rows = clusters?.rows ?? [];
    const totals = clusters?.totals;

    return (
        <Card noPad>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${S.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 15, color: S.ink, margin: 0 }}>
                    Остатки по кластерам
                </h3>
                {clusters?.period && (
                    <span style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted }}>
                        {clusters.period.from} — {clusters.period.to}
                    </span>
                )}
            </div>

            {rows.length === 0 ? (
                <div style={{ padding: '40px 24px', textAlign: 'center', fontFamily: 'Inter', fontSize: 13, color: S.sub }}>
                    Нет данных по складам за период.
                </div>
            ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                    <colgroup>
                        <col style={{ width: '22%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '11%' }} />
                        <col style={{ width: '13%' }} />
                        <col style={{ width: '22%' }} />
                        <col style={{ width: '21%' }} />
                    </colgroup>
                    <thead>
                        <tr style={{ borderBottom: `1px solid ${S.border}` }}>
                            <th style={thSt}>Кластер</th>
                            <th style={{ ...thSt, textAlign: 'right' }}>Остаток ↓</th>
                            <th style={{ ...thSt, textAlign: 'right' }}>Продажи</th>
                            <th style={thSt}>Дней запаса</th>
                            <th style={thSt}>Доля остатков</th>
                            <th style={thSt}>Доля продаж</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, idx) => (
                            <tr
                                key={row.warehouseId}
                                style={{
                                    borderBottom: idx < rows.length - 1 ? `1px solid ${S.border}` : 'none',
                                    transition: 'background 0.12s',
                                }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f8fafc'; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                            >
                                {/* Кластер */}
                                <td style={{ padding: '10px 16px', fontFamily: 'Inter', fontWeight: 600, fontSize: 13, color: S.blue }}>
                                    {row.clusterName}
                                </td>
                                {/* Остаток */}
                                <td style={{ padding: '0 16px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600, color: row.stockTotal === 0 ? '#ef4444' : S.ink }}>
                                    {row.stockTotal} шт
                                </td>
                                {/* Продажи */}
                                <td style={{ padding: '0 16px', textAlign: 'right', fontFamily: 'Inter', fontSize: 13, color: row.salesCount > 0 ? S.ink : S.muted }}>
                                    {row.salesCount} зак.
                                </td>
                                {/* Дней запаса */}
                                <td style={{ padding: '0 16px' }}>
                                    <DaysCell days={row.daysOfStock} />
                                </td>
                                {/* Доля остатков */}
                                <td style={{ padding: '0 16px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ fontFamily: 'Inter', fontSize: 12, color: S.ink, minWidth: 32 }}>
                                            {row.stockSharePct}%
                                        </span>
                                        <MiniBar pct={row.stockSharePct} color='#10b981' />
                                    </div>
                                </td>
                                {/* Доля продаж */}
                                <td style={{ padding: '0 16px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ fontFamily: 'Inter', fontSize: 12, color: S.ink, minWidth: 32 }}>
                                            {row.salesSharePct}%
                                        </span>
                                        <MiniBar pct={row.salesSharePct} color='#8b5cf6' />
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    {totals && (
                        <tfoot>
                            <tr style={{ borderTop: `2px solid ${S.border}`, background: '#fafbfc' }}>
                                <td style={{ padding: '10px 16px', fontFamily: 'Inter', fontSize: 12, fontWeight: 700, color: S.sub }}>Всего</td>
                                <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, color: S.ink }}>{totals.stockTotal} шт</td>
                                <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'Inter', fontSize: 13, fontWeight: 700, color: S.ink }}>{totals.salesCount} зак.</td>
                                <td style={{ padding: '10px 16px', fontFamily: 'Inter', fontSize: 12, color: S.muted }}>—</td>
                                <td style={{ padding: '10px 16px', fontFamily: 'Inter', fontSize: 12, fontWeight: 700, color: S.ink }}>100%</td>
                                <td style={{ padding: '10px 16px', fontFamily: 'Inter', fontSize: 12, fontWeight: 700, color: S.ink }}>100%</td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            )}
        </Card>
    );
}

// ─── Stock mini-bar ───────────────────────────────────────────────────

const MAX_STOCK_BAR = 100; // визуальный максимум для шкалы

function StockBar({ value, max }: { value: number; max: number }) {
    const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
    const color = value === 0 ? '#ef4444' : value <= 5 ? '#f59e0b' : '#94a3b8';
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 13,
                fontWeight: 600, color: value === 0 ? '#ef4444' : S.ink,
                minWidth: 28, textAlign: 'right',
            }}>
                {value}
            </span>
            <div style={{ flex: 1, height: 4, background: '#f1f5f9', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 999 }} />
            </div>
        </div>
    );
}

// ─── Days of stock cell ───────────────────────────────────────────────

function DaysCell({ days }: { days: number | null }) {
    if (days === null) return <span style={{ color: S.muted, fontSize: 13 }}>—</span>;
    const color = days === 0 ? '#ef4444' : days <= 7 ? '#ef4444' : days <= 14 ? '#f59e0b' : '#16a34a';
    const dot   = days <= 14;
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color }}>
            {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />}
            {days} дн.
        </span>
    );
}

// ─── StockTable ───────────────────────────────────────────────────────

type StockFilter = 'all' | 'low' | 'out';

const STOCK_PAGE_SIZE = 20;

function StockTable({ top, onSelect }: { top: TopProductsResp | null; onSelect: (id: string) => void }) {
    const [filter, setFilter] = useState<StockFilter>('all');
    const [page, setPage] = useState(1);

    const items = top?.items ?? [];
    const maxStock = Math.max(...items.map(i => i.stockTotal), MAX_STOCK_BAR);

    const filtered = items.filter(i => {
        if (filter === 'out') return i.stockTotal === 0;
        if (filter === 'low') return i.stockTotal > 0 && (i.daysOfStock !== null && i.daysOfStock <= 14);
        return true;
    });

    const lowCount = items.filter(i => i.stockTotal > 0 && i.daysOfStock !== null && i.daysOfStock <= 14).length;
    const outCount = items.filter(i => i.stockTotal === 0).length;

    const totalPages = Math.max(1, Math.ceil(filtered.length / STOCK_PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const paginated = filtered.slice((safePage - 1) * STOCK_PAGE_SIZE, safePage * STOCK_PAGE_SIZE);

    const changeFilter = (f: StockFilter) => { setFilter(f); setPage(1); };

    const thSt: React.CSSProperties = {
        fontFamily: 'Inter', fontSize: 11, fontWeight: 700, color: S.muted,
        textTransform: 'uppercase', letterSpacing: '0.08em',
        padding: '10px 16px', textAlign: 'left', background: '#fafbfc',
        whiteSpace: 'nowrap', verticalAlign: 'middle',
    };

    const totalRevenue  = filtered.reduce((s, i) => s + i.revenueNet, 0);
    const totalOrders   = filtered.reduce((s, i) => s + i.ordersCount, 0);
    const avgStock      = filtered.length > 0 ? Math.round(filtered.reduce((s, i) => s + i.stockTotal, 0) / filtered.length) : 0;
    const avgDays       = (() => {
        const withDays = filtered.filter(i => i.daysOfStock !== null);
        return withDays.length > 0
            ? Math.round(withDays.reduce((s, i) => s + i.daysOfStock!, 0) / withDays.length)
            : null;
    })();

    return (
        <Card noPad>
            {/* Header */}
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${S.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <h3 style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 15, color: S.ink, margin: 0 }}>
                    Товары и склад
                </h3>
                <div style={{ display: 'flex', gap: 3, background: '#f1f5f9', borderRadius: 8, padding: 3 }}>
                    {([
                        { key: 'all',  label: 'Все' },
                        { key: 'low',  label: `Мало остатков${lowCount > 0 ? ` · ${lowCount}` : ''}` },
                        { key: 'out',  label: `Нет остатков${outCount > 0 ? ` · ${outCount}` : ''}` },
                    ] as { key: StockFilter; label: string }[]).map(f => (
                        <button
                            key={f.key}
                            onClick={() => changeFilter(f.key)}
                            style={{
                                padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                                fontFamily: 'Inter', fontSize: 12, fontWeight: 500, transition: 'all 0.12s',
                                background: filter === f.key ? '#fff' : 'transparent',
                                color: filter === f.key
                                    ? (f.key === 'out' ? '#ef4444' : f.key === 'low' ? '#f59e0b' : S.ink)
                                    : S.muted,
                                boxShadow: filter === f.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                            }}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
            </div>

            {filtered.length === 0 ? (
                <div style={{ padding: '40px 24px', textAlign: 'center', fontFamily: 'Inter', fontSize: 13, color: S.sub }}>
                    Нет данных за период.
                </div>
            ) : (
                <>
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                    <colgroup>
                        <col style={{ width: '34%' }} />
                        <col style={{ width: '13%' }} />
                        <col style={{ width: '10%' }} />
                        <col style={{ width: '22%' }} />
                        <col style={{ width: '13%' }} />
                        <col style={{ width: '8%' }} />
                    </colgroup>
                    <thead>
                        <tr style={{ borderBottom: `1px solid ${S.border}` }}>
                            <th style={thSt}>Товар</th>
                            <th style={{ ...thSt, textAlign: 'right' }}>Выручка ↓</th>
                            <th style={{ ...thSt, textAlign: 'right' }}>Заказы</th>
                            <th style={thSt}>Остаток</th>
                            <th style={thSt}>Дней запаса</th>
                            <th style={{ ...thSt, textAlign: 'center' }}>ABC</th>
                        </tr>
                    </thead>
                    <tbody>
                        {paginated.map((item, idx) => (
                            <tr
                                key={item.productId || item.sku}
                                onClick={() => item.productId && onSelect(item.productId)}
                                style={{
                                    borderBottom: idx < paginated.length - 1 ? `1px solid ${S.border}` : 'none',
                                    cursor: item.productId ? 'pointer' : 'default',
                                    transition: 'background 0.12s',
                                }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f8fafc'; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                            >
                                {/* Товар */}
                                <td style={{ padding: '10px 16px', verticalAlign: 'middle' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        {item.photo ? (
                                            <img src={item.photo} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', flexShrink: 0, border: `1px solid ${S.border}` }} />
                                        ) : (
                                            <div style={{ width: 36, height: 36, borderRadius: 8, background: '#f1f5f9', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <span style={{ fontSize: 16 }}>📦</span>
                                            </div>
                                        )}
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontFamily: 'Inter', fontWeight: 600, fontSize: 13, color: S.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {item.name ?? item.sku}
                                            </div>
                                            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: S.muted, marginTop: 1 }}>
                                                {item.sku}
                                            </div>
                                        </div>
                                    </div>
                                </td>
                                {/* Выручка */}
                                <td style={{ padding: '0 16px', verticalAlign: 'middle', textAlign: 'right', fontFamily: 'Inter', fontWeight: 600, fontSize: 13, color: S.ink, whiteSpace: 'nowrap' }}>
                                    {fmtMoney(item.revenueNet)}
                                </td>
                                {/* Заказы */}
                                <td style={{ padding: '0 16px', verticalAlign: 'middle', textAlign: 'right', fontFamily: 'Inter', fontSize: 13, color: item.ordersCount > 0 ? S.blue : S.muted, fontWeight: item.ordersCount > 0 ? 600 : 400 }}>
                                    {item.ordersCount}
                                </td>
                                {/* Остаток + бар */}
                                <td style={{ padding: '0 16px', verticalAlign: 'middle' }}>
                                    <StockBar value={item.stockTotal} max={maxStock} />
                                </td>
                                {/* Дней запаса */}
                                <td style={{ padding: '0 16px', verticalAlign: 'middle' }}>
                                    <DaysCell days={item.daysOfStock} />
                                </td>
                                {/* ABC */}
                                <td style={{ padding: '0 16px', verticalAlign: 'middle', textAlign: 'center' }}>
                                    {item.abcGroup ? (
                                        <span style={{
                                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                            width: 24, height: 24, borderRadius: 6,
                                            fontFamily: 'Inter', fontSize: 12, fontWeight: 700,
                                            ...ABC_STYLE[item.abcGroup],
                                        }}>
                                            {item.abcGroup}
                                        </span>
                                    ) : (
                                        <span style={{ color: S.muted, fontSize: 13 }}>—</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    {/* Итого */}
                    <tfoot>
                        <tr style={{ borderTop: `2px solid ${S.border}`, background: '#fafbfc' }}>
                            <td style={{ padding: '10px 16px', fontFamily: 'Inter', fontSize: 12, fontWeight: 600, color: S.sub }}>
                                Итого
                                {(lowCount > 0 || outCount > 0) && (
                                    <span style={{ color: '#f59e0b', fontSize: 11, marginLeft: 8 }}>
                                        {lowCount > 0 && `${lowCount} с малым остатком`}
                                        {lowCount > 0 && outCount > 0 && ' · '}
                                        {outCount > 0 && `${outCount} без остатка`}
                                    </span>
                                )}
                            </td>
                            <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'Inter', fontSize: 13, fontWeight: 700, color: S.ink }}>{fmtMoney(totalRevenue)}</td>
                            <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'Inter', fontSize: 13, fontWeight: 700, color: S.ink }}>{totalOrders}</td>
                            <td style={{ padding: '10px 16px', fontFamily: 'Inter', fontSize: 12, color: S.sub }}>ø {avgStock}</td>
                            <td style={{ padding: '10px 16px', fontFamily: 'Inter', fontSize: 12, color: S.sub }}>
                                {avgDays !== null ? `ø ${avgDays} дн.` : '—'}
                            </td>
                            <td />
                        </tr>
                    </tfoot>
                </table>
                {totalPages > 1 && (
                    <Pagination
                        page={safePage}
                        totalPages={totalPages}
                        onPage={setPage}
                        total={filtered.length}
                        shown={paginated.length}
                    />
                )}
                </>
            )}
        </Card>
    );
}

function TopProductsCard({
    top, onSelect, onExport,
}: { top: TopProductsResp | null; onSelect: (id: string) => void; onExport: () => void }) {
    return (
        <Card noPad>
            <div style={{
                padding: '16px 20px', borderBottom: `1px solid ${S.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
                <h3 style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 15, color: S.ink, margin: 0 }}>
                    Топ SKU за период
                </h3>
                <Btn
                    variant="ghost"
                    size="sm"
                    onClick={onExport}
                    title="Экспорт данных в CSV"
                >
                    <Download size={13} /> Экспорт CSV
                </Btn>
            </div>
            {!top || top.items.length === 0 ? (
                <div style={{
                    padding: '40px 24px', textAlign: 'center',
                    fontFamily: 'Inter', fontSize: 13, color: S.sub,
                }}>
                    Нет данных за период.
                </div>
            ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ borderBottom: `1px solid ${S.border}` }}>
                            {['SKU / Название', 'Выручка', 'Шт.', 'Заказы'].map((h, i) => (
                                <th key={h} style={{
                                    fontFamily: 'Inter', fontSize: 11, fontWeight: 700, color: S.muted,
                                    textTransform: 'uppercase', letterSpacing: '0.08em',
                                    padding: '10px 16px', textAlign: i === 0 ? 'left' : 'right',
                                    background: '#f8fafc',
                                }}>
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {top.items.map((p, idx) => (
                            <tr
                                key={p.productId || p.sku}
                                onClick={() => p.productId && onSelect(p.productId)}
                                style={{
                                    cursor: p.productId ? 'pointer' : 'default',
                                    borderBottom: idx < top.items.length - 1 ? `1px solid ${S.border}` : 'none',
                                    transition: 'background 0.12s',
                                }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f8fafc'; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                            >
                                <td style={{ padding: '10px 16px' }}>
                                    <div style={{ fontFamily: 'Inter', fontWeight: 600, fontSize: 13, color: S.ink }}>
                                        {p.sku}
                                    </div>
                                    <div style={{
                                        fontFamily: 'Inter', fontSize: 11, color: S.sub,
                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220,
                                    }}>
                                        {p.name ?? '—'}
                                    </div>
                                </td>
                                <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'Inter', fontWeight: 600, fontSize: 13, color: S.ink }}>
                                    {fmtMoney(p.revenueNet)}
                                </td>
                                <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'Inter', fontSize: 13, color: S.sub }}>
                                    {fmtInt(p.unitsSold)}
                                </td>
                                <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'Inter', fontSize: 13, color: S.sub }}>
                                    {fmtInt(p.ordersCount)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </Card>
    );
}

// Приоритет → тип сигнала для счётчиков
const PRIORITY_TYPE: Record<string, { label: string; dotColor: string }> = {
    HIGH:   { label: 'Действие',   dotColor: '#ef4444' },
    MEDIUM: { label: 'Наблюдение', dotColor: '#f59e0b' },
    LOW:    { label: 'Возможность', dotColor: '#10b981' },
};

function RecommendationsCard({
    recs, onSelect,
}: { recs: RecommendationDto[]; onSelect: (id: string) => void }) {
    const now = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    const countHigh   = recs.filter(r => r.priority === 'HIGH').length;
    const countMedium = recs.filter(r => r.priority === 'MEDIUM').length;
    const countLow    = recs.filter(r => r.priority === 'LOW').length;

    return (
        <Card>
            {/* Заголовок */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Sparkles size={18} color={S.blue} />
                    <span style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 16, color: S.ink }}>
                        AI-анализ
                    </span>
                    <span style={{
                        padding: '2px 7px', borderRadius: 6,
                        fontFamily: 'Inter', fontSize: 10, fontWeight: 700,
                        color: '#92400e', background: '#fef3c7',
                        border: '1px solid #fde68a',
                    }}>
                        BETA
                    </span>
                </div>
                <span style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted }}>
                    Обновлено {now}
                </span>
            </div>

            {/* Счётчики */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
                {[
                    { count: countHigh,   ...PRIORITY_TYPE.HIGH },
                    { count: countMedium, ...PRIORITY_TYPE.MEDIUM },
                    { count: countLow,    ...PRIORITY_TYPE.LOW },
                ].map(t => (
                    <div key={t.label} style={{
                        borderRadius: 10, border: `1px solid ${S.border}`,
                        padding: '12px 14px',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.dotColor, display: 'inline-block' }} />
                            <span style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub }}>{t.label}</span>
                        </div>
                        <div style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 22, color: S.ink }}>
                            {t.count}
                        </div>
                    </div>
                ))}
            </div>

            {/* Список */}
            {recs.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '24px 0' }}>
                    <CheckCircle2 size={28} color={S.green} />
                    <span style={{ fontFamily: 'Inter', fontSize: 13, color: S.sub }}>
                        Нет активных подсказок. Можно работать.
                    </span>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {recs.map((r) => (
                        <div
                            key={r.id}
                            onClick={() => r.productId && onSelect(r.productId)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 12,
                                borderRadius: 10, border: `1px solid ${S.border}`,
                                padding: '12px 14px', cursor: r.productId ? 'pointer' : 'default',
                                transition: 'background 0.12s',
                            }}
                            onMouseEnter={e => { if (r.productId) (e.currentTarget as HTMLElement).style.background = '#f8fafc'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                        >
                            {/* Фото или заглушка */}
                            <div style={{
                                width: 40, height: 40, borderRadius: 8, flexShrink: 0,
                                background: '#f1f5f9', border: `1px solid ${S.border}`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                position: 'relative', overflow: 'visible',
                            }}>
                                <span style={{ fontSize: 18 }}>📦</span>
                                <span style={{
                                    position: 'absolute', bottom: -2, right: -2,
                                    width: 10, height: 10, borderRadius: '50%',
                                    background: PRIORITY_TYPE[r.priority]?.dotColor ?? S.muted,
                                    border: '2px solid #fff',
                                }} />
                            </div>

                            {/* Текст */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                    fontFamily: 'Inter', fontWeight: 600, fontSize: 13, color: S.ink,
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>
                                    {r.name ?? (RULE_LABEL[r.ruleKey] ?? r.ruleKey)}
                                </div>
                                <div style={{ fontFamily: 'Inter', fontSize: 11, color: S.muted, marginTop: 2 }}>
                                    {r.sku && <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{r.sku}</span>}
                                    {r.sku && ' · '}
                                    {r.message || (REASON_EXPLAIN[r.reasonCode] ?? r.reasonCode)}
                                </div>
                            </div>

                            {r.productId && <ArrowRight size={14} color={S.muted} />}
                        </div>
                    ))}
                </div>
            )}

            {/* Ссылка внизу */}
            {recs.length > 0 && (
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${S.border}` }}>
                    <span style={{
                        fontFamily: 'Inter', fontSize: 13, fontWeight: 600,
                        color: S.blue, cursor: 'default',
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}>
                        Все инсайты <ArrowRight size={14} />
                    </span>
                </div>
            )}
        </Card>
    );
}

const ORDER_STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
    // Ozon
    awaiting_deliver:       { label: 'Ожидает доставки', color: '#92400e', bg: '#fef3c7' },
    awaiting_packaging:     { label: 'Ожидает упаковки',  color: '#1e40af', bg: '#dbeafe' },
    delivering:             { label: 'Доставляется',       color: '#065f46', bg: '#d1fae5' },
    delivered:              { label: 'Доставлен',          color: '#065f46', bg: '#d1fae5' },
    not_accepted:           { label: 'Не принят',          color: '#991b1b', bg: '#fee2e2' },
    cancelled:              { label: 'Отменён',            color: '#6b7280', bg: '#f3f4f6' },
    cancelled_from_split_order: { label: 'Отменён (сплит)', color: '#6b7280', bg: '#f3f4f6' },
    returned_by_client:     { label: 'Возврат клиента',   color: '#991b1b', bg: '#fee2e2' },
    driver_pickup:          { label: 'Курьер забрал',      color: '#1e40af', bg: '#dbeafe' },
    // WB
    new:                    { label: 'Новый',              color: '#1e40af', bg: '#dbeafe' },
    confirm:                { label: 'Подтверждён',        color: '#1e40af', bg: '#dbeafe' },
    complete:               { label: 'Выполнен',           color: '#065f46', bg: '#d1fae5' },
    cancel:                 { label: 'Отменён',            color: '#6b7280', bg: '#f3f4f6' },
    sorted:                 { label: 'Отсортирован',       color: '#92400e', bg: '#fef3c7' },
    sold:                   { label: 'Продан',             color: '#065f46', bg: '#d1fae5' },
    defect:                 { label: 'Брак',               color: '#991b1b', bg: '#fee2e2' },
    return:                 { label: 'Возврат',            color: '#991b1b', bg: '#fee2e2' },
};

function OrderStatusBadge({ status }: { status: string | null }) {
    if (!status) return <span style={{ color: S.muted, fontSize: 11 }}>—</span>;
    const key = status.toLowerCase();
    const s = ORDER_STATUS_MAP[key];
    return (
        <span style={{
            display: 'inline-block',
            padding: '2px 8px', borderRadius: 6,
            fontFamily: 'Inter', fontSize: 11, fontWeight: 600,
            color: s?.color ?? S.sub,
            background: s?.bg ?? '#f1f5f9',
            whiteSpace: 'nowrap',
        }}>
            {s?.label ?? status}
        </span>
    );
}

function ProductDrawer({
    productId, period, onClose,
}: { productId: string; period: { from: string; to: string }; onClose: () => void }) {
    const [data, setData] = useState<ProductDrillDown | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                setLoading(true);
                const r = await axios.get<ProductDrillDown>(`/analytics/products/${productId}`, { params: period });
                if (alive) setData(r.data);
            } catch (e: any) {
                if (alive) setErr(e?.response?.data?.message ?? 'Не удалось загрузить SKU');
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, [productId, period.from, period.to]);

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex' }}>
            {/* Backdrop */}
            <div
                style={{ flex: 1, background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(3px)' }}
                onClick={onClose}
            />
            {/* Drawer panel */}
            <div style={{
                width: '100%', maxWidth: 560, background: '#fff',
                boxShadow: '-8px 0 40px rgba(0,0,0,0.18)', overflowY: 'auto', display: 'flex', flexDirection: 'column',
            }}>
                {/* Drawer header */}
                <div style={{
                    padding: '20px 24px', borderBottom: `1px solid ${S.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    position: 'sticky', top: 0, background: '#fff', zIndex: 1,
                }}>
                    <div>
                        <h3 style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 18, color: S.ink, margin: '0 0 2px' }}>
                            {data?.product.sku ?? '…'}
                        </h3>
                        <p style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub, margin: 0 }}>
                            {data?.product.name ?? ''}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: '#f1f5f9', border: 'none', cursor: 'pointer',
                            width: 32, height: 32, borderRadius: 8,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', color: S.sub,
                        }}
                    >
                        <X size={16} />
                    </button>
                </div>

                {loading && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48, gap: 10 }}>
                        <Spinner size={18} />
                        <span style={{ fontFamily: 'Inter', fontSize: 13, color: S.sub }}>Загрузка…</span>
                    </div>
                )}
                {err && (
                    <div style={{
                        margin: 20, padding: '12px 16px', borderRadius: 10,
                        background: 'rgba(239,68,68,0.06)', border: `1px solid rgba(239,68,68,0.25)`,
                        fontFamily: 'Inter', fontSize: 13, color: S.red,
                    }}>
                        {err}
                    </div>
                )}
                {data && (
                    <>
                        {/* KPI mini-grid */}
                        <div style={{ padding: '20px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <DrillKpi label="Выручка" value={fmtMoney(data.kpis.revenueNet)} />
                            <DrillKpi label="Шт. продано" value={fmtInt(data.kpis.unitsSold)} />
                            <DrillKpi label="Заказов" value={fmtInt(data.kpis.ordersCount)} />
                            <DrillKpi label="Возвратов" value={fmtInt(data.kpis.returnsCount)} />
                            <DrillKpi label="Средняя цена" value={fmtMoney(data.kpis.avgPrice)} />
                            <DrillKpi label="Период" value={`${data.period.from} — ${data.period.to}`} />
                        </div>

                        {/* Recent orders table */}
                        <div style={{ borderTop: `1px solid ${S.border}` }}>
                            <div style={{
                                padding: '12px 24px',
                                fontFamily: 'Inter', fontSize: 11, fontWeight: 700,
                                color: S.muted, textTransform: 'uppercase', letterSpacing: '0.08em',
                                background: '#f8fafc',
                            }}>
                                Последние заказы (до 30)
                            </div>
                            {data.recentOrders.length === 0 ? (
                                <div style={{
                                    padding: '32px 24px', textAlign: 'center',
                                    fontFamily: 'Inter', fontSize: 13, color: S.sub,
                                }}>
                                    Нет заказов за период.
                                </div>
                            ) : (
                                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                                    <colgroup>
                                        <col style={{ width: '10%' }} />
                                        <col style={{ width: '26%' }} />
                                        <col style={{ width: '17%' }} />
                                        <col style={{ width: '6%' }} />
                                        <col style={{ width: '15%' }} />
                                        <col style={{ width: '26%' }} />
                                    </colgroup>
                                    <thead>
                                        <tr style={{ background: '#f8fafc', borderBottom: `1px solid ${S.border}` }}>
                                            {['МП', '№ заказа', 'Дата', 'Шт.', 'Сумма', 'Статус'].map((h, i) => (
                                                <th key={h} style={{
                                                    fontFamily: 'Inter', fontSize: 10, fontWeight: 700,
                                                    color: S.muted, textTransform: 'uppercase', letterSpacing: '0.08em',
                                                    padding: '8px 12px',
                                                    textAlign: i >= 3 && i <= 4 ? 'right' : 'left',
                                                }}>
                                                    {h}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.recentOrders.map((o, i) => (
                                            <tr
                                                key={i}
                                                style={{
                                                    borderBottom: i < data.recentOrders.length - 1 ? `1px solid ${S.border}` : 'none',
                                                    transition: 'background 0.12s',
                                                }}
                                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f8fafc'; }}
                                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                                            >
                                                <td style={{ padding: '8px 12px', fontFamily: 'Inter', fontWeight: 700, fontSize: 12, color: S.ink }}>
                                                    {o.marketplace}
                                                </td>
                                                <td style={{ padding: '8px 12px', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: S.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {o.marketplaceOrderId}
                                                </td>
                                                <td style={{ padding: '8px 12px', fontFamily: 'Inter', fontSize: 11, color: S.sub }}>
                                                    {fmtDate(o.marketplaceCreatedAt)}
                                                </td>
                                                <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'Inter', fontSize: 12, color: S.ink }}>
                                                    {o.quantity}
                                                </td>
                                                <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'Inter', fontSize: 12, fontWeight: 600, color: S.ink, whiteSpace: 'nowrap' }}>
                                                    {fmtMoney(o.totalAmount ?? 0)}
                                                </td>
                                                <td style={{ padding: '8px 12px' }}>
                                                    <OrderStatusBadge status={o.status} />
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function DrillKpi({ label, value }: { label: string; value: string }) {
    return (
        <div style={{
            borderRadius: 10, background: '#f8fafc', border: `1px solid ${S.border}`,
            padding: '10px 14px',
        }}>
            <div style={{
                fontFamily: 'Inter', fontSize: 10, fontWeight: 700, color: S.muted,
                textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4,
            }}>
                {label}
            </div>
            <div style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 15, color: S.ink }}>
                {value}
            </div>
        </div>
    );
}
