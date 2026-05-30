import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import {
    Boxes, AlertTriangle, Plus, Activity, Search, RefreshCw, Lock,
    ShieldAlert, Info, ChevronRight,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { S, PageHeader, Card, Btn, Badge, Input, Modal, TH, FieldLabel, SkuTag, Pagination } from '../components/ui';

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

type MovementToneKey = { color: string; bg: string };
const MOVEMENT_TONE: Record<MovementType, MovementToneKey> = {
    MANUAL_ADD:           { color: '#065f46', bg: '#d1fae5' },
    MANUAL_REMOVE:        { color: '#92400e', bg: '#fef3c7' },
    ORDER_RESERVED:       { color: '#1e40af', bg: '#dbeafe' },
    ORDER_RELEASED:       { color: S.sub,     bg: '#f1f5f9' },
    ORDER_DEDUCTED:       { color: '#9f1239', bg: '#ffe4e6' },
    INVENTORY_ADJUSTMENT: { color: '#5b21b6', bg: '#ede9fe' },
    RETURN_LOGGED:        { color: '#164e63', bg: '#cffafe' },
    CONFLICT_DETECTED:    { color: '#991b1b', bg: '#fee2e2' },
};

type LockToneKey = { color: string; bg: string };
const LOCK_TONE: Record<LockStatus, LockToneKey> = {
    PROCESSING: { color: '#1e40af', bg: '#dbeafe' },
    APPLIED:    { color: '#065f46', bg: '#d1fae5' },
    IGNORED:    { color: S.sub,     bg: '#f1f5f9' },
    FAILED:     { color: '#991b1b', bg: '#fee2e2' },
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
        { id: 'movements', label: 'История движений', icon: null },
        { id: 'lowStock', label: 'Низкий остаток', icon: AlertTriangle },
    ] as const;

    const stocksLastPage = useMemo(
        () => Math.max(1, Math.ceil(stocksTotal / 20)),
        [stocksTotal],
    );

    const selectStyle: React.CSSProperties = {
        padding: '7px 12px',
        borderRadius: 8,
        border: `1px solid ${S.border}`,
        fontFamily: 'Inter',
        fontSize: 13,
        color: S.ink,
        background: '#fff',
        outline: 'none',
        cursor: 'pointer',
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <PageHeader
                title="Учёт остатков"
                subtitle="Сколько товара у вас на складе, что зарезервировано под заказы и что доступно к продаже."
            >
                {writeBlocked && (
                    <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        fontSize: 12, padding: '6px 12px', borderRadius: 8,
                        background: 'rgba(245,158,11,0.08)', border: `1px solid rgba(245,158,11,0.3)`,
                        color: '#92400e',
                    }}>
                        <Lock size={14} />
                        Режим только для чтения
                    </div>
                )}
            </PageHeader>

            {/* Tabs */}
            <div style={{ borderBottom: `2px solid ${S.border}`, display: 'flex', gap: 4, overflowX: 'auto' }}>
                {tabs.map((t) => {
                    const Icon = t.icon;
                    const active = tab === t.id;
                    return (
                        <button
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                padding: '10px 16px',
                                fontFamily: 'Inter', fontWeight: 600, fontSize: 13,
                                border: 'none', borderBottom: active ? `2px solid ${S.blue}` : '2px solid transparent',
                                marginBottom: -2,
                                background: 'transparent',
                                color: active ? S.blue : S.sub,
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                transition: 'color 0.15s',
                            }}
                        >
                            {Icon && <Icon size={15} />}
                            {t.label}
                        </button>
                    );
                })}
            </div>

            {/* ─── Balances ─── */}
            {tab === 'balances' && (
                <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* toolbar */}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <form onSubmit={onSearchSubmit} style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
                            <div style={{ flex: 1, maxWidth: 400 }}>
                                <Input
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Поиск по SKU или названию"
                                    icon={Search}
                                />
                            </div>
                            <Btn
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => loadStocks(stocksPage, search)}
                                title="Обновить"
                            >
                                <RefreshCw size={14} style={{ animation: stocksLoading ? 'spin 0.7s linear infinite' : undefined }} />
                            </Btn>
                        </form>

                    </div>

                    {/* Balances table */}
                    <Card noPad>
                        {/* Header row */}
                        <div style={{
                            display: 'flex', alignItems: 'center',
                            padding: '0 8px', height: 40,
                            borderBottom: `1px solid ${S.border}`,
                            background: S.bg,
                        }}>
                            <TH flex={3}>SKU / Товар</TH>
                            <TH flex={1} align="right">Всего</TH>
                            <TH flex={1} align="right">Резерв</TH>
                            <TH flex={1} align="right">Доступно</TH>
                            <TH flex={3}>Склады</TH>
                            <TH flex={2} align="right">Действия</TH>
                        </div>

                        {stocks.length === 0 && !stocksLoading && (
                            <div style={{ textAlign: 'center', padding: '32px 16px', color: S.muted, fontSize: 13 }}>
                                Нет товаров.
                            </div>
                        )}

                        {stocks.map((row) => {
                            return (
                                <div
                                    key={row.productId}
                                    style={{
                                        display: 'flex', alignItems: 'center',
                                        minHeight: 52, padding: '0 8px',
                                        borderBottom: `1px solid ${S.border}`,
                                        background: '#fff',
                                        transition: 'background 0.12s',
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.background = S.bg)}
                                    onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                                >
                                    {/* SKU / Name */}
                                    <div style={{ flex: 3, padding: '0 8px', overflow: 'hidden' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: S.ink, fontSize: 13 }}>
                                            <SkuTag>{row.sku}</SkuTag>
                                        </div>
                                        <div style={{ fontSize: 12, color: S.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240, marginTop: 2 }}>
                                            {row.name}
                                        </div>
                                    </div>
                                    {/* Всего */}
                                    <div style={{ flex: 1, padding: '0 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: 16, fontWeight: 600, color: S.ink }}>
                                        {row.onHand}
                                    </div>
                                    {/* Резерв */}
                                    <div style={{ flex: 1, padding: '0 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: 16, fontWeight: 600, color: S.blue }}>
                                        {row.reserved}
                                    </div>
                                    {/* Доступно */}
                                    <div style={{ flex: 1, padding: '0 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: S.ink }}>
                                        {row.available}
                                    </div>
                                    {/* Warehouses */}
                                    <div style={{ flex: 3, padding: '0 8px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                        {row.balances.map((b) => (
                                            <span
                                                key={`${row.productId}-${b.warehouseId}-${b.fulfillmentMode}`}
                                                title={`onHand=${b.onHand}, reserved=${b.reserved}, available=${b.available}`}
                                                style={{
                                                    fontSize: 10, padding: '2px 6px', borderRadius: 4,
                                                    background: b.isExternal ? '#f1f5f9' : 'rgba(59,130,246,0.08)',
                                                    color: b.isExternal ? S.sub : S.blue,
                                                    fontFamily: 'monospace',
                                                }}
                                            >
                                                {b.fulfillmentMode}/{b.warehouseId}: {b.available}
                                                {b.isExternal && ' (FBO)'}
                                            </span>
                                        ))}
                                    </div>
                                    {/* Actions */}
                                    <div style={{ flex: 2, padding: '0 8px', display: 'flex', justifyContent: 'flex-end' }}>
                                        <Btn
                                            size="sm"
                                            variant={writeBlocked ? 'ghost' : 'secondary'}
                                            onClick={() => openAdjust(row)}
                                            disabled={writeBlocked}
                                            title={writeBlocked ? writeBlockedHint : 'Корректировка остатка'}
                                        >
                                            {writeBlocked ? <Lock size={12} /> : <Plus size={12} />}
                                            Корректировка
                                        </Btn>
                                    </div>
                                </div>
                            );
                        })}

                        <Pagination
                            page={stocksPage}
                            totalPages={stocksLastPage}
                            onPage={(p) => loadStocks(p, search)}
                            total={stocksTotal}
                            shown={stocks.length}
                        />
                    </Card>
                </section>
            )}

            {/* ─── Movements ─── */}
            {tab === 'movements' && (
                <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* Filters */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                        <div>
                            <FieldLabel>Товар (ID)</FieldLabel>
                            <Input
                                value={moveProductFilter}
                                onChange={(e) => setMoveProductFilter(e.target.value)}
                                placeholder="опционально"
                                style={{ width: 224 }}
                            />
                        </div>
                        <div>
                            <FieldLabel>Тип движения</FieldLabel>
                            <select
                                value={moveTypeFilter}
                                onChange={(e) => setMoveTypeFilter(e.target.value as any)}
                                style={selectStyle}
                            >
                                <option value="">Все</option>
                                {Object.entries(MOVEMENT_LABELS).map(([k, v]) => (
                                    <option key={k} value={k}>{v}</option>
                                ))}
                            </select>
                        </div>
                        <Btn variant="primary" size="sm" onClick={() => loadMovements()}>
                            Применить
                        </Btn>
                    </div>

                    <Card noPad>
                        {/* Header */}
                        <div style={{
                            display: 'flex', alignItems: 'center',
                            padding: '0 8px', height: 40,
                            borderBottom: `1px solid ${S.border}`,
                            background: S.bg,
                        }}>
                            <TH flex={2}>Дата</TH>
                            <TH flex={2}>Тип</TH>
                            <TH flex={2}>Товар</TH>
                            <TH flex={1} align="right">Изм.</TH>
                            <TH flex={2} align="right">Всего до → после</TH>
                            <TH flex={2} align="right">Резерв до → после</TH>
                            <TH flex={3}>Причина / комментарий</TH>
                            <TH flex={2}>Источник</TH>
                        </div>

                        {movements.length === 0 && !moveLoading && (
                            <div style={{ textAlign: 'center', padding: '32px 16px', color: S.muted, fontSize: 13 }}>
                                Движений не найдено.
                            </div>
                        )}

                        {movements.map((m) => (
                            <div
                                key={m.id}
                                style={{
                                    display: 'flex', alignItems: 'center',
                                    minHeight: 52, padding: '0 8px',
                                    borderBottom: `1px solid ${S.border}`,
                                    background: '#fff', transition: 'background 0.12s',
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = S.bg)}
                                onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                            >
                                <div style={{ flex: 2, padding: '0 8px', fontSize: 12, color: S.sub, whiteSpace: 'nowrap' }}>
                                    {formatDateTime(m.createdAt)}
                                </div>
                                <div style={{ flex: 2, padding: '0 8px' }}>
                                    <Badge
                                        label={MOVEMENT_LABELS[m.movementType]}
                                        color={MOVEMENT_TONE[m.movementType].color}
                                        bg={MOVEMENT_TONE[m.movementType].bg}
                                    />
                                </div>
                                <div style={{ flex: 2, padding: '0 8px', overflow: 'hidden' }}>
                                    <div style={{ fontSize: 12, fontWeight: 600, color: S.ink }}>{m.product?.sku ?? '—'}</div>
                                    <div style={{ fontSize: 11, color: S.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                                        {m.product?.name ?? ''}
                                    </div>
                                </div>
                                <div style={{ flex: 1, padding: '0 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13 }}>
                                    <span style={{ color: m.delta > 0 ? S.green : m.delta < 0 ? S.red : S.muted }}>
                                        {m.delta > 0 ? '+' : ''}{m.delta}
                                    </span>
                                </div>
                                <div style={{ flex: 2, padding: '0 8px', textAlign: 'right', fontSize: 12, fontFamily: 'monospace', color: S.sub }}>
                                    {m.onHandBefore ?? '—'} → {m.onHandAfter ?? '—'}
                                </div>
                                <div style={{ flex: 2, padding: '0 8px', textAlign: 'right', fontSize: 12, fontFamily: 'monospace', color: S.sub }}>
                                    {m.reservedBefore ?? '—'} → {m.reservedAfter ?? '—'}
                                </div>
                                <div style={{ flex: 3, padding: '0 8px', fontSize: 12, overflow: 'hidden' }}>
                                    <div style={{ fontWeight: 600, color: S.ink }}>{m.reasonCode ?? '—'}</div>
                                    {m.comment && (
                                        <div style={{ color: S.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
                                            {m.comment}
                                        </div>
                                    )}
                                </div>
                                <div style={{ flex: 2, padding: '0 8px', fontSize: 12, color: S.sub, overflow: 'hidden' }}>
                                    <div style={{ color: S.ink }}>{{ USER: 'Пользователь', SYSTEM: 'Система', MARKETPLACE: 'Маркетплейс' }[m.source] ?? m.source}</div>
                                    {m.actorUser?.email && (
                                        <div style={{ color: S.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
                                            {m.actorUser.email}
                                        </div>
                                    )}
                                    {m.sourceEventId && (
                                        <div
                                            title={m.sourceEventId}
                                            style={{ color: S.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}
                                        >
                                            evt: {m.sourceEventId}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </Card>
                </section>
            )}

            {/* ─── Low stock ─── */}
            {tab === 'lowStock' && (
                <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* Threshold settings card */}
                    <Card>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 14, fontWeight: 600, color: S.ink }}>
                                    Порог низкого остатка
                                </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Input
                                    type="number"
                                    min={0}
                                    value={thresholdInput}
                                    onChange={(e) => setThresholdInput(e.target.value)}
                                    disabled={writeBlocked}
                                    style={{ width: 96 }}
                                />
                                <Btn
                                    variant={writeBlocked ? 'ghost' : 'primary'}
                                    size="sm"
                                    onClick={updateThreshold}
                                    disabled={writeBlocked || parseInt(thresholdInput, 10) === lowStockThreshold}
                                    title={writeBlocked ? writeBlockedHint : 'Сохранить порог'}
                                >
                                    Сохранить
                                </Btn>
                            </div>
                        </div>
                        <p style={{ fontSize: 12, color: S.muted, marginTop: 10, marginBottom: 0 }}>
                            Текущий порог: <span style={{ fontFamily: 'monospace', fontWeight: 600, color: S.ink }}>{lowStockThreshold}</span>. Товары с доступным остатком ≤ порога попадают в список ниже.
                        </p>
                    </Card>

                    {/* Low stock table */}
                    <Card noPad>
                        <div style={{
                            display: 'flex', alignItems: 'center',
                            padding: '0 8px', height: 40,
                            borderBottom: `1px solid ${S.border}`,
                            background: S.bg,
                        }}>
                            <TH flex={2}>SKU</TH>
                            <TH flex={4}>Название</TH>
                            <TH flex={2}>Склад</TH>
                            <TH flex={1} align="right">Всего</TH>
                            <TH flex={1} align="right">Резерв</TH>
                            <TH flex={1} align="right">Доступно</TH>
                            <TH flex={2}>Источник</TH>
                        </div>

                        {lowStock.length === 0 && !lowLoading && (
                            <div style={{ textAlign: 'center', padding: '32px 16px', color: S.muted, fontSize: 13 }}>
                                Все остатки выше порога — это хорошо.
                            </div>
                        )}

                        {lowStock.map((it) => (
                            <div
                                key={`${it.productId}-${it.warehouseId}`}
                                style={{
                                    display: 'flex', alignItems: 'center',
                                    minHeight: 52, padding: '0 8px',
                                    borderBottom: `1px solid ${S.border}`,
                                    background: '#fff', transition: 'background 0.12s',
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = S.bg)}
                                onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                            >
                                <div style={{ flex: 2, padding: '0 8px' }}>
                                    <SkuTag>{it.sku}</SkuTag>
                                </div>
                                <div style={{ flex: 4, padding: '0 8px', fontSize: 13, color: S.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>
                                    {it.name}
                                </div>
                                <div style={{ flex: 2, padding: '0 8px', fontSize: 12, color: S.sub }}>
                                    {it.warehouseId}
                                </div>
                                <div style={{ flex: 1, padding: '0 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13 }}>
                                    {it.onHand}
                                </div>
                                <div style={{ flex: 1, padding: '0 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13, color: S.blue }}>
                                    {it.reserved}
                                </div>
                                <div style={{ flex: 1, padding: '0 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: S.red }}>
                                    {it.available}
                                </div>
                                <div style={{ flex: 2, padding: '0 8px' }}>
                                    <Badge
                                        label={it.source === 'balance' ? 'Баланс склада' : 'Данные товара'}
                                        color={it.source === 'balance' ? S.blue : '#92400e'}
                                        bg={it.source === 'balance' ? 'rgba(59,130,246,0.08)' : 'rgba(245,158,11,0.1)'}
                                    />
                                </div>
                            </div>
                        ))}
                    </Card>
                </section>
            )}

            {/* ─── Diagnostics ─── */}
            {tab === 'diagnostics' && (
                <section style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {!diagnostics && diagLoading && (
                        <div style={{ fontSize: 13, color: S.muted }}>Загрузка диагностики...</div>
                    )}
                    {diagnostics && (
                        <>
                            {/* Diag cards grid */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
                                <DiagCard label="В обработке" value={diagnostics.locks.processing} color="#1e40af" bg="#dbeafe" warn={diagnostics.locks.processing > 5} />
                                <DiagCard label="Применено" value={diagnostics.locks.applied} color="#065f46" bg="#d1fae5" />
                                <DiagCard label="Пропущено" value={diagnostics.locks.ignored} color={S.sub} bg="#f1f5f9" />
                                <DiagCard label="Ошибки блокировок" value={diagnostics.locks.failed} color="#991b1b" bg="#fee2e2" warn={diagnostics.locks.failed > 0} />
                                <DiagCard label="Конфликты за 24ч" value={diagnostics.conflictsLast24h} color="#92400e" bg="#fef3c7" warn={diagnostics.conflictsLast24h > 0} />
                                <DiagCard label="Ошибки резерва (24ч)" value={diagnostics.reserveReleaseFailedLast24h} color="#9f1239" bg="#ffe4e6" warn={diagnostics.reserveReleaseFailedLast24h > 0} />
                                <DiagCard label="Ошибки списания (24ч)" value={diagnostics.deductFailedLast24h} color="#9f1239" bg="#ffe4e6" warn={diagnostics.deductFailedLast24h > 0} />
                                <DiagCard label="Период" value={diagnostics.window} color={S.sub} bg="#f1f5f9" raw />
                            </div>

                            {/* Conflicts table */}
                            <Card noPad>
                                <div style={{
                                    padding: '12px 20px', borderBottom: `1px solid ${S.border}`,
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    fontSize: 14, fontWeight: 700, color: S.ink,
                                }}>
                                    <ShieldAlert size={16} color={S.red} />
                                    Конфликты с маркетплейсами (CONFLICT_DETECTED)
                                </div>
                                {/* header */}
                                <div style={{
                                    display: 'flex', alignItems: 'center',
                                    padding: '0 8px', height: 40,
                                    borderBottom: `1px solid ${S.border}`,
                                    background: S.bg,
                                }}>
                                    <TH flex={2}>Когда</TH>
                                    <TH flex={2}>Товар</TH>
                                    <TH flex={1} align="right">Расхождение</TH>
                                    <TH flex={3}>Комментарий</TH>
                                    <TH flex={2}>ID события</TH>
                                </div>
                                {conflicts.length === 0 && (
                                    <div style={{ textAlign: 'center', padding: '24px 16px', color: S.muted, fontSize: 13 }}>
                                        Конфликтов не зафиксировано.
                                    </div>
                                )}
                                {conflicts.map((c) => (
                                    <div
                                        key={c.id}
                                        style={{
                                            display: 'flex', alignItems: 'center',
                                            minHeight: 48, padding: '0 8px',
                                            borderBottom: `1px solid ${S.border}`,
                                            background: '#fff', transition: 'background 0.12s',
                                        }}
                                        onMouseEnter={e => (e.currentTarget.style.background = S.bg)}
                                        onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                                    >
                                        <div style={{ flex: 2, padding: '0 8px', fontSize: 12, color: S.sub }}>
                                            {formatDateTime(c.createdAt)}
                                        </div>
                                        <div style={{ flex: 2, padding: '0 8px', fontSize: 12, color: S.ink }}>
                                            {c.product?.sku ?? c.productId}
                                        </div>
                                        <div style={{ flex: 1, padding: '0 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13 }}>
                                            <span style={{ color: c.delta > 0 ? S.green : c.delta < 0 ? S.red : S.muted }}>
                                                {c.delta > 0 ? '+' : ''}{c.delta}
                                            </span>
                                        </div>
                                        <div style={{ flex: 3, padding: '0 8px', fontSize: 12, color: S.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>
                                            {c.comment ?? '—'}
                                        </div>
                                        <div
                                            title={c.sourceEventId ?? ''}
                                            style={{ flex: 2, padding: '0 8px', fontSize: 12, color: S.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}
                                        >
                                            {c.sourceEventId ?? '—'}
                                        </div>
                                    </div>
                                ))}
                            </Card>

                            {/* Failed effect locks table */}
                            <Card noPad>
                                <div style={{
                                    padding: '12px 20px', borderBottom: `1px solid ${S.border}`,
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    fontSize: 14, fontWeight: 700, color: S.ink,
                                }}>
                                    <Info size={16} color={S.red} />
                                    Ошибки операций (требуют расследования)
                                </div>
                                <div style={{
                                    display: 'flex', alignItems: 'center',
                                    padding: '0 8px', height: 40,
                                    borderBottom: `1px solid ${S.border}`,
                                    background: S.bg,
                                }}>
                                    <TH flex={2}>Тип</TH>
                                    <TH flex={4}>ID события</TH>
                                    <TH flex={2}>Статус</TH>
                                    <TH flex={2}>Обновлён</TH>
                                </div>
                                {locks.length === 0 && (
                                    <div style={{ textAlign: 'center', padding: '24px 16px', color: S.muted, fontSize: 13 }}>
                                        Нет упавших lock'ов за окно — ок.
                                    </div>
                                )}
                                {locks.map((l) => (
                                    <div
                                        key={l.id}
                                        style={{
                                            display: 'flex', alignItems: 'center',
                                            minHeight: 48, padding: '0 8px',
                                            borderBottom: `1px solid ${S.border}`,
                                            background: '#fff', transition: 'background 0.12s',
                                        }}
                                        onMouseEnter={e => (e.currentTarget.style.background = S.bg)}
                                        onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                                    >
                                        <div style={{ flex: 2, padding: '0 8px', fontSize: 12, color: S.ink }}>{l.effectType}</div>
                                        <div
                                            title={l.sourceEventId}
                                            style={{ flex: 4, padding: '0 8px', fontSize: 12, color: S.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}
                                        >
                                            {l.sourceEventId}
                                        </div>
                                        <div style={{ flex: 2, padding: '0 8px' }}>
                                            <Badge
                                                label={l.status}
                                                color={LOCK_TONE[l.status].color}
                                                bg={LOCK_TONE[l.status].bg}
                                            />
                                        </div>
                                        <div style={{ flex: 2, padding: '0 8px', fontSize: 12, color: S.sub }}>
                                            {formatDateTime(l.updatedAt)}
                                        </div>
                                    </div>
                                ))}
                            </Card>
                        </>
                    )}
                </section>
            )}

            {/* ─── Adjustment dialog ─── */}
            <Modal
                open={adjustOpen && !!adjustTarget}
                onClose={() => setAdjustOpen(false)}
                title="Корректировка остатка"
                width={460}
            >
                {adjustTarget && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div style={{ fontSize: 13, color: S.sub }}>
                            <span style={{ fontWeight: 600, color: S.ink }}>{adjustTarget.sku}</span> — {adjustTarget.name}
                        </div>

                        {/* Stats */}
                        <div style={{
                            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
                            gap: 8, background: S.bg, borderRadius: 10, padding: 12,
                        }}>
                            <Stat label="Всего" value={adjustTarget.onHand} />
                            <Stat label="Резерв" value={adjustTarget.reserved} color={S.blue} />
                            <Stat label="Доступно" value={adjustTarget.available} color={S.green} />
                        </div>

                        {/* Mode toggle */}
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button
                                onClick={() => setAdjustMode('delta')}
                                style={{
                                    flex: 1, padding: '10px 12px', fontSize: 13, fontWeight: 600,
                                    borderRadius: 8, cursor: 'pointer',
                                    border: `1px solid ${adjustMode === 'delta' ? S.blue : S.border}`,
                                    background: adjustMode === 'delta' ? 'rgba(59,130,246,0.08)' : '#fff',
                                    color: adjustMode === 'delta' ? S.blue : S.sub,
                                    transition: 'all 0.12s',
                                }}
                            >
                                Добавить / убрать
                            </button>
                            <button
                                onClick={() => setAdjustMode('target')}
                                style={{
                                    flex: 1, padding: '10px 12px', fontSize: 13, fontWeight: 600,
                                    borderRadius: 8, cursor: 'pointer',
                                    border: `1px solid ${adjustMode === 'target' ? S.blue : S.border}`,
                                    background: adjustMode === 'target' ? 'rgba(59,130,246,0.08)' : '#fff',
                                    color: adjustMode === 'target' ? S.blue : S.sub,
                                    transition: 'all 0.12s',
                                }}
                            >
                                Задать точное количество
                            </button>
                        </div>

                        {adjustMode === 'delta' ? (
                            <div>
                                <FieldLabel>На сколько изменить *</FieldLabel>
                                <Input
                                    type="number"
                                    value={adjustDelta}
                                    onChange={(e) => setAdjustDelta(e.target.value)}
                                    placeholder="+10 чтобы добавить, -3 чтобы убрать"
                                    style={{ width: '100%' }}
                                />
                            </div>
                        ) : (
                            <div>
                                <FieldLabel>Новый остаток на складе *</FieldLabel>
                                <Input
                                    type="number"
                                    min={0}
                                    value={adjustTargetQty}
                                    onChange={(e) => setAdjustTargetQty(e.target.value)}
                                    placeholder="Введите фактическое количество"
                                    style={{ width: '100%' }}
                                />
                            </div>
                        )}

                        <div>
                            <FieldLabel>Причина корректировки *</FieldLabel>
                            <select
                                value={adjustReason}
                                onChange={(e) => setAdjustReason(e.target.value)}
                                style={{ ...selectStyle, width: '100%' }}
                            >
                                <option value="RECOUNT">Пересчёт (инвентаризация)</option>
                                <option value="LOSS">Недостача</option>
                                <option value="FOUND">Излишек (найдено)</option>
                                <option value="DAMAGE">Порча / брак</option>
                                <option value="RETURN_RESTOCK">Возврат на склад</option>
                                <option value="OTHER">Другое</option>
                            </select>
                        </div>

                        <div>
                            <FieldLabel>Комментарий</FieldLabel>
                            <textarea
                                value={adjustComment}
                                onChange={(e) => setAdjustComment(e.target.value)}
                                rows={2}
                                placeholder="Опционально, виден в истории движений"
                                style={{
                                    width: '100%', padding: '8px 12px',
                                    borderRadius: 8, border: `1px solid ${S.border}`,
                                    fontFamily: 'Inter', fontSize: 13, color: S.ink,
                                    background: '#fff', outline: 'none',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                                    resize: 'vertical', boxSizing: 'border-box',
                                }}
                            />
                        </div>

                        {adjustError && (
                            <div style={{
                                fontSize: 12, color: S.red,
                                background: 'rgba(239,68,68,0.06)',
                                border: `1px solid rgba(239,68,68,0.2)`,
                                borderRadius: 8, padding: '8px 12px',
                            }}>
                                {adjustError}
                            </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
                            <Btn variant="ghost" onClick={() => setAdjustOpen(false)}>
                                Отмена
                            </Btn>
                            <Btn
                                variant="primary"
                                onClick={submitAdjust}
                                disabled={adjustSubmitting}
                            >
                                {adjustSubmitting ? 'Применяем...' : 'Применить'}
                            </Btn>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
}

// ─── small subcomponents ───
function DiagCard({
    label, value, color, bg, warn, raw,
}: {
    label: string;
    value: number | string;
    color: string;
    bg: string;
    warn?: boolean;
    raw?: boolean;
}) {
    return (
        <div style={{
            borderRadius: 12,
            border: `1px solid ${warn ? 'rgba(239,68,68,0.35)' : S.border}`,
            background: '#fff',
            padding: 16,
        }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: S.muted }}>
                {label}
            </div>
            <div style={{
                display: 'inline-block', marginTop: 8,
                fontSize: 22, fontWeight: 800,
                fontFamily: raw ? 'monospace' : 'Inter',
                padding: '2px 8px', borderRadius: 6,
                background: bg, color,
            }}>
                {value}
            </div>
            {warn && (
                <div style={{ fontSize: 10, color: S.red, marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <ChevronRight size={11} />
                    Требует внимания
                </div>
            )}
        </div>
    );
}

function Stat({ label, value, color }: { label: string; value: number | string; color?: string }) {
    return (
        <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: S.muted }}>{label}</div>
            <div style={{ fontSize: 18, fontFamily: 'monospace', fontWeight: 700, color: color ?? S.ink, marginTop: 2 }}>{value}</div>
        </div>
    );
}
