import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import {
    Boxes, History as HistoryIcon, AlertTriangle, Plus, Settings as SettingsIcon,
    Activity, Search, RefreshCw, Lock, ShieldAlert, Info, X, ChevronRight,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// ─────────────────────────────── types ───────────────────────────────

const WRITE_BLOCKED_STATES = ['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED'];

type FulfillmentMode = 'FBS' | 'FBO';
type MovementType =
    | 'MANUAL_ADD' | 'MANUAL_REMOVE'
    | 'ORDER_RESERVED' | 'ORDER_RELEASED' | 'ORDER_DEDUCTED'
    | 'INVENTORY_ADJUSTMENT' | 'RETURN_LOGGED' | 'CONFLICT_DETECTED';
type LockStatus = 'PROCESSING' | 'APPLIED' | 'IGNORED' | 'FAILED';
type EffectType = 'ORDER_RESERVE' | 'ORDER_RELEASE' | 'ORDER_DEDUCT' | 'SYNC_RECONCILE';

interface BalanceView {
    warehouseId: string;
    fulfillmentMode: FulfillmentMode;
    isExternal: boolean;
    onHand: number;
    reserved: number;
    available: number;
}

interface StockRow {
    productId: string;
    sku: string;
    name: string;
    photo: string | null;
    onHand: number;
    reserved: number;
    available: number;
    balances: BalanceView[];
}

interface Movement {
    id: string;
    productId: string;
    warehouseId: string | null;
    movementType: MovementType;
    delta: number;
    onHandBefore: number | null;
    onHandAfter: number | null;
    reservedBefore: number | null;
    reservedAfter: number | null;
    reasonCode: string | null;
    comment: string | null;
    source: 'USER' | 'SYSTEM' | 'MARKETPLACE';
    sourceEventId: string | null;
    createdAt: string;
    product?: { id: string; sku: string; name: string };
    actorUser?: { id: string; email: string } | null;
}

interface LowStockItem {
    productId: string;
    sku: string;
    name: string;
    warehouseId: string;
    onHand: number;
    reserved: number;
    available: number;
    source: 'balance' | 'product_fallback';
}

interface Diagnostics {
    generatedAt: string;
    window: string;
    locks: { processing: number; applied: number; ignored: number; failed: number };
    conflictsLast24h: number;
    reserveReleaseFailedLast24h: number;
    deductFailedLast24h: number;
}

interface EffectLock {
    id: string;
    effectType: EffectType;
    sourceEventId: string;
    status: LockStatus;
    createdAt: string;
    updatedAt: string;
}

// ─────────────────────────────── helpers ─────────────────────────────

const MOVEMENT_LABELS: Record<MovementType, string> = {
    MANUAL_ADD: 'Ручное пополнение',
    MANUAL_REMOVE: 'Ручное списание',
    ORDER_RESERVED: 'Резерв под заказ',
    ORDER_RELEASED: 'Отмена резерва',
    ORDER_DEDUCTED: 'Списание под заказ',
    INVENTORY_ADJUSTMENT: 'Корректировка',
    RETURN_LOGGED: 'Возврат зафиксирован',
    CONFLICT_DETECTED: 'Конфликт обнаружен',
};

const MOVEMENT_TONE: Record<MovementType, string> = {
    MANUAL_ADD: 'bg-emerald-100 text-emerald-800',
    MANUAL_REMOVE: 'bg-amber-100 text-amber-800',
    ORDER_RESERVED: 'bg-blue-100 text-blue-800',
    ORDER_RELEASED: 'bg-slate-100 text-slate-700',
    ORDER_DEDUCTED: 'bg-rose-100 text-rose-800',
    INVENTORY_ADJUSTMENT: 'bg-violet-100 text-violet-800',
    RETURN_LOGGED: 'bg-cyan-100 text-cyan-800',
    CONFLICT_DETECTED: 'bg-red-100 text-red-800',
};

const LOCK_TONE: Record<LockStatus, string> = {
    PROCESSING: 'bg-blue-100 text-blue-800',
    APPLIED: 'bg-emerald-100 text-emerald-800',
    IGNORED: 'bg-slate-100 text-slate-700',
    FAILED: 'bg-red-100 text-red-800',
};

function formatDateTime(iso: string): string {
    try {
        return new Date(iso).toLocaleString('ru-RU', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch {
        return iso;
    }
}

function ucWriteBlockedHint(state: string | undefined): string {
    if (state === 'TRIAL_EXPIRED') return 'Пробный период истёк. Доступ только для чтения. Оформите подписку, чтобы вернуть редактирование.';
    if (state === 'SUSPENDED') return 'Доступ приостановлен. Запись данных заблокирована.';
    if (state === 'CLOSED') return 'Компания закрыта. Запись данных недоступна.';
    return '';
}

// ─────────────────────────────── component ───────────────────────────

export default function Inventory() {
    const { activeTenant } = useAuth();
    const writeBlocked = activeTenant ? WRITE_BLOCKED_STATES.includes(activeTenant.accessState) : false;
    const writeBlockedHint = ucWriteBlockedHint(activeTenant?.accessState);

    const [tab, setTab] = useState<'balances' | 'movements' | 'lowStock' | 'diagnostics'>('balances');

    // ─── balances state
    const [stocks, setStocks] = useState<StockRow[]>([]);
    const [stocksTotal, setStocksTotal] = useState(0);
    const [stocksPage, setStocksPage] = useState(1);
    const [search, setSearch] = useState('');
    const [stocksLoading, setStocksLoading] = useState(false);

    // ─── movements state
    const [movements, setMovements] = useState<Movement[]>([]);
    const [moveProductFilter, setMoveProductFilter] = useState('');
    const [moveTypeFilter, setMoveTypeFilter] = useState<MovementType | ''>('');
    const [moveLoading, setMoveLoading] = useState(false);

    // ─── low-stock state
    const [lowStock, setLowStock] = useState<LowStockItem[]>([]);
    const [lowStockThreshold, setLowStockThreshold] = useState<number>(5);
    const [thresholdInput, setThresholdInput] = useState<string>('5');
    const [lowLoading, setLowLoading] = useState(false);

    // ─── diagnostics state
    const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
    const [conflicts, setConflicts] = useState<Movement[]>([]);
    const [locks, setLocks] = useState<EffectLock[]>([]);
    const [diagLoading, setDiagLoading] = useState(false);

    // ─── adjustment dialog
    const [adjustOpen, setAdjustOpen] = useState(false);
    const [adjustTarget, setAdjustTarget] = useState<StockRow | null>(null);
    const [adjustMode, setAdjustMode] = useState<'delta' | 'target'>('delta');
    const [adjustDelta, setAdjustDelta] = useState('');
    const [adjustTargetQty, setAdjustTargetQty] = useState('');
    const [adjustReason, setAdjustReason] = useState('RECOUNT');
    const [adjustComment, setAdjustComment] = useState('');
    const [adjustError, setAdjustError] = useState<string | null>(null);
    const [adjustSubmitting, setAdjustSubmitting] = useState(false);

    // ─── loaders
    const loadStocks = useCallback(async (page = 1, q?: string) => {
        setStocksLoading(true);
        try {
            const res = await axios.get('/inventory/stocks', {
                params: { page, limit: 20, search: q ?? undefined },
            });
            setStocks(res.data.data ?? []);
            setStocksTotal(res.data.meta?.total ?? 0);
            setStocksPage(page);
        } finally {
            setStocksLoading(false);
        }
    }, []);

    const loadMovements = useCallback(async () => {
        setMoveLoading(true);
        try {
            const res = await axios.get('/inventory/movements', {
                params: {
                    productId: moveProductFilter || undefined,
                    movementType: moveTypeFilter || undefined,
                    limit: 50,
                },
            });
            setMovements(res.data.data ?? []);
        } finally {
            setMoveLoading(false);
        }
    }, [moveProductFilter, moveTypeFilter]);

    const loadLowStock = useCallback(async () => {
        setLowLoading(true);
        try {
            const [low, settings] = await Promise.all([
                axios.get('/inventory/low-stock'),
                axios.get('/inventory/settings'),
            ]);
            setLowStock(low.data.items ?? []);
            const threshold = settings.data.lowStockThreshold ?? 5;
            setLowStockThreshold(threshold);
            setThresholdInput(String(threshold));
        } finally {
            setLowLoading(false);
        }
    }, []);

    const loadDiagnostics = useCallback(async () => {
        setDiagLoading(true);
        try {
            const [diag, conf, lk] = await Promise.all([
                axios.get('/inventory/diagnostics'),
                axios.get('/inventory/conflicts', { params: { limit: 20 } }),
                axios.get('/inventory/effect-locks', { params: { limit: 20, status: 'FAILED' } }),
            ]);
            setDiagnostics(diag.data);
            setConflicts(conf.data.data ?? []);
            setLocks(lk.data.data ?? []);
        } finally {
            setDiagLoading(false);
        }
    }, []);

    useEffect(() => {
        if (tab === 'balances') loadStocks(1, search);
        if (tab === 'movements') loadMovements();
        if (tab === 'lowStock') loadLowStock();
        if (tab === 'diagnostics') loadDiagnostics();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab]);

    const onSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        loadStocks(1, search);
    };

    // ─── threshold update
    const updateThreshold = async () => {
        const v = parseInt(thresholdInput, 10);
        if (Number.isNaN(v) || v < 0) return;
        try {
            await axios.patch('/inventory/settings/threshold', { lowStockThreshold: v });
            await loadLowStock();
        } catch (err: any) {
            const code = err?.response?.data?.code;
            if (code === 'TENANT_WRITE_BLOCKED' || code === 'INVENTORY_WRITE_BLOCKED_BY_TENANT_STATE') {
                alert(writeBlockedHint || 'Запись заблокирована');
            }
        }
    };

    // ─── adjustment dialog
    const openAdjust = (row: StockRow) => {
        if (writeBlocked) return;
        setAdjustTarget(row);
        setAdjustMode('delta');
        setAdjustDelta('');
        setAdjustTargetQty('');
        setAdjustReason('RECOUNT');
        setAdjustComment('');
        setAdjustError(null);
        setAdjustOpen(true);
    };

    const submitAdjust = async () => {
        if (!adjustTarget) return;
        setAdjustError(null);
        const reasonCode = adjustReason.trim().toUpperCase().replace(/\s+/g, '_');
        if (!/^[A-Z0-9_]+$/.test(reasonCode)) {
            setAdjustError('Причина должна быть в формате UPPER_SNAKE_CASE (например, LOSS, RECOUNT)');
            return;
        }
        const body: any = {
            productId: adjustTarget.productId,
            reasonCode,
            comment: adjustComment.trim() || undefined,
        };
        if (adjustMode === 'delta') {
            const v = parseInt(adjustDelta, 10);
            if (Number.isNaN(v) || v === 0) {
                setAdjustError('Введите ненулевое целое значение');
                return;
            }
            body.delta = v;
        } else {
            const v = parseInt(adjustTargetQty, 10);
            if (Number.isNaN(v) || v < 0) {
                setAdjustError('Целевой остаток должен быть неотрицательным целым');
                return;
            }
            body.targetQuantity = v;
        }
        setAdjustSubmitting(true);
        try {
            await axios.post('/inventory/adjustments', body);
            setAdjustOpen(false);
            await loadStocks(stocksPage, search);
        } catch (err: any) {
            const code = err?.response?.data?.code;
            const msg = err?.response?.data?.message;
            const map: Record<string, string> = {
                NEGATIVE_STOCK_NOT_ALLOWED: 'Нельзя уйти в отрицательный остаток.',
                RESERVED_EXCEEDS_ONHAND: 'Корректировка оставила бы резерв больше остатка. Сначала снимите резерв.',
                ADJUSTMENT_NOOP: 'Целевое значение совпадает с текущим — изменений нет.',
                ADJUSTMENT_DELTA_ZERO: 'Изменение не может быть нулевым.',
                INVENTORY_WRITE_BLOCKED_BY_TENANT_STATE: writeBlockedHint || 'Запись заблокирована текущим состоянием тенанта.',
                TENANT_WRITE_BLOCKED: writeBlockedHint || 'Запись заблокирована текущим состоянием тенанта.',
            };
            setAdjustError(map[code] ?? msg ?? 'Не удалось применить корректировку.');
        } finally {
            setAdjustSubmitting(false);
        }
    };

    const tabs = [
        { id: 'balances', label: 'Остатки', icon: Boxes },
        { id: 'movements', label: 'История движений', icon: HistoryIcon },
        { id: 'lowStock', label: 'Низкий остаток', icon: AlertTriangle },
        { id: 'diagnostics', label: 'Диагностика', icon: Activity },
    ] as const;

    const stocksLastPage = useMemo(
        () => Math.max(1, Math.ceil(stocksTotal / 20)),
        [stocksTotal],
    );

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-slate-900 flex items-center">
                        <Boxes className="h-6 w-6 mr-2 text-blue-600" />
                        Учёт остатков
                    </h1>
                    <p className="text-xs md:text-sm text-slate-500 mt-1">
                        Балансы, движения, low-stock пороги и диагностика идемпотентности.
                    </p>
                </div>
                {writeBlocked && (
                    <div className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800">
                        <Lock className="h-3.5 w-3.5" />
                        Режим только для чтения
                    </div>
                )}
            </div>

            {/* Tabs */}
            <div className="border-b border-slate-200 flex gap-1 overflow-x-auto">
                {tabs.map((t) => {
                    const Icon = t.icon;
                    const active = tab === t.id;
                    return (
                        <button
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5 whitespace-nowrap ${
                                active
                                    ? 'border-blue-600 text-blue-700'
                                    : 'border-transparent text-slate-600 hover:text-slate-900'
                            }`}
                        >
                            <Icon className="h-4 w-4" />
                            {t.label}
                        </button>
                    );
                })}
            </div>

            {/* ─── Balances ─── */}
            {tab === 'balances' && (
                <section className="space-y-3">
                    <form onSubmit={onSearchSubmit} className="flex gap-2 items-center">
                        <div className="relative flex-1 max-w-md">
                            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Поиск по SKU или названию"
                                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-md text-sm"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => loadStocks(stocksPage, search)}
                            className="p-2 text-slate-500 hover:text-slate-900 border border-slate-300 rounded-md"
                            title="Обновить"
                        >
                            <RefreshCw className={`h-4 w-4 ${stocksLoading ? 'animate-spin' : ''}`} />
                        </button>
                    </form>

                    <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wider">
                                <tr>
                                    <th className="px-3 py-2 text-left">SKU / Товар</th>
                                    <th className="px-3 py-2 text-right">on_hand</th>
                                    <th className="px-3 py-2 text-right">reserved</th>
                                    <th className="px-3 py-2 text-right">available</th>
                                    <th className="px-3 py-2 text-left">Склады</th>
                                    <th className="px-3 py-2 text-right">Действия</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {stocks.length === 0 && !stocksLoading && (
                                    <tr><td colSpan={6} className="text-center py-6 text-slate-500">Нет товаров.</td></tr>
                                )}
                                {stocks.map((row) => (
                                    <tr key={row.productId} className="hover:bg-slate-50">
                                        <td className="px-3 py-2">
                                            <div className="font-medium text-slate-900">{row.sku}</div>
                                            <div className="text-xs text-slate-500 truncate max-w-xs">{row.name}</div>
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono">{row.onHand}</td>
                                        <td className="px-3 py-2 text-right font-mono text-blue-700">{row.reserved}</td>
                                        <td className="px-3 py-2 text-right font-mono font-semibold">
                                            {row.available}
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="flex flex-wrap gap-1">
                                                {row.balances.map((b) => (
                                                    <span
                                                        key={`${row.productId}-${b.warehouseId}-${b.fulfillmentMode}`}
                                                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                                                            b.isExternal
                                                                ? 'bg-slate-100 text-slate-600'
                                                                : 'bg-blue-50 text-blue-700'
                                                        }`}
                                                        title={`onHand=${b.onHand}, reserved=${b.reserved}, available=${b.available}`}
                                                    >
                                                        {b.fulfillmentMode}/{b.warehouseId}: {b.available}
                                                        {b.isExternal && ' (FBO)'}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <button
                                                onClick={() => openAdjust(row)}
                                                disabled={writeBlocked}
                                                title={writeBlocked ? writeBlockedHint : 'Корректировка остатка'}
                                                className={`text-xs inline-flex items-center px-2 py-1 rounded border ${
                                                    writeBlocked
                                                        ? 'border-slate-200 text-slate-400 cursor-not-allowed'
                                                        : 'border-blue-300 text-blue-700 hover:bg-blue-50'
                                                }`}
                                            >
                                                {writeBlocked ? <Lock className="h-3 w-3 mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
                                                Корректировка
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>Всего: {stocksTotal}</span>
                        <div className="flex gap-2">
                            <button
                                disabled={stocksPage <= 1}
                                onClick={() => loadStocks(stocksPage - 1, search)}
                                className="px-2 py-1 border border-slate-300 rounded disabled:opacity-40"
                            >
                                ‹
                            </button>
                            <span>{stocksPage} / {stocksLastPage}</span>
                            <button
                                disabled={stocksPage >= stocksLastPage}
                                onClick={() => loadStocks(stocksPage + 1, search)}
                                className="px-2 py-1 border border-slate-300 rounded disabled:opacity-40"
                            >
                                ›
                            </button>
                        </div>
                    </div>
                </section>
            )}

            {/* ─── Movements ─── */}
            {tab === 'movements' && (
                <section className="space-y-3">
                    <div className="flex flex-wrap gap-2 items-end">
                        <div>
                            <label className="block text-xs text-slate-600 mb-1">Product ID</label>
                            <input
                                value={moveProductFilter}
                                onChange={(e) => setMoveProductFilter(e.target.value)}
                                placeholder="опционально"
                                className="px-2 py-1.5 border border-slate-300 rounded text-sm w-56"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-600 mb-1">Тип движения</label>
                            <select
                                value={moveTypeFilter}
                                onChange={(e) => setMoveTypeFilter(e.target.value as any)}
                                className="px-2 py-1.5 border border-slate-300 rounded text-sm"
                            >
                                <option value="">Все</option>
                                {Object.entries(MOVEMENT_LABELS).map(([k, v]) => (
                                    <option key={k} value={k}>{v}</option>
                                ))}
                            </select>
                        </div>
                        <button
                            onClick={() => loadMovements()}
                            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                        >
                            Применить
                        </button>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-md overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                                <tr>
                                    <th className="px-3 py-2 text-left">Дата</th>
                                    <th className="px-3 py-2 text-left">Тип</th>
                                    <th className="px-3 py-2 text-left">Товар</th>
                                    <th className="px-3 py-2 text-right">Δ</th>
                                    <th className="px-3 py-2 text-right">on_hand до → после</th>
                                    <th className="px-3 py-2 text-right">reserved до → после</th>
                                    <th className="px-3 py-2 text-left">Причина / комментарий</th>
                                    <th className="px-3 py-2 text-left">Источник</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {movements.length === 0 && !moveLoading && (
                                    <tr><td colSpan={8} className="text-center py-6 text-slate-500">Движений не найдено.</td></tr>
                                )}
                                {movements.map((m) => (
                                    <tr key={m.id} className="hover:bg-slate-50">
                                        <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-600">
                                            {formatDateTime(m.createdAt)}
                                        </td>
                                        <td className="px-3 py-2">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${MOVEMENT_TONE[m.movementType]}`}>
                                                {MOVEMENT_LABELS[m.movementType]}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="text-xs font-medium">{m.product?.sku ?? '—'}</div>
                                            <div className="text-[11px] text-slate-500 truncate max-w-[180px]">{m.product?.name ?? ''}</div>
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono">
                                            <span className={m.delta > 0 ? 'text-emerald-700' : m.delta < 0 ? 'text-rose-700' : 'text-slate-500'}>
                                                {m.delta > 0 ? '+' : ''}{m.delta}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-right text-xs font-mono">
                                            {m.onHandBefore ?? '—'} → {m.onHandAfter ?? '—'}
                                        </td>
                                        <td className="px-3 py-2 text-right text-xs font-mono">
                                            {m.reservedBefore ?? '—'} → {m.reservedAfter ?? '—'}
                                        </td>
                                        <td className="px-3 py-2 text-xs">
                                            <div className="font-medium">{m.reasonCode ?? '—'}</div>
                                            {m.comment && <div className="text-slate-500 truncate max-w-[260px]">{m.comment}</div>}
                                        </td>
                                        <td className="px-3 py-2 text-xs text-slate-600">
                                            <div>{m.source}</div>
                                            {m.actorUser?.email && <div className="text-slate-400 truncate max-w-[160px]">{m.actorUser.email}</div>}
                                            {m.sourceEventId && <div className="text-slate-400 truncate max-w-[160px]" title={m.sourceEventId}>evt: {m.sourceEventId}</div>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            {/* ─── Low stock ─── */}
            {tab === 'lowStock' && (
                <section className="space-y-3">
                    <div className="bg-white border border-slate-200 rounded-md p-4">
                        <div className="flex items-center justify-between flex-wrap gap-3">
                            <div className="flex items-center gap-2">
                                <SettingsIcon className="h-4 w-4 text-slate-500" />
                                <span className="text-sm font-medium text-slate-700">Порог уведомлений (low-stock)</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    min={0}
                                    value={thresholdInput}
                                    onChange={(e) => setThresholdInput(e.target.value)}
                                    disabled={writeBlocked}
                                    className="w-24 px-2 py-1.5 border border-slate-300 rounded text-sm font-mono disabled:bg-slate-100"
                                />
                                <button
                                    onClick={updateThreshold}
                                    disabled={writeBlocked || parseInt(thresholdInput, 10) === lowStockThreshold}
                                    title={writeBlocked ? writeBlockedHint : 'Сохранить порог'}
                                    className={`px-3 py-1.5 text-sm rounded ${
                                        writeBlocked
                                            ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                                            : 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
                                    }`}
                                >
                                    Сохранить
                                </button>
                            </div>
                        </div>
                        <p className="text-xs text-slate-500 mt-2">
                            Текущий порог: <span className="font-mono font-medium">{lowStockThreshold}</span>. Товары с available ≤ порога попадают в список ниже.
                        </p>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                                <tr>
                                    <th className="px-3 py-2 text-left">SKU</th>
                                    <th className="px-3 py-2 text-left">Название</th>
                                    <th className="px-3 py-2 text-left">Склад</th>
                                    <th className="px-3 py-2 text-right">on_hand</th>
                                    <th className="px-3 py-2 text-right">reserved</th>
                                    <th className="px-3 py-2 text-right">available</th>
                                    <th className="px-3 py-2 text-left">Источник</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {lowStock.length === 0 && !lowLoading && (
                                    <tr><td colSpan={7} className="text-center py-6 text-slate-500">Все остатки выше порога — это хорошо.</td></tr>
                                )}
                                {lowStock.map((it) => (
                                    <tr key={`${it.productId}-${it.warehouseId}`} className="hover:bg-slate-50">
                                        <td className="px-3 py-2 font-medium">{it.sku}</td>
                                        <td className="px-3 py-2 text-slate-700 truncate max-w-xs">{it.name}</td>
                                        <td className="px-3 py-2 text-xs">{it.warehouseId}</td>
                                        <td className="px-3 py-2 text-right font-mono">{it.onHand}</td>
                                        <td className="px-3 py-2 text-right font-mono text-blue-700">{it.reserved}</td>
                                        <td className="px-3 py-2 text-right font-mono font-semibold text-rose-700">{it.available}</td>
                                        <td className="px-3 py-2 text-xs">
                                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                                it.source === 'balance' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'
                                            }`}>
                                                {it.source === 'balance' ? 'StockBalance' : 'Product fallback'}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            {/* ─── Diagnostics ─── */}
            {tab === 'diagnostics' && (
                <section className="space-y-4">
                    {!diagnostics && diagLoading && (
                        <div className="text-sm text-slate-500">Загрузка диагностики...</div>
                    )}
                    {diagnostics && (
                        <>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <DiagCard label="PROCESSING locks" value={diagnostics.locks.processing} tone="bg-blue-50 text-blue-800" warn={diagnostics.locks.processing > 5} />
                                <DiagCard label="APPLIED locks" value={diagnostics.locks.applied} tone="bg-emerald-50 text-emerald-800" />
                                <DiagCard label="IGNORED (paused/replays)" value={diagnostics.locks.ignored} tone="bg-slate-100 text-slate-700" />
                                <DiagCard label="FAILED locks" value={diagnostics.locks.failed} tone="bg-red-50 text-red-800" warn={diagnostics.locks.failed > 0} />
                                <DiagCard label="Конфликты за 24h" value={diagnostics.conflictsLast24h} tone="bg-amber-50 text-amber-800" warn={diagnostics.conflictsLast24h > 0} />
                                <DiagCard label="reserve/release fail (24h)" value={diagnostics.reserveReleaseFailedLast24h} tone="bg-rose-50 text-rose-800" warn={diagnostics.reserveReleaseFailedLast24h > 0} />
                                <DiagCard label="deduct fail (24h)" value={diagnostics.deductFailedLast24h} tone="bg-rose-50 text-rose-800" warn={diagnostics.deductFailedLast24h > 0} />
                                <DiagCard label="Окно" value={diagnostics.window} tone="bg-slate-50 text-slate-700" raw />
                            </div>

                            <div className="bg-white border border-slate-200 rounded-md">
                                <div className="px-4 py-2 border-b border-slate-100 flex items-center gap-2 text-sm font-medium">
                                    <ShieldAlert className="h-4 w-4 text-red-600" />
                                    Конфликты с маркетплейсами (CONFLICT_DETECTED)
                                </div>
                                <table className="w-full text-sm">
                                    <thead className="bg-slate-50 text-xs text-slate-600 uppercase">
                                        <tr>
                                            <th className="px-3 py-2 text-left">Когда</th>
                                            <th className="px-3 py-2 text-left">Товар</th>
                                            <th className="px-3 py-2 text-right">Δ (external − local)</th>
                                            <th className="px-3 py-2 text-left">Комментарий</th>
                                            <th className="px-3 py-2 text-left">Source event</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {conflicts.length === 0 && (
                                            <tr><td colSpan={5} className="text-center py-4 text-slate-500 text-sm">Конфликтов не зафиксировано.</td></tr>
                                        )}
                                        {conflicts.map((c) => (
                                            <tr key={c.id} className="hover:bg-slate-50">
                                                <td className="px-3 py-2 text-xs">{formatDateTime(c.createdAt)}</td>
                                                <td className="px-3 py-2 text-xs">{c.product?.sku ?? c.productId}</td>
                                                <td className="px-3 py-2 text-right font-mono">
                                                    <span className={c.delta > 0 ? 'text-emerald-700' : c.delta < 0 ? 'text-rose-700' : 'text-slate-500'}>
                                                        {c.delta > 0 ? '+' : ''}{c.delta}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2 text-xs text-slate-600 truncate max-w-xs">{c.comment ?? '—'}</td>
                                                <td className="px-3 py-2 text-xs text-slate-500 truncate max-w-[160px]" title={c.sourceEventId ?? ''}>{c.sourceEventId ?? '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div className="bg-white border border-slate-200 rounded-md">
                                <div className="px-4 py-2 border-b border-slate-100 flex items-center gap-2 text-sm font-medium">
                                    <Info className="h-4 w-4 text-red-600" />
                                    Failed effect locks (требуют расследования)
                                </div>
                                <table className="w-full text-sm">
                                    <thead className="bg-slate-50 text-xs text-slate-600 uppercase">
                                        <tr>
                                            <th className="px-3 py-2 text-left">Тип</th>
                                            <th className="px-3 py-2 text-left">Source event</th>
                                            <th className="px-3 py-2 text-left">Статус</th>
                                            <th className="px-3 py-2 text-left">Обновлён</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {locks.length === 0 && (
                                            <tr><td colSpan={4} className="text-center py-4 text-slate-500 text-sm">Нет упавших lock'ов за окно — ок.</td></tr>
                                        )}
                                        {locks.map((l) => (
                                            <tr key={l.id} className="hover:bg-slate-50">
                                                <td className="px-3 py-2 text-xs">{l.effectType}</td>
                                                <td className="px-3 py-2 text-xs truncate max-w-[200px]" title={l.sourceEventId}>{l.sourceEventId}</td>
                                                <td className="px-3 py-2">
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${LOCK_TONE[l.status]}`}>
                                                        {l.status}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2 text-xs">{formatDateTime(l.updatedAt)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </section>
            )}

            {/* ─── Adjustment dialog ─── */}
            {adjustOpen && adjustTarget && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
                        <div className="px-4 py-3 border-b flex items-center justify-between">
                            <h2 className="text-base font-semibold text-slate-900">Корректировка остатка</h2>
                            <button onClick={() => setAdjustOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                        <div className="p-4 space-y-3">
                            <div className="text-xs text-slate-500">
                                <span className="font-medium text-slate-800">{adjustTarget.sku}</span> — {adjustTarget.name}
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-xs bg-slate-50 rounded p-2">
                                <Stat label="on_hand" value={adjustTarget.onHand} />
                                <Stat label="reserved" value={adjustTarget.reserved} tone="text-blue-700" />
                                <Stat label="available" value={adjustTarget.available} tone="text-emerald-700" />
                            </div>

                            <div className="flex gap-2">
                                <button
                                    onClick={() => setAdjustMode('delta')}
                                    className={`flex-1 px-3 py-1.5 text-xs rounded border ${adjustMode === 'delta' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-300 text-slate-600'}`}
                                >
                                    На (delta)
                                </button>
                                <button
                                    onClick={() => setAdjustMode('target')}
                                    className={`flex-1 px-3 py-1.5 text-xs rounded border ${adjustMode === 'target' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-300 text-slate-600'}`}
                                >
                                    Установить (target)
                                </button>
                            </div>

                            {adjustMode === 'delta' ? (
                                <div>
                                    <label className="block text-xs text-slate-600 mb-1">Изменение (целое, не 0)</label>
                                    <input
                                        type="number"
                                        value={adjustDelta}
                                        onChange={(e) => setAdjustDelta(e.target.value)}
                                        placeholder="например: -3 или 10"
                                        className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm font-mono"
                                    />
                                </div>
                            ) : (
                                <div>
                                    <label className="block text-xs text-slate-600 mb-1">Целевой on_hand (≥ 0)</label>
                                    <input
                                        type="number"
                                        min={0}
                                        value={adjustTargetQty}
                                        onChange={(e) => setAdjustTargetQty(e.target.value)}
                                        className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm font-mono"
                                    />
                                </div>
                            )}

                            <div>
                                <label className="block text-xs text-slate-600 mb-1">Причина (UPPER_SNAKE_CASE) *</label>
                                <select
                                    value={adjustReason}
                                    onChange={(e) => setAdjustReason(e.target.value)}
                                    className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
                                >
                                    <option value="RECOUNT">RECOUNT — пересчёт</option>
                                    <option value="LOSS">LOSS — недостача</option>
                                    <option value="FOUND">FOUND — найдено</option>
                                    <option value="DAMAGE">DAMAGE — порча</option>
                                    <option value="RETURN_RESTOCK">RETURN_RESTOCK — возврат на склад</option>
                                    <option value="OTHER">OTHER — иное</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs text-slate-600 mb-1">Комментарий</label>
                                <textarea
                                    value={adjustComment}
                                    onChange={(e) => setAdjustComment(e.target.value)}
                                    rows={2}
                                    className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
                                    placeholder="Опционально, виден в истории движений"
                                />
                            </div>

                            {adjustError && (
                                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                                    {adjustError}
                                </div>
                            )}
                        </div>
                        <div className="px-4 py-3 border-t flex justify-end gap-2">
                            <button
                                onClick={() => setAdjustOpen(false)}
                                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900"
                            >
                                Отмена
                            </button>
                            <button
                                onClick={submitAdjust}
                                disabled={adjustSubmitting}
                                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                            >
                                {adjustSubmitting ? 'Применяем...' : 'Применить'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── small subcomponents ───
function DiagCard({
    label, value, tone, warn, raw,
}: {
    label: string;
    value: number | string;
    tone: string;
    warn?: boolean;
    raw?: boolean;
}) {
    return (
        <div className={`rounded-md border ${warn ? 'border-red-300' : 'border-slate-200'} bg-white p-3`}>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
            <div className={`text-xl font-bold mt-1 inline-block px-2 py-0.5 rounded ${tone} ${raw ? 'font-mono' : ''}`}>
                {value}
            </div>
            {warn && (
                <div className="text-[10px] text-red-700 mt-1 flex items-center gap-1">
                    <ChevronRight className="h-3 w-3" />
                    Требует внимания
                </div>
            )}
        </div>
    );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
    return (
        <div>
            <div className="text-[10px] uppercase text-slate-500">{label}</div>
            <div className={`text-base font-mono ${tone ?? 'text-slate-800'}`}>{value}</div>
        </div>
    );
}
