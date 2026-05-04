import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { Building2, RefreshCw, Search, Lock, Tag, Edit2, Save, AlertCircle, CheckCircle2, PauseCircle, Boxes } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
    S, PageHeader, Card, Badge, Btn, Input, TH, FieldLabel, SkuTag,
    EmptyState, Spinner, Pagination,
} from '../components/ui';

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

const STATUS_BADGE: Record<WarehouseStatus, { color: string; bg: string }> = {
    ACTIVE:   { color: S.green, bg: 'rgba(16,185,129,0.08)' },
    INACTIVE: { color: S.amber, bg: 'rgba(245,158,11,0.08)' },
    ARCHIVED: { color: S.muted, bg: '#f1f5f9' },
};

const STATUS_LABEL: Record<WarehouseStatus, string> = {
    ACTIVE: 'Активен', INACTIVE: 'Не активен', ARCHIVED: 'Архивный',
};

const TYPE_BADGE: Record<WarehouseType, { color: string; bg: string }> = {
    FBS: { color: S.blue,    bg: 'rgba(59,130,246,0.08)' },
    FBO: { color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
};

const SOURCE_BADGE: Record<SourceMarketplace, { color: string; bg: string }> = {
    WB:            { color: S.wb,    bg: 'rgba(203,17,171,0.06)' },
    OZON:          { color: S.oz,    bg: 'rgba(0,91,255,0.06)' },
    YANDEX_MARKET: { color: '#cc5500', bg: 'rgba(255,102,0,0.06)' },
};

const SOURCE_LABEL: Record<SourceMarketplace, string> = {
    WB: 'Wildberries', OZON: 'Ozon', YANDEX_MARKET: 'Я.Маркет',
};

function formatDateTime(iso: string | null): string {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
}

function ucWriteBlockedHint(state: string | undefined): string {
    if (state === 'TRIAL_EXPIRED') return 'Пробный период истёк. Ручной refresh и редактирование заблокированы.';
    if (state === 'SUSPENDED')     return 'Доступ приостановлен. Запись данных и обращения к маркетплейсу заблокированы.';
    if (state === 'CLOSED')        return 'Компания закрыта. Запись недоступна.';
    return '';
}

const LABEL_REGEX = /^[A-Za-z0-9_-]+$/;

// ─── Stat mini-card ───────────────────────────────────────────────────

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
    return (
        <div style={{ background: S.bg, border: `1px solid ${S.border}`, borderRadius: 8, padding: '8px 12px' }}>
            <div style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: S.muted, marginBottom: 4 }}>{label}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 600, color: tone ?? S.ink }}>{value}</div>
        </div>
    );
}

// ─────────────────────────────── component ───────────────────────────

