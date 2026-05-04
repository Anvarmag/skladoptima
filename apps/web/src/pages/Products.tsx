import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
    Plus, Edit2, Archive, ArrowDownUp, Search,
    RefreshCw, ImageDown, RotateCcw, AlertTriangle,
    CheckCircle, XCircle, AlertCircle, Link2, Unlink, Download,
    Package, Lock, Unlock, Trash2,
} from 'lucide-react';
import {
    fetchLocksForProduct, createLock, removeLock,
    type StockLock, type LockType, type Marketplace as LockMarketplace,
} from '../api/stockLocks';
import { useAuth } from '../context/AuthContext';
import AccessStateBanner from '../components/AccessStateBanner';
import ProductMediaWidget from '../components/ProductMediaWidget';
import { S, PageHeader, Card, Btn, Badge, MPBadge, Input, Modal, TH, FieldLabel, SkuTag, Pagination } from '../components/ui';

// ─────────────────────────────── types ───────────────────────────────

interface Product {
    id: string;
    sku: string;
    name: string;
    brand?: string | null;
    category?: string | null;
    status: 'ACTIVE' | 'DELETED';
    deletedAt?: string | null;
    sourceOfTruth?: 'MANUAL' | 'IMPORT' | 'SYNC';
    total: number;
    reserved: number;
    available: number;
    photo: string | null;
    mainImageFileId: string | null;
    ozonFbs: number;
    ozonFbo: number;
    wbFbs: number;
    wbFbo: number;
    wbBarcode?: string;
}

interface ImportPreviewItem {
    rowNumber: number;
    action: 'CREATE' | 'UPDATE' | 'MANUAL_REVIEW' | 'SKIP';
    raw: { sku: string; name: string; brand?: string; barcode?: string; category?: string };
    errors: Array<{ type: string; field: string; message: string }>;
    sourceConflict: { type: string; message: string } | null;
}

interface ImportPreviewResult {
    jobId: string;
    totalRows: number;
    summary: { create: number; update: number; skip: number; manualReview: number };
    items: ImportPreviewItem[];
}

interface ImportCommitResult {
    jobId: string;
    createdCount: number;
    updatedCount: number;
    errorCount: number;
}

interface ChannelMapping {
    id: string;
    marketplace: 'WB' | 'OZON';
    externalProductId: string;
    externalSku: string | null;
    isAutoMatched: boolean;
    createdAt: string;
}

// ─────────────────────────────── helpers ─────────────────────────────

const ACTION_LABELS: Record<string, string> = {
    CREATE: 'Создать',
    UPDATE: 'Обновить',
    MANUAL_REVIEW: 'Требует проверки',
    SKIP: 'Пропустить',
};

const WRITE_BLOCKED_STATES = ['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED'];

