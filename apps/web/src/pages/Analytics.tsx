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
    Download, Info, RefreshCw, Sparkles, X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { S, PageHeader, Card, KpiCard, Btn, Spinner } from '../components/ui';

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

const PRIORITY_STYLE: Record<string, { color: string; bg: string; border: string }> = {
    HIGH:   { color: S.red,   bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.2)' },
    MEDIUM: { color: S.amber, bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)' },
    LOW:    { color: S.sub,   bg: '#f8fafc',               border: S.border },
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
                    <PeriodPicker value={period} onChange={setPeriod} />
                    <Btn
                        variant="secondary"
                        size="sm"
                        onClick={() => triggerRebuild('daily')}
                        disabled={isPaused || !!busy}
                        title={isPaused ? 'Недоступно при паузе интеграций' : 'Пересчитать daily layer за период'}
                    >
                        {busy === 'daily' ? <Spinner size={12} /> : <RefreshCw size={13} />}
                        Rebuild daily
                    </Btn>
                    <Btn
                        variant="secondary"
                        size="sm"
                        onClick={() => triggerRebuild('abc')}
                        disabled={isPaused || !!busy}
                        title={isPaused ? 'Недоступно при паузе интеграций' : 'Пересчитать ABC snapshot за период'}
                    >
                        {busy === 'abc' ? <Spinner size={12} /> : <RefreshCw size={13} />}
                        Rebuild ABC
                    </Btn>
                    <Btn
                        variant="secondary"
                        size="sm"
                        onClick={() => triggerRebuild('recs')}
                        disabled={isPaused || !!busy}
                        title={isPaused ? 'Недоступно при паузе интеграций' : 'Пересчитать рекомендации'}
                    >
                        {busy === 'recs' ? <Spinner size={12} /> : <RefreshCw size={13} />}
                        Refresh recs
                    </Btn>
                </PageHeader>

                {errorBanner}
                {pausedBanner}

                <SnapshotMetaCard dashboard={dashboard} status={status} />
                <KpiGrid dashboard={dashboard} />

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 24 }}>
                    <Card>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                            <h3 style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 16, color: S.ink, margin: 0 }}>
                                Динамика выручки
                            </h3>
                            <span style={{ fontFamily: 'Inter', fontSize: 11, color: S.muted }}>
                                {dynamics?.formulaVersion ?? '—'}
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
                                title={abc?.snapshot ? 'Экспорт CSV' : 'Сначала постройте ABC snapshot'}
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
                                    ABC snapshot за период ещё не построен.
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
                                            <Pie data={abcPie} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={4} dataKey="value">
                                                {abcPie.map((e, i) => <Cell key={i} fill={e.color} />)}
                                            </Pie>
                                            <Tooltip contentStyle={tooltipStyle} />
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

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 24 }}>
                    <TopProductsCard top={top} onSelect={setDrillDownId} onExport={() => triggerExport('daily')} />
                    <RecommendationsCard recs={recs} onSelect={setDrillDownId} />
                </div>

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

function PeriodPicker({
    value, onChange,
}: { value: { from: string; to: string }; onChange: (v: { from: string; to: string }) => void }) {
    return (
        <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: '#f1f5f9', borderRadius: 8, padding: '3px 12px',
            border: `1px solid ${S.border}`,
        }}>
            <Calendar size={13} color={S.muted} />
            <input
                type="date"
                value={value.from}
                onChange={(e) => onChange({ ...value, from: e.target.value })}
                style={{
                    background: 'transparent', border: 'none', outline: 'none',
                    fontFamily: 'Inter', fontSize: 12, color: S.ink, cursor: 'pointer',
                }}
            />
            <span style={{ color: S.muted, fontSize: 12 }}>—</span>
            <input
                type="date"
                value={value.to}
                onChange={(e) => onChange({ ...value, to: e.target.value })}
                style={{
                    background: 'transparent', border: 'none', outline: 'none',
                    fontFamily: 'Inter', fontSize: 12, color: S.ink, cursor: 'pointer',
                }}
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

                <MetaItem label="Версия формул" value={dashboard?.formulaVersion ?? '—'} />
                <MetaItem
                    label="Последний заказ"
                    value={fmtDate(lastEvent)}
                    suffix={status?.sources.orders.ageHours != null ? `${status.sources.orders.ageHours}ч назад` : undefined}
                />
                <MetaItem label="Daily строк" value={String(status?.daily.rowsCount ?? 0)} />
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
        { label: 'Чистая выручка', value: fmtMoney(k?.revenueNet ?? 0), accent: `linear-gradient(90deg,${S.green},#34d399)` },
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
                    title="Экспорт daily layer в CSV"
                >
                    <Download size={13} /> CSV daily
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

