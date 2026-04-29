import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
    AlertCircle,
    AlertTriangle,
    CheckCircle2,
    Clock,
    ClipboardList,
    Info,
    Loader2,
    PauseCircle,
    PlayCircle,
    Plus,
    RefreshCw,
    ShieldAlert,
    XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { QuickCreateModal, type Member as TaskMember } from './Tasks';

// ─── Doменные типы (зеркалят backend OrdersReadService DTO) ─────────
type Marketplace = 'WB' | 'OZON';
type FulfillmentMode = 'FBS' | 'FBO';
type InternalStatus =
    | 'IMPORTED'
    | 'RESERVED'
    | 'CANCELLED'
    | 'FULFILLED'
    | 'DISPLAY_ONLY_FBO'
    | 'UNRESOLVED';
type StockEffectStatus =
    | 'NOT_REQUIRED'
    | 'PENDING'
    | 'APPLIED'
    | 'BLOCKED'
    | 'FAILED';
type MatchStatus = 'MATCHED' | 'UNMATCHED';
type OrderEventType =
    | 'RECEIVED'
    | 'STATUS_CHANGED'
    | 'RESERVED'
    | 'RESERVE_RELEASED'
    | 'DEDUCTED'
    | 'RETURN_LOGGED'
    | 'DUPLICATE_IGNORED'
    | 'OUT_OF_ORDER_IGNORED'
    | 'STOCK_EFFECT_FAILED';