function generateIdempotencyKey(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ─────────────────────────────── hooks ───────────────────────────────

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

// ─────────────────────────────── component ───────────────────────────

export default function Products() {
    const { activeTenant } = useAuth();
    const accessState = activeTenant?.accessState ?? '';
    const isReadOnly = WRITE_BLOCKED_STATES.includes(accessState);
    const isDesktop = useIsDesktop();

    // List state
    const [products, setProducts] = useState<Product[]>([]);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(false);
    const [statusFilter, setStatusFilter] = useState<'active' | 'deleted'>('active');

    // Inline edit state
    const [editingStock, setEditingStock] = useState<{ id: string; field: keyof Product; value: string } | null>(null);
    const [syncingId, setSyncingId] = useState<string | null>(null);
    const [syncResult, setSyncResult] = useState<{ id: string; data: any } | null>(null);

    // Create/edit modal
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [formData, setFormData] = useState({
        name: '', sku: '', wbBarcode: '', initialTotal: '0', file: null as File | null,
    });
    const [formError, setFormError] = useState<string | null>(null);

    // SKU reuse confirmation
    const [skuReuseId, setSkuReuseId] = useState<string | null>(null);
    const [pendingFormData, setPendingFormData] = useState<FormData | null>(null);

    // Stock adjust modal
    const [isAdjustOpen, setIsAdjustOpen] = useState(false);
    const [adjustDelta, setAdjustDelta] = useState(0);

    // Import modal (preview → commit flow)
    const [importPreview, setImportPreview] = useState<ImportPreviewResult | null>(null);
    const [importCommitting, setImportCommitting] = useState(false);
    const [importResult, setImportResult] = useState<ImportCommitResult | null>(null);
    const [importLoading, setImportLoading] = useState(false);

    // Unmatched mappings badge
    const [unmatchedCount, setUnmatchedCount] = useState(0);

    // Channel mappings (for edit modal)
    const [mappings, setMappings] = useState<ChannelMapping[]>([]);
    const [mappingsLoading, setMappingsLoading] = useState(false);
    const [addMappingOpen, setAddMappingOpen] = useState(false);
    const [addMpMarketplace, setAddMpMarketplace] = useState<'WB' | 'OZON'>('WB');
    const [addMpExtId, setAddMpExtId] = useState('');
    const [addMpExtSku, setAddMpExtSku] = useState('');
    const [addMpError, setAddMpError] = useState<string | null>(null);
    const [addMpSubmitting, setAddMpSubmitting] = useState(false);

    // Photos
    const [fetchingPhotos, setFetchingPhotos] = useState(false);

    // Import from WB
    const [importingFromWb, setImportingFromWb] = useState(false);

    // Stock locks
    const [lockModalProduct, setLockModalProduct] = useState<Product | null>(null);
    const [lockModalLocks, setLockModalLocks] = useState<StockLock[]>([]);
    const [lockFormMarketplace, setLockFormMarketplace] = useState<LockMarketplace>('WB');
    const [lockFormType, setLockFormType] = useState<LockType>('ZERO');
    const [lockFormFixed, setLockFormFixed] = useState('');
    const [lockFormNote, setLockFormNote] = useState('');
    const [lockFormError, setLockFormError] = useState<string | null>(null);
    const [lockFormSubmitting, setLockFormSubmitting] = useState(false);
    const [locksMap, setLocksMap] = useState<Record<string, StockLock[]>>({});

    // ─────────── data fetching ───────────

    const fetchProducts = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                page: String(page),
                search: search || '',
                ...(statusFilter === 'deleted' ? { status: 'deleted' } : {}),
            });
            const { data } = await axios.get(`/products?${params}`);
            setProducts(data.data);
            setTotalPages(data.meta.lastPage || 1);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [page, search, statusFilter]);

    useEffect(() => {
        const timer = setTimeout(() => fetchProducts(), 300);
        return () => clearTimeout(timer);
    }, [fetchProducts]);


    useEffect(() => {
        axios.get('/catalog/mappings/unmatched?page=1&limit=1')
            .then(res => setUnmatchedCount(res.data?.meta?.total ?? 0))
            .catch(() => {});
    }, []);

    // Reset page when filters change
    useEffect(() => { setPage(1); }, [search, statusFilter]);

    // ─────────── create / edit ───────────

    const buildFormData = (overrides?: Partial<typeof formData & { confirmRestoreId?: string }>) => {
        const f = { ...formData, ...overrides };
        const data = new FormData();
        data.append('name', f.name);
        data.append('sku', f.sku);
        if (f.wbBarcode) data.append('wbBarcode', f.wbBarcode);
        if (f.file) data.append('photo', f.file);
        if ('confirmRestoreId' in f && f.confirmRestoreId) {
            data.append('confirmRestoreId', f.confirmRestoreId!);
        }
        return data;
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError(null);
        const data = buildFormData();

        try {
            if (modalMode === 'create') {
                data.append('initialTotal', formData.initialTotal);
                await axios.post('/products', data);
                if (!formData.file) {
                    try { await axios.post('/sync/metadata'); } catch { /* ignore */ }
                }
            } else if (selectedProduct) {
                await axios.put(`/products/${selectedProduct.id}`, data);
            }
            setIsModalOpen(false);
            fetchProducts();
        } catch (err: any) {
            const code = err.response?.data?.code;
            if (code === 'SKU_SOFT_DELETED') {
                setSkuReuseId(err.response.data.deletedProductId);
                setPendingFormData(data);
                return;
            }
            if (code === 'SKU_ALREADY_EXISTS') {
                setFormError('Товар с таким артикулом уже существует в каталоге.');
                return;
            }
            setFormError('Ошибка при сохранении. Проверьте данные и попробуйте снова.');
        }
    };

    const handleConfirmSkuReuse = async () => {
        if (!skuReuseId || !pendingFormData) return;
        try {
            pendingFormData.append('confirmRestoreId', skuReuseId);
            pendingFormData.append('initialTotal', formData.initialTotal);
            await axios.post('/products', pendingFormData);
            setSkuReuseId(null);
            setPendingFormData(null);
            setIsModalOpen(false);
            fetchProducts();
        } catch (err: any) {
            setFormError('Не удалось создать карточку. Попробуйте снова.');
            setSkuReuseId(null);
        }
    };

    // ─────────── restore ───────────

    const handleRestore = async (id: string) => {
        if (!window.confirm('Восстановить товар из архива?')) return;
        try {
            await axios.post(`/products/${id}/restore`);
            fetchProducts();
        } catch (err) {
            console.error(err);
        }
    };

    // ─────────── delete ───────────

    const handleDelete = async (id: string) => {
        if (!window.confirm('Переместить товар в архив?')) return;
        try {
            await axios.delete(`/products/${id}`);
            fetchProducts();
        } catch (err) {
            console.error(err);
        }
    };

    // ─────────── stock adjust ───────────

    const handleAdjust = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (!selectedProduct) return;
            await axios.post(`/products/${selectedProduct.id}/stock-adjust`, {
                delta: adjustDelta,
                note: 'Ручная корректировка',
            });
            setIsAdjustOpen(false);
            fetchProducts();
        } catch {
            alert('Остаток не может быть меньше 0');
        }
    };

    // ─────────── inline stock edit ───────────

    const handleStockUpdate = async (id: string, field: keyof Product, value: string) => {
        const numValue = parseInt(value) || 0;
        const isSyncField = field === 'total' || field === 'wbFbs' || field === 'ozonFbs';

        setProducts(prev => prev.map(p => {
            if (p.id !== id) return p;
            const updated: Product = { ...p, [field]: numValue };
            if (isSyncField) {
                updated.wbFbs = numValue;
                updated.ozonFbs = numValue;
                updated.total = numValue;
            }
            return updated;
        }));
        setEditingStock(null);

        try {
            const product = products.find(p => p.id === id);
            if (!product) return;
            if (isSyncField) {
                const delta = numValue - product.total;
                if (delta !== 0) {
                    await axios.post(`/products/${id}/stock-adjust`, { delta, note: 'Синхронизация' });
                }
                await axios.put(`/products/${id}`, { wbFbs: numValue, ozonFbs: numValue });
            } else {
                await axios.put(`/products/${id}`, { [field]: numValue });
            }
            handleSync(id);
            fetchProducts();
        } catch {
            alert('Ошибка при обновлении');
            fetchProducts();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent, id: string, field: keyof Product) => {
        if (e.key === 'Enter') handleStockUpdate(id, field, editingStock!.value);
        else if (e.key === 'Escape') setEditingStock(null);
    };

    // ─────────── sync ───────────

    const handleSync = async (id: string) => {
        setSyncingId(id);
        setSyncResult(null);
        try {
            const { data } = await axios.post(`/sync/product/${id}`);
            setSyncResult({ id, data } as any);
            setTimeout(() => setSyncResult(null), 8000);
        } catch {
            setSyncResult({ id, data: { wb: { success: false, error: 'Ошибка сервера' }, ozon: { success: false, error: 'Ошибка сервера' } } } as any);
            setTimeout(() => setSyncResult(null), 8000);
        } finally {
            setSyncingId(null);
        }
    };

    // ─────────── import products from WB ───────────

    const handleImportFromWb = async () => {
        setImportingFromWb(true);
        try {
            const res = await axios.post('/sync/import/wb');
            if (!res.data?.success) {
                alert(`Не удалось загрузить товары из WB: ${res.data?.error ?? 'неизвестная ошибка'}`);
                return;
            }
            const created = res.data?.created ?? 0;
            const updated = res.data?.updated ?? 0;
            alert(
                created > 0 || updated > 0
                    ? `Загружено из WB: новых ${created}, обновлено ${updated}`
                    : 'Новых товаров из WB не найдено. Проверьте, что в WB есть карточки товаров.',
            );
            fetchProducts();
        } catch (err: any) {
            const msg = err?.response?.data?.message ?? err?.response?.data?.error ?? err?.message ?? 'неизвестная ошибка';
            alert(`Ошибка при загрузке товаров из WB: ${msg}`);
        } finally {
            setImportingFromWb(false);
        }
    };

    // ─────────── fetch photos ───────────

    const handleFetchPhotos = async () => {
        setFetchingPhotos(true);
        try {
            const res = await axios.post('/sync/metadata');
            const updated = res.data?.updated ?? 0;
            alert(updated > 0 ? `Обновлено фото: ${updated}` : 'Новых фото не найдено');
            fetchProducts();
        } catch {
            alert('Ошибка при подтягивании фото');
        } finally {
            setFetchingPhotos(false);
        }
    };

    // ─────────── media updated ───────────

    const handleMediaUpdated = useCallback((productId: string, newFileId: string | null) => {
        setProducts(prev =>
            prev.map(p => (p.id === productId ? { ...p, mainImageFileId: newFileId } : p)),
        );
    }, []);

    // ─────────── stock locks ───────────

    const openLockModal = async (p: Product) => {
        setLockModalProduct(p);
        setLockFormMarketplace('WB');
        setLockFormType('ZERO');
        setLockFormFixed('');
        setLockFormNote('');
        setLockFormError(null);
        try {
            const locks = await fetchLocksForProduct(p.id);
            setLockModalLocks(locks);
            setLocksMap(m => ({ ...m, [p.id]: locks }));
        } catch {
            setLockModalLocks([]);
        }
    };

    const handleRemoveLock = async (lockId: string, productId: string) => {
        const prev = lockModalLocks;
        setLockModalLocks(l => l.filter(x => x.id !== lockId));
        setLocksMap(m => ({ ...m, [productId]: (m[productId] ?? []).filter(x => x.id !== lockId) }));
        try {
            await removeLock(lockId);
        } catch {
            setLockModalLocks(prev);
            setLocksMap(m => ({ ...m, [productId]: prev }));
            alert('Не удалось снять блокировку');
        }
    };

    const handleCreateLock = async () => {
        if (!lockModalProduct) return;
        setLockFormError(null);
        if (lockFormType === 'FIXED' && (lockFormFixed === '' || parseInt(lockFormFixed, 10) < 0)) {
            setLockFormError('Для типа «Фиксированное» укажите значение ≥ 0');
            return;
        }
        setLockFormSubmitting(true);
        try {
            const newLock = await createLock({
                productId: lockModalProduct.id,
                marketplace: lockFormMarketplace,
                lockType: lockFormType,
                fixedValue: lockFormType === 'FIXED' ? parseInt(lockFormFixed, 10) : null,
                note: lockFormNote.trim() || null,
            });
            const merged = [...lockModalLocks.filter(l => l.marketplace !== lockFormMarketplace), newLock];
            setLockModalLocks(merged);
            setLocksMap(m => ({ ...m, [lockModalProduct.id]: merged }));
            setLockFormFixed('');
            setLockFormNote('');
        } catch (err: any) {
            setLockFormError(err?.response?.data?.message ?? 'Не удалось создать блокировку');
        } finally {
            setLockFormSubmitting(false);
        }
    };

    // ─────────── import preview/commit ───────────

    const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';

        setImportLoading(true);
        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const bstr = evt.target?.result;
                // @ts-ignore
                const XLSX = window.XLSX;
                if (!XLSX) {
                    alert('Библиотека Excel ещё загружается. Попробуйте через несколько секунд.');
                    setImportLoading(false);
                    return;
                }

                const wb = XLSX.read(bstr, { type: 'binary' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const rawData = XLSX.utils.sheet_to_json(ws);

                const rows = (rawData as any[]).map((row: any) => ({
                    sku: String(row['Артикул продавца'] || row['Vendor code'] || row['sku'] || '').trim(),
                    name: String(row['Наименование'] || row['Name'] || row['name'] || '').trim(),
                    brand: String(row['Бренд'] || row['Brand'] || row['brand'] || '').trim() || undefined,
                    barcode: String(row['Баркод'] || row['Barcode'] || row['barcode'] || '').trim() || undefined,
                    category: String(row['Категория'] || row['Category'] || row['category'] || '').trim() || undefined,
                })).filter((r: any) => r.sku || r.name);

                if (rows.length === 0) {
                    alert('Не найдены строки с данными. Проверьте заголовки: Артикул продавца, Наименование.');
                    setImportLoading(false);
                    return;
                }

                const { data } = await axios.post('/catalog/imports/preview', { rows });
                setImportPreview(data);
                setImportResult(null);
            } catch (err: any) {
                const msg = err.response?.data?.message ?? 'Ошибка при создании предпросмотра';
                alert(msg);
            } finally {
                setImportLoading(false);
            }
        };
        reader.readAsBinaryString(file);
    };

    const handleCommitImport = async () => {
        if (!importPreview) return;
        setImportCommitting(true);
        try {
            const { data } = await axios.post('/catalog/imports/commit', {
                jobId: importPreview.jobId,
                idempotencyKey: generateIdempotencyKey(),
            });
            setImportResult(data);
            setImportPreview(null);
            fetchProducts();
            axios.get('/catalog/mappings/unmatched?page=1&limit=1')
                .then(res => setUnmatchedCount(res.data?.meta?.total ?? 0))
                .catch(() => {});
        } catch (err: any) {
            const code = err.response?.data?.code;
            if (code === 'IMPORT_JOB_ALREADY_PROCESSING') {
                alert('Импорт уже обрабатывается. Подождите и проверьте результат.');
            } else {
                alert('Ошибка при применении импорта. Попробуйте снова.');
            }
        } finally {
            setImportCommitting(false);
        }
    };

    // ─────────── mapping handlers ───────────

    const loadMappings = useCallback(async (productId: string) => {
        setMappingsLoading(true);
        try {
            const res = await axios.get(`/catalog/mappings/product/${productId}`);
            setMappings(res.data.data ?? []);
        } catch {
            setMappings([]);
        } finally {
            setMappingsLoading(false);
        }
    }, []);

    const handleDetachMapping = async (mappingId: string) => {
        if (!window.confirm('Отвязать этот артикул?')) return;
        setMappings(prev => prev.filter(m => m.id !== mappingId));
        try {
            await axios.delete(`/catalog/mappings/${mappingId}`);
        } catch {
            if (selectedProduct) loadMappings(selectedProduct.id);
            alert('Не удалось отвязать артикул');
        }
    };

    const handleAddMapping = async () => {
        if (!selectedProduct || !addMpExtId.trim()) return;
        setAddMpError(null);
        setAddMpSubmitting(true);
        try {
            const res = await axios.post('/catalog/mappings/manual', {
                productId: selectedProduct.id,
                marketplace: addMpMarketplace,
                externalProductId: addMpExtId.trim(),
                externalSku: addMpExtSku.trim() || undefined,
            });
            setMappings(prev => [...prev, res.data]);
            setAddMpExtId('');
            setAddMpExtSku('');
            setAddMappingOpen(false);
        } catch (err: any) {
            const code = err?.response?.data?.code;
            const existingName = err?.response?.data?.existingProductId
                ? `(ID: ${err.response.data.existingProductId})`
                : '';
            setAddMpError(
                code === 'MAPPING_ALREADY_EXISTS'
                    ? `Этот артикул уже связан с другим товаром ${existingName}. Сначала отвяжите его.`
                    : err?.response?.data?.message ?? 'Не удалось добавить артикул',
            );
        } finally {
            setAddMpSubmitting(false);
        }
    };

    // ─────────── open modals ───────────

    const openCreate = () => {
        if (isReadOnly) return;
        setModalMode('create');
        setSelectedProduct(null);
        setFormData({ name: '', sku: '', wbBarcode: '', initialTotal: '0', file: null });
        setFormError(null);
        setIsModalOpen(true);
    };

    const openEdit = (p: Product) => {
        if (isReadOnly) return;
        setModalMode('edit');
        setSelectedProduct(p);
        setFormData({ name: p.name, sku: p.sku, wbBarcode: (p as any).wbBarcode || '', initialTotal: '0', file: null });
        setFormError(null);
        setMappings([]);
        setAddMappingOpen(false);
        setAddMpExtId('');
        setAddMpExtSku('');
        setAddMpError(null);
        setIsModalOpen(true);
        loadMappings(p.id);
    };

    const openAdjust = (p: Product) => {
        if (isReadOnly) return;
        setSelectedProduct(p);
        setAdjustDelta(0);
        setIsAdjustOpen(true);
    };

    // ─────────── helpers ───────────

    const availColor = (n: number) =>
        n === 0
            ? { bg: 'rgba(239,68,68,0.08)', color: S.red }
            : n <= 5
            ? { bg: 'rgba(245,158,11,0.08)', color: S.amber }
            : { bg: 'rgba(16,185,129,0.08)', color: S.green };

    // ─────────── derived ───────────

    const total = products.length;
    const lowStock = products.filter(p => p.available <= 5).length;

    // ─────────── render ───────────

    if (!isDesktop) {
        return (
            <div style={{ background: '#f8fafc', minHeight: '100vh' }}>
                {/* Заголовок */}
                <div style={{ padding: '8px 20px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                        <div>
                            <div style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 26, color: '#0f172a', letterSpacing: '-0.02em', lineHeight: 1.1 }}>Остатки</div>
                            <div style={{ fontFamily: 'Inter', fontSize: 12, color: '#64748b', marginTop: 4 }}>{total} SKU • {lowStock} низкий остаток</div>
                        </div>
                        {!isReadOnly && (
                            <button onClick={openCreate} style={{ width: 36, height: 36, borderRadius: 10, background: '#0f172a', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                                <Plus size={16} color="#fff" strokeWidth={2.5} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Поиск */}
                <div style={{ padding: '4px 20px 12px' }}>
                    <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск товара…" />
                </div>

                {/* Sync chips */}
                <div style={{ padding: '0 20px 12px', display: 'flex', gap: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch' as any }}>
                    {([['WB', '#cb11ab'], ['Ozon', '#005bff']] as const).map(([label, color]) => (
                        <button key={label} onClick={() => {}} style={{
                            padding: '6px 12px', borderRadius: 999, border: `1px solid ${color}40`,
                            background: `${color}0d`, color, fontFamily: 'Inter', fontSize: 12, fontWeight: 600,
                            display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', flexShrink: 0,
                            whiteSpace: 'nowrap',
                        }}>
                            <RefreshCw size={11} />Синхронизировать {label}
                        </button>
                    ))}
                </div>

                {/* Фильтр активные/архив */}
                <div style={{ padding: '0 20px 14px', display: 'flex', gap: 6 }}>
                    {(['active', 'deleted'] as const).map(f => (
                        <button key={f} onClick={() => setStatusFilter(f)} style={{
                            padding: '7px 16px', borderRadius: 999, border: 'none', cursor: 'pointer',
                            background: statusFilter === f ? '#0f172a' : '#f1f5f9',
                            color: statusFilter === f ? '#fff' : '#64748b',
                            fontFamily: 'Inter', fontSize: 12, fontWeight: 600, transition: 'all 0.15s',
                        }}>{f === 'active' ? 'Активные' : 'Архив'}</button>
                    ))}
                </div>

                {/* Карточки товаров */}
                <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {loading && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontFamily: 'Inter', fontSize: 13 }}>Загрузка…</div>}
                    {!loading && products.length === 0 && (
                        <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontFamily: 'Inter', fontSize: 13 }}>Товары не найдены</div>
                    )}
                    {products.map(p => {
                        const avail = p.available;
                        const ac = avail === 0
                            ? { bg: 'rgba(239,68,68,0.08)', color: '#ef4444' }
                            : avail <= 5
                            ? { bg: 'rgba(245,158,11,0.1)', color: '#f59e0b' }
                            : { bg: 'rgba(16,185,129,0.08)', color: '#10b981' };
                        return (
                            <div key={p.id} style={{
                                background: '#fff', borderRadius: 16, padding: '14px 14px 12px',
                                border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                                    {/* Фото / иконка */}
                                    <div style={{ width: 72, height: 96, borderRadius: 10, overflow: 'hidden', background: '#f1f5f9', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        {p.photo
                                            ? <img src={p.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                            : <Package size={32} color="#94a3b8" />}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontFamily: 'Inter', fontWeight: 600, fontSize: 14, color: '#0f172a', lineHeight: 1.3 }}>{p.name}</div>
                                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{p.sku}</div>
                                        {p.brand && <div style={{ fontFamily: 'Inter', fontSize: 11, color: '#64748b', marginTop: 2 }}>{p.brand}</div>}
                                    </div>
                                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                        <div style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 22, color: '#0f172a', letterSpacing: '-0.02em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{avail}</div>
                                        <div style={{ fontFamily: 'Inter', fontSize: 10, color: '#94a3b8', marginTop: 2 }}>доступно</div>
                                    </div>
                                </div>
                                {/* Нижняя строка */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTop: '1px solid #e2e8f0' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: 'Inter', fontSize: 11, color: '#cb11ab', fontWeight: 600 }}>
                                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#cb11ab', display: 'inline-block' }} />{p.wbFbs + p.wbFbo}
                                        </span>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: 'Inter', fontSize: 11, color: '#005bff', fontWeight: 600 }}>
                                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#005bff', display: 'inline-block' }} />{p.ozonFbs + p.ozonFbo}
                                        </span>
                                        <span style={{ fontFamily: 'Inter', fontSize: 11, color: '#64748b' }}>склад: {p.total}</span>
                                    </div>
                                    <Badge label={avail === 0 ? 'Нет' : avail <= 5 ? 'Мало' : 'В наличии'} bg={ac.bg} color={ac.color} />
                                </div>
                                {/* Кнопки действий */}
                                {!isReadOnly && (
                                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                                        <button onClick={() => openEdit(p)} style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1px solid #e2e8f0', background: 'transparent', fontFamily: 'Inter', fontSize: 12, fontWeight: 500, color: '#0f172a', cursor: 'pointer' }}>
                                            Редактировать
                                        </button>
                                        <button onClick={() => openAdjust(p)} style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', background: '#f1f5f9', fontFamily: 'Inter', fontSize: 12, fontWeight: 500, color: '#0f172a', cursor: 'pointer' }}>
                                            Остатки
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
                <div style={{ height: 24 }} />

                {/* ─── Modal: Create / Edit ─── */}
                <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)} title={modalMode === 'create' ? 'Новый товар' : 'Редактировать товар'} width={500}>
                    <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <div>
                            <FieldLabel>Название *</FieldLabel>
                            <Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="Название товара" />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <div>
                                <FieldLabel>Артикул (SKU) *</FieldLabel>
                                <Input value={formData.sku} onChange={e => setFormData({ ...formData, sku: e.target.value })} placeholder="Артикул продавца" />
                            </div>
                            <div>
                                <FieldLabel>WB Баркод</FieldLabel>
                                <Input value={formData.wbBarcode} onChange={e => setFormData({ ...formData, wbBarcode: e.target.value })} placeholder="2043309181375" />
                            </div>
                        </div>
                        {modalMode === 'create' && (
                            <div>
                                <FieldLabel>Начальный остаток</FieldLabel>
                                <Input type="number" min={0} value={formData.initialTotal} onChange={e => setFormData({ ...formData, initialTotal: e.target.value })} />
                            </div>
                        )}
                        {formError && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'Inter', fontSize: 13, color: S.red, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '10px 12px' }}>
                                <AlertCircle size={15} /> {formError}
                            </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
                            <Btn type="button" variant="secondary" onClick={() => setIsModalOpen(false)}>Отмена</Btn>
                            <Btn type="submit" variant="primary">Сохранить</Btn>
                        </div>
                    </form>
                </Modal>

                {/* ─── Modal: SKU Reuse ─── */}
                <Modal open={!!skuReuseId} onClose={() => { setSkuReuseId(null); setPendingFormData(null); }} title="" width={400}>
                    <div style={{ textAlign: 'center', padding: '8px 0' }}>
                        <div style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 17, color: S.ink, marginBottom: 8 }}>Артикул уже использовался</div>
                        <div style={{ fontFamily: 'Inter', fontSize: 13, color: S.sub, marginBottom: 24 }}>
                            Товар с артикулом <SkuTag>{formData.sku}</SkuTag> ранее был удалён.<br />
                            Создать новую карточку?
                        </div>
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                            <Btn variant="secondary" onClick={() => { setSkuReuseId(null); setPendingFormData(null); }}>Отмена</Btn>
                            <Btn variant="wb" onClick={handleConfirmSkuReuse}>Создать новую карточку</Btn>
                        </div>
                    </div>
                </Modal>

                {/* ─── Modal: Adjust Stock ─── */}
                <Modal open={isAdjustOpen && !!selectedProduct} onClose={() => setIsAdjustOpen(false)} title="Корректировка остатка" width={400}>
                    {selectedProduct && (
                        <form onSubmit={handleAdjust} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <div style={{ textAlign: 'center' }}>
                                <div style={{ fontFamily: 'Inter', fontSize: 13, color: S.sub, marginBottom: 4 }}>
                                    {selectedProduct.name} · <SkuTag>{selectedProduct.sku}</SkuTag>
                                </div>
                                <div style={{ fontFamily: 'Inter', fontWeight: 900, fontSize: 48, color: S.ink, letterSpacing: '-0.03em' }}>{selectedProduct.total}</div>
                                <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted }}>текущий остаток</div>
                            </div>
                            <div>
                                <FieldLabel>Изменение (±)</FieldLabel>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <button type="button" onClick={() => setAdjustDelta(d => d - 1)} style={{ width: 36, height: 36, borderRadius: 8, border: `1px solid ${S.border}`, background: '#fff', cursor: 'pointer', fontFamily: 'Inter', fontSize: 18, fontWeight: 700, color: S.ink, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                                    <input
                                        type="number" required value={adjustDelta}
                                        onChange={e => setAdjustDelta(parseInt(e.target.value) || 0)}
                                        style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: `1px solid ${S.border}`, fontFamily: 'Inter', fontSize: 20, fontWeight: 700, textAlign: 'center', color: adjustDelta > 0 ? S.green : adjustDelta < 0 ? S.red : S.ink, outline: 'none' }}
                                    />
                                    <button type="button" onClick={() => setAdjustDelta(d => d + 1)} style={{ width: 36, height: 36, borderRadius: 8, border: `1px solid ${S.border}`, background: '#fff', cursor: 'pointer', fontFamily: 'Inter', fontSize: 18, fontWeight: 700, color: S.ink, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                                </div>
                            </div>
                            <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontFamily: 'Inter', fontSize: 13, color: S.sub }}>Итоговый остаток</span>
                                <span style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 22, color: S.blue }}>{Math.max(0, selectedProduct.total + adjustDelta)}</span>
                            </div>
                            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                                <Btn type="button" variant="secondary" onClick={() => setIsAdjustOpen(false)}>Отмена</Btn>
                                <Btn type="submit" variant="primary">Применить</Btn>
                            </div>
                        </form>
                    )}
                </Modal>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {accessState && <AccessStateBanner accessState={accessState} />}

            {/* Header */}
            <PageHeader title="Остатки товаров" subtitle="Управление запасами по всем маркетплейсам">
                {unmatchedCount > 0 && (
                    <Badge label={`${unmatchedCount} без привязки`} bg="rgba(245,158,11,0.1)" color={S.amber} style={{ marginRight: 4 }} />
                )}
                {!isReadOnly && (
                    <Btn variant="ghost" size="sm" onClick={handleFetchPhotos} disabled={fetchingPhotos} title="Подтянуть фото с МП">
                        <ImageDown size={13} style={{ animation: fetchingPhotos ? 'spin 1s linear infinite' : undefined }} />
                        Фото МП
                    </Btn>
                )}
                {!isReadOnly && (
                    <Btn variant="wb" size="sm" onClick={handleImportFromWb} disabled={importingFromWb} title="Загрузить карточки из WB">
                        <Download size={13} />
                        {importingFromWb ? 'Загрузка…' : 'Из WB'}
                    </Btn>
                )}
                {!isReadOnly && (
                    <>
                        <input type="file" id="catalog-import-file" style={{ display: 'none' }} accept=".xlsx,.xls,.csv" onChange={handleImportFile} />
                        <Btn variant="secondary" size="sm" onClick={() => document.getElementById('catalog-import-file')?.click()} disabled={importLoading}>
                            <ArrowDownUp size={13} />
                            {importLoading ? 'Анализ…' : 'Импорт Excel'}
                        </Btn>
                    </>
                )}
                {!isReadOnly && (
                    <Btn variant="primary" size="sm" onClick={openCreate}>
                        <Plus size={13} /> Новый товар
                    </Btn>
                )}
            </PageHeader>

            {/* Import result banner */}
            {importResult && (
                <div style={{ background: 'rgba(16,185,129,0.08)', border: `1px solid rgba(16,185,129,0.25)`, borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'Inter', fontSize: 13, color: S.green, fontWeight: 500 }}>
                        <CheckCircle size={16} />
                        Импорт завершён: создано <b>{importResult.createdCount}</b>, обновлено {importResult.updatedCount}
                        {importResult.errorCount > 0 && <span style={{ color: S.amber }}>, требует проверки: {importResult.errorCount}</span>}
                    </div>
                    <button onClick={() => setImportResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: S.muted, display: 'flex' }}>
                        <XCircle size={16} />
                    </button>
                </div>
            )}

            {/* Table card */}
            <Card noPad>
                {/* Toolbar */}
                <div style={{ padding: '14px 20px', borderBottom: `1px solid ${S.border}`, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* Status tabs */}
                    <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 8, padding: 3, gap: 2 }}>
                        {(['active', 'deleted'] as const).map(f => (
                            <button key={f} onClick={() => setStatusFilter(f)} style={{
                                padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
                                fontFamily: 'Inter', fontSize: 12, fontWeight: 600,
                                background: statusFilter === f ? '#fff' : 'transparent',
                                color: statusFilter === f ? S.ink : S.muted,
                                boxShadow: statusFilter === f ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                transition: 'all 0.15s',
                            }}>
                                {f === 'active' ? 'Активные' : 'Архив'}
                            </button>
                        ))}
                    </div>
                    {/* Search */}
                    <div style={{ flex: 1, minWidth: 200 }}>
                        <Input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Поиск по названию, SKU или бренду…"
                            icon={Search}
                        />
                    </div>
                </div>

                {/* Table header */}
                <div style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${S.border}`, background: '#fafbfc' }}>
                    <TH flex={0.5}>Фото</TH>
                    <TH flex={2.5}>Название</TH>
                    <TH flex={1.2}>SKU</TH>
                    {statusFilter === 'active' && (
                        <>
                            <TH flex={0.9}>Склад</TH>
                            <TH flex={1} align="center"><span style={{ color: S.wb }}>WB</span> FBS/FBO</TH>
                            <TH flex={1} align="center"><span style={{ color: S.oz }}>Ozon</span> FBS/FBO</TH>
                            <TH flex={0.9} align="center">Доступно</TH>
                        </>
                    )}
                    {statusFilter === 'deleted' && <TH flex={1}>Удалён</TH>}
                    <TH flex={1} align="center">Действия</TH>
                </div>

                {/* Rows */}
                {loading && (
                    <div style={{ padding: '32px 24px', textAlign: 'center', fontFamily: 'Inter', fontSize: 13, color: S.muted }}>
                        Загрузка…
                    </div>
                )}
                {!loading && products.length === 0 && (
                    <div style={{ padding: '32px 24px', textAlign: 'center', fontFamily: 'Inter', fontSize: 13, color: S.muted }}>
                        {statusFilter === 'deleted' ? 'Архив пуст.' : 'Товары не найдены.'}
                    </div>
                )}
                {products.map((p) => {
                    const ac = availColor(p.available);
                    return (
                        <div
                            key={p.id}
                            style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${S.border}`, minHeight: 60, transition: 'background 0.15s', opacity: statusFilter === 'deleted' ? 0.75 : 1 }}
                            onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                            {/* Photo */}
                            <div style={{ flex: 0.5, padding: '8px 16px', display: 'flex', alignItems: 'center' }}>
                                <div style={{ width: 72, height: 96, borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}>
                                    <ProductMediaWidget
                                        productId={p.id}
                                        mainImageFileId={p.mainImageFileId}
                                        legacyPhotoUrl={p.photo}
                                        isReadOnly={isReadOnly || statusFilter === 'deleted'}
                                        onMediaUpdated={(newFileId) => handleMediaUpdated(p.id, newFileId)}
                                    />
                                </div>
                            </div>

                            {/* Name */}
                            <div style={{ flex: 2.5, padding: '0 16px' }}>
                                <div style={{ fontFamily: 'Inter', fontSize: 15, fontWeight: 600, color: S.ink, marginBottom: 2 }}>{p.name}</div>
                                {p.brand && <div style={{ fontFamily: 'Inter', fontSize: 13, color: S.muted }}>{p.brand}</div>}
                                {p.sourceOfTruth === 'IMPORT' && (
                                    <span style={{ display: 'inline-block', fontFamily: 'Inter', fontSize: 10, color: S.blue, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 4, padding: '1px 5px', marginTop: 2 }}>import</span>
                                )}
                                {p.sourceOfTruth === 'SYNC' && (
                                    <span style={{ display: 'inline-block', fontFamily: 'Inter', fontSize: 10, color: S.green, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 4, padding: '1px 5px', marginTop: 2 }}>sync</span>
                                )}
                            </div>

                            {/* SKU */}
                            <div style={{ flex: 1.2, padding: '0 16px' }}>
                                <SkuTag>{p.sku}</SkuTag>
                                {p.wbBarcode && (
                                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: S.muted, marginTop: 3 }}>WB: {p.wbBarcode}</div>
                                )}
                            </div>

                            {/* Stock columns (active) */}
                            {statusFilter === 'active' && (
                                <>
                                    {/* Warehouse */}
                                    <div style={{ flex: 0.9, padding: '0 16px' }}>
                                        {editingStock?.id === p.id && editingStock?.field === 'total' ? (
                                            <input
                                                type="number" autoFocus
                                                style={{ width: 60, padding: '4px 8px', border: `1px solid ${S.blue}`, borderRadius: 6, fontFamily: 'Inter', fontSize: 13, outline: 'none' }}
                                                value={editingStock.value}
                                                onChange={e => setEditingStock({ ...editingStock, value: e.target.value })}
                                                onBlur={() => handleStockUpdate(p.id, 'total', editingStock.value)}
                                                onKeyDown={e => handleKeyDown(e, p.id, 'total')}
                                            />
                                        ) : (
                                            <span
                                                style={{ fontFamily: 'Inter', fontSize: 16, fontWeight: 700, color: S.ink, cursor: isReadOnly ? 'default' : 'pointer' }}
                                                onClick={() => !isReadOnly && setEditingStock({ id: p.id, field: 'total', value: String(p.total) })}
                                            >{p.total}</span>
                                        )}
                                        <span style={{ fontFamily: 'Inter', fontSize: 13, color: S.muted }}> / р.{p.reserved}</span>
                                    </div>

                                    {/* WB */}
                                    <div style={{ flex: 1, padding: '0 16px', textAlign: 'center' }}>
                                        {editingStock?.id === p.id && editingStock?.field === 'wbFbs' ? (
                                            <input
                                                type="number" autoFocus
                                                style={{ width: 50, padding: '4px 6px', border: `1px solid ${S.wb}`, borderRadius: 6, fontFamily: 'Inter', fontSize: 12, outline: 'none', textAlign: 'center' }}
                                                value={editingStock.value}
                                                onChange={e => setEditingStock({ ...editingStock, value: e.target.value })}
                                                onBlur={() => handleStockUpdate(p.id, 'wbFbs', editingStock.value)}
                                                onKeyDown={e => handleKeyDown(e, p.id, 'wbFbs')}
                                            />
                                        ) : (
                                            <span
                                                style={{ fontFamily: 'Inter', fontSize: 14, color: S.wb, fontWeight: 600, cursor: isReadOnly ? 'default' : 'pointer' }}
                                                onClick={() => !isReadOnly && setEditingStock({ id: p.id, field: 'wbFbs', value: String(p.wbFbs) })}
                                            >{p.wbFbs}</span>
                                        )}
                                        <span style={{ color: S.muted, fontFamily: 'Inter', fontSize: 14 }}>/</span>
                                        <span style={{ fontFamily: 'Inter', fontSize: 14, color: S.wb, fontWeight: 600 }}>{p.wbFbo}</span>
                                    </div>

                                    {/* Ozon */}
                                    <div style={{ flex: 1, padding: '0 16px', textAlign: 'center' }}>
                                        {editingStock?.id === p.id && editingStock?.field === 'ozonFbs' ? (
                                            <input
                                                type="number" autoFocus
                                                style={{ width: 50, padding: '4px 6px', border: `1px solid ${S.oz}`, borderRadius: 6, fontFamily: 'Inter', fontSize: 12, outline: 'none', textAlign: 'center' }}
                                                value={editingStock.value}
                                                onChange={e => setEditingStock({ ...editingStock, value: e.target.value })}
                                                onBlur={() => handleStockUpdate(p.id, 'ozonFbs', editingStock.value)}
                                                onKeyDown={e => handleKeyDown(e, p.id, 'ozonFbs')}
                                            />
                                        ) : (
                                            <span
                                                style={{ fontFamily: 'Inter', fontSize: 14, color: S.oz, fontWeight: 600, cursor: isReadOnly ? 'default' : 'pointer' }}
                                                onClick={() => !isReadOnly && setEditingStock({ id: p.id, field: 'ozonFbs', value: String(p.ozonFbs) })}
                                            >{p.ozonFbs}</span>
                                        )}
                                        <span style={{ color: S.muted, fontFamily: 'Inter', fontSize: 14 }}>/</span>
                                        <span style={{ fontFamily: 'Inter', fontSize: 14, color: S.oz, fontWeight: 600 }}>{p.ozonFbo}</span>
                                    </div>

                                    {/* Available */}
                                    <div style={{ flex: 0.9, padding: '0 16px', display: 'flex', justifyContent: 'center' }}>
                                        <Badge label={`${p.available} шт.`} bg={ac.bg} color={ac.color} />
                                    </div>
                                </>
                            )}

                            {/* Deleted at */}
                            {statusFilter === 'deleted' && (
                                <div style={{ flex: 1, padding: '0 16px', fontFamily: 'Inter', fontSize: 12, color: S.muted }}>
                                    {p.deletedAt ? new Date(p.deletedAt).toLocaleDateString('ru-RU') : '—'}
                                </div>
                            )}

                            {/* Actions */}
                            <div style={{ flex: 1, padding: '0 12px', display: 'flex', justifyContent: 'center', gap: 4, flexDirection: 'column', alignItems: 'center' }}>
                                {/* Sync result tooltip */}
                                {(syncResult as any)?.id === p.id && (() => {
                                    const sr = (syncResult as any).data;
                                    return (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 4, width: '100%' }}>
                                            <span style={{ fontFamily: 'Inter', fontSize: 10, color: sr?.wb?.success ? S.green : S.amber, background: sr?.wb?.success ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)', borderRadius: 4, padding: '1px 6px' }}>
                                                WB: {sr?.wb?.success ? '✓' : sr?.wb?.error}
                                            </span>
                                            <span style={{ fontFamily: 'Inter', fontSize: 10, color: sr?.ozon?.success ? S.green : S.amber, background: sr?.ozon?.success ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)', borderRadius: 4, padding: '1px 6px' }}>
                                                Ozon: {sr?.ozon?.success ? '✓' : sr?.ozon?.error}
                                            </span>
                                        </div>
                                    );
                                })()}
                                <div style={{ display: 'flex', gap: 4 }}>
                                    {statusFilter === 'active' && !isReadOnly && (
                                        <>
                                            <ActionBtn onClick={() => handleSync(p.id)} disabled={syncingId === p.id} color={S.green} title="Синхронизировать остатки">
                                                <RefreshCw size={18} style={{ animation: syncingId === p.id ? 'spin 1s linear infinite' : undefined }} />
                                            </ActionBtn>
                                            <ActionBtn onClick={() => openAdjust(p)} color={S.blue} title="Корректировка остатка">
                                                <ArrowDownUp size={18} />
                                            </ActionBtn>
                                            <ActionBtn onClick={() => openEdit(p)} color={S.ink} title="Редактировать">
                                                <Edit2 size={18} />
                                            </ActionBtn>
                                            <ActionBtn onClick={() => openLockModal(p)} color={S.amber} title="Блокировки остатков">
                                                {(locksMap[p.id]?.length ?? 0) > 0 ? <Lock size={18} /> : <Unlock size={18} />}
                                            </ActionBtn>
                                            <ActionBtn onClick={() => handleDelete(p.id)} color={S.red} title="В архив">
                                                <Archive size={18} />
                                            </ActionBtn>
                                        </>
                                    )}
                                    {statusFilter === 'active' && isReadOnly && (
                                        <span style={{ fontFamily: 'Inter', fontSize: 11, color: S.muted }}>только чтение</span>
                                    )}
                                    {statusFilter === 'deleted' && !isReadOnly && (
                                        <Btn variant="success" size="sm" onClick={() => handleRestore(p.id)} title="Восстановить из архива">
                                            <RotateCcw size={13} /> Восстановить
                                        </Btn>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}

                {/* Pagination */}
                <Pagination page={page} totalPages={totalPages} onPage={setPage} />
            </Card>

            {/* ─── Modal: Create / Edit ─── */}
            <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)} title={modalMode === 'create' ? 'Новый товар' : 'Редактировать товар'} width={500}>
                <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                        <FieldLabel>Название *</FieldLabel>
                        <Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="Название товара" />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                            <FieldLabel>Артикул (SKU) *</FieldLabel>
                            <Input value={formData.sku} onChange={e => setFormData({ ...formData, sku: e.target.value })} placeholder="Артикул продавца" />
                            <p style={{ fontFamily: 'Inter', fontSize: 11, color: S.muted, marginTop: 4 }}>ЛК Ozon → Товары → Список → Артикул</p>
                        </div>
                        <div>
                            <FieldLabel>WB Баркод</FieldLabel>
                            <Input value={formData.wbBarcode} onChange={e => setFormData({ ...formData, wbBarcode: e.target.value })} placeholder="2043309181375" />
                            <p style={{ fontFamily: 'Inter', fontSize: 11, color: S.muted, marginTop: 4 }}>ЛК WB → Мои товары → Баркод</p>
                        </div>
                    </div>
                    {modalMode === 'create' && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <div>
                                <FieldLabel>Начальный остаток</FieldLabel>
                                <Input type="number" min={0} value={formData.initialTotal} onChange={e => setFormData({ ...formData, initialTotal: e.target.value })} />
                            </div>
                            <div>
                                <FieldLabel>Изображение</FieldLabel>
                                <input type="file" accept="image/*" onChange={e => setFormData({ ...formData, file: e.target.files?.[0] || null })} style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub, width: '100%' }} />
                            </div>
                        </div>
                    )}
                    {modalMode === 'edit' && (
                        <p style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted, background: '#f8fafc', border: `1px solid ${S.border}`, borderRadius: 8, padding: '8px 12px' }}>
                            Для управления фото наведите курсор на изображение в таблице.
                        </p>
                    )}
                    {formError && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'Inter', fontSize: 13, color: S.red, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '10px 12px' }}>
                            <AlertCircle size={15} /> {formError}
                        </div>
                    )}

                    {/* Linked mappings (edit mode) */}
                    {modalMode === 'edit' && (
                        <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 14 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: S.ink }}>
                                    <Link2 size={14} color={S.muted} /> Связанные артикулы
                                </div>
                                <Btn variant="ghost" size="sm" type="button" onClick={() => { setAddMappingOpen(v => !v); setAddMpError(null); }}>
                                    <Plus size={12} /> Добавить
                                </Btn>
                            </div>
                            {mappingsLoading && <p style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted }}>Загрузка…</p>}
                            {!mappingsLoading && mappings.length === 0 && <p style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted }}>Нет связанных артикулов</p>}
                            {mappings.map(m => (
                                <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${S.border}` }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                        <MPBadge mp={m.marketplace} />
                                        <SkuTag>{m.externalProductId}</SkuTag>
                                        {m.externalSku && <span style={{ fontFamily: 'Inter', fontSize: 11, color: S.muted }}>SKU: {m.externalSku}</span>}
                                        {m.isAutoMatched && <span style={{ fontFamily: 'Inter', fontSize: 10, color: S.muted, background: '#f1f5f9', padding: '1px 5px', borderRadius: 4 }}>auto</span>}
                                    </div>
                                    <button type="button" onClick={() => handleDetachMapping(m.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: S.red, display: 'flex', padding: 4 }} title="Отвязать">
                                        <Unlink size={14} />
                                    </button>
                                </div>
                            ))}
                            {addMappingOpen && (
                                <div style={{ marginTop: 10, background: '#f8fafc', border: `1px solid ${S.border}`, borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                        <div>
                                            <FieldLabel>Маркетплейс</FieldLabel>
                                            <select value={addMpMarketplace} onChange={e => setAddMpMarketplace(e.target.value as 'WB' | 'OZON')} style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: `1px solid ${S.border}`, fontFamily: 'Inter', fontSize: 12, color: S.ink, outline: 'none' }}>
                                                <option value="WB">Wildberries</option>
                                                <option value="OZON">Ozon</option>
                                            </select>
                                        </div>
                                        <div>
                                            <FieldLabel>Артикул МП *</FieldLabel>
                                            <input type="text" value={addMpExtId} onChange={e => setAddMpExtId(e.target.value)} placeholder="externalProductId" style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: `1px solid ${S.border}`, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: S.ink, outline: 'none' }} />
                                        </div>
                                    </div>
                                    <div>
                                        <FieldLabel>SKU (опционально)</FieldLabel>
                                        <input type="text" value={addMpExtSku} onChange={e => setAddMpExtSku(e.target.value)} placeholder="externalSku" style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: `1px solid ${S.border}`, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: S.ink, outline: 'none' }} />
                                    </div>
                                    {addMpError && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'Inter', fontSize: 12, color: S.red, background: 'rgba(239,68,68,0.06)', borderRadius: 6, padding: '8px 10px' }}>
                                            <AlertCircle size={13} /> {addMpError}
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                        <Btn type="button" variant="secondary" size="sm" onClick={() => { setAddMappingOpen(false); setAddMpError(null); }}>Отмена</Btn>
                                        <Btn type="button" variant="primary" size="sm" onClick={handleAddMapping} disabled={addMpSubmitting || !addMpExtId.trim()}>
                                            {addMpSubmitting ? 'Добавляем…' : 'Привязать'}
                                        </Btn>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
                        <Btn type="button" variant="secondary" onClick={() => setIsModalOpen(false)}>Отмена</Btn>
                        <Btn type="submit" variant="primary">Сохранить</Btn>
                    </div>
                </form>
            </Modal>

            {/* ─── Modal: SKU Reuse ─── */}
            <Modal open={!!skuReuseId} onClose={() => { setSkuReuseId(null); setPendingFormData(null); }} title="" width={400}>
                <div style={{ textAlign: 'center', padding: '8px 0' }}>
                    <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(245,158,11,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                        <AlertTriangle size={26} color={S.amber} />
                    </div>
                    <div style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 17, color: S.ink, marginBottom: 8 }}>Артикул уже использовался</div>
                    <div style={{ fontFamily: 'Inter', fontSize: 13, color: S.sub, marginBottom: 24 }}>
                        Товар с артикулом <SkuTag>{formData.sku}</SkuTag> ранее был удалён.<br />
                        Создать новую карточку? Старая останется в архиве.
                    </div>
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                        <Btn variant="secondary" onClick={() => { setSkuReuseId(null); setPendingFormData(null); }}>Отмена</Btn>
                        <Btn variant="wb" onClick={handleConfirmSkuReuse}>Создать новую карточку</Btn>
                    </div>
                </div>
            </Modal>

            {/* ─── Modal: Adjust Stock ─── */}
            <Modal open={isAdjustOpen && !!selectedProduct} onClose={() => setIsAdjustOpen(false)} title="Корректировка остатка" width={400}>
                {selectedProduct && (
                    <form onSubmit={handleAdjust} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontFamily: 'Inter', fontSize: 13, color: S.sub, marginBottom: 4 }}>
                                {selectedProduct.name} · <SkuTag>{selectedProduct.sku}</SkuTag>
                            </div>
                            <div style={{ fontFamily: 'Inter', fontWeight: 900, fontSize: 48, color: S.ink, letterSpacing: '-0.03em' }}>{selectedProduct.total}</div>
                            <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted }}>текущий остаток</div>
                        </div>
                        <div>
                            <FieldLabel>Изменение (±)</FieldLabel>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <button type="button" onClick={() => setAdjustDelta(d => d - 1)} style={{ width: 36, height: 36, borderRadius: 8, border: `1px solid ${S.border}`, background: '#fff', cursor: 'pointer', fontFamily: 'Inter', fontSize: 18, fontWeight: 700, color: S.ink, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                                <input
                                    type="number" required value={adjustDelta}
                                    onChange={e => setAdjustDelta(parseInt(e.target.value) || 0)}
                                    style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: `1px solid ${S.border}`, fontFamily: 'Inter', fontSize: 20, fontWeight: 700, textAlign: 'center', color: adjustDelta > 0 ? S.green : adjustDelta < 0 ? S.red : S.ink, outline: 'none' }}
                                />
                                <button type="button" onClick={() => setAdjustDelta(d => d + 1)} style={{ width: 36, height: 36, borderRadius: 8, border: `1px solid ${S.border}`, background: '#fff', cursor: 'pointer', fontFamily: 'Inter', fontSize: 18, fontWeight: 700, color: S.ink, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                            </div>
                        </div>
                        <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontFamily: 'Inter', fontSize: 13, color: S.sub }}>Итоговый остаток</span>
                            <span style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 22, color: S.blue }}>{Math.max(0, selectedProduct.total + adjustDelta)}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                            <Btn type="button" variant="secondary" onClick={() => setIsAdjustOpen(false)}>Отмена</Btn>
                            <Btn type="submit" variant="primary">Применить</Btn>
                        </div>
                    </form>
                )}
            </Modal>

            {/* ─── Modal: Import Preview ─── */}
            <Modal open={!!importPreview} onClose={() => setImportPreview(null)} title="Предпросмотр импорта" width={680}>
                {importPreview && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {/* Summary */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                            {[
                                { label: 'Создать', value: importPreview.summary.create, color: S.green, bg: 'rgba(16,185,129,0.08)' },
                                { label: 'Обновить', value: importPreview.summary.update, color: S.blue, bg: 'rgba(59,130,246,0.08)' },
                                { label: 'Проверки', value: importPreview.summary.manualReview, color: S.red, bg: 'rgba(239,68,68,0.08)' },
                                { label: 'Пропустить', value: importPreview.summary.skip, color: S.muted, bg: '#f8fafc' },
                            ].map(({ label, value, color, bg }) => (
                                <div key={label} style={{ background: bg, borderRadius: 10, padding: '12px', textAlign: 'center' }}>
                                    <div style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 28, color, letterSpacing: '-0.02em' }}>{value}</div>
                                    <div style={{ fontFamily: 'Inter', fontSize: 11, color, marginTop: 2 }}>{label}</div>
                                </div>
                            ))}
                        </div>
                        {importPreview.summary.manualReview > 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'Inter', fontSize: 12, color: S.amber, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, padding: '10px 12px' }}>
                                <AlertTriangle size={14} /> Строки с ошибками будут пропущены. Исправьте данные и повторите импорт.
                            </div>
                        )}

                        {/* Items */}
                        <div style={{ border: `1px solid ${S.border}`, borderRadius: 10, overflow: 'hidden', maxHeight: 320, overflowY: 'auto' }}>
                            <div style={{ display: 'flex', background: '#f8fafc', borderBottom: `1px solid ${S.border}`, padding: '8px 0' }}>
                                <TH flex={0.3}>#</TH>
                                <TH flex={1}>SKU</TH>
                                <TH flex={2}>Название</TH>
                                <TH flex={1}>Действие</TH>
                                <TH flex={1.5}>Предупреждения</TH>
                            </div>
                            {importPreview.items.map(item => {
                                const actionColors: Record<string, { bg: string; color: string }> = {
                                    CREATE: { bg: 'rgba(16,185,129,0.1)', color: S.green },
                                    UPDATE: { bg: 'rgba(59,130,246,0.1)', color: S.blue },
                                    MANUAL_REVIEW: { bg: 'rgba(239,68,68,0.1)', color: S.red },
                                    SKIP: { bg: '#f1f5f9', color: S.muted },
                                };
                                const ac2 = actionColors[item.action] ?? { bg: '#f1f5f9', color: S.muted };
                                return (
                                    <div key={item.rowNumber} style={{ display: 'flex', alignItems: 'flex-start', padding: '8px 0', borderBottom: `1px solid ${S.border}`, background: item.action === 'MANUAL_REVIEW' ? 'rgba(239,68,68,0.02)' : undefined }}>
                                        <div style={{ flex: 0.3, padding: '0 16px', fontFamily: 'Inter', fontSize: 11, color: S.muted }}>{item.rowNumber}</div>
                                        <div style={{ flex: 1, padding: '0 16px' }}><SkuTag>{item.raw.sku || '—'}</SkuTag></div>
                                        <div style={{ flex: 2, padding: '0 16px', fontFamily: 'Inter', fontSize: 12, color: S.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.raw.name || '—'}</div>
                                        <div style={{ flex: 1, padding: '0 16px' }}>
                                            <Badge label={ACTION_LABELS[item.action]} bg={ac2.bg} color={ac2.color} />
                                        </div>
                                        <div style={{ flex: 1.5, padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                                            {item.errors.map((err, i) => (
                                                <span key={i} style={{ fontFamily: 'Inter', fontSize: 11, color: S.red, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    <XCircle size={11} /> {err.message}
                                                </span>
                                            ))}
                                            {item.sourceConflict && (
                                                <span style={{ fontFamily: 'Inter', fontSize: 11, color: S.amber, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    <AlertTriangle size={11} /> Перезапишет ручные изменения
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                            <Btn variant="secondary" onClick={() => setImportPreview(null)}>Отмена</Btn>
                            <Btn
                                variant="primary"
                                onClick={handleCommitImport}
                                disabled={importCommitting || importPreview.summary.create + importPreview.summary.update === 0}
                            >
                                {importCommitting ? <><RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> Применяю…</> : <>
                                    <CheckCircle size={13} /> Применить ({importPreview.summary.create + importPreview.summary.update} строк)
                                </>}
                            </Btn>
                        </div>
                    </div>
                )}
            </Modal>

            {/* ─── Modal: Stock Locks ─── */}
            <Modal
                open={!!lockModalProduct}
                onClose={() => setLockModalProduct(null)}
                title={lockModalProduct ? `Блокировки: ${lockModalProduct.sku}` : ''}
                width={520}
            >
                {lockModalProduct && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                        <div style={{ fontFamily: 'Inter', fontSize: 13, color: S.sub }}>{lockModalProduct.name}</div>

                        {/* Существующие блокировки */}
                        <div>
                            <FieldLabel>Активные блокировки</FieldLabel>
                            {lockModalLocks.length === 0 ? (
                                <p style={{ fontSize: 13, color: S.muted, fontStyle: 'italic' }}>Нет активных блокировок</p>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {lockModalLocks.map(l => (
                                        <div key={l.id} style={{
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
                                            borderRadius: 8, padding: '10px 14px', fontSize: 13,
                                        }}>
                                            <div>
                                                <span style={{ fontWeight: 700, color: '#92400e' }}>
                                                    {{ WB: 'Wildberries', OZON: 'Ozon' }[l.marketplace] ?? l.marketplace}
                                                </span>
                                                <span style={{ color: '#b45309', marginLeft: 8 }}>
                                                    {{ ZERO: 'Обнулить', FIXED: 'Фиксированное', PAUSED: 'Пауза' }[l.lockType as LockType] ?? l.lockType}
                                                    {l.fixedValue != null ? ` = ${l.fixedValue}` : ''}
                                                </span>
                                                {l.note && <span style={{ color: '#ca8a04', marginLeft: 8, fontSize: 12 }}>— {l.note}</span>}
                                            </div>
                                            <button
                                                onClick={() => handleRemoveLock(l.id, lockModalProduct.id)}
                                                title="Снять блокировку"
                                                style={{ marginLeft: 8, padding: 4, borderRadius: 4, border: 'none', background: 'transparent', color: S.red, cursor: 'pointer', display: 'flex' }}
                                                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.08)'}
                                                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Форма добавления */}
                        {!isReadOnly && (
                            <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                                <FieldLabel>Добавить блокировку</FieldLabel>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                    <div>
                                        <FieldLabel>Маркетплейс</FieldLabel>
                                        <select value={lockFormMarketplace} onChange={e => setLockFormMarketplace(e.target.value as LockMarketplace)}
                                            style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${S.border}`, fontFamily: 'Inter', fontSize: 14, color: S.ink, background: '#fff', outline: 'none', cursor: 'pointer' }}>
                                            <option value="WB">Wildberries</option>
                                            <option value="OZON">Ozon</option>
                                        </select>
                                    </div>
                                </div>
                                <div>
                                    <FieldLabel>Тип блокировки</FieldLabel>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        {([
                                            { value: 'ZERO', title: 'Показывать 0', desc: 'На маркетплейсе будет показан нулевой остаток — новые заказы не поступят, даже если товар есть на складе.' },
                                            { value: 'FIXED', title: 'Фиксированное количество', desc: 'На маркетплейсе всегда будет показано ровно то число, которое вы укажете — независимо от реального остатка. ⚠️ Списание идёт с реального остатка: если укажете больше чем есть, возможны отмены заказов.' },
                                            { value: 'PAUSED', title: 'Пауза (остановить синхронизацию)', desc: 'Остаток перестаёт обновляться на этом маркетплейсе. Последнее значение остаётся как есть.' },
                                        ] as { value: LockType; title: string; desc: string }[]).map(opt => (
                                            <div
                                                key={opt.value}
                                                onClick={() => setLockFormType(opt.value)}
                                                style={{
                                                    padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                                                    border: `1.5px solid ${lockFormType === opt.value ? S.amber : S.border}`,
                                                    background: lockFormType === opt.value ? 'rgba(245,158,11,0.06)' : '#fff',
                                                    transition: 'all 0.12s',
                                                }}
                                            >
                                                <div style={{ fontFamily: 'Inter', fontWeight: 600, fontSize: 14, color: lockFormType === opt.value ? '#92400e' : S.ink, marginBottom: 3 }}>
                                                    {lockFormType === opt.value ? '● ' : '○ '}{opt.title}
                                                </div>
                                                <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub, lineHeight: 1.4 }}>{opt.desc}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                {lockFormType === 'FIXED' && (
                                    <div>
                                        <FieldLabel>Количество для отображения</FieldLabel>
                                        <Input type="number" min={0} value={lockFormFixed} onChange={e => setLockFormFixed(e.target.value)} style={{ width: '100%' }} placeholder="Например: 10" />
                                        <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub, marginTop: 4 }}>
                                            Это число будет показано покупателям на маркетплейсе вместо реального остатка.
                                        </div>
                                    </div>
                                )}
                                <div>
                                    <FieldLabel>Заметка (опционально)</FieldLabel>
                                    <Input type="text" value={lockFormNote} onChange={e => setLockFormNote(e.target.value)} placeholder="Например: Распродажа FBO" style={{ width: '100%' }} />
                                </div>
                                {lockFormError && (
                                    <div style={{ fontSize: 13, color: S.red, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '8px 12px' }}>
                                        {lockFormError}
                                    </div>
                                )}
                                <Btn variant="secondary" onClick={handleCreateLock} disabled={lockFormSubmitting}
                                    style={{ width: '100%', justifyContent: 'center', background: 'rgba(245,158,11,0.08)', color: '#92400e', border: '1px solid rgba(245,158,11,0.3)' }}>
                                    {lockFormSubmitting ? 'Добавляем...' : 'Добавить блокировку'}
                                </Btn>
                            </div>
                        )}
                    </div>
                )}
            </Modal>
        </div>
    );
}

// ─── Action button helper ─────────────────────────────────────────────────────
function ActionBtn({ children, onClick, disabled, color, title }: {
    children: React.ReactNode; onClick?: () => void; disabled?: boolean; color: string; title?: string;
}) {
    const [hovered, setHovered] = useState(false);
    return (
        <button
            onClick={onClick} disabled={disabled} title={title}
            style={{
                background: hovered ? `${color}18` : 'transparent',
                border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
                padding: 7, borderRadius: 6, color: hovered ? color : '#94a3b8',
                display: 'flex', opacity: disabled ? 0.4 : 1, transition: 'all 0.15s',
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >{children}</button>
    );
}
