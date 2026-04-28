import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import {
    Building2, RefreshCw, Search, Lock, Tag, X, Edit2, Save,
    AlertCircle, Archive, CheckCircle2, PauseCircle, Boxes, ChevronRight,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// ─────────────────────────────── types ───────────────────────────────

const WRITE_BLOCKED_STATES = ['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED'];

type WarehouseStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
type WarehouseType = 'FBS' | 'FBO';
type SourceMarketplace = 'WB' | 'OZON' | 'YANDEX_MARKET';

interface Warehouse {
    id: string;
    tenantId: string;
    marketplaceAccountId: string;
    marketplaceAccount: { id: string; name: string; marketplace: 'WB' | 'OZON' } | null;
    externalWarehouseId: string;
    name: string;
    city: string | null;
    warehouseType: WarehouseType;
    sourceMarketplace: SourceMarketplace;
    aliasName: string | null;
    labels: string[];
    status: WarehouseStatus;
    deactivationReason: string | null;
    firstSeenAt: string;
    lastSyncedAt: string | null;
    inactiveSince: string | null;
}

interface WarehouseStocks {
    warehouse: {
        id: string;
        externalWarehouseId: string;
        name: string;
        aliasName: string | null;
        warehouseType: WarehouseType;
        sourceMarketplace: SourceMarketplace;
        status: WarehouseStatus;
    };
    totals: { onHand: number; reserved: number; available: number };
    items: Array<{
        productId: string;
        sku: string;
        name: string;
        onHand: number;
        reserved: number;
        available: number;
        fulfillmentMode: WarehouseType;
        isExternal: boolean;
    }>;
    count: number;
}

// ─────────────────────────────── helpers ─────────────────────────────

const STATUS_TONE: Record<WarehouseStatus, string> = {
    ACTIVE: 'bg-emerald-100 text-emerald-800',
    INACTIVE: 'bg-amber-100 text-amber-800',
    ARCHIVED: 'bg-slate-200 text-slate-700',
};

const STATUS_LABEL: Record<WarehouseStatus, string> = {
    ACTIVE: 'Активен',
    INACTIVE: 'Не активен',
    ARCHIVED: 'Архивный',
};

const TYPE_TONE: Record<WarehouseType, string> = {
    FBS: 'bg-blue-100 text-blue-800',
    FBO: 'bg-violet-100 text-violet-800',
};

const SOURCE_TONE: Record<SourceMarketplace, string> = {
    WB: 'bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200',
    OZON: 'bg-sky-50 text-sky-700 border border-sky-200',
    YANDEX_MARKET: 'bg-amber-50 text-amber-700 border border-amber-200',
};

const SOURCE_LABEL: Record<SourceMarketplace, string> = {
    WB: 'Wildberries',
    OZON: 'Ozon',
    YANDEX_MARKET: 'Я.Маркет',
};

function formatDateTime(iso: string | null): string {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString('ru-RU', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch { return iso; }
}

function ucWriteBlockedHint(state: string | undefined): string {
    if (state === 'TRIAL_EXPIRED') return 'Пробный период истёк. Ручной refresh и редактирование заблокированы.';
    if (state === 'SUSPENDED') return 'Доступ приостановлен. Запись данных и обращения к маркетплейсу заблокированы.';
    if (state === 'CLOSED') return 'Компания закрыта. Запись недоступна.';
    return '';
}

const LABEL_REGEX = /^[A-Za-z0-9_-]+$/;

// ─────────────────────────────── component ───────────────────────────

export default function Warehouses() {
    const { activeTenant } = useAuth();
    const writeBlocked = activeTenant ? WRITE_BLOCKED_STATES.includes(activeTenant.accessState) : false;
    const writeBlockedHint = ucWriteBlockedHint(activeTenant?.accessState);

    // ─── list state
    const [items, setItems] = useState<Warehouse[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);

    const [search, setSearch] = useState('');
    const [filterAccount, setFilterAccount] = useState('');
    const [filterSource, setFilterSource] = useState<SourceMarketplace | ''>('');
    const [filterType, setFilterType] = useState<WarehouseType | ''>('');
    const [filterStatus, setFilterStatus] = useState<WarehouseStatus | ''>('ACTIVE');

    const [refreshing, setRefreshing] = useState(false);
    const [topMessage, setTopMessage] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);

    // ─── detail state
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [stocks, setStocks] = useState<WarehouseStocks | null>(null);
    const [stocksLoading, setStocksLoading] = useState(false);

    // ─── metadata edit state
    const [editingMeta, setEditingMeta] = useState(false);
    const [aliasInput, setAliasInput] = useState('');
    const [labelsInput, setLabelsInput] = useState('');
    const [metaSaving, setMetaSaving] = useState(false);
    const [metaError, setMetaError] = useState<string | null>(null);

    const lastPage = useMemo(() => Math.max(1, Math.ceil(total / 50)), [total]);

    const loadList = useCallback(async (p = 1) => {
        setLoading(true);
        try {
            const res = await axios.get('/warehouses', {
                params: {
                    page: p,
                    limit: 50,
                    search: search || undefined,
                    marketplaceAccountId: filterAccount || undefined,
                    sourceMarketplace: filterSource || undefined,
                    warehouseType: filterType || undefined,
                    status: filterStatus || undefined,
                },
            });
            setItems(res.data.data ?? []);
            setTotal(res.data.meta?.total ?? 0);
            setPage(p);
        } finally {
            setLoading(false);
        }
    }, [search, filterAccount, filterSource, filterType, filterStatus]);

    const loadStocks = useCallback(async (id: string) => {
        setStocksLoading(true);
        try {
            const res = await axios.get(`/warehouses/${id}/stocks`);
            setStocks(res.data);
        } catch {
            setStocks(null);
        } finally {
            setStocksLoading(false);
        }
    }, []);

    useEffect(() => { loadList(1); }, [loadList]);

    const selected = useMemo(
        () => items.find(i => i.id === selectedId) ?? null,
        [items, selectedId],
    );

    useEffect(() => {
        if (selectedId) loadStocks(selectedId);
        else setStocks(null);
    }, [selectedId, loadStocks]);

    useEffect(() => {
        if (!selected) return;
        setAliasInput(selected.aliasName ?? '');
        setLabelsInput((selected.labels ?? []).join(', '));
    }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const onRefresh = async () => {
        if (writeBlocked) return;
        setRefreshing(true);
        setTopMessage(null);
        try {
            const res = await axios.post('/warehouses/sync');
            const results = (res.data?.results ?? []) as Array<{ created?: number; updated?: number; deactivated?: number; archived?: number; error?: string; paused?: boolean }>;
            const created = results.reduce((s, r) => s + (r.created ?? 0), 0);
            const updated = results.reduce((s, r) => s + (r.updated ?? 0), 0);
            const deactivated = results.reduce((s, r) => s + (r.deactivated ?? 0), 0);
            const archived = results.reduce((s, r) => s + (r.archived ?? 0), 0);
            const errored = results.filter(r => r.error).length;

            if (res.data?.paused) {
                setTopMessage({ kind: 'warn', text: 'Синхронизация приостановлена политикой тенанта.' });
            } else {
                setTopMessage({
                    kind: errored > 0 ? 'warn' : 'ok',
                    text: `Создано: ${created}, обновлено: ${updated}, неактивных: ${deactivated}, архивировано: ${archived}${errored > 0 ? `, ошибок: ${errored}` : ''}`,
                });
            }
            await loadList(page);
            if (selectedId) await loadStocks(selectedId);
        } catch (err: any) {
            const code = err?.response?.data?.code;
            const map: Record<string, string> = {
                TENANT_WRITE_BLOCKED: writeBlockedHint || 'Запись заблокирована.',
            };
            setTopMessage({ kind: 'err', text: map[code] ?? err?.message ?? 'Не удалось обновить справочник.' });
        } finally {
            setRefreshing(false);
        }
    };

    // ─── metadata editing
    const beginEdit = () => {
        if (writeBlocked || !selected) return;
        setMetaError(null);
        setEditingMeta(true);
    };
    const cancelEdit = () => {
        setEditingMeta(false);
        if (selected) {
            setAliasInput(selected.aliasName ?? '');
            setLabelsInput((selected.labels ?? []).join(', '));
        }
        setMetaError(null);
    };

    const saveMeta = async () => {
        if (!selected) return;
        setMetaError(null);

        const labels = labelsInput
            .split(',')
            .map(x => x.trim())
            .filter(x => x.length > 0);

        if (labels.length > 20) {
            setMetaError('Максимум 20 меток.');
            return;
        }
        for (const l of labels) {
            if (l.length > 64) { setMetaError(`Метка "${l}" длиннее 64 символов.`); return; }
            if (!LABEL_REGEX.test(l)) { setMetaError(`Метка "${l}" не соответствует формату (A-Z, 0-9, _, -).`); return; }
        }
        if (aliasInput.length > 255) { setMetaError('Псевдоним длиннее 255 символов.'); return; }

        setMetaSaving(true);
        try {
            const res = await axios.patch(`/warehouses/${selected.id}/metadata`, {
                aliasName: aliasInput.trim() || null,
                labels,
            });
            // обновляем элемент в списке
            setItems(prev => prev.map(i => i.id === selected.id ? { ...i, ...res.data } : i));
            setEditingMeta(false);
        } catch (err: any) {
            const code = err?.response?.data?.code;
            const map: Record<string, string> = {
                WAREHOUSE_METADATA_FIELD_NOT_ALLOWED: 'Можно менять только псевдоним и метки.',
                WAREHOUSE_METADATA_TOO_LONG: 'Слишком длинное значение.',
                WAREHOUSE_LABELS_TOO_MANY: 'Максимум 20 меток.',
                WAREHOUSE_LABEL_FORMAT_INVALID: 'Метки должны содержать только A-Z, 0-9, _ и -.',
                WAREHOUSE_LABEL_INVALID_TYPE: 'Метки должны быть строками.',
                WAREHOUSE_LABELS_INVALID: 'Список меток повреждён.',
                WAREHOUSE_ALIAS_INVALID_TYPE: 'Псевдоним должен быть строкой.',
                WAREHOUSE_METADATA_EMPTY: 'Изменений не указано.',
                WAREHOUSE_NOT_FOUND: 'Склад больше не найден.',
                TENANT_WRITE_BLOCKED: writeBlockedHint || 'Запись заблокирована.',
            };
            setMetaError(map[code] ?? err?.response?.data?.message ?? 'Не удалось сохранить.');
        } finally {
            setMetaSaving(false);
        }
    };

    // ─── render
    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-slate-900 flex items-center">
                        <Building2 className="h-6 w-6 mr-2 text-blue-600" />
                        Склады
                    </h1>
                    <p className="text-xs md:text-sm text-slate-500 mt-1">
                        Справочник внешних складов из marketplace API. FBS и FBO визуально разведены, INACTIVE/ARCHIVED видны для истории.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {writeBlocked && (
                        <span className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800">
                            <Lock className="h-3.5 w-3.5" />
                            Только чтение
                        </span>
                    )}
                    <button
                        onClick={onRefresh}
                        disabled={writeBlocked || refreshing}
                        title={writeBlocked ? writeBlockedHint : 'Запустить ручную синхронизацию'}
                        className={`px-3 py-1.5 text-sm rounded inline-flex items-center gap-1 ${
                            writeBlocked
                                ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                                : 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
                        }`}
                    >
                        {writeBlocked ? <Lock className="h-3.5 w-3.5" /> : <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />}
                        Обновить из API
                    </button>
                </div>
            </div>

            {topMessage && (
                <div className={`text-sm border rounded-md px-3 py-2 flex items-start gap-2 ${
                    topMessage.kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : topMessage.kind === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}>
                    {topMessage.kind === 'ok' ? <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        : topMessage.kind === 'warn' ? <PauseCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        : <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />}
                    <span>{topMessage.text}</span>
                    <button onClick={() => setTopMessage(null)} className="ml-auto text-current/60 hover:text-current">
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            )}

            {/* ─── Filters ─── */}
            <form
                onSubmit={(e) => { e.preventDefault(); loadList(1); }}
                className="bg-white border border-slate-200 rounded-md p-3 flex flex-wrap gap-2 items-end"
            >
                <div className="flex-1 min-w-[180px]">
                    <label className="block text-[11px] text-slate-500 mb-1">Поиск</label>
                    <div className="relative">
                        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Имя, псевдоним или город"
                            className="w-full pl-9 pr-3 py-1.5 border border-slate-300 rounded text-sm"
                        />
                    </div>
                </div>
                <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Маркетплейс</label>
                    <select
                        value={filterSource}
                        onChange={(e) => setFilterSource(e.target.value as any)}
                        className="px-2 py-1.5 border border-slate-300 rounded text-sm"
                    >
                        <option value="">Все</option>
                        <option value="WB">Wildberries</option>
                        <option value="OZON">Ozon</option>
                        <option value="YANDEX_MARKET">Я.Маркет</option>
                    </select>
                </div>
                <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Тип</label>
                    <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value as any)}
                        className="px-2 py-1.5 border border-slate-300 rounded text-sm"
                    >
                        <option value="">Все</option>
                        <option value="FBS">FBS</option>
                        <option value="FBO">FBO</option>
                    </select>
                </div>
                <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Статус</label>
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value as any)}
                        className="px-2 py-1.5 border border-slate-300 rounded text-sm"
                    >
                        <option value="">Все статусы</option>
                        <option value="ACTIVE">Активные</option>
                        <option value="INACTIVE">Не активные</option>
                        <option value="ARCHIVED">Архивные</option>
                    </select>
                </div>
                <div>
                    <label className="block text-[11px] text-slate-500 mb-1">ID аккаунта</label>
                    <input
                        value={filterAccount}
                        onChange={(e) => setFilterAccount(e.target.value)}
                        placeholder="опционально"
                        className="px-2 py-1.5 border border-slate-300 rounded text-sm w-44"
                    />
                </div>
                <button
                    type="submit"
                    className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                    Применить
                </button>
            </form>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                {/* ─── List ─── */}
                <div className="lg:col-span-3 bg-white border border-slate-200 rounded-md overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                            <tr>
                                <th className="px-3 py-2 text-left">Склад</th>
                                <th className="px-3 py-2 text-left">Тип</th>
                                <th className="px-3 py-2 text-left">Источник</th>
                                <th className="px-3 py-2 text-left">Статус</th>
                                <th className="px-3 py-2 text-left">Метки</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {items.length === 0 && !loading && (
                                <tr><td colSpan={5} className="text-center py-6 text-slate-500">Складов не найдено.</td></tr>
                            )}
                            {items.map((w) => {
                                const active = selectedId === w.id;
                                return (
                                    <tr
                                        key={w.id}
                                        onClick={() => setSelectedId(w.id)}
                                        className={`cursor-pointer ${active ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                                    >
                                        <td className="px-3 py-2">
                                            <div className="font-medium text-slate-900 truncate max-w-[220px]" title={w.name}>
                                                {w.aliasName ? `${w.aliasName} (${w.name})` : w.name}
                                            </div>
                                            <div className="text-[11px] text-slate-500 truncate max-w-[220px]">
                                                {w.city ?? '—'} • ID: {w.externalWarehouseId}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${TYPE_TONE[w.warehouseType]}`}>
                                                {w.warehouseType}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${SOURCE_TONE[w.sourceMarketplace]}`}>
                                                {SOURCE_LABEL[w.sourceMarketplace]}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_TONE[w.status]}`}>
                                                {w.status === 'INACTIVE' && <PauseCircle className="inline h-3 w-3 mr-0.5" />}
                                                {w.status === 'ARCHIVED' && <Archive className="inline h-3 w-3 mr-0.5" />}
                                                {STATUS_LABEL[w.status]}
                                            </span>
                                            {w.deactivationReason && (
                                                <div className="text-[10px] text-slate-500 mt-0.5 truncate max-w-[140px]" title={w.deactivationReason}>
                                                    {w.deactivationReason}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="flex flex-wrap gap-0.5">
                                                {w.labels.slice(0, 3).map((l) => (
                                                    <span key={l} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                                                        {l}
                                                    </span>
                                                ))}
                                                {w.labels.length > 3 && (
                                                    <span className="text-[10px] text-slate-500">+{w.labels.length - 3}</span>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    <div className="flex items-center justify-between text-xs text-slate-500 px-3 py-2 border-t border-slate-100">
                        <span>Всего: {total}</span>
                        <div className="flex gap-2 items-center">
                            <button
                                disabled={page <= 1}
                                onClick={() => loadList(page - 1)}
                                className="px-2 py-1 border border-slate-300 rounded disabled:opacity-40"
                            >‹</button>
                            <span>{page} / {lastPage}</span>
                            <button
                                disabled={page >= lastPage}
                                onClick={() => loadList(page + 1)}
                                className="px-2 py-1 border border-slate-300 rounded disabled:opacity-40"
                            >›</button>
                        </div>
                    </div>
                </div>

                {/* ─── Detail panel ─── */}
                <div className="lg:col-span-2 bg-white border border-slate-200 rounded-md p-4 space-y-4">
                    {!selected && (
                        <div className="text-sm text-slate-500 text-center py-10 flex flex-col items-center gap-2">
                            <ChevronRight className="h-5 w-5 text-slate-300" />
                            Выберите склад слева для подробностей и редактирования.
                        </div>
                    )}

                    {selected && (
                        <>
                            <div>
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <h2 className="font-semibold text-slate-900 truncate">{selected.name}</h2>
                                        <div className="text-xs text-slate-500 mt-0.5">
                                            {selected.city ?? '—'} • External ID: <span className="font-mono">{selected.externalWarehouseId}</span>
                                        </div>
                                    </div>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_TONE[selected.status]} flex-shrink-0`}>
                                        {STATUS_LABEL[selected.status]}
                                    </span>
                                </div>

                                <div className="flex flex-wrap gap-1 mt-2">
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${TYPE_TONE[selected.warehouseType]}`}>
                                        {selected.warehouseType}
                                    </span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${SOURCE_TONE[selected.sourceMarketplace]}`}>
                                        {SOURCE_LABEL[selected.sourceMarketplace]}
                                    </span>
                                    {selected.marketplaceAccount && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                                            Аккаунт: {selected.marketplaceAccount.name}
                                        </span>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-500 mt-3">
                                    <div>
                                        <span className="block text-[10px] uppercase">Первая загрузка</span>
                                        {formatDateTime(selected.firstSeenAt)}
                                    </div>
                                    <div>
                                        <span className="block text-[10px] uppercase">Последний sync</span>
                                        {formatDateTime(selected.lastSyncedAt)}
                                    </div>
                                    {selected.inactiveSince && (
                                        <div>
                                            <span className="block text-[10px] uppercase">Стал неактивным</span>
                                            {formatDateTime(selected.inactiveSince)}
                                        </div>
                                    )}
                                    {selected.deactivationReason && (
                                        <div>
                                            <span className="block text-[10px] uppercase">Причина</span>
                                            <span className="font-mono text-[10px]">{selected.deactivationReason}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* metadata editor */}
                            <div className="border-t pt-3">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-xs font-semibold uppercase text-slate-600 flex items-center gap-1">
                                        <Tag className="h-3.5 w-3.5" /> Локальные метки
                                    </h3>
                                    {!editingMeta ? (
                                        <button
                                            onClick={beginEdit}
                                            disabled={writeBlocked}
                                            title={writeBlocked ? writeBlockedHint : 'Изменить псевдоним и метки'}
                                            className={`text-xs inline-flex items-center px-2 py-0.5 rounded border ${
                                                writeBlocked
                                                    ? 'border-slate-200 text-slate-400 cursor-not-allowed'
                                                    : 'border-blue-300 text-blue-700 hover:bg-blue-50'
                                            }`}
                                        >
                                            {writeBlocked ? <Lock className="h-3 w-3 mr-1" /> : <Edit2 className="h-3 w-3 mr-1" />}
                                            Изменить
                                        </button>
                                    ) : (
                                        <div className="flex gap-1">
                                            <button
                                                onClick={cancelEdit}
                                                className="text-xs px-2 py-0.5 rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
                                            >
                                                Отмена
                                            </button>
                                            <button
                                                onClick={saveMeta}
                                                disabled={metaSaving}
                                                className="text-xs inline-flex items-center px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                                            >
                                                <Save className="h-3 w-3 mr-1" />
                                                Сохранить
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {!editingMeta ? (
                                    <div className="text-sm mt-2">
                                        <div className="text-slate-500 text-[11px] uppercase">Псевдоним</div>
                                        <div className="text-slate-800">{selected.aliasName || <span className="text-slate-400">—</span>}</div>
                                        <div className="text-slate-500 text-[11px] uppercase mt-2">Метки</div>
                                        <div className="flex flex-wrap gap-1 mt-1">
                                            {selected.labels.length === 0 && <span className="text-slate-400 text-xs">нет меток</span>}
                                            {selected.labels.map((l) => (
                                                <span key={l} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">{l}</span>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-2 mt-2">
                                        <div>
                                            <label className="block text-[11px] text-slate-500 mb-1">Псевдоним (≤255)</label>
                                            <input
                                                value={aliasInput}
                                                onChange={(e) => setAliasInput(e.target.value)}
                                                maxLength={255}
                                                className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
                                                placeholder="например: главный склад"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[11px] text-slate-500 mb-1">Метки через запятую (≤20, формат A-Z, 0-9, _, -)</label>
                                            <input
                                                value={labelsInput}
                                                onChange={(e) => setLabelsInput(e.target.value)}
                                                className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm font-mono"
                                                placeholder="hub, main_eu, fast"
                                            />
                                        </div>
                                        {metaError && (
                                            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                                                {metaError}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* stocks for warehouse */}
                            <div className="border-t pt-3">
                                <h3 className="text-xs font-semibold uppercase text-slate-600 flex items-center gap-1 mb-2">
                                    <Boxes className="h-3.5 w-3.5" /> Остатки на складе
                                </h3>
                                {stocksLoading && <div className="text-xs text-slate-500">Загрузка...</div>}
                                {!stocksLoading && stocks && (
                                    <>
                                        <div className="grid grid-cols-3 gap-2 mb-2 text-xs">
                                            <Stat label="on_hand" value={stocks.totals.onHand} />
                                            <Stat label="reserved" value={stocks.totals.reserved} tone="text-blue-700" />
                                            <Stat label="available" value={stocks.totals.available} tone="text-emerald-700" />
                                        </div>
                                        {stocks.items.length === 0 && (
                                            <div className="text-xs text-slate-500 italic">Остатки на этом складе не зафиксированы.</div>
                                        )}
                                        {stocks.items.length > 0 && (
                                            <div className="max-h-60 overflow-y-auto border border-slate-100 rounded">
                                                <table className="w-full text-xs">
                                                    <thead className="bg-slate-50 text-slate-600">
                                                        <tr>
                                                            <th className="px-2 py-1 text-left">SKU</th>
                                                            <th className="px-2 py-1 text-right">on_hand</th>
                                                            <th className="px-2 py-1 text-right">reserved</th>
                                                            <th className="px-2 py-1 text-right">available</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-50">
                                                        {stocks.items.map((it) => (
                                                            <tr key={it.productId}>
                                                                <td className="px-2 py-1 truncate max-w-[140px]">
                                                                    <div className="font-medium">{it.sku}</div>
                                                                    <div className="text-[10px] text-slate-500 truncate">{it.name}</div>
                                                                </td>
                                                                <td className="px-2 py-1 text-right font-mono">{it.onHand}</td>
                                                                <td className="px-2 py-1 text-right font-mono text-blue-700">{it.reserved}</td>
                                                                <td className="px-2 py-1 text-right font-mono">{it.available}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
    return (
        <div className="bg-slate-50 rounded px-2 py-1">
            <div className="text-[10px] uppercase text-slate-500">{label}</div>
            <div className={`font-mono ${tone ?? 'text-slate-800'}`}>{value}</div>
        </div>
    );
}