interface OrderHeader {
    id: string;
    marketplace: Marketplace;
    marketplaceAccountId: string;
    marketplaceOrderId: string;
    syncRunId: string | null;
    fulfillmentMode: FulfillmentMode;
    externalStatus: string | null;
    internalStatus: InternalStatus;
    affectsStock: boolean;
    stockEffectStatus: StockEffectStatus;
    warehouseId: string | null;
    orderCreatedAt: string | null;
    processedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

interface OrderItemDto {
    id: string;
    productId: string | null;
    sku: string | null;
    name: string | null;
    matchStatus: MatchStatus;
    warehouseId: string | null;
    quantity: number;
    price: string | null;
}

interface OrderDetailDto extends OrderHeader {
    items: OrderItemDto[];
}

interface OrderEventDto {
    id: string;
    eventType: OrderEventType;
    externalEventId: string;
    marketplaceAccountId: string;
    payload: any;
    createdAt: string;
}

// ─── Лейблы и стили ─────────────────────────────────────────────────
const INTERNAL_STATUS_LABEL: Record<InternalStatus, { label: string; tone: string }> = {
    IMPORTED: { label: 'Принят', tone: 'bg-slate-100 text-slate-700 ring-slate-200' },
    RESERVED: { label: 'Резерв', tone: 'bg-blue-50 text-blue-700 ring-blue-200' },
    CANCELLED: { label: 'Отменён', tone: 'bg-rose-50 text-rose-700 ring-rose-200' },
    FULFILLED: { label: 'Выполнен', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
    DISPLAY_ONLY_FBO: { label: 'FBO (без резерва)', tone: 'bg-violet-50 text-violet-700 ring-violet-200' },
    UNRESOLVED: { label: 'Требует разбора', tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
};

const STOCK_EFFECT_LABEL: Record<StockEffectStatus, { label: string; tone: string; explain: string }> = {
    NOT_REQUIRED: {
        label: 'Не требуется',
        tone: 'text-slate-500',
        explain: 'Заказ не влияет на управляемый остаток (например, FBO).',
    },
    PENDING: {
        label: 'Ожидает применения',
        tone: 'text-amber-600',
        explain: 'Бизнес-эффект на остаток ещё не применён. Обычно решается автоматически следующим циклом синхронизации.',
    },
    APPLIED: {
        label: 'Применено',
        tone: 'text-emerald-600',
        explain: 'Резерв/списание учтены в остатках.',
    },
    BLOCKED: {
        label: 'Заблокировано политикой',
        tone: 'text-orange-600',
        explain: 'Действие приостановлено: tenant в режиме TRIAL_EXPIRED / SUSPENDED / CLOSED. Снимется автоматически после восстановления доступа.',
    },
    FAILED: {
        label: 'Ошибка применения',
        tone: 'text-rose-600',
        explain: 'Side-effect не применился. Чаще всего из-за несопоставленного SKU или неопределённого склада. Используйте «Повторить обработку» после устранения причины.',
    },
};

const MATCH_LABEL: Record<MatchStatus, string> = {
    MATCHED: 'Сопоставлен',
    UNMATCHED: 'Не сопоставлен',
};

const EVENT_LABEL: Record<OrderEventType, { label: string; icon: any; tone: string }> = {
    RECEIVED: { label: 'Получено событие', icon: Info, tone: 'text-slate-600' },
    STATUS_CHANGED: { label: 'Изменение внешнего статуса', icon: RefreshCw, tone: 'text-blue-600' },
    RESERVED: { label: 'Резерв оформлен', icon: CheckCircle2, tone: 'text-blue-600' },
    RESERVE_RELEASED: { label: 'Резерв снят', icon: AlertTriangle, tone: 'text-amber-600' },
    DEDUCTED: { label: 'Списано со склада', icon: CheckCircle2, tone: 'text-emerald-600' },
    RETURN_LOGGED: { label: 'Возврат зафиксирован', icon: Info, tone: 'text-slate-600' },
    DUPLICATE_IGNORED: { label: 'Дубль проигнорирован', icon: ShieldAlert, tone: 'text-slate-500' },
    OUT_OF_ORDER_IGNORED: { label: 'Устаревшее событие пропущено', icon: ShieldAlert, tone: 'text-slate-500' },
    STOCK_EFFECT_FAILED: { label: 'Ошибка применения остатка', icon: XCircle, tone: 'text-rose-600' },
};

const PAUSED_STATES = new Set(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED']);

// ─── Component ──────────────────────────────────────────────────────
export default function Orders() {
    const { activeTenant } = useAuth();
    const isPaused = activeTenant ? PAUSED_STATES.has(activeTenant.accessState) : false;

    const [orders, setOrders] = useState<OrderHeader[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [marketplace, setMarketplace] = useState<'ALL' | Marketplace>('ALL');
    const [fulfillmentMode, setFulfillmentMode] = useState<'ALL' | FulfillmentMode>('ALL');
    const [internalStatus, setInternalStatus] = useState<'ALL' | InternalStatus>('ALL');
    const [stockEffectStatus, setStockEffectStatus] = useState<'ALL' | StockEffectStatus>('ALL');
    const [search, setSearch] = useState('');

    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);

    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

    const fetchOrders = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page), limit: '20' });
            if (marketplace !== 'ALL') params.set('marketplace', marketplace);
            if (fulfillmentMode !== 'ALL') params.set('fulfillmentMode', fulfillmentMode);
            if (internalStatus !== 'ALL') params.set('internalStatus', internalStatus);
            if (stockEffectStatus !== 'ALL') params.set('stockEffectStatus', stockEffectStatus);
            if (search.trim()) params.set('search', search.trim());

            const res = await axios.get(`/orders?${params.toString()}`);
            setOrders(res.data.items ?? []);
            setPages(res.data.meta?.pages ?? 1);
            setTotal(res.data.meta?.total ?? 0);
            setError(null);
        } catch (err: any) {
            setError(err?.response?.data?.message ?? 'Не удалось загрузить заказы');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const t = setTimeout(fetchOrders, 200);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, marketplace, fulfillmentMode, internalStatus, stockEffectStatus, search]);

    // Counters для шапки — высчитываются по текущей странице (для quick UX).
    const counters = useMemo(() => {
        const c = { reserved: 0, fulfilled: 0, cancelled: 0, unresolved: 0, failedEffect: 0, fbo: 0 };
        for (const o of orders) {
            if (o.internalStatus === 'RESERVED') c.reserved++;
            if (o.internalStatus === 'FULFILLED') c.fulfilled++;
            if (o.internalStatus === 'CANCELLED') c.cancelled++;
            if (o.internalStatus === 'UNRESOLVED') c.unresolved++;
            if (o.stockEffectStatus === 'FAILED') c.failedEffect++;
            if (o.fulfillmentMode === 'FBO') c.fbo++;
        }
        return c;
    }, [orders]);

    return (
        <div className="space-y-6">
            <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Заказы</h1>
                    <p className="text-slate-500 mt-1 text-xs sm:text-sm">
                        Внутренний статус, влияние на остатки и таймлайн событий по каждому заказу
                    </p>
                </div>
                <button
                    onClick={fetchOrders}
                    disabled={loading}
                    className="inline-flex items-center px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-50"
                >
                    <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                    Обновить список
                </button>
            </header>

            {/* TASK_ORDERS_6: paused integration banner.
                §10 + §4 сценарий 4 + UX-правило: история доступна, но не
                ждите новых заказов до снятия паузы. Не обещаем live-данные. */}
            {isPaused && (
                <div className="border border-amber-200 bg-amber-50 text-amber-900 rounded-xl px-4 py-3 flex items-start gap-3">
                    <PauseCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                        <div className="font-semibold">Интеграции с маркетплейсами на паузе</div>
                        <div className="mt-0.5">
                            История ваших заказов доступна для просмотра, но новые заказы из внешних API
                            не будут приходить до снятия ограничения по компании
                            ({activeTenant?.accessState}). Side-effects на остатки также не применяются.
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

            {/* KPI tiles по текущей странице */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <KpiTile label="Резерв" value={counters.reserved} tone="blue" />
                <KpiTile label="Выполнено" value={counters.fulfilled} tone="emerald" />
                <KpiTile label="Отменено" value={counters.cancelled} tone="rose" />
                <KpiTile label="Требует разбора" value={counters.unresolved} tone="amber" />
                <KpiTile label="Ошибка остатка" value={counters.failedEffect} tone="rose" />
                <KpiTile label="FBO" value={counters.fbo} tone="violet" />
            </div>

            {/* Filters */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 grid grid-cols-1 md:grid-cols-5 gap-3">
                <Select
                    label="Маркетплейс"
                    value={marketplace}
                    onChange={(v) => { setMarketplace(v as any); setPage(1); }}
                    options={[
                        ['ALL', 'Все'],
                        ['WB', 'WB'],
                        ['OZON', 'Ozon'],
                    ]}
                />
                <Select
                    label="Тип отгрузки"
                    value={fulfillmentMode}
                    onChange={(v) => { setFulfillmentMode(v as any); setPage(1); }}
                    options={[
                        ['ALL', 'Все'],
                        ['FBS', 'FBS'],
                        ['FBO', 'FBO'],
                    ]}
                />
                <Select
                    label="Внутренний статус"
                    value={internalStatus}
                    onChange={(v) => { setInternalStatus(v as any); setPage(1); }}
                    options={[
                        ['ALL', 'Все'],
                        ['IMPORTED', 'Принят'],
                        ['RESERVED', 'Резерв'],
                        ['CANCELLED', 'Отменён'],
                        ['FULFILLED', 'Выполнен'],
                        ['DISPLAY_ONLY_FBO', 'FBO (без резерва)'],
                        ['UNRESOLVED', 'Требует разбора'],
                    ]}
                />
                <Select
                    label="Эффект на остаток"
                    value={stockEffectStatus}
                    onChange={(v) => { setStockEffectStatus(v as any); setPage(1); }}
                    options={[
                        ['ALL', 'Все'],
                        ['NOT_REQUIRED', 'Не требуется'],
                        ['PENDING', 'Ожидает'],
                        ['APPLIED', 'Применено'],
                        ['BLOCKED', 'Заблокировано'],
                        ['FAILED', 'Ошибка'],
                    ]}
                />
                <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                        Поиск по номеру
                    </label>
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                        placeholder="WB12345 / 0000-1234-5678"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm"
                    />
                </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-slate-50/60 border-b border-slate-100">
                            <tr>
                                <Th>Дата</Th>
                                <Th>Источник</Th>
                                <Th>Номер</Th>
                                <Th>Тип</Th>
                                <Th>Внутренний статус</Th>
                                <Th>Внешний статус</Th>
                                <Th>Эффект на остаток</Th>
                                <Th />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading && orders.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="py-16 text-center text-slate-400">
                                        <Loader2 className="h-6 w-6 animate-spin inline-block" />
                                    </td>
                                </tr>
                            ) : orders.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="py-16 text-center text-slate-400 italic">
                                        Заказов по выбранным фильтрам не найдено
                                    </td>
                                </tr>
                            ) : (
                                orders.map((o) => {
                                    const intl = INTERNAL_STATUS_LABEL[o.internalStatus];
                                    const eff = STOCK_EFFECT_LABEL[o.stockEffectStatus];
                                    return (
                                        <tr
                                            key={o.id}
                                            onClick={() => setSelectedOrderId(o.id)}
                                            className="hover:bg-slate-50/60 cursor-pointer transition-colors"
                                        >
                                            <td className="px-4 py-3 text-sm text-slate-700">
                                                <div className="font-medium text-slate-900">
                                                    {formatDate(o.orderCreatedAt || o.createdAt)}
                                                </div>
                                                <div className="text-[11px] text-slate-400 mt-0.5">
                                                    {timeAgo(o.orderCreatedAt || o.createdAt)}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span
                                                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ring-1 ring-inset ${
                                                        o.marketplace === 'WB'
                                                            ? 'bg-purple-50 text-purple-700 ring-purple-200'
                                                            : 'bg-blue-50 text-blue-700 ring-blue-200'
                                                    }`}
                                                >
                                                    {o.marketplace}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 font-mono text-sm font-semibold text-slate-900">
                                                {o.marketplaceOrderId}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-slate-600">
                                                {o.fulfillmentMode}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span
                                                    className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ring-1 ring-inset ${intl.tone}`}
                                                >
                                                    {intl.label}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-slate-500">
                                                {o.externalStatus ?? '—'}
                                            </td>
                                            <td className="px-4 py-3 text-xs">
                                                <div className={`flex items-center gap-1 font-semibold ${eff.tone}`}>
                                                    {o.affectsStock ? <CheckCircle2 className="h-3.5 w-3.5" /> : <PlayCircle className="h-3.5 w-3.5" />}
                                                    {eff.label}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setSelectedOrderId(o.id);
                                                    }}
                                                    className="text-blue-600 hover:text-blue-700 text-xs font-semibold"
                                                >
                                                    Подробнее →
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="bg-slate-50 px-4 py-3 border-t border-slate-200 flex items-center justify-between">
                    <button
                        disabled={page === 1}
                        onClick={() => setPage((p) => p - 1)}
                        className="px-3 py-1.5 border border-slate-300 text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50"
                    >
                        Назад
                    </button>
                    <span className="text-xs text-slate-600">
                        Страница <span className="font-semibold">{page}</span> из <span className="font-semibold">{pages}</span>
                        {' · '}
                        Всего: <span className="font-semibold">{total}</span>
                    </span>
                    <button
                        disabled={page >= pages}
                        onClick={() => setPage((p) => p + 1)}
                        className="px-3 py-1.5 border border-slate-300 text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50"
                    >
                        Вперёд
                    </button>
                </div>
            </div>

            {selectedOrderId && (
                <OrderDetailDrawer
                    orderId={selectedOrderId}
                    onClose={() => setSelectedOrderId(null)}
                    onReprocessed={fetchOrders}
                    isPaused={isPaused}
                />
            )}
        </div>
    );
}

// ─── Subcomponents ──────────────────────────────────────────────────

function KpiTile({ label, value, tone }: { label: string; value: number; tone: string }) {
    const toneMap: Record<string, string> = {
        blue: 'bg-blue-50 text-blue-700',
        emerald: 'bg-emerald-50 text-emerald-700',
        rose: 'bg-rose-50 text-rose-700',
        amber: 'bg-amber-50 text-amber-700',
        violet: 'bg-violet-50 text-violet-700',
    };
    return (
        <div className={`rounded-xl px-3 py-3 ${toneMap[tone]} border border-transparent`}>
            <div className="text-[10px] uppercase tracking-wider font-semibold opacity-80">{label}</div>
            <div className="text-2xl font-bold mt-0.5">{value}</div>
        </div>
    );
}

function Th({ children }: { children?: React.ReactNode }) {
    return (
        <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            {children}
        </th>
    );
}

function Select({
    label,
    value,
    onChange,
    options,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: Array<[string, string]>;
}) {
    return (
        <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                {label}
            </label>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm bg-white"
            >
                {options.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                ))}
            </select>
        </div>
    );
}

