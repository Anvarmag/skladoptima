import { useCallback, useEffect, useMemo, useState } from 'react';

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
import axios from 'axios';
import {
    AlertTriangle,
    CheckCircle2,
    ClipboardList,
    Info,
    PauseCircle,
    PlayCircle,
    Plus,
    RefreshCw,
    ShieldAlert,
    XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { QuickCreateModal, type Member as TaskMember } from './Tasks';
import {
    S,
    PageHeader,
    Card,
    Btn,
    Badge,
    MPBadge,
    HiSelect,
    Input,
    TH,
    FieldLabel,
    SkuTag,
    Spinner,
    Pagination,
} from '../components/ui';

// ─── Доменные типы (зеркалят backend OrdersReadService DTO) ─────────
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
const MARKETPLACE_LABEL: Record<Marketplace, string> = { WB: 'Wildberries', OZON: 'Ozon' };

const INTERNAL_STATUS_CFG: Record<InternalStatus, { label: string; color: string; bg: string }> = {
    IMPORTED:         { label: 'Принят',           color: S.sub,   bg: '#f1f5f9' },
    RESERVED:         { label: 'Резерв',            color: S.blue,  bg: 'rgba(59,130,246,0.08)' },
    CANCELLED:        { label: 'Отменён',           color: S.red,   bg: 'rgba(239,68,68,0.08)' },
    FULFILLED:        { label: 'Выполнен',          color: S.green, bg: 'rgba(16,185,129,0.08)' },
    DISPLAY_ONLY_FBO: { label: 'FBO (без резерва)', color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
    UNRESOLVED:       { label: 'Требует разбора',   color: S.amber, bg: 'rgba(245,158,11,0.10)' },
};

const STOCK_EFFECT_LABEL: Record<StockEffectStatus, { label: string; color: string; explain: string }> = {
    NOT_REQUIRED: {
        label: 'Не требуется',
        color: S.muted,
        explain: 'Заказ не влияет на управляемый остаток (например, FBO).',
    },
    PENDING: {
        label: 'Ожидает применения',
        color: S.amber,
        explain: 'Бизнес-эффект на остаток ещё не применён. Обычно решается автоматически следующим циклом синхронизации.',
    },
    APPLIED: {
        label: 'Применено',
        color: S.green,
        explain: 'Резерв/списание учтены в остатках.',
    },
    BLOCKED: {
        label: 'Заблокировано политикой',
        color: '#ea580c',
        explain: 'Действие приостановлено: tenant в режиме TRIAL_EXPIRED / SUSPENDED / CLOSED. Снимется автоматически после восстановления доступа.',
    },
    FAILED: {
        label: 'Ошибка применения',
        color: S.red,
        explain: 'Side-effect не применился. Чаще всего из-за несопоставленного SKU или неопределённого склада. Используйте «Повторить обработку» после устранения причины.',
    },
};

const MATCH_LABEL: Record<MatchStatus, string> = {
    MATCHED: 'Сопоставлен',
    UNMATCHED: 'Не сопоставлен',
};

const EVENT_LABEL: Record<OrderEventType, { label: string; icon: any; color: string }> = {
    RECEIVED:              { label: 'Получено событие',                  icon: Info,          color: S.sub },
    STATUS_CHANGED:        { label: 'Изменение внешнего статуса',         icon: RefreshCw,     color: S.blue },
    RESERVED:              { label: 'Резерв оформлен',                   icon: CheckCircle2,  color: S.blue },
    RESERVE_RELEASED:      { label: 'Резерв снят',                       icon: AlertTriangle, color: S.amber },
    DEDUCTED:              { label: 'Списано со склада',                  icon: CheckCircle2,  color: S.green },
    RETURN_LOGGED:         { label: 'Возврат зафиксирован',               icon: Info,          color: S.sub },
    DUPLICATE_IGNORED:     { label: 'Дубль проигнорирован',               icon: ShieldAlert,   color: S.muted },
    OUT_OF_ORDER_IGNORED:  { label: 'Устаревшее событие пропущено',       icon: ShieldAlert,   color: S.muted },
    STOCK_EFFECT_FAILED:   { label: 'Ошибка применения остатка',          icon: XCircle,       color: S.red },
};

const PAUSED_STATES = new Set(['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED']);

// ─── KPI tile colours ────────────────────────────────────────────────
const KPI_CFG: Record<string, { color: string; bg: string }> = {
    blue:   { color: S.blue,   bg: 'rgba(59,130,246,0.08)' },
    emerald:{ color: S.green,  bg: 'rgba(16,185,129,0.08)' },
    rose:   { color: S.red,    bg: 'rgba(239,68,68,0.08)' },
    amber:  { color: S.amber,  bg: 'rgba(245,158,11,0.10)' },
    violet: { color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
};

// ─── Component ──────────────────────────────────────────────────────
export default function Orders() {
    const { activeTenant } = useAuth();
    const isPaused = activeTenant ? PAUSED_STATES.has(activeTenant.accessState) : false;
    const isDesktop = useIsDesktop();

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

    // ── Mobile render ──────────────────────────────────────────────────
    if (!isDesktop) {
        return (
            <div style={{ background: '#f8fafc', minHeight: '100vh' }}>
                {/* Заголовок */}
                <div style={{ padding: '8px 20px 12px' }}>
                    <div style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 26, color: '#0f172a', letterSpacing: '-0.02em', lineHeight: 1.1 }}>Заказы</div>
                    <div style={{ fontFamily: 'Inter', fontSize: 12, color: '#64748b', marginTop: 4 }}>{total} заказов</div>
                </div>

                {/* Фильтр по МП — pill tabs */}
                <div style={{ padding: '0 20px 14px', display: 'flex', gap: 6, overflowX: 'auto' }}>
                    {(['ALL', 'WB', 'OZON'] as const).map(mp => (
                        <button
                            key={mp}
                            onClick={() => { setMarketplace(mp); setPage(1); }}
                            style={{
                                padding: '7px 16px', borderRadius: 999, border: 'none', flexShrink: 0,
                                background: marketplace === mp ? '#0f172a' : '#f1f5f9',
                                color: marketplace === mp ? '#fff' : '#64748b',
                                fontFamily: 'Inter', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                            }}
                        >
                            {mp === 'ALL' ? 'Все' : mp === 'OZON' ? 'Ozon' : mp}
                        </button>
                    ))}
                </div>

                {/* Карточки заказов */}
                <div style={{ padding: '0 20px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {loading && (
                        <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontFamily: 'Inter', fontSize: 13 }}>Загрузка…</div>
                    )}
                    {!loading && orders.length === 0 && (
                        <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontFamily: 'Inter', fontSize: 13 }}>Заказов нет</div>
                    )}
                    {orders.map(o => {
                        const mpColor = o.marketplace === 'WB' ? '#cb11ab' : '#005bff';
                        const intlCfg = INTERNAL_STATUS_CFG[o.internalStatus];
                        const dateStr = new Date(o.orderCreatedAt ?? o.createdAt)
                            .toLocaleDateString('ru', { day: '2-digit', month: '2-digit' });
                        const timeStr = new Date(o.orderCreatedAt ?? o.createdAt)
                            .toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
                        return (
                            <div
                                key={o.id}
                                onClick={() => setSelectedOrderId(o.id)}
                                style={{
                                    background: '#fff', borderRadius: 16, padding: '14px 14px 12px',
                                    border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                                    cursor: 'pointer',
                                }}
                            >
                                {/* Строка 1: МП бейдж + номер + дата/время */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <div style={{
                                            width: 6, height: 6, borderRadius: '50%', background: mpColor, flexShrink: 0,
                                        }} />
                                        <span style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 700, color: mpColor }}>
                                            {o.marketplace === 'WB' ? 'WB' : 'Ozon'}
                                        </span>
                                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#94a3b8' }}>
                                            {o.marketplaceOrderId}
                                        </span>
                                    </div>
                                    <span style={{ fontFamily: 'Inter', fontSize: 11, color: '#94a3b8' }}>
                                        {dateStr} {timeStr}
                                    </span>
                                </div>
                                {/* Строка 2: Тип отгрузки */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                                    <span style={{
                                        display: 'inline-flex', padding: '2px 8px', borderRadius: 6,
                                        background: '#f1f5f9', fontFamily: 'Inter', fontSize: 11, fontWeight: 700, color: '#64748b',
                                    }}>
                                        {o.fulfillmentMode}
                                    </span>
                                    {o.externalStatus && (
                                        <span style={{ fontFamily: 'Inter', fontSize: 12, color: '#64748b' }}>
                                            {o.externalStatus}
                                        </span>
                                    )}
                                </div>
                                {/* Строка 3: Статус + эффект на остаток */}
                                <div style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    paddingTop: 10, borderTop: '1px solid #e2e8f0',
                                }}>
                                    <Badge label={intlCfg.label} bg={intlCfg.bg} color={intlCfg.color} />
                                    {o.stockEffectStatus === 'FAILED' && (
                                        <span style={{ fontFamily: 'Inter', fontSize: 11, color: '#ef4444', fontWeight: 600 }}>
                                            Ошибка остатка
                                        </span>
                                    )}
                                    {o.stockEffectStatus === 'PENDING' && (
                                        <span style={{ fontFamily: 'Inter', fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>
                                            Ожидает
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
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

    // ── Desktop render ─────────────────────────────────────────────────
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <PageHeader
                title="Заказы"
                subtitle="Внутренний статус, влияние на остатки и таймлайн событий по каждому заказу"
            >
                <Btn variant="secondary" onClick={fetchOrders} disabled={loading}>
                    <RefreshCw size={14} style={loading ? { animation: 'spin 0.7s linear infinite' } : undefined} />
                    Обновить список
                </Btn>
            </PageHeader>

            {/* TASK_ORDERS_6: paused integration banner.
                §10 + §4 сценарий 4 + UX-правило: история доступна, но не
                ждите новых заказов до снятия паузы. Не обещаем live-данные. */}
            {isPaused && (
                <div style={{
                    border: `1px solid rgba(245,158,11,0.35)`,
                    background: 'rgba(245,158,11,0.07)',
                    borderRadius: 12,
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                }}>
                    <PauseCircle size={18} color={S.amber} style={{ flexShrink: 0, marginTop: 1 }} />
                    <div>
                        <div style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 13, color: '#92400e' }}>
                            Интеграции с маркетплейсами на паузе
                        </div>
                        <div style={{ fontFamily: 'Inter', fontSize: 13, color: '#92400e', marginTop: 2 }}>
                            История ваших заказов доступна для просмотра, но новые заказы из внешних API
                            не будут приходить до снятия ограничения по компании
                            ({activeTenant?.accessState}). Side-effects на остатки также не применяются.
                        </div>
                    </div>
                </div>
            )}

            {error && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 16px',
                    background: 'rgba(239,68,68,0.06)',
                    border: `1px solid rgba(239,68,68,0.2)`,
                    borderRadius: 12,
                }}>
                    <XCircle size={16} color={S.red} style={{ flexShrink: 0 }} />
                    <span style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: S.red }}>{error}</span>
                </div>
            )}

            {/* KPI tiles по текущей странице */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
                <KpiTile label="Резерв"          value={counters.reserved}     tone="blue" />
                <KpiTile label="Выполнено"        value={counters.fulfilled}    tone="emerald" />
                <KpiTile label="Отменено"         value={counters.cancelled}    tone="rose" />
                <KpiTile label="Требует разбора"  value={counters.unresolved}   tone="amber" />
                <KpiTile label="Ошибка остатка"   value={counters.failedEffect} tone="rose" />
                <KpiTile label="FBO"              value={counters.fbo}          tone="violet" />
            </div>

            {/* Filters */}
            <Card>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
                    <FilterSelect
                        label="Маркетплейс"
                        value={marketplace}
                        onChange={(v) => { setMarketplace(v as any); setPage(1); }}
                        options={[
                            ['ALL', 'Все'],
                            ['WB', 'WB'],
                            ['OZON', 'Ozon'],
                        ]}
                    />
                    <FilterSelect
                        label="Тип отгрузки"
                        value={fulfillmentMode}
                        onChange={(v) => { setFulfillmentMode(v as any); setPage(1); }}
                        options={[
                            ['ALL', 'Все'],
                            ['FBS', 'FBS'],
                            ['FBO', 'FBO'],
                        ]}
                    />
                    <FilterSelect
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
                    <FilterSelect
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
                        <FieldLabel>Поиск по номеру</FieldLabel>
                        <Input
                            type="text"
                            value={search}
                            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                            placeholder="WB12345 / 0000-1234-5678"
                        />
                    </div>
                </div>
            </Card>

            {/* Table */}
            <Card noPad>
                {/* Table header */}
                <div style={{
                    display: 'flex', alignItems: 'center', height: 44,
                    borderBottom: `1px solid ${S.border}`,
                    background: '#f8fafc',
                    borderRadius: '16px 16px 0 0',
                }}>
                    <TH flex={1.4}>Дата</TH>
                    <TH flex={0.8}>Источник</TH>
                    <TH flex={1.6}>Номер</TH>
                    <TH flex={0.6}>Тип</TH>
                    <TH flex={1.2}>Внутренний статус</TH>
                    <TH flex={1.2}>Внешний статус</TH>
                    <TH flex={1.4}>Эффект на остаток</TH>
                    <TH flex={0.5} align="right"></TH>
                </div>

                {/* Table body */}
                {loading && orders.length === 0 ? (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 160 }}>
                        <Spinner size={24} />
                    </div>
                ) : orders.length === 0 ? (
                    <div style={{
                        display: 'flex', justifyContent: 'center', alignItems: 'center', height: 160,
                        fontFamily: 'Inter', fontSize: 14, color: S.muted, fontStyle: 'italic',
                    }}>
                        Заказов по выбранным фильтрам не найдено
                    </div>
                ) : (
                    orders.map((o) => {
                        const intl = INTERNAL_STATUS_CFG[o.internalStatus];
                        const eff = STOCK_EFFECT_LABEL[o.stockEffectStatus];
                        return (
                            <OrderRow
                                key={o.id}
                                o={o}
                                intl={intl}
                                eff={eff}
                                onClick={() => setSelectedOrderId(o.id)}
                                onDetailClick={(e) => { e.stopPropagation(); setSelectedOrderId(o.id); }}
                            />
                        );
                    })
                )}

                <Pagination
                    page={page}
                    totalPages={pages}
                    onPage={setPage}
                    total={total}
                    shown={orders.length}
                />
            </Card>

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

