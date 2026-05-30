import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import {
    Search, Link2, Unlink, ChevronDown, CheckCircle, XCircle,
    Package, Crown, ChevronRight, X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { S, PageHeader, Card, Input, Badge, SkuTag } from '../components/ui';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChannelMapping {
    id: string;
    marketplace: 'WB' | 'OZON' | 'YANDEX_MARKET' | 'SITE';
    externalProductId: string;
    externalSku: string | null;
    isAutoMatched: boolean;
}

interface CatalogProduct {
    id: string;
    sku: string;
    name: string;
    brand: string | null;
    photo: string | null;
    mainImageFileId: string | null;
    total: number;
    groupId: string | null;
    groupRole: 'PRIMARY' | 'SECONDARY' | null;
    channelMappings: ChannelMapping[];
}

interface Meta {
    total: number;
    page: number;
    lastPage: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WRITE_BLOCKED_STATES = ['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED'];

function getMappingFor(mappings: ChannelMapping[], mp: string) {
    return mappings.find(m => m.marketplace === mp);
}

// ─── Product thumbnail ────────────────────────────────────────────────────────

function Thumb({ product, small }: { product: Pick<CatalogProduct, 'photo' | 'mainImageFileId' | 'name'>; small?: boolean }) {
    const thumb = product.mainImageFileId
        ? `/api/files/${product.mainImageFileId}/thumb`
        : product.photo ?? null;
    const w = small ? 52 : 72;
    const h = small ? 68 : 96;
    return (
        <div style={{
            width: w, height: h, borderRadius: 10, flexShrink: 0,
            background: '#f1f5f9', overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
            {thumb
                ? <img src={thumb} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <Package size={small ? 20 : 32} color="#94a3b8" strokeWidth={1.5} />}
        </div>
    );
}

// ─── Marketplace status badges ────────────────────────────────────────────────

function MpStatus({ label, mapped, externalId }: { label: string; mapped: boolean; externalId?: string }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {mapped
                ? <CheckCircle size={13} color="#22c55e" strokeWidth={2.2} />
                : <XCircle size={13} color="#e2e8f0" strokeWidth={2} />}
            <span style={{ fontSize: 12, color: mapped ? '#16a34a' : '#cbd5e1', fontWeight: 500 }}>{label}</span>
            {mapped && externalId && (
                <span style={{ fontSize: 10, color: S.textSecondary, maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {externalId}
                </span>
            )}
        </div>
    );
}

// ─── Link picker modal ────────────────────────────────────────────────────────

function LinkPickerModal({
    product,
    onLinked,
    onClose,
}: {
    product: CatalogProduct;
    onLinked: () => void;
    onClose: () => void;
}) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<CatalogProduct[]>([]);
    const [searching, setSearching] = useState(false);
    const [linking, setLinking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    useEffect(() => {
        if (query.trim().length < 1) { setResults([]); return; }
        const t = setTimeout(async () => {
            setSearching(true);
            try {
                const res = await axios.get('/catalog/groups/search', {
                    params: { q: query.trim(), excludeId: product.id },
                });
                setResults(res.data);
            } catch { setResults([]); }
            finally { setSearching(false); }
        }, 250);
        return () => clearTimeout(t);
    }, [query, product.id]);

    async function handleLink(targetId: string) {
        setLinking(true);
        setError(null);
        try {
            await axios.post('/catalog/groups/link', { productAId: product.id, productBId: targetId });
            onLinked();
        } catch (e: any) {
            const code = e?.response?.data?.code;
            if (code === 'BOTH_IN_DIFFERENT_GROUPS') {
                setError('Оба товара уже в разных группах. Сначала отвяжите один из них.');
            } else if (code === 'ALREADY_LINKED') {
                setError('Товары уже в одной группе.');
            } else {
                setError(e?.response?.data?.message ?? 'Ошибка связки');
            }
        } finally { setLinking(false); }
    }

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={onClose}>
            <div
                style={{
                    background: '#fff', borderRadius: 16, width: 480, maxWidth: '92vw',
                    boxShadow: '0 24px 64px rgba(0,0,0,0.20)',
                    display: 'flex', flexDirection: 'column', maxHeight: '80vh',
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{ padding: '18px 20px 12px', borderBottom: `1px solid ${S.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <div>
                            <div style={{ fontSize: 15, fontWeight: 700, color: S.text }}>Связать товар</div>
                            <div style={{ fontSize: 12, color: S.textSecondary, marginTop: 2 }}>
                                Выберите товар для связки с <strong>{product.name}</strong>
                            </div>
                        </div>
                        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: S.textSecondary, padding: 4 }}>
                            <X size={18} />
                        </button>
                    </div>
                    {/* Search */}
                    <div style={{ position: 'relative' }}>
                        <Search size={14} color={S.textSecondary} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Поиск по названию или SKU…"
                            style={{
                                width: '100%', height: 38, padding: '0 10px 0 32px',
                                border: `1px solid ${S.border}`, borderRadius: 9,
                                fontSize: 13, outline: 'none', boxSizing: 'border-box',
                                fontFamily: 'inherit',
                            }}
                        />
                    </div>
                </div>

                {/* Results */}
                <div style={{ overflowY: 'auto', flex: 1 }}>
                    {searching && (
                        <div style={{ padding: '20px 20px', fontSize: 13, color: S.textSecondary }}>Поиск…</div>
                    )}
                    {!searching && query.trim().length > 0 && results.length === 0 && (
                        <div style={{ padding: '20px 20px', fontSize: 13, color: S.textSecondary }}>Товары не найдены</div>
                    )}
                    {!searching && query.trim().length === 0 && (
                        <div style={{ padding: '20px 20px', fontSize: 13, color: S.textSecondary }}>
                            Начните вводить название или SKU товара
                        </div>
                    )}
                    {results.map(r => (
                        <button
                            key={r.id}
                            disabled={linking}
                            onClick={() => handleLink(r.id)}
                            style={{
                                width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                                padding: '10px 20px', border: 'none', background: 'none',
                                cursor: linking ? 'wait' : 'pointer', textAlign: 'left',
                                borderBottom: `1px solid ${S.border}`,
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                        >
                            <Thumb product={r} size={36} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: S.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {r.name}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                                    <SkuTag>{r.sku}</SkuTag>
                                    {r.brand && <span style={{ fontSize: 11, color: S.textSecondary }}>{r.brand}</span>}
                                    {r.groupId && <Badge label="В группе" color="#1d4ed8" bg="#dbeafe" />}
                                </div>
                            </div>
                            <ChevronRight size={14} color={S.textSecondary} />
                        </button>
                    ))}
                </div>

                {error && (
                    <div style={{ padding: '10px 20px', borderTop: `1px solid ${S.border}`, fontSize: 12, color: '#dc2626' }}>
                        {error}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Single product row ───────────────────────────────────────────────────────

function ProductRow({
    product,
    isReadOnly,
    onLinkClick,
    onUnlink,
    onSetPrimary,
    isSecondary,
    isInGroup,
}: {
    product: CatalogProduct;
    isReadOnly: boolean;
    onLinkClick: () => void;
    onUnlink: () => void;
    onSetPrimary: () => void;
    isSecondary?: boolean;
    isInGroup?: boolean;
}) {
    const wbMap = getMappingFor(product.channelMappings, 'WB');
    const ozMap = getMappingFor(product.channelMappings, 'OZON');
    const ymMap = getMappingFor(product.channelMappings, 'YANDEX_MARKET');
    const hasMappings = product.channelMappings.length > 0;
    const isPrimary = product.groupRole === 'PRIMARY';

    return (
        <tr
            style={{
                borderBottom: `1px solid ${S.border}`,
            }}
            onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = '#f8fafc'}
            onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = ''}
        >
            {/* Фото */}
            <td style={{
                padding: '8px 16px', verticalAlign: 'middle',
                borderLeft: isInGroup ? '3px solid #3b82f6' : '3px solid transparent',
            }}>
                <Thumb product={product} small={isSecondary} />
            </td>

            {/* Название */}
            <td style={{ padding: '0 16px', verticalAlign: 'middle' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: 'Inter', fontSize: isSecondary ? 13 : 15, fontWeight: 600, color: S.ink ?? S.text }}>
                                {product.name}
                            </span>
                            {isPrimary && product.groupId && (
                                <span style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 3,
                                    fontSize: 10, fontWeight: 700, color: '#92400e',
                                    background: '#fef3c7', borderRadius: 5, padding: '2px 6px',
                                    flexShrink: 0,
                                }}>
                                    <Crown size={9} color="#f59e0b" strokeWidth={2.5} />
                                    Главный
                                </span>
                            )}
                        </div>
                        {product.brand && <div style={{ fontFamily: 'Inter', fontSize: 13, color: S.muted ?? S.textSecondary, marginTop: 1 }}>{product.brand}</div>}
                        {!hasMappings && !product.groupId && (
                            <div style={{ marginTop: 3 }}>
                                <Badge label="Без связки" color="#92400e" bg="#fef3c7" />
                            </div>
                        )}
                    </div>
                </div>
            </td>

            {/* SKU */}
            <td style={{ padding: '0 16px', verticalAlign: 'middle' }}>
                <SkuTag>{product.sku}</SkuTag>
            </td>

            {/* Маркетплейсы */}
            <td style={{ padding: '0 16px', verticalAlign: 'middle', borderLeft: `1px solid ${S.border}` }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <MpStatus label="WB" mapped={!!wbMap} externalId={wbMap?.externalProductId} />
                    <MpStatus label="Ozon" mapped={!!ozMap} externalId={ozMap?.externalProductId} />
                    {ymMap && <MpStatus label="YM" mapped={true} externalId={ymMap.externalProductId} />}
                </div>
            </td>

            {/* Остаток */}
            <td style={{ padding: '0 16px', verticalAlign: 'middle', borderLeft: `1px solid ${S.border}` }}>
                <span style={{ fontFamily: 'Inter', fontSize: 16, fontWeight: 700, color: S.ink ?? S.text }}>{product.total}</span>
                <span style={{ fontFamily: 'Inter', fontSize: 13, color: S.muted ?? S.textSecondary }}> шт.</span>
            </td>

            {/* Действия */}
            <td style={{ padding: '0 16px', verticalAlign: 'middle', borderLeft: `1px solid ${S.border}` }}>
                {!isReadOnly && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                        <button onClick={onLinkClick} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            fontSize: 12, color: '#3b82f6', background: 'none',
                            border: 'none', cursor: 'pointer', padding: 0,
                            fontFamily: 'Inter', fontWeight: 500, whiteSpace: 'nowrap',
                        }}>
                            <Link2 size={12} />
                            {product.groupId ? 'Добавить' : 'Привязать'}
                        </button>
                        {product.groupId && !isPrimary && (
                            <button onClick={onSetPrimary} style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                fontSize: 12, color: '#d97706', background: 'none',
                                border: 'none', cursor: 'pointer', padding: 0,
                                fontFamily: 'Inter', fontWeight: 500, whiteSpace: 'nowrap',
                            }}>
                                <Crown size={11} />
                                Сделать главным
                            </button>
                        )}
                        {product.groupId && (
                            <button onClick={onUnlink} style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                fontSize: 12, color: '#ef4444', background: 'none',
                                border: 'none', cursor: 'pointer', padding: 0,
                                fontFamily: 'Inter', fontWeight: 500, whiteSpace: 'nowrap',
                            }}>
                                <Unlink size={11} />
                                Отвязать
                            </button>
                        )}
                    </div>
                )}
            </td>
        </tr>
    );
}

// ─── Group row (PRIMARY + expandable SECONDARYs) ─────────────────────────────

function GroupRows({
    products,
    isReadOnly,
    onLinkClick,
    onUnlink,
    onSetPrimary,
}: {
    products: CatalogProduct[];
    isReadOnly: boolean;
    onLinkClick: (p: CatalogProduct) => void;
    onUnlink: (p: CatalogProduct) => void;
    onSetPrimary: (p: CatalogProduct) => void;
}) {
    const [expanded, setExpanded] = useState(true);
    const primary = products.find(p => p.groupRole === 'PRIMARY') ?? products[0];
    const secondaries = products.filter(p => p.id !== primary.id);

    return (
        <>
            {/* Group header row */}
            <tr style={{ background: '#eff6ff' }}>
                <td style={{ borderLeft: '3px solid #3b82f6', padding: '5px 14px', width: 0 }} />
                <td colSpan={5} style={{ padding: '5px 0' }}>
                    <button
                        onClick={() => setExpanded(v => !v)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: 11, fontWeight: 700, color: '#2563eb',
                            letterSpacing: '0.04em', textTransform: 'uppercase',
                            padding: 0, fontFamily: 'Inter',
                        }}
                    >
                        <ChevronDown
                            size={13}
                            style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}
                        />
                        Группа · {products.length} товара
                    </button>
                </td>
            </tr>

            {/* Primary */}
            <ProductRow
                product={primary}
                isReadOnly={isReadOnly}
                onLinkClick={() => onLinkClick(primary)}
                onUnlink={() => onUnlink(primary)}
                onSetPrimary={() => onSetPrimary(primary)}
                isInGroup
            />

            {/* Secondaries */}
            {expanded && secondaries.map(p => (
                <ProductRow
                    key={p.id}
                    product={p}
                    isReadOnly={isReadOnly}
                    onLinkClick={() => onLinkClick(p)}
                    onUnlink={() => onUnlink(p)}
                    onSetPrimary={() => onSetPrimary(p)}
                    isSecondary
                    isInGroup
                />
            ))}
        </>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ProductCatalog() {
    const { activeTenant } = useAuth();
    const isReadOnly = WRITE_BLOCKED_STATES.includes(activeTenant?.accessState ?? '');

    const [products, setProducts] = useState<CatalogProduct[]>([]);
    const [meta, setMeta] = useState<Meta>({ total: 0, page: 1, lastPage: 1 });
    const [loading, setLoading] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [pageSizeOpen, setPageSizeOpen] = useState(false);
    const [unmappedOnly, setUnmappedOnly] = useState(false);
    const [linkTarget, setLinkTarget] = useState<CatalogProduct | null>(null);

    const fetchProducts = useCallback(async () => {
        setLoading(true);
        setFetchError(null);
        try {
            const params: Record<string, any> = { page, limit: pageSize, ...(search ? { search } : {}) };

            if (unmappedOnly) {
                const res = await axios.get('/catalog/mappings/unmatched', { params });
                setProducts((res.data.data ?? []).map((p: any) => ({
                    ...p, photo: p.photo ?? null, mainImageFileId: p.mainImageFileId ?? null,
                    total: p.total ?? 0, channelMappings: [], groupId: null, groupRole: null,
                })));
                setMeta(res.data.meta);
            } else {
                const res = await axios.get('/products', { params });
                setProducts((res.data.data ?? []).map((p: any) => ({
                    ...p,
                    channelMappings: p.channelMappings ?? [],
                    groupId: p.groupId ?? null,
                    groupRole: p.groupRole ?? null,
                })));
                setMeta(res.data.meta);
            }
        } catch (e: any) {
            setFetchError(e?.response?.data?.message ?? e?.message ?? 'Ошибка загрузки');
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, search, unmappedOnly]);

    useEffect(() => { fetchProducts(); }, [fetchProducts]);

    useEffect(() => {
        if (!pageSizeOpen) return;
        const h = () => setPageSizeOpen(false);
        window.addEventListener('click', h);
        return () => window.removeEventListener('click', h);
    }, [pageSizeOpen]);

    async function handleUnlink(product: CatalogProduct) {
        if (!window.confirm(`Отвязать «${product.name}» из группы?`)) return;
        try {
            await axios.delete(`/catalog/groups/unlink/${product.id}`);
            fetchProducts();
        } catch (e: any) {
            alert(e?.response?.data?.message ?? 'Ошибка');
        }
    }

    async function handleSetPrimary(product: CatalogProduct) {
        try {
            await axios.post(`/catalog/groups/primary/${product.id}`);
            fetchProducts();
        } catch (e: any) {
            alert(e?.response?.data?.message ?? 'Ошибка');
        }
    }

    // Группируем продукты: группы идут как блоки, одиночные — отдельные строки
    const rows = buildRows(products);

    const thSt: React.CSSProperties = {
        padding: '10px 16px', textAlign: 'left', fontWeight: 600,
        fontSize: 11, color: S.textSecondary, letterSpacing: '0.05em',
        textTransform: 'uppercase', verticalAlign: 'middle', whiteSpace: 'nowrap',
    };

    const firstIdx = (page - 1) * pageSize + 1;
    const lastIdx = Math.min(page * pageSize, meta.total);

    return (
        <div>
            <PageHeader title="Товары" subtitle="Каталог и связка с маркетплейсами" />

            {fetchError && (
                <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fca5a5', color: '#dc2626', fontSize: 13, marginBottom: 12 }}>
                    Ошибка: {fetchError}
                </div>
            )}

            <Card noPad>
                {/* Toolbar */}
                <div style={{ padding: '14px 20px', borderBottom: `1px solid ${S.border}`, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                        <Input
                            value={search}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setSearch(e.target.value); setPage(1); }}
                            placeholder="Поиск по названию, SKU, бренду…"
                            icon={Search}
                        />
                    </div>
                    <button
                        onClick={() => { setUnmappedOnly(v => !v); setPage(1); }}
                        style={{
                            height: 36, padding: '0 14px', borderRadius: 8, cursor: 'pointer',
                            border: `1px solid ${unmappedOnly ? '#3b82f6' : S.border}`,
                            background: unmappedOnly ? '#eff6ff' : '#fff',
                            color: unmappedOnly ? '#2563eb' : S.textSecondary,
                            fontSize: 13, fontWeight: unmappedOnly ? 600 : 400,
                            display: 'flex', alignItems: 'center', gap: 6,
                            fontFamily: 'Inter',
                        }}
                    >
                        <Unlink size={14} />
                        Без связки
                    </button>
                </div>

                {/* Table */}
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                    <colgroup>
                        <col style={{ width: 104 }} />
                        <col />
                        <col style={{ width: '16%' }} />
                        <col style={{ width: 130 }} />
                        <col style={{ width: '9%' }} />
                        <col style={{ width: '14%' }} />
                    </colgroup>
                    <thead>
                        <tr style={{ background: '#fafbfc', borderBottom: `1px solid ${S.border}` }}>
                            <th style={thSt}>Фото</th>
                            <th style={thSt}>Название</th>
                            <th style={thSt}>SKU</th>
                            <th style={{ ...thSt, borderLeft: `1px solid ${S.border}` }}>Маркетплейсы</th>
                            <th style={{ ...thSt, borderLeft: `1px solid ${S.border}` }}>Склад</th>
                            <th style={{ ...thSt, borderLeft: `1px solid ${S.border}` }}>Действия</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={6} style={{ textAlign: 'center', padding: '40px 16px', color: S.textSecondary, fontSize: 14 }}>Загрузка…</td></tr>
                        )}
                        {!loading && products.length === 0 && (
                            <tr><td colSpan={6} style={{ textAlign: 'center', padding: '48px 16px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: S.textSecondary }}>
                                    <Package size={32} color={S.border} strokeWidth={1.5} />
                                    <div style={{ fontSize: 14, fontWeight: 500 }}>
                                        {unmappedOnly ? 'Все товары привязаны — отлично!' : 'Товары не найдены'}
                                    </div>
                                </div>
                            </td></tr>
                        )}
                        {!loading && rows.map((row, i) =>
                            row.type === 'solo' ? (
                                <ProductRow
                                    key={row.product.id}
                                    product={row.product}
                                    isReadOnly={isReadOnly}
                                    onLinkClick={() => setLinkTarget(row.product)}
                                    onUnlink={() => handleUnlink(row.product)}
                                    onSetPrimary={() => handleSetPrimary(row.product)}
                                />
                            ) : (
                                <GroupRows
                                    key={`group-${i}`}
                                    products={row.products}
                                    isReadOnly={isReadOnly}
                                    onLinkClick={setLinkTarget}
                                    onUnlink={handleUnlink}
                                    onSetPrimary={handleSetPrimary}
                                />
                            )
                        )}
                    </tbody>
                </table>

                {/* Pagination */}
                {meta.total > 0 && (
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '12px 16px', borderTop: `1px solid ${S.border}`, flexWrap: 'wrap', gap: 10,
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
                            <span style={{ fontSize: 12, color: S.textSecondary }}>Строк на странице:</span>
                            <button
                                onClick={e => { e.stopPropagation(); setPageSizeOpen(v => !v); }}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 4,
                                    height: 30, padding: '0 10px', borderRadius: 7,
                                    border: `1px solid ${S.border}`, background: '#fff',
                                    fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                                }}
                            >
                                {pageSize} <ChevronDown size={12} color={S.textSecondary} />
                            </button>
                            {pageSizeOpen && (
                                <div style={{
                                    position: 'absolute', bottom: '110%', left: 0, zIndex: 20,
                                    background: '#fff', border: `1px solid ${S.border}`,
                                    borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
                                    overflow: 'hidden', minWidth: 70,
                                }}>
                                    {[5, 10, 20, 50, 100].map(n => (
                                        <button key={n} onClick={e => { e.stopPropagation(); setPageSize(n); setPage(1); setPageSizeOpen(false); }}
                                            style={{
                                                width: '100%', padding: '7px 14px', border: 'none',
                                                background: n === pageSize ? '#eff6ff' : '#fff',
                                                color: n === pageSize ? '#2563eb' : S.text,
                                                fontSize: 13, cursor: 'pointer', textAlign: 'left',
                                                fontWeight: n === pageSize ? 600 : 400, fontFamily: 'inherit',
                                            }}
                                        >{n}</button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{ fontSize: 12, color: S.textSecondary }}>{firstIdx}–{lastIdx} из {meta.total}</span>
                            <div style={{ display: 'flex', gap: 4 }}>
                                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                                    style={{ width: 30, height: 30, borderRadius: 7, border: `1px solid ${S.border}`, background: page <= 1 ? '#f8fafc' : '#fff', cursor: page <= 1 ? 'not-allowed' : 'pointer', fontSize: 14, color: page <= 1 ? S.border : S.text }}>
                                    ‹
                                </button>
                                {Array.from({ length: Math.min(meta.lastPage, 7) }, (_, i) => i + 1).map(p => (
                                    <button key={p} onClick={() => setPage(p)}
                                        style={{ width: 30, height: 30, borderRadius: 7, border: `1px solid ${p === page ? '#3b82f6' : S.border}`, background: p === page ? '#3b82f6' : '#fff', color: p === page ? '#fff' : S.text, cursor: 'pointer', fontSize: 13, fontWeight: p === page ? 700 : 400 }}>
                                        {p}
                                    </button>
                                ))}
                                <button disabled={page >= meta.lastPage} onClick={() => setPage(p => p + 1)}
                                    style={{ width: 30, height: 30, borderRadius: 7, border: `1px solid ${S.border}`, background: page >= meta.lastPage ? '#f8fafc' : '#fff', cursor: page >= meta.lastPage ? 'not-allowed' : 'pointer', fontSize: 14, color: page >= meta.lastPage ? S.border : S.text }}>
                                    ›
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </Card>

            {/* Link picker modal */}
            {linkTarget && (
                <LinkPickerModal
                    product={linkTarget}
                    onLinked={() => { setLinkTarget(null); fetchProducts(); }}
                    onClose={() => setLinkTarget(null)}
                />
            )}
        </div>
    );
}

// ─── Build display rows ───────────────────────────────────────────────────────

type DisplayRow =
    | { type: 'solo'; product: CatalogProduct }
    | { type: 'group'; products: CatalogProduct[] };

function buildRows(products: CatalogProduct[]): DisplayRow[] {
    const rows: DisplayRow[] = [];
    const seen = new Set<string>();

    // Собираем группы
    const groups = new Map<string, CatalogProduct[]>();
    for (const p of products) {
        if (p.groupId) {
            if (!groups.has(p.groupId)) groups.set(p.groupId, []);
            groups.get(p.groupId)!.push(p);
        }
    }

    for (const p of products) {
        if (seen.has(p.id)) continue;
        if (p.groupId && groups.has(p.groupId)) {
            const members = groups.get(p.groupId)!;
            members.forEach(m => seen.add(m.id));
            rows.push({ type: 'group', products: members });
        } else {
            seen.add(p.id);
            rows.push({ type: 'solo', product: p });
        }
    }
    return rows;
}