// ─── Detail drawer (right side panel) ───────────────────────────────
function OrderDetailDrawer({
    orderId,
    onClose,
    onReprocessed,
    isPaused,
}: {
    orderId: string;
    onClose: () => void;
    onReprocessed: () => void;
    isPaused: boolean;
}) {
    const { user } = useAuth();
    const [detail, setDetail] = useState<OrderDetailDto | null>(null);
    const [events, setEvents] = useState<OrderEventDto[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [reprocessing, setReprocessing] = useState(false);
    const [reprocessResult, setReprocessResult] = useState<any | null>(null);

    // Task creation state
    const [createTaskOpen, setCreateTaskOpen] = useState(false);
    const [members, setMembers] = useState<TaskMember[]>([]);
    const [relatedTasks, setRelatedTasks] = useState<Array<{ id: string; title: string; status: string; assigneeUserId: string }>>([]);
    const [relatedTasksLoading, setRelatedTasksLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [d, t] = await Promise.all([
                axios.get(`/orders/${orderId}`),
                axios.get(`/orders/${orderId}/timeline`),
            ]);
            setDetail(d.data);
            setEvents(t.data.events ?? []);
            setError(null);
        } catch (err: any) {
            setError(err?.response?.data?.message ?? 'Не удалось загрузить детали заказа');
        } finally {
            setLoading(false);
        }
    }, [orderId]);

    const loadRelatedTasks = useCallback(async () => {
        setRelatedTasksLoading(true);
        try {
            const res = await axios.get('/tasks', { params: { relatedOrderId: orderId, status: 'OPEN,IN_PROGRESS,WAITING', limit: 10 } });
            setRelatedTasks(res.data.items ?? []);
        } catch { /* non-critical */ }
        finally { setRelatedTasksLoading(false); }
    }, [orderId]);

    useEffect(() => {
        load();
        loadRelatedTasks();
        axios.get('/team/members').then(r => setMembers(r.data ?? [])).catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orderId]);

    const onReprocess = async () => {
        setReprocessing(true);
        setReprocessResult(null);
        try {
            const res = await axios.post(`/orders/${orderId}/reprocess`);
            setReprocessResult(res.data);
            await load();
            onReprocessed();
        } catch (err: any) {
            setReprocessResult({
                status: 'ERROR',
                detail: err?.response?.data?.message
                    ?? err?.response?.data?.code
                    ?? 'Ошибка повторной обработки',
            });
        } finally {
            setReprocessing(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex">
            <div className="flex-1 bg-slate-900/40" onClick={onClose} />
            <aside className="w-full max-w-xl bg-white shadow-2xl flex flex-col">
                <header className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                    <div>
                        <div className="text-xs text-slate-500">Заказ</div>
                        <div className="font-mono font-bold text-slate-900">
                            {detail?.marketplaceOrderId ?? '...'}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setCreateTaskOpen(true)}
                            disabled={isPaused}
                            title={isPaused ? 'Создание недоступно при паузе интеграций' : 'Создать задачу по этому заказу'}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 transition-colors"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            Создать задачу
                        </button>
                        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl">
                            ×
                        </button>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                    {loading ? (
                        <div className="flex items-center text-slate-500 text-sm">
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            Загрузка...
                        </div>
                    ) : error ? (
                        <div className="text-rose-600 text-sm">{error}</div>
                    ) : detail ? (
                        <>
                            {/* Header summary */}
                            <section className="grid grid-cols-2 gap-3">
                                <Field label="Маркетплейс" value={detail.marketplace} />
                                <Field label="Тип отгрузки" value={detail.fulfillmentMode} />
                                <Field
                                    label="Внутренний статус"
                                    value={
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ring-1 ring-inset ${INTERNAL_STATUS_LABEL[detail.internalStatus].tone}`}>
                                            {INTERNAL_STATUS_LABEL[detail.internalStatus].label}
                                        </span>
                                    }
                                />
                                <Field
                                    label="Внешний статус"
                                    value={detail.externalStatus ?? '—'}
                                />
                                <Field label="Создано на маркетплейсе" value={detail.orderCreatedAt ? formatDate(detail.orderCreatedAt) : '—'} />
                                <Field label="Последнее событие" value={detail.processedAt ? formatDate(detail.processedAt) : '—'} />
                            </section>

                            {/* Stock effect explanation */}
                            <section className={`rounded-xl border p-4 ${
                                detail.stockEffectStatus === 'FAILED' ? 'border-rose-200 bg-rose-50/60' :
                                detail.stockEffectStatus === 'BLOCKED' ? 'border-orange-200 bg-orange-50/60' :
                                detail.stockEffectStatus === 'PENDING' ? 'border-amber-200 bg-amber-50/60' :
                                detail.stockEffectStatus === 'APPLIED' ? 'border-emerald-200 bg-emerald-50/60' :
                                'border-slate-200 bg-slate-50'
                            }`}>
                                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                                    Эффект на остаток
                                </div>
                                <div className={`text-sm font-bold ${STOCK_EFFECT_LABEL[detail.stockEffectStatus].tone}`}>
                                    {STOCK_EFFECT_LABEL[detail.stockEffectStatus].label}
                                </div>
                                <div className="text-xs text-slate-600 mt-1">
                                    {STOCK_EFFECT_LABEL[detail.stockEffectStatus].explain}
                                </div>

                                {detail.internalStatus === 'UNRESOLVED' && (
                                    <p className="text-xs text-amber-800 mt-2 flex items-start gap-1">
                                        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                                        В заказе есть несопоставленные SKU или не задан склад. Резерв не будет
                                        выполнен до устранения причины — пожалуйста, проверьте список товаров ниже.
                                    </p>
                                )}

                                {/* Reprocess button: только для FBS заказов в business-critical статусах
                                    и не в paused. Бэкенд проверит роль и вернёт STILL_FAILED, если scope
                                    всё ещё не resolved — это нормальное поведение. */}
                                {detail.fulfillmentMode === 'FBS'
                                    && (detail.internalStatus === 'RESERVED'
                                        || detail.internalStatus === 'CANCELLED'
                                        || detail.internalStatus === 'FULFILLED') && (
                                    <button
                                        onClick={onReprocess}
                                        disabled={reprocessing || isPaused}
                                        className="mt-3 inline-flex items-center px-3 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50"
                                        title={isPaused ? 'Недоступно при паузе интеграций' : ''}
                                    >
                                        {reprocessing ? (
                                            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                        ) : (
                                            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                                        )}
                                        Повторить обработку
                                    </button>
                                )}

                                {reprocessResult && (
                                    <div className={`mt-2 text-xs ${
                                        reprocessResult.status === 'APPLIED' ? 'text-emerald-700' :
                                        reprocessResult.status === 'STILL_FAILED' ? 'text-rose-700' :
                                        'text-slate-600'
                                    }`}>
                                        Результат: {reprocessResult.status}
                                        {reprocessResult.detail ? ` (${reprocessResult.detail})` : ''}
                                    </div>
                                )}
                            </section>

                            {/* Items */}
                            <section>
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                                    Товары
                                </h3>
                                <div className="space-y-2">
                                    {detail.items.map((it) => (
                                        <div key={it.id} className="border border-slate-200 rounded-lg p-3 bg-white">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div className="text-sm font-medium text-slate-900 truncate">
                                                        {it.name ?? '—'}
                                                    </div>
                                                    <div className="text-xs text-slate-500 font-mono mt-0.5">
                                                        {it.sku ?? '—'}
                                                    </div>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <div className="text-sm font-bold text-slate-900">×{it.quantity}</div>
                                                    {it.price && (
                                                        <div className="text-xs text-slate-500">{it.price} ₽</div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="mt-2 flex items-center gap-2 text-[11px]">
                                                <span className={`px-1.5 py-0.5 rounded ring-1 ring-inset font-semibold ${
                                                    it.matchStatus === 'MATCHED'
                                                        ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                                                        : 'bg-rose-50 text-rose-700 ring-rose-200'
                                                }`}>
                                                    {MATCH_LABEL[it.matchStatus]}
                                                </span>
                                                {!it.warehouseId && (
                                                    <span className="px-1.5 py-0.5 rounded ring-1 ring-inset bg-amber-50 text-amber-800 ring-amber-200 font-semibold">
                                                        Склад не определён
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            {/* Related tasks */}
                            <section>
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
                                    <ClipboardList className="h-3.5 w-3.5" />
                                    Связанные задачи
                                    {relatedTasksLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                                </h3>
                                {!relatedTasksLoading && relatedTasks.length === 0 ? (
                                    <div className="text-xs text-slate-400 italic">
                                        Нет открытых задач по этому заказу.{' '}
                                        {!isPaused && (
                                            <button onClick={() => setCreateTaskOpen(true)} className="text-blue-600 hover:underline">
                                                Создать
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-1.5">
                                        {relatedTasks.map(t => (
                                            <div key={t.id} className="flex items-center justify-between border border-slate-100 rounded-lg px-3 py-2 bg-slate-50">
                                                <span className="text-sm text-slate-700 truncate flex-1">{t.title}</span>
                                                <span className={`ml-2 shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ring-1 ring-inset ${
                                                    t.status === 'OPEN' ? 'bg-slate-100 text-slate-600 ring-slate-200' :
                                                    t.status === 'IN_PROGRESS' ? 'bg-blue-50 text-blue-700 ring-blue-200' :
                                                    'bg-amber-50 text-amber-800 ring-amber-200'
                                                }`}>
                                                    {t.status === 'OPEN' ? 'Открыта' : t.status === 'IN_PROGRESS' ? 'В работе' : 'Ожидает'}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>

                            {/* Timeline */}
                            <section>
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                                    Таймлайн событий
                                </h3>
                                {events.length === 0 ? (
                                    <div className="text-xs text-slate-400 italic">Событий пока нет</div>
                                ) : (
                                    <ol className="relative border-l border-slate-200 ml-2">
                                        {events.map((e) => {
                                            const meta = EVENT_LABEL[e.eventType] ?? EVENT_LABEL.RECEIVED;
                                            const Icon = meta.icon;
                                            return (
                                                <li key={e.id} className="ml-4 mb-4">
                                                    <span className="absolute -left-[7px] flex items-center justify-center w-3.5 h-3.5 bg-white border border-slate-300 rounded-full" />
                                                    <div className={`flex items-center gap-2 text-sm font-semibold ${meta.tone}`}>
                                                        <Icon className="h-3.5 w-3.5" />
                                                        {meta.label}
                                                    </div>
                                                    <time className="block text-[11px] text-slate-400 mt-0.5">
                                                        {formatDate(e.createdAt)} <Clock className="inline h-3 w-3 ml-1" />
                                                    </time>
                                                    {e.payload && Object.keys(e.payload).length > 0 && (
                                                        <pre className="mt-1 bg-slate-50 border border-slate-100 rounded p-2 text-[11px] text-slate-600 overflow-x-auto">
{JSON.stringify(e.payload, null, 2)}
                                                        </pre>
                                                    )}
                                                </li>
                                            );
                                        })}
                                    </ol>
                                )}
                            </section>
                        </>
                    ) : null}
                </div>
            </aside>

            {/* Quick-create task modal pre-filled for this order */}
            {createTaskOpen && (
                <QuickCreateModal
                    members={members}
                    isPaused={isPaused}
                    prefill={{
                        title: `Заказ ${detail?.marketplaceOrderId ?? ''} — `,
                        relatedOrderId: orderId,
                    }}
                    currentUserId={user?.id ?? ''}
                    onCreated={() => { setCreateTaskOpen(false); loadRelatedTasks(); }}
                    onClose={() => setCreateTaskOpen(false)}
                />
            )}
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

// ─── helpers ────────────────────────────────────────────────────────
function formatDate(iso: string) {
    return new Date(iso).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function timeAgo(iso?: string | null) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 0) return '';
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    if (h > 24) return `${Math.floor(h / 24)} д назад`;
    if (h > 0) return `${h} ч назад`;
    return `${m} мин назад`;
}