// ─── OrderRow ────────────────────────────────────────────────────────
function OrderRow({
    o,
    intl,
    eff,
    onClick,
    onDetailClick,
}: {
    o: OrderHeader;
    intl: { label: string; color: string; bg: string };
    eff: { label: string; color: string };
    onClick: () => void;
    onDetailClick: (e: React.MouseEvent) => void;
}) {
    const [hovered, setHovered] = useState(false);
    return (
        <div
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                display: 'flex', alignItems: 'center', height: 52,
                borderBottom: `1px solid ${S.border}`,
                background: hovered ? '#f8fafc' : '#fff',
                cursor: 'pointer',
                transition: 'background 0.12s',
            }}
        >
            {/* Date */}
            <div style={{ flex: 1.4, padding: '0 16px' }}>
                <div style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: S.ink }}>
                    {formatDate(o.orderCreatedAt || o.createdAt)}
                </div>
                <div style={{ fontFamily: 'Inter', fontSize: 11, color: S.muted, marginTop: 1 }}>
                    {timeAgo(o.orderCreatedAt || o.createdAt)}
                </div>
            </div>

            {/* Marketplace */}
            <div style={{ flex: 0.8, padding: '0 16px' }}>
                <MPBadge mp={o.marketplace} />
            </div>

            {/* Order number */}
            <div style={{ flex: 1.6, padding: '0 16px' }}>
                <SkuTag>{o.marketplaceOrderId}</SkuTag>
            </div>

            {/* Fulfillment mode */}
            <div style={{ flex: 0.6, padding: '0 16px' }}>
                <span style={{ fontFamily: 'Inter', fontSize: 12, fontWeight: 600, color: S.sub }}>
                    {o.fulfillmentMode}
                </span>
            </div>

            {/* Internal status */}
            <div style={{ flex: 1.2, padding: '0 16px' }}>
                <Badge label={intl.label} color={intl.color} bg={intl.bg} />
            </div>

            {/* External status */}
            <div style={{ flex: 1.2, padding: '0 16px' }}>
                <span style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted }}>
                    {o.externalStatus ?? '—'}
                </span>
            </div>

            {/* Stock effect */}
            <div style={{ flex: 1.4, padding: '0 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    {o.affectsStock
                        ? <CheckCircle2 size={13} color={eff.color} />
                        : <PlayCircle size={13} color={eff.color} />
                    }
                    <span style={{ fontFamily: 'Inter', fontSize: 12, fontWeight: 600, color: eff.color }}>
                        {eff.label}
                    </span>
                </div>
            </div>

            {/* Detail link */}
            <div style={{ flex: 0.5, padding: '0 16px', textAlign: 'right' }}>
                <button
                    onClick={onDetailClick}
                    style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontFamily: 'Inter', fontSize: 12, fontWeight: 600, color: S.blue,
                        padding: 0,
                    }}
                >
                    Подробнее →
                </button>
            </div>
        </div>
    );
}

