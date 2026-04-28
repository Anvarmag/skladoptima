import { useEffect, useState } from 'react';
import axios from 'axios';
import {
    AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2,
    PauseCircle, RefreshCw, ShieldAlert, TrendingUp, TrendingDown,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// ─── Domain types (mirror backend FinanceReadService DTO) ────────────
type FreshnessClass =
    | 'FRESH_AND_COMPLETE' | 'STALE_BUT_COMPLETE'
    | 'INCOMPLETE_BUT_FRESH' | 'STALE_AND_INCOMPLETE';

type WarningType =
    | 'MISSING_COST' | 'MISSING_FEES' | 'MISSING_LOGISTICS'
    | 'MISSING_TAX' | 'MISSING_ADS_COST' | 'MISSING_RETURNS_DATA'
    | 'STALE_FINANCIAL_SOURCE';

interface SnapshotMeta {
    id: string;
    periodFrom: string;
    periodTo: string;
    periodType: string;
    formulaVersion: string;
    snapshotStatus: 'READY' | 'INCOMPLETE' | 'FAILED';
    generatedAt: string;
    sourceFreshness?: any;
}

interface UEItem {
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
    warnings: WarningType[];
}

interface ListResp {
    items: UEItem[];
    snapshot: SnapshotMeta | null;
}

interface DashboardResp {
    snapshot: SnapshotMeta | null;
    totals: {
        revenue: number; cogs: number; marketplaceFees: number; logistics: number;
        adsCost: number; returnsImpact: number; taxImpact: number; additionalCharges: number;
        profit: number; marginPct: number | null; roiPct: number | null;
        skuCount: number; incompleteSkuCount: number;
    };
    aggregatedWarnings: WarningType[];
    topProfitable: Array<{ productId: string; sku: string; profit: number }>;
    negativeMarginSkus: Array<{ productId: string; sku: string; profit: number; marginPct: number | null }>;
}

interface DetailResp {
    item: UEItem;
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

// ─── Labels ──────────────────────────────────────────────────────────
const WARNING_LABEL: Record<WarningType, { label: string; explain: string; critical: boolean }> = {
    MISSING_COST: {
        label: 'Не задана себестоимость',
        explain: 'Базовая себестоимость не введена в карточке товара. Расчёт COGS неполный.',
        critical: true,
    },
    MISSING_FEES: {
        label: 'Нет данных по комиссиям',
        explain: 'Финансовый отчёт маркетплейса за период не загружен. Комиссия не учтена.',
        critical: true,
    },
    MISSING_LOGISTICS: {
        label: 'Нет данных по логистике',
        explain: 'Логистические расходы из отчёта маркетплейса отсутствуют.',
        critical: true,
    },
    MISSING_TAX: {
        label: 'Нет данных по налогам',
        explain: 'Расчёт налога не выполнен. На итог влияет несильно, но прибыль завышена.',
        critical: false,
    },
    MISSING_ADS_COST: {
        label: 'Нет данных по рекламе',
        explain: 'Рекламные расходы не подгружены. Прибыль может быть завышена.',
        critical: false,
    },
    MISSING_RETURNS_DATA: {
        label: 'Нет данных по возвратам',
        explain: 'Возвраты не учтены — прибыль может быть завышена.',
        critical: false,
    },
    STALE_FINANCIAL_SOURCE: {
        label: 'Устаревшие источники',
        explain: 'Один из источников данных не обновлялся более 48 часов. Цифры могут не отражать реальность.',
        critical: false,
    },
};

const FRESHNESS_BADGE: Record<FreshnessClass, { label: string; tone: string; explain: string }> = {
    FRESH_AND_COMPLETE: {
        label: 'Свежие и полные данные',
        tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
        explain: 'Все источники свежие, критичные компоненты на месте.',
    },
    STALE_BUT_COMPLETE: {
        label: 'Устаревшие источники',
        tone: 'bg-amber-50 text-amber-800 ring-amber-200',
        explain: 'Структура расчёта полная, но источники старее 48ч. Запустите rebuild после обновления.',
    },
    INCOMPLETE_BUT_FRESH: {
        label: 'Неполные данные',
        tone: 'bg-orange-50 text-orange-700 ring-orange-200',
        explain: 'Источники свежие, но критичные компоненты (cost / fees / logistics) отсутствуют.',
    },
    STALE_AND_INCOMPLETE: {
        label: 'Устаревшие и неполные',
        tone: 'bg-rose-50 text-rose-700 ring-rose-200',
        explain: 'Источники старше 48ч + отсутствуют критичные компоненты. Доверять цифрам нельзя.',
    },
};

const PAUSED_STATES = new Set(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED']);

// ─── Helpers ─────────────────────────────────────────────────────────
function classifyFreshness(snap: SnapshotMeta | null): FreshnessClass | null {
    if (!snap) return null;
    const sf = snap.sourceFreshness as any;
    const isStale = !!(sf?.orders?.isStale || sf?.fees?.isStale);
    const isIncomplete = snap.snapshotStatus === 'INCOMPLETE';
    if (isStale && isIncomplete) return 'STALE_AND_INCOMPLETE';
    if (isStale) return 'STALE_BUT_COMPLETE';
    if (isIncomplete) return 'INCOMPLETE_BUT_FRESH';
    return 'FRESH_AND_COMPLETE';
}
function fmtMoney(n: number | null | undefined) {
    if (n === null || n === undefined) return '—';
    return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';
}
function fmtPct(n: number | null | undefined) {
    if (n === null || n === undefined) return '—';
    return `${n.toFixed(2)} %`;
}
function fmtDate(iso: string | null | undefined) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
}

// ─── Component ───────────────────────────────────────────────────────
export default function UnitEconomics() {
    const { activeTenant } = useAuth();
    const isPaused = activeTenant ? PAUSED_STATES.has(activeTenant.accessState) : false;

    const [list, setList] = useState<ListResp | null>(null);
    const [dashboard, setDashboard] = useState<DashboardResp | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [search, setSearch] = useState('');
    const [incompleteOnly, setIncompleteOnly] = useState(false);

    const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
    const [rebuilding, setRebuilding] = useState(false);
    const [rebuildResult, setRebuildResult] = useState<string | null>(null);

    const fetchData = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (search.trim()) params.set('search', search.trim());
            if (incompleteOnly) params.set('incompleteOnly', 'true');

            const [l, d] = await Promise.all([
                axios.get(`/finance/unit-economics?${params.toString()}`),
                axios.get('/finance/dashboard'),
            ]);
            setList(l.data);
            setDashboard(d.data);
            setError(null);
        } catch (err: any) {
            setError(err?.response?.data?.message ?? 'Не удалось загрузить unit-экономику');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const t = setTimeout(fetchData, 200);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search, incompleteOnly]);

    const snapshot = list?.snapshot ?? dashboard?.snapshot ?? null;
    const freshness = classifyFreshness(snapshot);
    const items = list?.items ?? [];

    const onRebuild = async () => {
        if (!snapshot) {
            // нет snapshot — построим за последние 30 дней
            await rebuildPeriod(30);
            return;
        }
        // rebuild текущего периода
        await rebuildPeriod(null, snapshot.periodFrom, snapshot.periodTo, snapshot.periodType);
    };

    const rebuildPeriod = async (
        days: number | null,
        periodFrom?: string,
        periodTo?: string,
        periodType?: string,
    ) => {
        setRebuilding(true);
        setRebuildResult(null);
        try {
            const body = days
                ? {
                      periodFrom: new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10),
                      periodTo: new Date().toISOString().slice(0, 10),
                      periodType: 'CUSTOM',
                  }
                : { periodFrom, periodTo, periodType };
            const r = await axios.post('/finance/snapshots/rebuild', body);
            setRebuildResult(`Snapshot ${r.data.snapshotStatus} · SKU: ${r.data.skuCount} (incomplete: ${r.data.incompleteSkuCount})`);
            await fetchData();
        } catch (err: any) {
            const code = err?.response?.data?.code;
            setRebuildResult(`Ошибка: ${code ?? err?.response?.data?.message ?? 'Не удалось'}`);
        } finally {
            setRebuilding(false);
        }
    };

    return (
        <div className="space-y-6">
            <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Unit-экономика</h1>
                    <p className="text-slate-500 mt-1 text-xs sm:text-sm">
                        Прибыльность по SKU из последнего snapshot. Все цифры воспроизводимы по версии формулы.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={fetchData}
                        disabled={loading}
                        className="inline-flex items-center px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                        <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                        Обновить
                    </button>
                    <button
                        onClick={onRebuild}
                        disabled={rebuilding || isPaused}
                        title={isPaused ? 'Недоступно при паузе интеграций' : 'Пересчитать snapshot'}
                        className="inline-flex items-center px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                    >
                        {rebuilding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <TrendingUp className="h-4 w-4 mr-2" />}
                        Пересчитать
                    </button>
                </div>
            </header>

            {/* Paused banner */}
            {isPaused && (
                <div className="border border-amber-200 bg-amber-50 text-amber-900 rounded-xl px-4 py-3 flex items-start gap-3">
                    <PauseCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                        <div className="font-semibold">Финансовые источники на паузе</div>
                        <div className="mt-0.5">
                            История snapshots доступна для просмотра, но пересчёт и подгрузка новых данных
                            заблокированы политикой компании ({activeTenant?.accessState}).
                            Цифры ниже могут не отражать актуальное состояние.
                        </div>
                    </div>
                </div>
            )}

            {error && (
                <div className="flex items-center p-4 bg-red-50 text-red-700 rounded-xl border border-red-100">
                    <AlertCircle className="h-5 w-5 mr-3 shrink-0" />
                    <p className="text-sm font-medium">{error}</p>
                </div>
            )}

            {rebuildResult && (
                <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    Результат пересчёта: {rebuildResult}
                </div>
            )}

            {/* Snapshot metadata + freshness badge */}
            <SnapshotMetaCard snapshot={snapshot} freshness={freshness} />

            {/* KPI Tiles */}
            {dashboard && (
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                    <KpiTile label="Выручка" value={fmtMoney(dashboard.totals.revenue)} tone="blue" />
                    <KpiTile label="COGS" value={fmtMoney(dashboard.totals.cogs)} tone="slate" />
                    <KpiTile label="Прибыль" value={fmtMoney(dashboard.totals.profit)} tone={dashboard.totals.profit >= 0 ? 'emerald' : 'rose'} />
                    <KpiTile label="Маржа" value={fmtPct(dashboard.totals.marginPct)} tone="violet" />
                    <KpiTile label="ROI" value={fmtPct(dashboard.totals.roiPct)} tone="violet" />
                    <KpiTile label="Incomplete SKU" value={`${dashboard.totals.incompleteSkuCount} / ${dashboard.totals.skuCount}`} tone={dashboard.totals.incompleteSkuCount > 0 ? 'amber' : 'emerald'} />
                </div>
            )}

            {/* Aggregated warnings */}
            {dashboard && dashboard.aggregatedWarnings.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                        Активные предупреждения
                    </div>
                    <ul className="space-y-1.5">
                        {dashboard.aggregatedWarnings.map((w) => (
                            <li key={w} className="flex items-start gap-2 text-sm">
                                <ShieldAlert className={`h-4 w-4 mt-0.5 flex-shrink-0 ${WARNING_LABEL[w].critical ? 'text-rose-500' : 'text-amber-500'}`} />
                                <div>
                                    <span className="font-semibold text-slate-800">{WARNING_LABEL[w].label}</span>
                                    <span className="text-slate-500 ml-2">{WARNING_LABEL[w].explain}</span>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Top profitable / negative margin */}
            {dashboard && (dashboard.topProfitable.length > 0 || dashboard.negativeMarginSkus.length > 0) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <ListBox
                        title="Топ-3 прибыльных SKU"
                        icon={<TrendingUp className="h-4 w-4 text-emerald-500" />}
                        items={dashboard.topProfitable.map((p) => ({
                            primary: p.sku, secondary: fmtMoney(p.profit), tone: 'emerald',
                            onClick: () => setSelectedProductId(p.productId),
                        }))}
                    />
                    <ListBox
                        title={`Отрицательная прибыль (${dashboard.negativeMarginSkus.length})`}
                        icon={<TrendingDown className="h-4 w-4 text-rose-500" />}
                        items={dashboard.negativeMarginSkus.slice(0, 5).map((p) => ({
                            primary: p.sku, secondary: `${fmtMoney(p.profit)} · ${fmtPct(p.marginPct)}`, tone: 'rose',
                            onClick: () => setSelectedProductId(p.productId),
                        }))}
                    />
                </div>
            )}

            {/* Filters */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col sm:flex-row gap-3 items-end">
                <div className="flex-1 w-full">
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                        Поиск по SKU
                    </label>
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="SKU-1001"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm"
                    />
                </div>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none mt-4 sm:mt-0">
                    <input
                        type="checkbox"
                        checked={incompleteOnly}
                        onChange={(e) => setIncompleteOnly(e.target.checked)}
                        className="rounded border-slate-300"
                    />
                    Только incomplete
                </label>
            </div>

            {/* Profitability table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-slate-50/60 border-b border-slate-100">
                            <tr>
                                <Th>SKU</Th>
                                <Th>Кол-во</Th>
                                <Th>Выручка</Th>
                                <Th>COGS</Th>
                                <Th>Комиссии</Th>
                                <Th>Логистика</Th>
                                <Th>Прибыль</Th>
                                <Th>Маржа</Th>
                                <Th>ROI</Th>
                                <Th>Состояние</Th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading && items.length === 0 ? (
                                <tr><td colSpan={10} className="py-16 text-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin inline-block" /></td></tr>
                            ) : items.length === 0 ? (
                                <tr><td colSpan={10} className="py-16 text-center text-slate-400 italic">
                                    {snapshot ? 'Нет данных по выбранным фильтрам' : 'Snapshot ещё не построен. Нажмите «Пересчитать».'}
                                </td></tr>
                            ) : (
                                items.map((it) => (
                                    <tr
                                        key={it.productId}
                                        onClick={() => setSelectedProductId(it.productId)}
                                        className="hover:bg-slate-50/60 cursor-pointer"
                                    >
                                        <td className="px-4 py-3 font-mono text-sm font-semibold text-slate-900">{it.sku}</td>
                                        <td className="px-4 py-3 text-sm text-slate-700 text-right">{it.soldQty}</td>
                                        <td className="px-4 py-3 text-sm text-slate-700">{fmtMoney(it.revenue)}</td>
                                        <td className="px-4 py-3 text-sm text-slate-700">{fmtMoney(it.cogs)}</td>
                                        <td className="px-4 py-3 text-sm text-slate-700">{fmtMoney(it.marketplaceFees)}</td>
                                        <td className="px-4 py-3 text-sm text-slate-700">{fmtMoney(it.logistics)}</td>
                                        <td className={`px-4 py-3 text-sm font-bold ${it.profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmtMoney(it.profit)}</td>
                                        <td className="px-4 py-3 text-sm text-slate-700">{fmtPct(it.marginPct)}</td>
                                        <td className="px-4 py-3 text-sm text-slate-700">{fmtPct(it.roiPct)}</td>
                                        <td className="px-4 py-3 text-sm">
                                            {it.isIncomplete ? (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 ring-1 ring-amber-200">
                                                    incomplete · {it.warnings.length}
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                                                    OK
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {selectedProductId && (
                <ProductDrawer
                    productId={selectedProductId}
                    onClose={() => setSelectedProductId(null)}
                    onSaved={fetchData}
                    isPaused={isPaused}
                />
            )}
        </div>
    );
}

// ─── Subcomponents ───────────────────────────────────────────────────

function SnapshotMetaCard({ snapshot, freshness }: { snapshot: SnapshotMeta | null; freshness: FreshnessClass | null }) {
    if (!snapshot) {
        return (
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-600 flex items-center gap-2">
                <Info className="h-4 w-4 text-slate-400" />
                Snapshot ещё не построен. Нажмите «Пересчитать», чтобы собрать данные за последние 30 дней.
            </div>
        );
    }
    const f = freshness ?? 'FRESH_AND_COMPLETE';
    return (
        <div className={`border rounded-xl px-4 py-3 text-sm flex flex-wrap items-center gap-x-6 gap-y-2 ${FRESHNESS_BADGE[f].tone}`}>
            <div>
                <div className="text-[10px] uppercase tracking-wider opacity-80">Период</div>
                <div className="font-semibold">{snapshot.periodFrom} → {snapshot.periodTo}</div>
            </div>
            <div>
                <div className="text-[10px] uppercase tracking-wider opacity-80">Версия формулы</div>
                <div className="font-semibold font-mono">{snapshot.formulaVersion}</div>
            </div>
            <div>
                <div className="text-[10px] uppercase tracking-wider opacity-80">Сгенерирован</div>
                <div className="font-semibold">{fmtDate(snapshot.generatedAt)}</div>
            </div>
            <div className="ml-auto">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ring-1 ring-inset bg-white">
                    {FRESHNESS_BADGE[f].label}
                </span>
                <div className="text-[11px] mt-1 opacity-80 max-w-md">{FRESHNESS_BADGE[f].explain}</div>
            </div>
        </div>
    );
}

function KpiTile({ label, value, tone }: { label: string; value: string; tone: string }) {
    const toneMap: Record<string, string> = {
        blue: 'bg-blue-50 text-blue-700',
        slate: 'bg-slate-100 text-slate-700',
        emerald: 'bg-emerald-50 text-emerald-700',
        rose: 'bg-rose-50 text-rose-700',
        violet: 'bg-violet-50 text-violet-700',
        amber: 'bg-amber-50 text-amber-800',
    };
    return (
        <div className={`rounded-xl px-3 py-3 ${toneMap[tone]}`}>
            <div className="text-[10px] uppercase tracking-wider font-semibold opacity-80">{label}</div>
            <div className="text-lg font-bold mt-0.5">{value}</div>
        </div>
    );
}

function Th({ children }: { children?: React.ReactNode }) {
    return <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{children}</th>;
}

function ListBox({
    title, icon, items,
}: {
    title: string;
    icon: React.ReactNode;
    items: Array<{ primary: string; secondary: string; tone: string; onClick: () => void }>;
}) {
    return (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2 mb-3">
                {icon}{title}
            </div>
            {items.length === 0 ? (
                <div className="text-xs text-slate-400 italic">Пусто</div>
            ) : (
                <ul className="space-y-2">
                    {items.map((it, i) => (
                        <li key={i}>
                            <button
                                onClick={it.onClick}
                                className="w-full text-left flex items-center justify-between text-sm hover:bg-slate-50 rounded px-2 py-1.5"
                            >
                                <span className="font-mono font-semibold text-slate-900">{it.primary}</span>
                                <span className={`text-xs font-bold ${it.tone === 'emerald' ? 'text-emerald-700' : 'text-rose-700'}`}>{it.secondary}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

// ─── Drawer ──────────────────────────────────────────────────────────
function ProductDrawer({
    productId, onClose, onSaved, isPaused,
}: { productId: string; onClose: () => void; onSaved: () => void; isPaused: boolean }) {
    const [detail, setDetail] = useState<DetailResp | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [editMode, setEditMode] = useState(false);
    const [form, setForm] = useState({ baseCost: '', packagingCost: '', additionalCost: '' });
    const [saving, setSaving] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const r = await axios.get(`/finance/unit-economics/${productId}`);
            setDetail(r.data);
            const p = r.data.productProfile;
            setForm({
                baseCost: p?.baseCost ?? '',
                packagingCost: p?.packagingCost ?? '',
                additionalCost: p?.additionalCost ?? '',
            });
            setError(null);
        } catch (err: any) {
            setError(err?.response?.data?.message ?? 'Не удалось загрузить детали');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); /* eslint-disable-next-line */ }, [productId]);

    const onSave = async () => {
        setSaving(true);
        try {
            const body: any = {};
            if (form.baseCost !== '') body.baseCost = parseFloat(form.baseCost);
            else body.baseCost = null;
            if (form.packagingCost !== '') body.packagingCost = parseFloat(form.packagingCost);
            else body.packagingCost = null;
            if (form.additionalCost !== '') body.additionalCost = parseFloat(form.additionalCost);
            else body.additionalCost = null;

            await axios.patch(`/finance/products/${productId}/cost`, body);
            setEditMode(false);
            await load();
            onSaved();
        } catch (err: any) {
            const code = err?.response?.data?.code;
            alert(`Ошибка сохранения: ${code ?? err?.response?.data?.message}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex">
            <div className="flex-1 bg-slate-900/40" onClick={onClose} />
            <aside className="w-full max-w-xl bg-white shadow-2xl flex flex-col">
                <header className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                    <div>
                        <div className="text-xs text-slate-500">SKU</div>
                        <div className="font-mono font-bold text-slate-900">{detail?.item.sku ?? '...'}</div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl">×</button>
                </header>

                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                    {loading ? (
                        <div className="flex items-center text-slate-500 text-sm"><Loader2 className="h-4 w-4 animate-spin mr-2" />Загрузка...</div>
                    ) : error ? (
                        <div className="text-rose-600 text-sm">{error}</div>
                    ) : detail ? (
                        <>
                            {/* Summary */}
                            <section className="grid grid-cols-2 gap-3">
                                <Field label="Sold qty" value={detail.item.soldQty} />
                                <Field label="Revenue" value={fmtMoney(detail.item.revenue)} />
                                <Field label="Profit" value={
                                    <span className={detail.item.profit >= 0 ? 'text-emerald-700 font-bold' : 'text-rose-700 font-bold'}>
                                        {fmtMoney(detail.item.profit)}
                                    </span>
                                } />
                                <Field label="Margin" value={fmtPct(detail.item.marginPct)} />
                                <Field label="ROI" value={fmtPct(detail.item.roiPct)} />
                                <Field label="Period" value={`${detail.snapshot.periodFrom} → ${detail.snapshot.periodTo}`} />
                            </section>

                            {/* Cost breakdown */}
                            <section>
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Breakdown расходов</h3>
                                <div className="bg-slate-50 rounded-xl p-3 space-y-1.5 text-sm">
                                    <Row label="COGS (себестоимость × кол-во)" value={fmtMoney(detail.item.cogs)} />
                                    <Row label="Комиссии маркетплейса" value={fmtMoney(detail.item.marketplaceFees)} />
                                    <Row label="Логистика" value={fmtMoney(detail.item.logistics)} />
                                    <Row label="Реклама" value={fmtMoney(detail.item.adsCost)} />
                                    <Row label="Возвраты" value={fmtMoney(detail.item.returnsImpact)} />
                                    <Row label="Налоги" value={fmtMoney(detail.item.taxImpact)} />
                                    <Row label="Прочие" value={fmtMoney(detail.item.additionalCharges)} />
                                </div>
                            </section>

                            {/* Warnings explanation */}
                            {detail.item.warnings.length > 0 && (
                                <section className="rounded-xl border p-4 border-amber-200 bg-amber-50/60">
                                    <div className="text-xs font-semibold uppercase tracking-wider text-amber-800 mb-2">
                                        Почему расчёт неполный
                                    </div>
                                    <ul className="space-y-2">
                                        {detail.item.warnings.map((w) => (
                                            <li key={w} className="flex items-start gap-2 text-xs">
                                                {WARNING_LABEL[w].critical
                                                    ? <AlertTriangle className="h-3.5 w-3.5 text-rose-500 mt-0.5 flex-shrink-0" />
                                                    : <Info className="h-3.5 w-3.5 text-amber-500 mt-0.5 flex-shrink-0" />}
                                                <div>
                                                    <span className="font-semibold text-slate-800">{WARNING_LABEL[w].label}</span>
                                                    <span className="text-slate-600 ml-1">— {WARNING_LABEL[w].explain}</span>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            )}

                            {/* Cost profile editor */}
                            <section className="border border-slate-200 rounded-xl p-4">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                                        Себестоимость (manual)
                                    </h3>
                                    {!editMode && (
                                        <button
                                            onClick={() => setEditMode(true)}
                                            disabled={isPaused}
                                            title={isPaused ? 'Недоступно при паузе интеграций' : ''}
                                            className="text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50"
                                        >
                                            Редактировать
                                        </button>
                                    )}
                                </div>
                                {editMode ? (
                                    <div className="space-y-3">
                                        <CostInput label="baseCost (руб.)" value={form.baseCost} onChange={(v) => setForm({ ...form, baseCost: v })} />
                                        <CostInput label="packagingCost (руб.)" value={form.packagingCost} onChange={(v) => setForm({ ...form, packagingCost: v })} />
                                        <CostInput label="additionalCost (руб.)" value={form.additionalCost} onChange={(v) => setForm({ ...form, additionalCost: v })} />
                                        <div className="flex gap-2 pt-2">
                                            <button
                                                onClick={onSave}
                                                disabled={saving}
                                                className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                                            >
                                                {saving ? <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> : <CheckCircle2 className="h-4 w-4 inline mr-1" />}
                                                Сохранить
                                            </button>
                                            <button
                                                onClick={() => setEditMode(false)}
                                                className="px-3 py-1.5 bg-white border border-slate-300 rounded-md text-sm font-medium hover:bg-slate-50"
                                            >
                                                Отмена
                                            </button>
                                        </div>
                                        <div className="text-[11px] text-slate-500 mt-1">
                                            Manual input разрешён только для baseCost / packagingCost / additionalCost
                                            (см. policy §13). Marketplace fees и logistics берутся только из feed'ов.
                                        </div>
                                    </div>
                                ) : detail.productProfile ? (
                                    <div className="space-y-1 text-sm">
                                        <Row label="baseCost" value={detail.productProfile.baseCost ? `${detail.productProfile.baseCost} ${detail.productProfile.costCurrency}` : '—'} />
                                        <Row label="packagingCost" value={detail.productProfile.packagingCost ? `${detail.productProfile.packagingCost} ${detail.productProfile.costCurrency}` : '—'} />
                                        <Row label="additionalCost" value={detail.productProfile.additionalCost ? `${detail.productProfile.additionalCost} ${detail.productProfile.costCurrency}` : '—'} />
                                        <div className="text-[11px] text-slate-400 mt-2">
                                            Обновлено: {fmtDate(detail.productProfile.updatedAt)} · {detail.productProfile.isCostManual ? 'manual' : 'auto'}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-xs text-slate-500 italic">Профиль ещё не создан. Нажмите «Редактировать», чтобы задать себестоимость.</div>
                                )}
                            </section>
                        </>
                    ) : null}
                </div>
            </aside>
        </div>
    );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{label}</div>
            <div className="text-sm text-slate-900 mt-0.5">{value}</div>
        </div>
    );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between">
            <span className="text-slate-500">{label}</span>
            <span className="font-semibold text-slate-900">{value}</span>
        </div>
    );
}

function CostInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
    return (
        <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">{label}</label>
            <input
                type="number"
                step="0.01"
                min="0"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-blue-500 focus:border-blue-500"
                placeholder="—"
            />
        </div>
    );
}
