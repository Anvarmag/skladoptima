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
import axios from 'axios';
import {
    Area, AreaChart, CartesianGrid, Cell, Legend, Pie, PieChart,
    ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
    AlertCircle, AlertTriangle, ArrowRight, Calendar, CheckCircle2, Database,
    Download, Info, RefreshCw, Sparkles, X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

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

interface TopProductsResp {
    items: Array<{ productId: string; sku: string; name: string | null; revenueNet: number; unitsSold: number; ordersCount: number }>;
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

const FRESHNESS_BADGE: Record<FreshnessClass, { label: string; tone: string; explain: string }> = {
    FRESH_AND_COMPLETE: {
        label: 'Свежие и полные',
        tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
        explain: 'Все источники свежие, расчёт полный.',
    },
    STALE_BUT_COMPLETE: {
        label: 'Устаревшие источники',
        tone: 'bg-amber-50 text-amber-800 ring-amber-200',
        explain: 'Расчёт полный, но источники старее 48ч. Запустите rebuild после обновления.',
    },
    INCOMPLETE_BUT_FRESH: {
        label: 'Неполные данные',
        tone: 'bg-orange-50 text-orange-700 ring-orange-200',
        explain: 'Источники свежие, но недостаточно данных за период.',
    },
    STALE_AND_INCOMPLETE: {
        label: 'Устаревшие и неполные',
        tone: 'bg-rose-50 text-rose-700 ring-rose-200',
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

const PRIORITY_TONE: Record<string, string> = {
    HIGH: 'bg-rose-50 text-rose-700 ring-rose-200',
    MEDIUM: 'bg-amber-50 text-amber-800 ring-amber-200',
    LOW: 'bg-slate-50 text-slate-600 ring-slate-200',
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

// ─── Component ───────────────────────────────────────────────────────

export default function Analytics() {
    const { activeTenant } = useAuth();
    const isPaused = activeTenant ? PAUSED_STATES.has(activeTenant.accessState) : false;

    const [period, setPeriod] = useState(defaultPeriod());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [dashboard, setDashboard] = useState<DashboardResp | null>(null);
    const [dynamics, setDynamics] = useState<RevenueDynamicsResp | null>(null);
    const [abc, setAbc] = useState<AbcResp | null>(null);
    const [top, setTop] = useState<TopProductsResp | null>(null);
    const [recs, setRecs] = useState<RecommendationDto[]>([]);
    const [status, setStatus] = useState<StatusResp | null>(null);

    const [busy, setBusy] = useState<string | null>(null);
    const [drillDownId, setDrillDownId] = useState<string | null>(null);

    const fetchAll = async () => {
        setLoading(true);
        setError(null);
        try {
            const [dRes, dynRes, abcRes, topRes, recRes, stRes] = await Promise.all([
                axios.get<DashboardResp>('/analytics/dashboard', { params: period }),
                axios.get<RevenueDynamicsResp>('/analytics/revenue-dynamics', { params: period }),
                axios.get<AbcResp>('/analytics/abc', { params: period }),
                axios.get<TopProductsResp>('/analytics/products/top', { params: { ...period, limit: 10 } }),
                axios.get<RecommendationDto[]>('/analytics/recommendations'),
                axios.get<StatusResp>('/analytics/status'),
            ]);
            setDashboard(dRes.data);
            setDynamics(dynRes.data);
            setAbc(abcRes.data);
            setTop(topRes.data);
            setRecs(recRes.data);
            setStatus(stRes.data);
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
    }, [period.from, period.to]);

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
        return <div className="p-8 text-center text-slate-500">Загрузка аналитики…</div>;
    }

    return (
        <div className="space-y-6">
            {/* ─── Header + period + actions ───────────────────────── */}
            <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Аналитика и рекомендации</h1>
                    <p className="text-slate-500 text-sm mt-1">
                        Управленческий обзор продаж, ABC и read-only подсказок по ассортименту.
                    </p>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                    <PeriodPicker value={period} onChange={setPeriod} />
                    <button
                        onClick={() => triggerRebuild('daily')}
                        disabled={isPaused || !!busy}
                        title={isPaused ? 'Недоступно при паузе интеграций' : 'Пересчитать daily layer за период'}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${busy === 'daily' ? 'animate-spin' : ''}`} />
                        Rebuild daily
                    </button>
                    <button
                        onClick={() => triggerRebuild('abc')}
                        disabled={isPaused || !!busy}
                        title={isPaused ? 'Недоступно при паузе интеграций' : 'Пересчитать ABC snapshot за период'}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${busy === 'abc' ? 'animate-spin' : ''}`} />
                        Rebuild ABC
                    </button>
                    <button
                        onClick={() => triggerRebuild('recs')}
                        disabled={isPaused || !!busy}
                        title={isPaused ? 'Недоступно при паузе интеграций' : 'Пересчитать рекомендации'}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${busy === 'recs' ? 'animate-spin' : ''}`} />
                        Refresh recs
                    </button>
                </div>
            </div>

            {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    {error}
                    <button className="ml-auto" onClick={() => setError(null)}><X className="h-4 w-4" /></button>
                </div>
            )}

            {isPaused && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 mt-0.5" />
                    <div>
                        <div className="font-semibold">Read-only режим</div>
                        <div className="text-amber-800">
                            Tenant в состоянии {activeTenant?.accessState}. Рекомендации и snapshot'ы остаются доступны
                            на чтение, rebuild/refresh заблокированы политикой компании.
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Snapshot meta + KPI cards ───────────────────────── */}
            <SnapshotMetaCard dashboard={dashboard} status={status} />

            <KpiGrid dashboard={dashboard} />

            {/* ─── Charts row: revenue dynamics + ABC pie ──────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-slate-900">Динамика выручки</h3>
                        <span className="text-[11px] text-slate-400">{dynamics?.formulaVersion ?? '—'}</span>
                    </div>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={(dynamics?.series ?? []).map((s) => ({
                                date: s.date.slice(5),
                                wb: s.byMarketplace?.WB?.revenueNet ?? 0,
                                ozon: s.byMarketplace?.OZON?.revenueNet ?? 0,
                                total: s.revenueNet,
                            }))}>
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
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} />
                                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                                <Tooltip />
                                <Legend />
                                <Area name="Wildberries" type="monotone" dataKey="wb" stroke="#8b5cf6" fill="url(#colorWB)" strokeWidth={2} />
                                <Area name="Ozon" type="monotone" dataKey="ozon" stroke="#3b82f6" fill="url(#colorOzon)" strokeWidth={2} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="text-lg font-bold text-slate-900">ABC-анализ</h3>
                            <p className="text-xs text-slate-500">по revenue_net • A=80%, B=15%, C=5%</p>
                        </div>
                        <button
                            onClick={() => triggerExport('abc')}
                            disabled={!abc?.snapshot}
                            title={abc?.snapshot ? 'Экспорт CSV' : 'Сначала постройте ABC snapshot'}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-40"
                        >
                            <Download className="h-3.5 w-3.5" /> CSV
                        </button>
                    </div>
                    {!abc?.snapshot ? (
                        <div className="h-64 flex flex-col items-center justify-center gap-2 text-sm text-slate-500">
                            <Database className="h-8 w-8 text-slate-300" />
                            <div>ABC snapshot за период ещё не построен.</div>
                            <button
                                onClick={() => triggerRebuild('abc')}
                                disabled={isPaused || !!busy}
                                className="text-xs font-semibold text-blue-600 hover:underline disabled:opacity-50"
                            >
                                Построить сейчас
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="h-48 flex items-center">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={abcPie} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={4} dataKey="value">
                                            {abcPie.map((e, i) => <Cell key={i} fill={e.color} />)}
                                        </Pie>
                                        <Tooltip />
                                        <Legend layout="vertical" align="right" verticalAlign="middle" />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-center text-xs">
                                {(['A', 'B', 'C'] as const).map((g) => (
                                    <div key={g} className="rounded-lg bg-slate-50 px-2 py-2">
                                        <div className="font-bold text-slate-900">
                                            {abc.snapshot!.payload.totals.groupCounts[g]} тов.
                                        </div>
                                        <div className="text-slate-500">
                                            {abc.snapshot!.payload.totals.groupShares[g].toFixed(1)}% выручки
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* ─── Top SKU + Recommendations ───────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <TopProductsCard top={top} onSelect={setDrillDownId} onExport={() => triggerExport('daily')} />
                <RecommendationsCard recs={recs} onSelect={setDrillDownId} />
            </div>

            {drillDownId && (
                <ProductDrawer
                    productId={drillDownId}
                    period={period}
                    onClose={() => setDrillDownId(null)}
                />
            )}
        </div>
    );
}

// ─── Sub-components ──────────────────────────────────────────────────

function PeriodPicker({
    value, onChange,
}: { value: { from: string; to: string }; onChange: (v: { from: string; to: string }) => void }) {
    return (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700">
            <Calendar className="h-3.5 w-3.5 text-slate-400" />
            <input
                type="date"
                value={value.from}
                onChange={(e) => onChange({ ...value, from: e.target.value })}
                className="bg-transparent border-0 outline-none text-xs"
            />
            <span className="text-slate-400">—</span>
            <input
                type="date"
                value={value.to}
                onChange={(e) => onChange({ ...value, to: e.target.value })}
                className="bg-transparent border-0 outline-none text-xs"
            />
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
        <div className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-wrap items-center gap-4 text-xs">
            {badge ? (
                <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold ring-1 ${badge.tone}`}
                    title={badge.explain}
                >
                    {cls === 'FRESH_AND_COMPLETE' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                    {badge.label}
                </span>
            ) : dashboard?.snapshotStatus === 'EMPTY' ? (
                <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold ring-1 bg-slate-50 text-slate-600 ring-slate-200">
                    <Database className="h-3.5 w-3.5" /> Нет данных за период
                </span>
            ) : null}
            <div className="text-slate-500">
                Версия формул: <span className="font-semibold text-slate-700">{dashboard?.formulaVersion ?? '—'}</span>
            </div>
            <div className="text-slate-500">
                Последний заказ: <span className="font-semibold text-slate-700">{fmtDate(lastEvent)}</span>
                {status?.sources.orders.ageHours != null && (
                    <span className="ml-1 text-slate-400">({status.sources.orders.ageHours}ч назад)</span>
                )}
            </div>
            <div className="text-slate-500">
                Daily strok: <span className="font-semibold text-slate-700">{status?.daily.rowsCount ?? 0}</span>
            </div>
            <div className="text-slate-500 ml-auto">
                Активных рекомендаций: <span className="font-semibold text-slate-700">{status?.recommendations.activeCount ?? 0}</span>
            </div>
        </div>
    );
}

function KpiGrid({ dashboard }: { dashboard: DashboardResp | null }) {
    const k = dashboard?.kpis;
    const tiles: Array<{ label: string; value: string; hint?: string }> = [
        { label: 'Чистая выручка', value: fmtMoney(k?.revenueNet ?? 0) },
        { label: 'Заказов', value: fmtInt(k?.ordersCount ?? 0) },
        { label: 'Штук продано', value: fmtInt(k?.unitsSold ?? 0) },
        { label: 'Средний чек', value: fmtMoney(k?.avgCheck ?? 0) },
        { label: 'Возвратов', value: fmtInt(k?.returnsCount ?? 0) },
        {
            label: 'Топ маркетплейс',
            value: k?.topMarketplaceShare.marketplace
                ? `${k.topMarketplaceShare.marketplace} • ${fmtPct(k.topMarketplaceShare.sharePct)}`
                : '—',
        },
    ];
    return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {tiles.map((t) => (
                <div key={t.label} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">{t.label}</div>
                    <div className="mt-1 text-lg font-bold text-slate-900 truncate">{t.value}</div>
                </div>
            ))}
        </div>
    );
}

