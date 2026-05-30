import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { X, Plus, Pencil, Trash2, Package, ShoppingCart, BookOpen } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { S, Btn, SkuTag, Spinner } from './ui';

// ─── Types ────────────────────────────────────────────────────────────

interface StockRow {
    productId: string;
    sku: string;
    name: string;
    photo: string | null;
    onHand: number;
    reserved: number;
    available: number;
    balances: Array<{
        warehouseId: string;
        fulfillmentMode: 'FBS' | 'FBO';
        isExternal: boolean;
        onHand: number;
        reserved: number;
        available: number;
    }>;
}

// Минимальный набор полей — совместим и с Products.tsx (id/total) и с Inventory.tsx (productId/onHand)
export interface ProductPanelItem {
    id?: string;
    productId?: string;
    sku: string;
    name: string;
    photo?: string | null;
    onHand?: number;
    total?: number;
    reserved?: number;
    available?: number;
    balances?: StockRow['balances'];
}

interface ProductNote {
    id: string;
    title: string;
    body: string | null;
}

interface DailyPoint { date: string; ordersCount: number; revenueNet: number; unitsSold: number; }

interface DrillDown {
    product: { id: string; sku: string; name: string };
    period: { from: string; to: string };
    kpis: { revenueNet: number; unitsSold: number; ordersCount: number; returnsCount: number; avgPrice: number };
    dailySeries: DailyPoint[];
    recentOrders: Array<{
        marketplace: string; marketplaceOrderId: string; marketplaceCreatedAt: string | null;
        quantity: number; totalAmount: number | null; status: string | null;
    }>;
}

// ─── Constants ────────────────────────────────────────────────────────


const PERIODS = [
    { label: '7 дней',  days: 7 },
    { label: '30 дней', days: 30 },
    { label: '90 дней', days: 90 },
];

type Tab = 'stocks' | 'orders' | 'diary';

// ─── Helpers ──────────────────────────────────────────────────────────

function periodDates(days: number): { from: string; to: string } {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    return {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
    };
}

function fmtDate(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return iso; }
}

function fmtMoney(v: number): string {
    return v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽';
}

// ─── Section header ───────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
    return (
        <p style={{
            fontFamily: 'Inter', fontSize: 10, fontWeight: 700,
            color: S.muted, textTransform: 'uppercase', letterSpacing: '0.1em',
            margin: '0 0 12px',
        }}>
            {label}
        </p>
    );
}

// ─── KPI card with sparkline ──────────────────────────────────────────