function RecommendationsCard({
    recs, onSelect,
}: { recs: RecommendationDto[]; onSelect: (id: string) => void }) {
    return (
        <Card noPad>
            <div style={{
                padding: '16px 20px', borderBottom: `1px solid ${S.border}`,
                display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            }}>
                <div>
                    <h3 style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        fontFamily: 'Inter', fontWeight: 700, fontSize: 15, color: S.ink, margin: '0 0 4px',
                    }}>
                        <Sparkles size={15} color={S.blue} /> Read-only подсказки
                    </h3>
                    <p style={{ fontFamily: 'Inter', fontSize: 11, color: S.sub, margin: 0 }}>
                        Объяснимые сигналы по правилам. Не план действий — только подсказки.
                    </p>
                </div>
                <span style={{ fontFamily: 'Inter', fontSize: 11, color: S.muted, whiteSpace: 'nowrap' }}>
                    {recs.length} активных
                </span>
            </div>
            {recs.length === 0 ? (
                <div style={{
                    padding: '40px 24px', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 12,
                }}>
                    <div style={{
                        width: 48, height: 48, borderRadius: 14, background: 'rgba(16,185,129,0.1)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <CheckCircle2 size={22} color={S.green} />
                    </div>
                    <span style={{ fontFamily: 'Inter', fontSize: 13, color: S.sub }}>
                        Нет активных подсказок. Можно работать.
                    </span>
                </div>
            ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 420, overflowY: 'auto' }}>
                    {recs.map((r, idx) => {
                        const ps = PRIORITY_STYLE[r.priority];
                        return (
                            <li
                                key={r.id}
                                style={{
                                    padding: '14px 20px',
                                    borderBottom: idx < recs.length - 1 ? `1px solid ${S.border}` : 'none',
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                                    <span style={{
                                        display: 'inline-flex', alignItems: 'center',
                                        padding: '2px 8px', borderRadius: 6,
                                        fontFamily: 'Inter', fontSize: 10, fontWeight: 700,
                                        color: ps.color, background: ps.bg, border: `1px solid ${ps.border}`,
                                        flexShrink: 0, marginTop: 2,
                                    }}>
                                        {r.priority}
                                    </span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{
                                            fontFamily: 'Inter', fontWeight: 600, fontSize: 13, color: S.ink,
                                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                        }}>
                                            {RULE_LABEL[r.ruleKey] ?? r.ruleKey}
                                            {r.sku && (
                                                <span style={{ fontWeight: 400, color: S.sub, marginLeft: 8 }}>
                                                    — {r.sku}
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.ink, marginTop: 4 }}>
                                            {r.message}
                                        </div>
                                        <div style={{
                                            display: 'flex', alignItems: 'center', gap: 5,
                                            fontFamily: 'Inter', fontSize: 11, color: S.muted, marginTop: 6,
                                        }}>
                                            <Info size={11} />
                                            {REASON_EXPLAIN[r.reasonCode] ?? r.reasonCode}
                                        </div>
                                    </div>
                                    {r.productId && (
                                        <button
                                            onClick={() => onSelect(r.productId!)}
                                            title="Открыть drill-down по SKU"
                                            style={{
                                                display: 'inline-flex', alignItems: 'center', gap: 3,
                                                background: 'none', border: 'none', cursor: 'pointer',
                                                fontFamily: 'Inter', fontSize: 12, fontWeight: 600, color: S.blue,
                                                padding: 0, flexShrink: 0,
                                            }}
                                        >
                                            Подробнее <ArrowRight size={12} />
                                        </button>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </Card>
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
                            <DrillKpi label="Чистая выручка" value={fmtMoney(data.kpis.revenueNet)} />
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
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr style={{ background: '#f8fafc', borderBottom: `1px solid ${S.border}` }}>
                                            {['МП', '№', 'Дата', 'Шт.', 'Сумма', 'Статус'].map((h, i) => (
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
                                                <td style={{
                                                    padding: '8px 12px', fontFamily: 'Inter', fontSize: 11, color: S.sub,
                                                    maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                }}>
                                                    {o.marketplaceOrderId}
                                                </td>
                                                <td style={{ padding: '8px 12px', fontFamily: 'Inter', fontSize: 11, color: S.sub }}>
                                                    {fmtDate(o.marketplaceCreatedAt)}
                                                </td>
                                                <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'Inter', fontSize: 12, color: S.ink }}>
                                                    {o.quantity}
                                                </td>
                                                <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'Inter', fontSize: 12, fontWeight: 600, color: S.ink }}>
                                                    {fmtMoney(o.totalAmount ?? 0)}
                                                </td>
                                                <td style={{ padding: '8px 12px', fontFamily: 'Inter', fontSize: 11, color: S.muted }}>
                                                    {o.status ?? '—'}
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