export default function Warehouses() {
    const { activeTenant } = useAuth();
    const writeBlocked = activeTenant ? WRITE_BLOCKED_STATES.includes(activeTenant.accessState) : false;
    const writeBlockedHint = ucWriteBlockedHint(activeTenant?.accessState);

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

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [stocks, setStocks] = useState<WarehouseStocks | null>(null);
    const [stocksLoading, setStocksLoading] = useState(false);

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
                    page: p, limit: 50,
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

    const selected = useMemo(() => items.find(i => i.id === selectedId) ?? null, [items, selectedId]);

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
            const created     = results.reduce((s, r) => s + (r.created ?? 0), 0);
            const updated     = results.reduce((s, r) => s + (r.updated ?? 0), 0);
            const deactivated = results.reduce((s, r) => s + (r.deactivated ?? 0), 0);
            const archived    = results.reduce((s, r) => s + (r.archived ?? 0), 0);
            const errored     = results.filter(r => r.error).length;
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
            const map: Record<string, string> = { TENANT_WRITE_BLOCKED: writeBlockedHint || 'Запись заблокирована.' };
            setTopMessage({ kind: 'err', text: map[code] ?? err?.message ?? 'Не удалось обновить справочник.' });
        } finally {
            setRefreshing(false);
        }
    };

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
        const labels = labelsInput.split(',').map(x => x.trim()).filter(x => x.length > 0);
        if (labels.length > 20) { setMetaError('Максимум 20 меток.'); return; }
        for (const l of labels) {
            if (l.length > 64) { setMetaError(`Метка "${l}" длиннее 64 символов.`); return; }
            if (!LABEL_REGEX.test(l)) { setMetaError(`Метка "${l}" не соответствует формату (A-Z, 0-9, _, -).`); return; }
        }
        if (aliasInput.length > 255) { setMetaError('Псевдоним длиннее 255 символов.'); return; }
        setMetaSaving(true);
        try {
            const res = await axios.patch(`/warehouses/${selected.id}/metadata`, { aliasName: aliasInput.trim() || null, labels });
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

    // ─── top message color map
    const msgColors = {
        ok:   { color: S.green, bg: 'rgba(16,185,129,0.06)',  border: 'rgba(16,185,129,0.2)',  Icon: CheckCircle2 },
        warn: { color: S.amber, bg: 'rgba(245,158,11,0.06)',  border: 'rgba(245,158,11,0.2)',  Icon: PauseCircle },
        err:  { color: S.red,   bg: 'rgba(239,68,68,0.06)',   border: 'rgba(239,68,68,0.2)',   Icon: AlertCircle },
    };

    const ROW_STYLE = (active: boolean, hovered: boolean): React.CSSProperties => ({
        display: 'flex', alignItems: 'center', minHeight: 56,
        borderBottom: `1px solid ${S.border}`, cursor: 'pointer',
        background: active ? 'rgba(59,130,246,0.06)' : hovered ? S.bg : '#fff',
        transition: 'background 0.1s',
        borderLeft: active ? `3px solid ${S.blue}` : '3px solid transparent',
    });

    // ─── render
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <PageHeader
                title="Склады"
                subtitle="Справочник внешних складов из marketplace API. FBS и FBO визуально разведены, INACTIVE/ARCHIVED видны для истории."
            >
                {writeBlocked && (
                    <Badge label="Только чтение" color={S.amber} bg="rgba(245,158,11,0.08)"
                        style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                    />
                )}
                <Btn
                    onClick={onRefresh}
                    disabled={writeBlocked || refreshing}
                    variant={writeBlocked ? 'secondary' : 'primary'}
                    title={writeBlocked ? writeBlockedHint : 'Запустить ручную синхронизацию'}
                >
                    {writeBlocked
                        ? <Lock size={14} />
                        : <RefreshCw size={14} style={{ animation: refreshing ? 'spin 0.7s linear infinite' : 'none' }} />
                    }
                    Обновить из API
                </Btn>
            </PageHeader>

            {/* Top message */}
            {topMessage && (() => {
                const c = msgColors[topMessage.kind];
                const Icon = c.Icon;
                return (
                    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: '10px 16px', fontFamily: 'Inter', fontSize: 13, color: c.color, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Icon size={15} style={{ flexShrink: 0 }} />
                        <span style={{ flex: 1 }}>{topMessage.text}</span>
                        <button onClick={() => setTopMessage(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
                    </div>
                );
            })()}

            {/* ─── Filters ─── */}
            <Card style={{ padding: '14px 20px' }}>
                <form onSubmit={e => { e.preventDefault(); loadList(1); }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
                        <div style={{ flex: '1 1 180px', minWidth: 180 }}>
                            <FieldLabel>Поиск</FieldLabel>
                            <Input
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Имя, псевдоним или город"
                                icon={Search}
                            />
                        </div>
                        <div>
                            <FieldLabel>Маркетплейс</FieldLabel>
                            <select
                                value={filterSource}
                                onChange={e => setFilterSource(e.target.value as any)}
                                style={SELECT_STYLE}
                            >
                                <option value="">Все</option>
                                <option value="WB">Wildberries</option>
                                <option value="OZON">Ozon</option>
                                <option value="YANDEX_MARKET">Я.Маркет</option>
                            </select>
                        </div>
                        <div>
                            <FieldLabel>Тип</FieldLabel>
                            <select
                                value={filterType}
                                onChange={e => setFilterType(e.target.value as any)}
                                style={SELECT_STYLE}
                            >
                                <option value="">Все</option>
                                <option value="FBS">FBS</option>
                                <option value="FBO">FBO</option>
                            </select>
                        </div>
                        <div>
                            <FieldLabel>Статус</FieldLabel>
                            <select
                                value={filterStatus}
                                onChange={e => setFilterStatus(e.target.value as any)}
                                style={SELECT_STYLE}
                            >
                                <option value="">Все статусы</option>
                                <option value="ACTIVE">Активные</option>
                                <option value="INACTIVE">Не активные</option>
                                <option value="ARCHIVED">Архивные</option>
                            </select>
                        </div>
                        <div style={{ minWidth: 160 }}>
                            <FieldLabel>ID аккаунта</FieldLabel>
                            <Input
                                value={filterAccount}
                                onChange={e => setFilterAccount(e.target.value)}
                                placeholder="опционально"
                            />
                        </div>
                        <Btn type="submit" variant="primary">Применить</Btn>
                    </div>
                </form>
            </Card>

            {/* ─── Main grid ─── */}
            <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16, alignItems: 'start' }}>

                {/* ─── List ─── */}
                <Card noPad>
                    {/* Table header */}
                    <div style={{ display: 'flex', alignItems: 'center', padding: '12px 4px', background: S.bg, borderBottom: `1px solid ${S.border}` }}>
                        <div style={{ width: 3 }} />{/* border offset */}
                        <TH flex={3}>Склад</TH>
                        <TH flex={1}>Тип</TH>
                        <TH flex={1.5}>Источник</TH>
                        <TH flex={1.5}>Статус</TH>
                        <TH flex={2}>Метки</TH>
                    </div>

                    {loading ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '48px 0', fontFamily: 'Inter', fontSize: 13, color: S.muted }}>
                            <Spinner /> Загрузка…
                        </div>
                    ) : items.length === 0 ? (
                        <EmptyState icon={Building2} title="Складов не найдено" subtitle="Попробуйте изменить фильтры или запустите синхронизацию" />
                    ) : (
                        items.map(w => <WarehouseRow key={w.id} w={w} active={selectedId === w.id} onClick={() => setSelectedId(w.id)} ROW_STYLE={ROW_STYLE} />)
                    )}

                    <Pagination
                        page={page}
                        totalPages={lastPage}
                        onPage={p => loadList(p)}
                        total={total}
                        shown={items.length}
                    />
                </Card>

                {/* ─── Detail panel ─── */}
                <Card style={{ position: 'sticky', top: 16 }}>
                    {!selected ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: 10 }}>
                            <Building2 size={32} color={S.muted} style={{ opacity: 0.3 }} />
                            <span style={{ fontFamily: 'Inter', fontSize: 13, color: S.muted }}>Выберите склад слева</span>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                            {/* Header */}
                            <div>
                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 15, color: S.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {selected.aliasName ? `${selected.aliasName} (${selected.name})` : selected.name}
                                        </div>
                                        <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted, marginTop: 2 }}>
                                            {selected.city ?? '—'} · External ID: <SkuTag>{selected.externalWarehouseId}</SkuTag>
                                        </div>
                                    </div>
                                    <Badge
                                        label={STATUS_LABEL[selected.status]}
                                        color={STATUS_BADGE[selected.status].color}
                                        bg={STATUS_BADGE[selected.status].bg}
                                        style={{ flexShrink: 0 }}
                                    />
                                </div>

                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                                    <Badge label={selected.warehouseType} color={TYPE_BADGE[selected.warehouseType].color} bg={TYPE_BADGE[selected.warehouseType].bg} />
                                    <Badge label={SOURCE_LABEL[selected.sourceMarketplace]} color={SOURCE_BADGE[selected.sourceMarketplace].color} bg={SOURCE_BADGE[selected.sourceMarketplace].bg} />
                                    {selected.marketplaceAccount && (
                                        <Badge label={`Аккаунт: ${selected.marketplaceAccount.name}`} color={S.sub} bg={S.bg} />
                                    )}
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
                                    <div>
                                        <div style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: S.muted, marginBottom: 3 }}>Первая загрузка</div>
                                        <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub }}>{formatDateTime(selected.firstSeenAt)}</div>
                                    </div>
                                    <div>
                                        <div style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: S.muted, marginBottom: 3 }}>Последний sync</div>
                                        <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub }}>{formatDateTime(selected.lastSyncedAt)}</div>
                                    </div>
                                    {selected.inactiveSince && (
                                        <div>
                                            <div style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: S.muted, marginBottom: 3 }}>Стал неактивным</div>
                                            <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub }}>{formatDateTime(selected.inactiveSince)}</div>
                                        </div>
                                    )}
                                    {selected.deactivationReason && (
                                        <div>
                                            <div style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: S.muted, marginBottom: 3 }}>Причина</div>
                                            <SkuTag>{selected.deactivationReason}</SkuTag>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Metadata editor */}
                            <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 16 }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'Inter', fontSize: 11, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                        <Tag size={13} /> Локальные метки
                                    </div>
                                    {!editingMeta ? (
                                        <Btn
                                            size="sm"
                                            variant="secondary"
                                            onClick={beginEdit}
                                            disabled={writeBlocked}
                                            title={writeBlocked ? writeBlockedHint : 'Изменить псевдоним и метки'}
                                        >
                                            {writeBlocked ? <Lock size={12} /> : <Edit2 size={12} />}
                                            Изменить
                                        </Btn>
                                    ) : (
                                        <div style={{ display: 'flex', gap: 6 }}>
                                            <Btn size="sm" variant="ghost" onClick={cancelEdit}>Отмена</Btn>
                                            <Btn size="sm" variant="primary" onClick={saveMeta} disabled={metaSaving}>
                                                <Save size={12} /> Сохранить
                                            </Btn>
                                        </div>
                                    )}
                                </div>

                                {!editingMeta ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        <div>
                                            <div style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: S.muted, marginBottom: 4 }}>Псевдоним</div>
                                            <div style={{ fontFamily: 'Inter', fontSize: 13, color: selected.aliasName ? S.ink : S.muted }}>
                                                {selected.aliasName || '—'}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: S.muted, marginBottom: 6 }}>Метки</div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                                {selected.labels.length === 0
                                                    ? <span style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted }}>нет меток</span>
                                                    : selected.labels.map(l => <SkuTag key={l}>{l}</SkuTag>)
                                                }
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        <div>
                                            <FieldLabel>Псевдоним (≤255)</FieldLabel>
                                            <Input
                                                value={aliasInput}
                                                onChange={e => setAliasInput(e.target.value)}
                                                placeholder="например: главный склад"
                                            />
                                        </div>
                                        <div>
                                            <FieldLabel>Метки через запятую (≤20, формат A-Z, 0-9, _, -)</FieldLabel>
                                            <Input
                                                value={labelsInput}
                                                onChange={e => setLabelsInput(e.target.value)}
                                                placeholder="hub, main_eu, fast"
                                            />
                                        </div>
                                        {metaError && (
                                            <div style={{ background: 'rgba(239,68,68,0.06)', border: `1px solid rgba(239,68,68,0.2)`, borderRadius: 8, padding: '8px 12px', fontFamily: 'Inter', fontSize: 12, color: S.red }}>
                                                {metaError}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Stocks */}
                            <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 16 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'Inter', fontSize: 11, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
                                    <Boxes size={13} /> Остатки на складе
                                </div>
                                {stocksLoading && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'Inter', fontSize: 12, color: S.muted }}>
                                        <Spinner size={14} /> Загрузка...
                                    </div>
                                )}
                                {!stocksLoading && stocks && (
                                    <>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                                            <Stat label="on_hand" value={stocks.totals.onHand} />
                                            <Stat label="reserved" value={stocks.totals.reserved} tone={S.blue} />
                                            <Stat label="available" value={stocks.totals.available} tone={S.green} />
                                        </div>
                                        {stocks.items.length === 0 ? (
                                            <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted, fontStyle: 'italic' }}>
                                                Остатки на этом складе не зафиксированы.
                                            </div>
                                        ) : (
                                            <div style={{ maxHeight: 240, overflowY: 'auto', border: `1px solid ${S.border}`, borderRadius: 8 }}>
                                                {/* Stock table header */}
                                                <div style={{ display: 'flex', background: S.bg, borderBottom: `1px solid ${S.border}`, padding: '6px 0' }}>
                                                    <TH flex={3}>SKU</TH>
                                                    <TH flex={1} align="right">on_hand</TH>
                                                    <TH flex={1} align="right">reserved</TH>
                                                    <TH flex={1} align="right">avail.</TH>
                                                </div>
                                                {stocks.items.map(it => (
                                                    <div key={it.productId} style={{ display: 'flex', alignItems: 'center', minHeight: 40, borderBottom: `1px solid ${S.border}`, padding: '0 4px' }}>
                                                        <div style={{ flex: 3, padding: '0 8px', minWidth: 0 }}>
                                                            <div style={{ fontFamily: 'Inter', fontSize: 12, fontWeight: 600, color: S.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.sku}</div>
                                                            <div style={{ fontFamily: 'Inter', fontSize: 11, color: S.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</div>
                                                        </div>
                                                        <div style={{ flex: 1, padding: '0 8px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: S.ink }}>{it.onHand}</div>
                                                        <div style={{ flex: 1, padding: '0 8px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: S.blue }}>{it.reserved}</div>
                                                        <div style={{ flex: 1, padding: '0 8px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: S.green }}>{it.available}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
}

// ─── Warehouse list row (extracted to avoid inline hook issues) ───────

const SELECT_STYLE: React.CSSProperties = {
    padding: '8px 12px', borderRadius: 8, border: `1px solid ${S.border}`,
    fontFamily: 'Inter', fontSize: 13, color: S.ink, background: '#fff', outline: 'none',
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
};

function WarehouseRow({ w, active, onClick, ROW_STYLE }: {
    w: Warehouse;
    active: boolean;
    onClick: () => void;
    ROW_STYLE: (active: boolean, hovered: boolean) => React.CSSProperties;
}) {
    const [hovered, setHovered] = useState(false);
    return (
        <div
            key={w.id}
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={ROW_STYLE(active, hovered)}
        >
            <div style={{ width: 3, alignSelf: 'stretch', flexShrink: 0 }} />
            <div style={{ flex: 3, padding: '0 12px', minWidth: 0 }}>
                <div style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: S.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={w.name}>
                    {w.aliasName ? `${w.aliasName} (${w.name})` : w.name}
                </div>
                <div style={{ fontFamily: 'Inter', fontSize: 11, color: S.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {w.city ?? '—'} · ID: {w.externalWarehouseId}
                </div>
            </div>
            <div style={{ flex: 1, padding: '0 8px' }}>
                <Badge label={w.warehouseType} color={TYPE_BADGE[w.warehouseType].color} bg={TYPE_BADGE[w.warehouseType].bg} />
            </div>
            <div style={{ flex: 1.5, padding: '0 8px' }}>
                <Badge label={SOURCE_LABEL[w.sourceMarketplace]} color={SOURCE_BADGE[w.sourceMarketplace].color} bg={SOURCE_BADGE[w.sourceMarketplace].bg} />
            </div>
            <div style={{ flex: 1.5, padding: '0 8px' }}>
                <Badge label={STATUS_LABEL[w.status]} color={STATUS_BADGE[w.status].color} bg={STATUS_BADGE[w.status].bg} />
                {w.deactivationReason && (
                    <div style={{ fontFamily: 'Inter', fontSize: 10, color: S.muted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={w.deactivationReason}>
                        {w.deactivationReason}
                    </div>
                )}
            </div>
            <div style={{ flex: 2, padding: '0 8px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {w.labels.slice(0, 3).map(l => <SkuTag key={l}>{l}</SkuTag>)}
                {w.labels.length > 3 && (
                    <span style={{ fontFamily: 'Inter', fontSize: 11, color: S.muted }}>+{w.labels.length - 3}</span>
                )}
            </div>
        </div>
    );
}