function KpiSparkCard({ label, value, series, color }: {
    label: string; value: string;
    series: number[]; color: string;
}) {
    const data = series.map(v => ({ v }));
    const gradId = `kpi-grad-${label.replace(/\s/g, '')}`;
    return (
        <div style={{ padding: '10px 14px', borderRadius: 10, border: `1px solid ${S.border}`, background: '#fff', overflow: 'hidden' }}>
            <p style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: S.muted, margin: 0 }}>
                {label}
            </p>
            <p style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: S.ink, margin: '3px 0 6px' }}>
                {value}
            </p>
            <div style={{ height: 32, marginLeft: -14, marginRight: -14, marginBottom: -10 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={color} stopOpacity={0.18} />
                                <stop offset="95%" stopColor={color} stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5}
                            fill={`url(#${gradId})`} dot={false} isAnimationActive={false} />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────

interface Props {
    product: ProductPanelItem;
    onClose: () => void;
    onNotesChange?: (productId: string, count: number) => void;
    initialTab?: Tab;
}

export default function ProductDetailPanel({ product, onClose, onNotesChange, initialTab }: Props) {
    // Нормализация — поддерживаем оба формата: Inventory (productId/onHand) и Products (id/total)
    const productId = product.productId ?? product.id ?? '';
    const onHand    = product.onHand ?? product.total ?? 0;
    const reserved  = product.reserved ?? 0;
    const available = product.available ?? 0;
    const balances  = product.balances ?? [];

    const [tab, setTab] = useState<Tab>(initialTab ?? 'stocks');
    const [periodDays, setPeriodDays] = useState(30);

    // orders/analytics
    const [drillDown, setDrillDown] = useState<DrillDown | null>(null);
    const [drillLoading, setDrillLoading] = useState(false);

    // notes
    const [notes, setNotes] = useState<ProductNote[]>([]);
    const [notesLoading, setNotesLoading] = useState(false);

    // note form
    const [formOpen, setFormOpen] = useState(false);
    const [editNote, setEditNote] = useState<ProductNote | null>(null);
    const [formTitle, setFormTitle] = useState('');
    const [formBody, setFormBody] = useState('');
    const [formSubmitting, setFormSubmitting] = useState(false);

    // ─── loaders

    const loadDrillDown = useCallback(async (days: number) => {
        setDrillLoading(true);
        try {
            const { from, to } = periodDates(days);
            const res = await axios.get<DrillDown>(`/analytics/products/${productId}`, { params: { from, to } });
            setDrillDown(res.data);
        } catch {
            setDrillDown(null);
        } finally {
            setDrillLoading(false);
        }
    }, [productId]);

    const loadNotes = useCallback(async () => {
        setNotesLoading(true);
        try {
            const res = await axios.get<ProductNote[]>(`/products/${productId}/notes`);
            setNotes(res.data);
            onNotesChange?.(productId, res.data.length);
        } catch {
            setNotes([]);
        } finally {
            setNotesLoading(false);
        }
    }, [productId]);

    useEffect(() => {
        if (tab === 'orders') loadDrillDown(periodDays);
    }, [tab, periodDays, loadDrillDown]);

    useEffect(() => {
        if (tab === 'diary') loadNotes();
    }, [tab, loadNotes]);

    // ─── note form helpers

    function openCreate() {
        setEditNote(null);
        setFormTitle('');
        setFormBody('');
        setFormOpen(true);
    }

    function openEditNote(note: ProductNote) {
        setEditNote(note);
        setFormTitle(note.title);
        setFormBody(note.body ?? '');
        setFormOpen(true);
    }

    async function submitNote() {
        if (!formTitle.trim()) return;
        setFormSubmitting(true);
        try {
            if (editNote) {
                await axios.patch(`/products/${productId}/notes/${editNote.id}`, {
                    title: formTitle.trim(),
                    body: formBody.trim() || undefined,
                });
            } else {
                await axios.post(`/products/${productId}/notes`, {
                    title: formTitle.trim(),
                    body: formBody.trim() || undefined,
                });
            }
            setFormOpen(false);
            await loadNotes();
        } finally {
            setFormSubmitting(false);
        }
    }

    async function deleteNote(noteId: string) {
        if (!confirm('Удалить заметку?')) return;
        await axios.delete(`/products/${productId}/notes/${noteId}`);
        await loadNotes();
    }

    // ─── tab styles
    const tabs: Array<{ id: Tab; label: string; icon: any }> = [
        { id: 'stocks', label: 'Остатки',  icon: Package },
        { id: 'orders', label: 'Заказы',   icon: ShoppingCart },
        { id: 'diary',  label: 'Заметки',  icon: BookOpen },
    ];

    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '7px 10px',
        borderRadius: 8, border: `1px solid ${S.border}`,
        fontFamily: 'Inter', fontSize: 13, color: S.ink,
        background: '#fff', outline: 'none', boxSizing: 'border-box',
    };

    return (
        <>
            {/* Backdrop */}
            <div
                style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(15,23,42,0.2)', backdropFilter: 'blur(2px)' }}
                onClick={onClose}
            />

            {/* Panel */}
            <div style={{
                position: 'fixed', insetBlock: 0, right: 0, zIndex: 40,
                width: '100%', maxWidth: 520,
                background: '#fff',
                boxShadow: '-8px 0 40px rgba(0,0,0,0.12)',
                borderLeft: `1px solid ${S.border}`,
                display: 'flex', flexDirection: 'column',
            }}>
                {/* Header */}
                <div style={{
                    padding: '14px 20px', borderBottom: `1px solid ${S.border}`,
                    background: S.bg, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        {product.photo && (
                            <img
                                src={product.photo}
                                alt=""
                                style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', flexShrink: 0, border: `1px solid ${S.border}` }}
                            />
                        )}
                        <div style={{ minWidth: 0 }}>
                            <SkuTag>{product.sku}</SkuTag>
                            <p style={{
                                fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: S.ink,
                                margin: '4px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 360,
                            }}>
                                {product.name}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            padding: 6, borderRadius: 6, color: S.muted, display: 'flex', flexShrink: 0,
                        }}
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* KPI row */}
                <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
                    borderBottom: `1px solid ${S.border}`,
                }}>
                    {[
                        { label: 'Всего', value: onHand, color: S.ink },
                        { label: 'Резерв', value: reserved, color: S.blue },
                        { label: 'Доступно', value: available, color: S.green },
                    ].map((item, i) => (
                        <div key={i} style={{
                            padding: '10px 16px',
                            borderRight: i < 2 ? `1px solid ${S.border}` : 'none',
                        }}>
                            <p style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: S.muted, margin: 0 }}>
                                {item.label}
                            </p>
                            <p style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 700, color: item.color, margin: '2px 0 0' }}>
                                {item.value}
                            </p>
                        </div>
                    ))}
                </div>

                {/* Tabs */}
                <div style={{ borderBottom: `2px solid ${S.border}`, display: 'flex', gap: 0 }}>
                    {tabs.map(t => {
                        const Icon = t.icon;
                        const active = tab === t.id;
                        return (
                            <button
                                key={t.id}
                                onClick={() => setTab(t.id)}
                                style={{
                                    flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                                    padding: '10px 8px',
                                    fontFamily: 'Inter', fontWeight: 600, fontSize: 12,
                                    border: 'none', borderBottom: active ? `2px solid ${S.blue}` : '2px solid transparent',
                                    marginBottom: -2,
                                    background: 'transparent',
                                    color: active ? S.blue : S.sub,
                                    cursor: 'pointer',
                                    transition: 'color 0.12s',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                <Icon size={13} />
                                {t.label}
                            </button>
                        );
                    })}
                </div>

                {/* Content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

                    {/* ─── Остатки ─── */}
                    {tab === 'stocks' && (
                        <>
                            <SectionHeader label="По складам и каналам" />
                            {balances.length === 0 ? (
                                <p style={{ fontFamily: 'Inter', fontSize: 13, color: S.muted, textAlign: 'center', padding: '24px 0' }}>
                                    Нет данных по складам
                                </p>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {balances.map((b, i) => (
                                        <div key={i} style={{
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            padding: '10px 14px', borderRadius: 10,
                                            border: `1px solid ${S.border}`, background: '#fff',
                                        }}>
                                            <div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                                                    <span style={{
                                                        fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                                                        background: b.fulfillmentMode === 'FBO' ? 'rgba(59,130,246,0.08)' : 'rgba(16,185,129,0.08)',
                                                        color: b.fulfillmentMode === 'FBO' ? S.blue : S.green,
                                                    }}>
                                                        {b.fulfillmentMode}
                                                    </span>
                                                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: S.sub }}>
                                                        {b.warehouseId}
                                                    </span>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: 16, textAlign: 'right' }}>
                                                <div>
                                                    <p style={{ fontSize: 10, color: S.muted, margin: 0 }}>Всего</p>
                                                    <p style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: S.ink, margin: 0 }}>{b.onHand}</p>
                                                </div>
                                                <div>
                                                    <p style={{ fontSize: 10, color: S.muted, margin: 0 }}>Резерв</p>
                                                    <p style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: S.blue, margin: 0 }}>{b.reserved}</p>
                                                </div>
                                                <div>
                                                    <p style={{ fontSize: 10, color: S.muted, margin: 0 }}>Доступно</p>
                                                    <p style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: S.green, margin: 0 }}>{b.available}</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}

                    {/* ─── Заказы ─── */}
                    {tab === 'orders' && (
                        <>
                            {/* Period selector */}
                            <div style={{ display: 'flex', gap: 6 }}>
                                {PERIODS.map(p => (
                                    <button
                                        key={p.days}
                                        onClick={() => setPeriodDays(p.days)}
                                        style={{
                                            padding: '6px 14px', borderRadius: 8, border: `1px solid ${periodDays === p.days ? S.blue : S.border}`,
                                            background: periodDays === p.days ? 'rgba(59,130,246,0.08)' : '#fff',
                                            color: periodDays === p.days ? S.blue : S.sub,
                                            fontFamily: 'Inter', fontSize: 12, fontWeight: 600,
                                            cursor: 'pointer', transition: 'all 0.12s',
                                        }}
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>

                            {drillLoading && (
                                <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
                                    <Spinner size={20} />
                                </div>
                            )}

                            {!drillLoading && drillDown && (() => {
                                const s = drillDown.dailySeries ?? [];
                                const ordersSeries  = s.map(d => d.ordersCount);
                                const revenueSeries = s.map(d => d.revenueNet);
                                const unitsSeries   = s.map(d => d.unitsSold);
                                const returnsSeries = s.map(() => 0);
                                const priceSeries   = s.map(d => d.unitsSold > 0 ? Math.round(d.revenueNet / d.unitsSold) : 0);
                                return (
                                    <>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                            <KpiSparkCard label="Заказов"       value={String(drillDown.kpis.ordersCount)}   series={ordersSeries}  color="#3b82f6" />
                                            <KpiSparkCard label="Продано шт."   value={String(drillDown.kpis.unitsSold)}     series={unitsSeries}   color="#22c55e" />
                                            <KpiSparkCard label="Выручка"        value={fmtMoney(drillDown.kpis.revenueNet)}  series={revenueSeries} color="#22c55e" />
                                            <KpiSparkCard label="Средняя цена"  value={fmtMoney(drillDown.kpis.avgPrice)}    series={priceSeries}   color="#8b5cf6" />
                                            <KpiSparkCard label="Возвраты"      value={String(drillDown.kpis.returnsCount)}  series={returnsSeries} color="#ef4444" />
                                        </div>

                                        {drillDown.recentOrders.length > 0 && (
                                            <>
                                                <SectionHeader label={`Последние заказы (${drillDown.recentOrders.length})`} />
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                    {drillDown.recentOrders.map((o, i) => (
                                                        <div key={i} style={{
                                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                            padding: '8px 12px', borderRadius: 8,
                                                            background: S.bg, fontSize: 12,
                                                        }}>
                                                            <div>
                                                                <span style={{ fontFamily: 'monospace', color: S.ink, fontWeight: 600 }}>{o.marketplaceOrderId}</span>
                                                                <span style={{ color: S.muted, marginLeft: 8 }}>{o.marketplace}</span>
                                                            </div>
                                                            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                                                                <span style={{ fontFamily: 'monospace', color: S.sub }}>{o.quantity} шт.</span>
                                                                {o.totalAmount != null && (
                                                                    <span style={{ fontFamily: 'monospace', fontWeight: 600, color: S.ink }}>{fmtMoney(o.totalAmount)}</span>
                                                                )}
                                                                {o.marketplaceCreatedAt && (
                                                                    <span style={{ color: S.muted }}>{fmtDate(o.marketplaceCreatedAt)}</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </>
                                        )}

                                        {drillDown.recentOrders.length === 0 && (
                                            <p style={{ fontFamily: 'Inter', fontSize: 13, color: S.muted, textAlign: 'center', padding: '16px 0' }}>
                                                Заказов за период нет
                                            </p>
                                        )}
                                    </>
                                );
                            })()}

                            {!drillLoading && !drillDown && (
                                <p style={{ fontFamily: 'Inter', fontSize: 13, color: S.muted, textAlign: 'center', padding: '24px 0' }}>
                                    Не удалось загрузить данные
                                </p>
                            )}
                        </>
                    )}

                    {/* ─── Заметки ─── */}
                    {tab === 'diary' && (
                        <>
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <Btn size="sm" variant="primary" onClick={openCreate}>
                                    <Plus size={12} /> Добавить
                                </Btn>
                            </div>

                            {/* Note form */}
                            {formOpen && (
                                <div style={{
                                    padding: 14, borderRadius: 10, background: S.bg,
                                    border: `1px solid ${S.border}`, display: 'flex', flexDirection: 'column', gap: 10,
                                }}>
                                    <p style={{ fontFamily: 'Inter', fontSize: 12, fontWeight: 700, color: S.ink, margin: 0 }}>
                                        {editNote ? 'Редактировать заметку' : 'Новая заметка'}
                                    </p>
                                    <input
                                        type="text"
                                        value={formTitle}
                                        onChange={e => setFormTitle(e.target.value)}
                                        placeholder="Заголовок *"
                                        style={inputStyle}
                                    />
                                    <textarea
                                        value={formBody}
                                        onChange={e => setFormBody(e.target.value)}
                                        placeholder="Описание (опционально)"
                                        rows={3}
                                        style={{ ...inputStyle, resize: 'vertical' }}
                                    />
                                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                        <Btn size="sm" variant="ghost" onClick={() => setFormOpen(false)}>Отмена</Btn>
                                        <Btn size="sm" variant="primary" onClick={submitNote} disabled={!formTitle.trim() || formSubmitting}>
                                            {formSubmitting ? 'Сохраняем...' : 'Сохранить'}
                                        </Btn>
                                    </div>
                                </div>
                            )}

                            {notesLoading && (
                                <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
                                    <Spinner size={20} />
                                </div>
                            )}

                            {!notesLoading && notes.length === 0 && (
                                <p style={{ fontFamily: 'Inter', fontSize: 13, color: S.muted, textAlign: 'center', padding: '24px 0' }}>
                                    Пока нет заметок
                                </p>
                            )}

                            {!notesLoading && notes.map(note => (
                                <div key={note.id} style={{
                                    padding: '12px 14px', borderRadius: 10,
                                    border: `1px solid ${S.border}`, background: '#fff',
                                    display: 'flex', flexDirection: 'column', gap: 6,
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                                        <p style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: S.ink, margin: 0 }}>
                                            {note.title}
                                        </p>
                                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                            <button
                                                onClick={() => openEditNote(note)}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: S.muted, display: 'flex', borderRadius: 4 }}
                                            >
                                                <Pencil size={13} />
                                            </button>
                                            <button
                                                onClick={() => deleteNote(note.id)}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: S.muted, display: 'flex', borderRadius: 4 }}
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </div>
                                    {note.body && (
                                        <p style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub, margin: 0, whiteSpace: 'pre-wrap' }}>
                                            {note.body}
                                        </p>
                                    )}
                                </div>
                            ))}
                        </>
                    )}
                </div>
            </div>
        </>
    );
}