// ─── Subcomponents ──────────────────────────────────────────────────

function KpiTile({ label, value, tone }: { label: string; value: number; tone: string }) {
    const cfg = KPI_CFG[tone] ?? KPI_CFG.blue;
    return (
        <div style={{
            borderRadius: 12,
            padding: '12px 14px',
            background: cfg.bg,
            border: '1px solid transparent',
        }}>
            <div style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: cfg.color, opacity: 0.8 }}>
                {label}
            </div>
            <div style={{ fontFamily: 'Inter', fontSize: 24, fontWeight: 800, color: cfg.color, marginTop: 2, lineHeight: 1.2 }}>
                {value}
            </div>
        </div>
    );
}

function FilterSelect({
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
            <FieldLabel>{label}</FieldLabel>
            <HiSelect
                value={value}
                onChange={onChange}
                options={options.map(([v, l]) => ({ value: v, label: l }))}
                style={{ width: '100%' }}
            />
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

    // Stock effect section styling
    const effectSectionBg =
        detail?.stockEffectStatus === 'FAILED'  ? 'rgba(239,68,68,0.05)'   :
        detail?.stockEffectStatus === 'BLOCKED' ? 'rgba(234,88,12,0.05)'   :
        detail?.stockEffectStatus === 'PENDING' ? 'rgba(245,158,11,0.06)'  :
        detail?.stockEffectStatus === 'APPLIED' ? 'rgba(16,185,129,0.06)'  :
        '#f8fafc';

    const effectSectionBorder =
        detail?.stockEffectStatus === 'FAILED'  ? 'rgba(239,68,68,0.2)'    :
        detail?.stockEffectStatus === 'BLOCKED' ? 'rgba(234,88,12,0.2)'    :
        detail?.stockEffectStatus === 'PENDING' ? 'rgba(245,158,11,0.25)'  :
        detail?.stockEffectStatus === 'APPLIED' ? 'rgba(16,185,129,0.2)'   :
        S.border;

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex' }}>
            {/* Backdrop */}
            <div
                style={{ flex: 1, background: 'rgba(15,23,42,0.4)', backdropFilter: 'blur(2px)' }}
                onClick={onClose}
            />

            {/* Panel */}
            <aside style={{
                width: '100%', maxWidth: 560,
                background: '#fff',
                boxShadow: '-4px 0 32px rgba(0,0,0,0.12)',
                display: 'flex', flexDirection: 'column',
            }}>
                {/* Panel header */}
                <div style={{
                    padding: '16px 24px',
                    borderBottom: `1px solid ${S.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    flexShrink: 0,
                }}>
                    <div>
                        <div style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            Заказ
                        </div>
                        <div style={{ marginTop: 2 }}>
                            <SkuTag>{detail?.marketplaceOrderId ?? '…'}</SkuTag>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Btn
                            variant="secondary"
                            size="sm"
                            onClick={() => setCreateTaskOpen(true)}
                            disabled={isPaused}
                            title={isPaused ? 'Создание недоступно при паузе интеграций' : 'Создать задачу по этому заказу'}
                        >
                            <Plus size={13} />
                            Создать задачу
                        </Btn>
                        <button
                            onClick={onClose}
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: S.muted, fontSize: 22, lineHeight: 1,
                                display: 'flex', alignItems: 'center', padding: 4, borderRadius: 6,
                            }}
                        >
                            ×
                        </button>
                    </div>
                </div>

                {/* Panel body */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {loading ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: S.sub, fontFamily: 'Inter', fontSize: 13 }}>
                            <Spinner size={16} />
                            Загрузка…
                        </div>
                    ) : error ? (
                        <div style={{ fontFamily: 'Inter', fontSize: 13, color: S.red }}>{error}</div>
                    ) : detail ? (
                        <>
                            {/* Header summary grid */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                <DrawerField label="Маркетплейс" value={MARKETPLACE_LABEL[detail.marketplace]} />
                                <DrawerField label="Тип отгрузки" value={detail.fulfillmentMode} />
                                <DrawerField
                                    label="Внутренний статус"
                                    value={
                                        <Badge
                                            label={INTERNAL_STATUS_CFG[detail.internalStatus].label}
                                            color={INTERNAL_STATUS_CFG[detail.internalStatus].color}
                                            bg={INTERNAL_STATUS_CFG[detail.internalStatus].bg}
                                        />
                                    }
                                />
                                <DrawerField label="Внешний статус" value={detail.externalStatus ?? '—'} />
                                <DrawerField label="Создано на маркетплейсе" value={detail.orderCreatedAt ? formatDate(detail.orderCreatedAt) : '—'} />
                                <DrawerField label="Последнее событие" value={detail.processedAt ? formatDate(detail.processedAt) : '—'} />
                            </div>

                            {/* Stock effect explanation */}
                            <div style={{
                                borderRadius: 12,
                                border: `1px solid ${effectSectionBorder}`,
                                background: effectSectionBg,
                                padding: 16,
                            }}>
                                <div style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: S.muted, marginBottom: 4 }}>
                                    Эффект на остаток
                                </div>
                                <div style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 700, color: STOCK_EFFECT_LABEL[detail.stockEffectStatus].color }}>
                                    {STOCK_EFFECT_LABEL[detail.stockEffectStatus].label}
                                </div>
                                <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub, marginTop: 4 }}>
                                    {STOCK_EFFECT_LABEL[detail.stockEffectStatus].explain}
                                </div>

                                {detail.internalStatus === 'UNRESOLVED' && (
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 10 }}>
                                        <AlertTriangle size={13} color={S.amber} style={{ flexShrink: 0, marginTop: 1 }} />
                                        <span style={{ fontFamily: 'Inter', fontSize: 12, color: '#92400e' }}>
                                            В заказе есть несопоставленные SKU или не задан склад. Резерв не будет
                                            выполнен до устранения причины — пожалуйста, проверьте список товаров ниже.
                                        </span>
                                    </div>
                                )}

                                {/* Reprocess button: только для FBS заказов в business-critical статусах
                                    и не в paused. Бэкенд проверит роль и вернёт STILL_FAILED, если scope
                                    всё ещё не resolved — это нормальное поведение. */}
                                {detail.fulfillmentMode === 'FBS'
                                    && (detail.internalStatus === 'RESERVED'
                                        || detail.internalStatus === 'CANCELLED'
                                        || detail.internalStatus === 'FULFILLED') && (
                                    <div style={{ marginTop: 12 }}>
                                        <Btn
                                            variant="secondary"
                                            size="sm"
                                            onClick={onReprocess}
                                            disabled={reprocessing || isPaused}
                                            title={isPaused ? 'Недоступно при паузе интеграций' : ''}
                                        >
                                            {reprocessing ? <Spinner size={13} /> : <RefreshCw size={13} />}
                                            Повторить обработку
                                        </Btn>
                                    </div>
                                )}

                                {reprocessResult && (
                                    <div style={{
                                        marginTop: 8, fontFamily: 'Inter', fontSize: 12,
                                        color: reprocessResult.status === 'APPLIED' ? S.green :
                                               reprocessResult.status === 'STILL_FAILED' ? S.red : S.sub,
                                    }}>
                                        Результат: {reprocessResult.status}
                                        {reprocessResult.detail ? ` (${reprocessResult.detail})` : ''}
                                    </div>
                                )}
                            </div>

                            {/* Items */}
                            <div>
                                <div style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: S.muted, marginBottom: 8 }}>
                                    Товары
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {detail.items.map((it) => (
                                        <div key={it.id} style={{
                                            border: `1px solid ${S.border}`,
                                            borderRadius: 10,
                                            padding: 12,
                                            background: '#fff',
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                                                <div style={{ minWidth: 0, flex: 1 }}>
                                                    <div style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: S.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {it.name ?? '—'}
                                                    </div>
                                                    <div style={{ marginTop: 3 }}>
                                                        <SkuTag>{it.sku ?? '—'}</SkuTag>
                                                    </div>
                                                </div>
                                                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                                    <div style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 800, color: S.ink }}>
                                                        ×{it.quantity}
                                                    </div>
                                                    {it.price && (
                                                        <div style={{ fontFamily: 'Inter', fontSize: 11, color: S.muted }}>
                                                            {it.price} ₽
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <Badge
                                                    label={MATCH_LABEL[it.matchStatus]}
                                                    color={it.matchStatus === 'MATCHED' ? S.green : S.red}
                                                    bg={it.matchStatus === 'MATCHED' ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)'}
                                                />
                                                {!it.warehouseId && (
                                                    <Badge
                                                        label="Склад не определён"
                                                        color={S.amber}
                                                        bg="rgba(245,158,11,0.10)"
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Related tasks */}
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                                    <ClipboardList size={13} color={S.muted} />
                                    <span style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: S.muted }}>
                                        Связанные задачи
                                    </span>
                                    {relatedTasksLoading && <Spinner size={13} />}
                                </div>
                                {!relatedTasksLoading && relatedTasks.length === 0 ? (
                                    <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted, fontStyle: 'italic' }}>
                                        Нет открытых задач по этому заказу.{' '}
                                        {!isPaused && (
                                            <button
                                                onClick={() => setCreateTaskOpen(true)}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Inter', fontSize: 12, color: S.blue, padding: 0, textDecoration: 'underline' }}
                                            >
                                                Создать
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        {relatedTasks.map(t => (
                                            <div key={t.id} style={{
                                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                border: `1px solid ${S.border}`, borderRadius: 8,
                                                padding: '8px 12px', background: '#f8fafc',
                                            }}>
                                                <span style={{ fontFamily: 'Inter', fontSize: 13, color: S.ink, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {t.title}
                                                </span>
                                                <Badge
                                                    label={t.status === 'OPEN' ? 'Открыта' : t.status === 'IN_PROGRESS' ? 'В работе' : 'Ожидает'}
                                                    color={t.status === 'OPEN' ? S.sub : t.status === 'IN_PROGRESS' ? S.blue : S.amber}
                                                    bg={t.status === 'OPEN' ? '#f1f5f9' : t.status === 'IN_PROGRESS' ? 'rgba(59,130,246,0.08)' : 'rgba(245,158,11,0.10)'}
                                                    style={{ marginLeft: 8, flexShrink: 0 }}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Timeline */}
                            <div>
                                <div style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: S.muted, marginBottom: 8 }}>
                                    Таймлайн событий
                                </div>
                                {events.length === 0 ? (
                                    <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted, fontStyle: 'italic' }}>
                                        Событий пока нет
                                    </div>
                                ) : (
                                    <div style={{ position: 'relative', paddingLeft: 20, borderLeft: `2px solid ${S.border}`, display: 'flex', flexDirection: 'column', gap: 16 }}>
                                        {events.map((e) => {
                                            const meta = EVENT_LABEL[e.eventType] ?? EVENT_LABEL.RECEIVED;
                                            const Icon = meta.icon;
                                            return (
                                                <div key={e.id} style={{ position: 'relative' }}>
                                                    {/* Dot */}
                                                    <div style={{
                                                        position: 'absolute', left: -27, top: 3,
                                                        width: 12, height: 12, borderRadius: '50%',
                                                        background: '#fff', border: `2px solid ${S.border}`,
                                                    }} />
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        <Icon size={13} color={meta.color} />
                                                        <span style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: meta.color }}>
                                                            {meta.label}
                                                        </span>
                                                    </div>
                                                    <div style={{ fontFamily: 'Inter', fontSize: 11, color: S.muted, marginTop: 2 }}>
                                                        {formatDate(e.createdAt)}
                                                    </div>
                                                    {e.payload && Object.keys(e.payload).length > 0 && (
                                                        <pre style={{
                                                            marginTop: 6,
                                                            background: '#f8fafc',
                                                            border: `1px solid ${S.border}`,
                                                            borderRadius: 6,
                                                            padding: '8px 10px',
                                                            fontFamily: "'JetBrains Mono', monospace",
                                                            fontSize: 11,
                                                            color: S.sub,
                                                            overflowX: 'auto',
                                                        }}>
                                                            {JSON.stringify(e.payload, null, 2)}
                                                        </pre>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
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

function DrawerField({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div>
            <div style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: S.muted }}>
                {label}
            </div>
            <div style={{ fontFamily: 'Inter', fontSize: 13, color: S.ink, marginTop: 3 }}>
                {value}
            </div>
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