function TopProductsCard({
    top, onSelect, onExport,
}: { top: TopProductsResp | null; onSelect: (id: string) => void; onExport: () => void }) {
    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900">Топ SKU за период</h3>
                <button
                    onClick={onExport}
                    title="Экспорт daily layer в CSV"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
                >
                    <Download className="h-3.5 w-3.5" /> CSV daily
                </button>
            </div>
            {!top || top.items.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-500">Нет данных за период.</div>
            ) : (
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-[11px] text-slate-500 uppercase tracking-wider">
                            <th className="text-left px-4 py-2">SKU / Название</th>
                            <th className="text-right px-4 py-2">Выручка</th>
                            <th className="text-right px-4 py-2">Шт.</th>
                            <th className="text-right px-4 py-2">Заказы</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {top.items.map((p) => (
                            <tr key={p.productId || p.sku} className="hover:bg-slate-50 cursor-pointer" onClick={() => p.productId && onSelect(p.productId)}>
                                <td className="px-4 py-2">
                                    <div className="font-semibold text-slate-900">{p.sku}</div>
                                    <div className="text-xs text-slate-500 truncate max-w-[220px]">{p.name ?? '—'}</div>
                                </td>
                                <td className="px-4 py-2 text-right font-semibold text-slate-900">{fmtMoney(p.revenueNet)}</td>
                                <td className="px-4 py-2 text-right text-slate-700">{fmtInt(p.unitsSold)}</td>
                                <td className="px-4 py-2 text-right text-slate-700">{fmtInt(p.ordersCount)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

function RecommendationsCard({
    recs, onSelect,
}: { recs: RecommendationDto[]; onSelect: (id: string) => void }) {
    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                    <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-blue-500" /> Read-only подсказки
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                        Объяснимые сигналы по правилам. Не план действий — только подсказки.
                    </p>
                </div>
                <span className="text-[11px] text-slate-400">{recs.length} активных</span>
            </div>
            {recs.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-500 flex flex-col items-center gap-2">
                    <CheckCircle2 className="h-8 w-8 text-emerald-300" />
                    Нет активных подсказок. Можно работать.
                </div>
            ) : (
                <ul className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
                    {recs.map((r) => (
                        <li key={r.id} className="p-4 hover:bg-slate-50">
                            <div className="flex items-start gap-3">
                                <span className={`mt-0.5 inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold ring-1 ${PRIORITY_TONE[r.priority]}`}>
                                    {r.priority}
                                </span>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-semibold text-slate-900 truncate">
                                        {RULE_LABEL[r.ruleKey] ?? r.ruleKey}
                                        {r.sku && <span className="ml-2 text-slate-500 font-normal">— {r.sku}</span>}
                                    </div>
                                    <div className="mt-1 text-xs text-slate-700">{r.message}</div>
                                    <div className="mt-1.5 text-[11px] text-slate-500 flex items-center gap-1">
                                        <Info className="h-3 w-3" />
                                        {REASON_EXPLAIN[r.reasonCode] ?? r.reasonCode}
                                    </div>
                                </div>
                                {r.productId && (
                                    <button
                                        onClick={() => onSelect(r.productId!)}
                                        title="Открыть drill-down по SKU"
                                        className="text-blue-600 text-xs font-semibold inline-flex items-center gap-0.5 hover:underline"
                                    >
                                        Подробнее <ArrowRight className="h-3 w-3" />
                                    </button>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
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
        <div className="fixed inset-0 z-50 flex">
            <div className="flex-1 bg-slate-900/40" onClick={onClose} />
            <div className="w-full max-w-xl bg-white shadow-2xl overflow-y-auto">
                <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-slate-900">{data?.product.sku ?? '…'}</h3>
                        <p className="text-xs text-slate-500">{data?.product.name ?? ''}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
                </div>
                {loading && <div className="p-8 text-center text-sm text-slate-500">Загрузка…</div>}
                {err && <div className="p-5 text-sm text-rose-700 bg-rose-50">{err}</div>}
                {data && (
                    <>
                        <div className="p-5 grid grid-cols-2 gap-3 text-sm">
                            <DrillKpi label="Чистая выручка" value={fmtMoney(data.kpis.revenueNet)} />
                            <DrillKpi label="Шт. продано" value={fmtInt(data.kpis.unitsSold)} />
                            <DrillKpi label="Заказов" value={fmtInt(data.kpis.ordersCount)} />
                            <DrillKpi label="Возвратов" value={fmtInt(data.kpis.returnsCount)} />
                            <DrillKpi label="Средняя цена" value={fmtMoney(data.kpis.avgPrice)} />
                            <DrillKpi label="Период" value={`${data.period.from} — ${data.period.to}`} />
                        </div>
                        <div className="border-t border-slate-100">
                            <div className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                                Последние заказы (до 30)
                            </div>
                            {data.recentOrders.length === 0 ? (
                                <div className="px-5 py-8 text-center text-sm text-slate-500">Нет заказов за период.</div>
                            ) : (
                                <table className="w-full text-xs">
                                    <thead className="bg-slate-50 text-slate-500">
                                        <tr>
                                            <th className="text-left px-4 py-2">МП</th>
                                            <th className="text-left px-4 py-2">№</th>
                                            <th className="text-left px-4 py-2">Дата</th>
                                            <th className="text-right px-4 py-2">Шт.</th>
                                            <th className="text-right px-4 py-2">Сумма</th>
                                            <th className="text-left px-4 py-2">Статус</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {data.recentOrders.map((o, i) => (
                                            <tr key={i} className="hover:bg-slate-50">
                                                <td className="px-4 py-2 font-semibold">{o.marketplace}</td>
                                                <td className="px-4 py-2 truncate max-w-[120px]">{o.marketplaceOrderId}</td>
                                                <td className="px-4 py-2">{fmtDate(o.marketplaceCreatedAt)}</td>
                                                <td className="px-4 py-2 text-right">{o.quantity}</td>
                                                <td className="px-4 py-2 text-right">{fmtMoney(o.totalAmount ?? 0)}</td>
                                                <td className="px-4 py-2 text-slate-500">{o.status ?? '—'}</td>
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
        <div className="rounded-xl bg-slate-50 px-3 py-2">
            <div className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">{label}</div>
            <div className="mt-0.5 text-sm font-bold text-slate-900">{value}</div>
        </div>
    );
}
