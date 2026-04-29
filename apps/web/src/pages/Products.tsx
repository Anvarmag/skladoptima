import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
    Plus, Edit2, Archive, ArrowDownUp, Search,
    RefreshCw, ImageDown, RotateCcw, AlertTriangle, Link2Off,
    CheckCircle, XCircle, AlertCircle, Link2, Unlink,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import AccessStateBanner from '../components/AccessStateBanner';
import ProductMediaWidget from '../components/ProductMediaWidget';

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

const MARKETPLACE_LABELS: Record<string, string> = { WB: 'Wildberries', OZON: 'Ozon' };
const MARKETPLACE_COLORS: Record<string, string> = {
    WB: 'bg-pink-50 text-pink-700 border-pink-200',
    OZON: 'bg-blue-50 text-blue-700 border-blue-200',
};

// ─────────────────────────────── helpers ─────────────────────────────

const ACTION_LABELS: Record<string, string> = {
    CREATE: 'Создать',
    UPDATE: 'Обновить',
    MANUAL_REVIEW: 'Требует проверки',
    SKIP: 'Пропустить',
};

const ACTION_COLORS: Record<string, string> = {
    CREATE: 'bg-emerald-100 text-emerald-800',
    UPDATE: 'bg-blue-100 text-blue-800',
    MANUAL_REVIEW: 'bg-red-100 text-red-800',
    SKIP: 'bg-slate-100 text-slate-600',
};

const WRITE_BLOCKED_STATES = ['TRIAL_EXPIRED', 'SUSPENDED', 'CLOSED'];

function generateIdempotencyKey(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ─────────────────────────────── component ───────────────────────────

export default function Products() {
    const { activeTenant } = useAuth();
    const accessState = activeTenant?.accessState ?? '';
    const isReadOnly = WRITE_BLOCKED_STATES.includes(accessState);

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
        const interval = setInterval(() => fetchProducts(), 30_000);
        return () => clearInterval(interval);
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

    // ─────────── render ───────────

    return (
        <div className="space-y-4 animate-fade-in pb-12">

            {/* Access state banner */}
            {accessState && <AccessStateBanner accessState={accessState} />}

            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div className="flex items-center gap-3">
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Управление Товарами</h1>
                    {unmatchedCount > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-medium border border-amber-200">
                            <Link2Off className="h-3 w-3" />
                            {unmatchedCount} без маппинга
                        </span>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {!isReadOnly && (
                        <button
                            onClick={handleFetchPhotos}
                            disabled={fetchingPhotos}
                            className="inline-flex items-center px-3 sm:px-4 py-2 bg-white border border-slate-200 rounded-lg text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-50 transition-all hover:shadow-sm disabled:opacity-50"
                        >
                            <ImageDown className={`h-4 w-4 mr-1.5 ${fetchingPhotos ? 'animate-pulse' : ''}`} />
                            <span className="hidden sm:inline">Подтянуть фото с МП</span>
                            <span className="sm:hidden">Фото МП</span>
                        </button>
                    )}

                    {!isReadOnly && (
                        <>
                            <input
                                type="file"
                                id="catalog-import-file"
                                className="hidden"
                                accept=".xlsx,.xls,.csv"
                                onChange={handleImportFile}
                            />
                            <button
                                onClick={() => document.getElementById('catalog-import-file')?.click()}
                                disabled={importLoading}
                                className="flex items-center px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 shadow-sm transition-all text-sm font-medium disabled:opacity-50"
                                title="Загрузить товары из Excel (Артикул продавца, Наименование, ...)"
                            >
                                <ArrowDownUp size={16} className={`mr-2 ${importLoading ? 'animate-spin' : ''}`} />
                                {importLoading ? 'Анализ...' : 'Импорт Excel'}
                            </button>
                        </>
                    )}

                    {!isReadOnly && (
                        <button
                            onClick={openCreate}
                            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm transition-all text-sm font-medium"
                        >
                            <Plus size={18} className="mr-2" />
                            Новый товар
                        </button>
                    )}
                </div>
            </div>

            {/* Import result banner */}
            {importResult && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-emerald-800 text-sm">
                        <CheckCircle className="h-4 w-4 flex-shrink-0" />
                        <span>
                            Импорт завершён: <b>создано {importResult.createdCount}</b>, обновлено {importResult.updatedCount}
                            {importResult.errorCount > 0 && (
                                <span className="text-amber-700">, требует проверки: {importResult.errorCount}</span>
                            )}
                        </span>
                    </div>
                    <button onClick={() => setImportResult(null)} className="text-emerald-600 hover:text-emerald-800 ml-3">
                        <XCircle className="h-4 w-4" />
                    </button>
                </div>
            )}

            {/* Filters row */}
            <div className="flex flex-col sm:flex-row gap-3">
                {/* Status filter tabs */}
                <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-white shadow-sm">
                    <button
                        onClick={() => setStatusFilter('active')}
                        className={`px-4 py-2 text-sm font-medium transition-colors ${statusFilter === 'active' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                        Активные
                    </button>
                    <button
                        onClick={() => setStatusFilter('deleted')}
                        className={`px-4 py-2 text-sm font-medium transition-colors border-l border-slate-200 ${statusFilter === 'deleted' ? 'bg-slate-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                        Архив
                    </button>
                </div>

                {/* Search */}
                <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200">
                    <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Search className="h-5 w-5 text-slate-400" />
                        </div>
                        <input
                            type="text"
                            placeholder="Поиск по названию, SKU или бренду..."
                            className="block w-full pl-10 pr-3 py-2.5 border-0 rounded-xl focus:ring-blue-500 focus:ring-2 transition-colors"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {/* Product table */}
            <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-2 sm:px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Фото</th>
                                <th className="px-2 sm:px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Название</th>
                                <th className="hidden sm:table-cell px-2 sm:px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">SKU</th>
                                {statusFilter === 'active' && (
                                    <>
                                        <th className="px-2 sm:px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Склад</th>
                                        <th className="hidden md:table-cell px-2 sm:px-4 py-3 text-left text-xs font-semibold text-[#cb11ab]">WB FBS/FBO</th>
                                        <th className="hidden md:table-cell px-2 sm:px-4 py-3 text-left text-xs font-semibold text-[#005bff]">Ozon FBS/FBO</th>
                                        <th className="hidden lg:table-cell px-2 sm:px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Доступно</th>
                                    </>
                                )}
                                {statusFilter === 'deleted' && (
                                    <th className="px-2 sm:px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Удалён</th>
                                )}
                                <th className="px-2 sm:px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Действия</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-slate-200">
                            {products.map((p) => (
                                <tr key={p.id} className={`hover:bg-slate-50 transition-colors ${statusFilter === 'deleted' ? 'opacity-70' : ''}`}>
                                    {/* Фото */}
                                    <td className="px-2 sm:px-4 py-2 sm:py-3">
                                        <div className="flex-shrink-0 w-14 h-14 sm:w-24 sm:h-24 lg:w-40 lg:h-40">
                                            <ProductMediaWidget
                                                productId={p.id}
                                                mainImageFileId={p.mainImageFileId}
                                                legacyPhotoUrl={p.photo}
                                                isReadOnly={isReadOnly || statusFilter === 'deleted'}
                                                onMediaUpdated={(newFileId) =>
                                                    handleMediaUpdated(p.id, newFileId)
                                                }
                                            />
                                        </div>
                                    </td>

                                    {/* Название + бренд/категория */}
                                    <td className="px-2 sm:px-4 py-2 sm:py-3">
                                        <div className="text-xs sm:text-sm font-semibold text-slate-900 max-w-[130px] sm:max-w-xs break-words">{p.name}</div>
                                        <div className="sm:hidden text-[10px] font-mono text-slate-500 mt-0.5">{p.sku}</div>
                                        {p.brand && <div className="text-[10px] text-slate-400 mt-0.5">{p.brand}</div>}
                                        {p.sourceOfTruth === 'IMPORT' && (
                                            <span className="inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100">import</span>
                                        )}
                                        {p.sourceOfTruth === 'SYNC' && (
                                            <span className="inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-100">sync</span>
                                        )}
                                    </td>

                                    {/* SKU */}
                                    <td className="hidden sm:table-cell px-2 sm:px-4 py-2 sm:py-3 min-w-[130px]">
                                        <div className="text-xs font-mono text-slate-700 bg-slate-100 px-2 py-1 rounded inline-block mb-1">{p.sku}</div>
                                        {p.wbBarcode && (
                                            <div className="text-[10px] text-slate-400 font-mono">WB: {p.wbBarcode}</div>
                                        )}
                                    </td>

                                    {/* Stock (active only) */}
                                    {statusFilter === 'active' && (
                                        <>
                                            <td className="px-2 sm:px-4 lg:px-6 py-2 sm:py-4">
                                                <div className="text-xs sm:text-sm text-slate-900 font-medium flex items-center gap-1 mb-1">
                                                    {editingStock?.id === p.id && editingStock?.field === 'total' ? (
                                                        <input type="number" autoFocus className="w-16 sm:w-20 px-2 border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-300" value={editingStock.value} onChange={e => setEditingStock({ ...editingStock, value: e.target.value })} onBlur={() => handleStockUpdate(p.id, 'total', editingStock.value)} onKeyDown={(e) => handleKeyDown(e, p.id, 'total')} />
                                                    ) : (
                                                        <span className={`cursor-pointer text-base sm:text-lg font-bold hover:text-blue-600 hover:underline ${isReadOnly ? 'pointer-events-none' : ''}`} onClick={() => !isReadOnly && setEditingStock({ id: p.id, field: 'total', value: String(p.total) })}>{p.total}</span>
                                                    )}
                                                    <span className="text-slate-500 text-[10px] sm:text-xs">всего</span>
                                                </div>
                                                <div className="text-xs sm:text-sm text-yellow-600 font-medium">{p.reserved} <span className="text-slate-500 font-normal text-[10px] sm:text-xs">в резерве (Ozon)</span></div>
                                            </td>
                                            <td className="hidden md:table-cell px-2 sm:px-4 lg:px-6 py-2 sm:py-4">
                                                <div className="text-xs sm:text-sm font-medium text-[#cb11ab] flex items-center gap-1 mb-1">
                                                    <span>FBS:</span>
                                                    {editingStock?.id === p.id && editingStock?.field === 'wbFbs' ? (
                                                        <input type="number" autoFocus className="w-14 px-1 border border-[#cb11ab] rounded focus:outline-none" value={editingStock.value} onChange={e => setEditingStock({ ...editingStock, value: e.target.value })} onBlur={() => handleStockUpdate(p.id, 'wbFbs', editingStock.value)} onKeyDown={(e) => handleKeyDown(e, p.id, 'wbFbs')} />
                                                    ) : (
                                                        <span className={`${isReadOnly ? '' : 'cursor-pointer hover:underline'}`} onClick={() => !isReadOnly && setEditingStock({ id: p.id, field: 'wbFbs', value: String(p.wbFbs) })}>{p.wbFbs} шт.</span>
                                                    )}
                                                </div>
                                                <div className="text-xs sm:text-sm text-slate-400"><span>FBO:</span> {p.wbFbo} шт.</div>
                                            </td>
                                            <td className="hidden md:table-cell px-2 sm:px-4 lg:px-6 py-2 sm:py-4">
                                                <div className="text-xs sm:text-sm font-medium text-[#005bff] flex items-center gap-1 mb-1">
                                                    <span>FBS:</span>
                                                    {editingStock?.id === p.id && editingStock?.field === 'ozonFbs' ? (
                                                        <input type="number" autoFocus className="w-14 px-1 border border-[#005bff] rounded focus:outline-none" value={editingStock.value} onChange={e => setEditingStock({ ...editingStock, value: e.target.value })} onBlur={() => handleStockUpdate(p.id, 'ozonFbs', editingStock.value)} onKeyDown={(e) => handleKeyDown(e, p.id, 'ozonFbs')} />
                                                    ) : (
                                                        <span className={`${isReadOnly ? '' : 'cursor-pointer hover:underline'}`} onClick={() => !isReadOnly && setEditingStock({ id: p.id, field: 'ozonFbs', value: String(p.ozonFbs) })}>{p.ozonFbs} шт.</span>
                                                    )}
                                                </div>
                                                <div className="text-xs sm:text-sm text-slate-400"><span>FBO:</span> {p.ozonFbo} шт.</div>
                                            </td>
                                            <td className="hidden lg:table-cell px-2 sm:px-4 lg:px-6 py-2 sm:py-4 whitespace-nowrap">
                                                <span className={`px-2 sm:px-3 py-1 inline-flex text-xs sm:text-sm leading-5 font-semibold rounded-full ${p.available > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                                                    {p.available} шт.
                                                </span>
                                            </td>
                                        </>
                                    )}

                                    {/* Deleted at (archived only) */}
                                    {statusFilter === 'deleted' && (
                                        <td className="px-2 sm:px-4 py-2 sm:py-3">
                                            {p.deletedAt ? (
                                                <span className="text-xs text-slate-500">
                                                    {new Date(p.deletedAt).toLocaleDateString('ru-RU')}
                                                </span>
                                            ) : '—'}
                                        </td>
                                    )}

                                    {/* Actions */}
                                    <td className="px-2 sm:px-4 lg:px-6 py-2 sm:py-4 text-right text-sm font-medium min-w-[90px] sm:min-w-[180px]">
                                        {statusFilter === 'active' && (
                                            <div className="flex flex-col items-end gap-1 mb-2">
                                                {(syncResult as any)?.id === p.id && (() => {
                                                    const sr = (syncResult as any).data;
                                                    return (
                                                        <div className="flex flex-col gap-1 text-xs text-right w-full max-w-[220px]">
                                                            <span className={`px-2 py-1 rounded border ${sr?.wb?.success ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-orange-50 border-orange-200 text-orange-700'} whitespace-normal break-words`}>
                                                                <b>WB:</b> {sr?.wb?.success ? 'Обновлено ✅' : sr?.wb?.error}
                                                            </span>
                                                            <span className={`px-2 py-1 rounded border ${sr?.ozon?.success ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-orange-50 border-orange-200 text-orange-700'} whitespace-normal break-words`}>
                                                                <b>Ozon:</b> {sr?.ozon?.success ? 'Обновлено ✅' : sr?.ozon?.error}
                                                            </span>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        )}
                                        <div className="flex justify-end gap-2 items-center">
                                            {statusFilter === 'active' && !isReadOnly && (
                                                <>
                                                    <button onClick={() => handleSync(p.id)} disabled={syncingId === p.id} className="p-2 text-emerald-600 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50" title="Синхронизировать остатки на WB и Ozon">
                                                        <RefreshCw size={18} className={syncingId === p.id ? 'animate-spin' : ''} />
                                                    </button>
                                                    <button onClick={() => openAdjust(p)} className="p-2 text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors" title="Скорректировать остаток">
                                                        <ArrowDownUp size={18} />
                                                    </button>
                                                    <button onClick={() => openEdit(p)} className="p-2 text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors" title="Редактировать">
                                                        <Edit2 size={18} />
                                                    </button>
                                                    <button onClick={() => handleDelete(p.id)} className="p-2 text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors" title="Переместить в архив">
                                                        <Archive size={18} />
                                                    </button>
                                                </>
                                            )}
                                            {statusFilter === 'active' && isReadOnly && (
                                                <span className="text-xs text-slate-400 italic">только чтение</span>
                                            )}
                                            {statusFilter === 'deleted' && !isReadOnly && (
                                                <button onClick={() => handleRestore(p.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors border border-emerald-200" title="Восстановить из архива">
                                                    <RotateCcw size={14} />
                                                    Восстановить
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {products.length === 0 && !loading && (
                                <tr>
                                    <td colSpan={8} className="px-6 py-12 text-center text-slate-500">
                                        {statusFilter === 'deleted' ? 'Архив пуст.' : 'Товары не найдены.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="bg-slate-50 px-4 py-3 border-t border-slate-200 flex items-center justify-between sm:px-6">
                    <button disabled={page === 1} onClick={() => setPage(prev => prev - 1)} className="relative inline-flex items-center px-4 py-2 border border-slate-300 text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50">
                        Назад
                    </button>
                    <span className="text-sm text-slate-700">Стр. <span className="font-semibold">{page}</span> из <span className="font-semibold">{totalPages}</span></span>
                    <button disabled={page >= totalPages} onClick={() => setPage(prev => prev + 1)} className="relative inline-flex items-center px-4 py-2 border border-slate-300 text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50">
                        Вперёд
                    </button>
                </div>
            </div>

            {/* ─────── Modal: Create / Edit ─────── */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
                        <h3 className="text-xl font-bold text-slate-900 mb-6">
                            {modalMode === 'create' ? 'Создать товар' : 'Редактировать товар'}
                        </h3>
                        <form onSubmit={handleSave} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Название</label>
                                <input required type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Артикул (SKU) <span className="text-slate-400 font-normal">(для связи с Ozon и WB)</span>
                                </label>
                                <input required type="text" value={formData.sku} onChange={e => setFormData({ ...formData, sku: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono" />
                                <p className="text-xs text-slate-400 mt-1">ЛК Ozon → Товары и цены → Список товаров → Артикул</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    WB Баркод <span className="text-slate-400 font-normal">(штрихкод для WB API)</span>
                                </label>
                                <input type="text" value={formData.wbBarcode} onChange={e => setFormData({ ...formData, wbBarcode: e.target.value })} placeholder="Например: 2043309181375" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:ring-pink-500 focus:border-pink-500 outline-none font-mono" />
                                <p className="text-xs text-slate-400 mt-1">ЛК WB → Мои товары → Карточка → Баркод</p>
                            </div>
                            {modalMode === 'create' && (
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Начальный остаток</label>
                                    <input required type="number" min="0" value={formData.initialTotal} onChange={e => setFormData({ ...formData, initialTotal: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                                </div>
                            )}
                            {modalMode === 'create' ? (
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Изображение (опционально)</label>
                                    <input type="file" accept="image/*" onChange={e => setFormData({ ...formData, file: e.target.files?.[0] || null })} className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                                    <p className="text-xs text-slate-400 mt-1">JPG, PNG, WebP. Максимум 10 МБ</p>
                                </div>
                            ) : (
                                <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                                    Для управления фото товара наведите курсор на изображение в таблице.
                                </p>
                            )}

                            {formError && (
                                <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                                    {formError}
                                </div>
                            )}

                            {/* ── Связанные артикулы (только в режиме edit) ── */}
                            {modalMode === 'edit' && (
                                <div className="border-t border-slate-100 pt-4 mt-2">
                                    <div className="flex items-center justify-between mb-2">
                                        <p className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                                            <Link2 className="h-4 w-4 text-slate-400" />
                                            Связанные артикулы
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => { setAddMappingOpen(v => !v); setAddMpError(null); }}
                                            className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                                        >
                                            <Plus className="h-3.5 w-3.5" />
                                            Добавить
                                        </button>
                                    </div>

                                    {mappingsLoading && (
                                        <p className="text-xs text-slate-400 italic">Загрузка...</p>
                                    )}

                                    {!mappingsLoading && mappings.length === 0 && (
                                        <p className="text-xs text-slate-400 italic">Нет связанных артикулов</p>
                                    )}

                                    {mappings.map(m => (
                                        <div key={m.id} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${MARKETPLACE_COLORS[m.marketplace] ?? 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                                                    {MARKETPLACE_LABELS[m.marketplace] ?? m.marketplace}
                                                </span>
                                                <span className="text-xs font-mono text-slate-700 truncate">{m.externalProductId}</span>
                                                {m.externalSku && (
                                                    <span className="text-[10px] text-slate-400 truncate">SKU: {m.externalSku}</span>
                                                )}
                                                {m.isAutoMatched && (
                                                    <span className="text-[9px] px-1 py-0.5 rounded bg-slate-100 text-slate-500">auto</span>
                                                )}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => handleDetachMapping(m.id)}
                                                className="ml-2 p-1 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded flex-shrink-0"
                                                title="Отвязать артикул"
                                            >
                                                <Unlink className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    ))}

                                    {/* Add mapping form */}
                                    {addMappingOpen && (
                                        <div className="mt-2 bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                                            <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                    <label className="block text-[10px] text-slate-500 mb-0.5">Маркетплейс</label>
                                                    <select
                                                        value={addMpMarketplace}
                                                        onChange={e => setAddMpMarketplace(e.target.value as 'WB' | 'OZON')}
                                                        className="w-full px-2 py-1 border border-slate-300 rounded text-xs"
                                                    >
                                                        <option value="WB">Wildberries</option>
                                                        <option value="OZON">Ozon</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-[10px] text-slate-500 mb-0.5">Артикул МП *</label>
                                                    <input
                                                        type="text"
                                                        value={addMpExtId}
                                                        onChange={e => setAddMpExtId(e.target.value)}
                                                        placeholder="externalProductId"
                                                        className="w-full px-2 py-1 border border-slate-300 rounded text-xs font-mono"
                                                    />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="block text-[10px] text-slate-500 mb-0.5">SKU (опционально)</label>
                                                <input
                                                    type="text"
                                                    value={addMpExtSku}
                                                    onChange={e => setAddMpExtSku(e.target.value)}
                                                    placeholder="externalSku"
                                                    className="w-full px-2 py-1 border border-slate-300 rounded text-xs font-mono"
                                                />
                                            </div>
                                            {addMpError && (
                                                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 flex items-start gap-1">
                                                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                                                    {addMpError}
                                                </div>
                                            )}
                                            <div className="flex gap-2 pt-1">
                                                <button
                                                    type="button"
                                                    onClick={() => { setAddMappingOpen(false); setAddMpError(null); }}
                                                    className="flex-1 px-2 py-1 text-xs text-slate-600 border border-slate-300 rounded hover:bg-slate-100"
                                                >
                                                    Отмена
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleAddMapping}
                                                    disabled={addMpSubmitting || !addMpExtId.trim()}
                                                    className="flex-1 px-2 py-1 text-xs text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
                                                >
                                                    {addMpSubmitting ? 'Добавляем...' : 'Привязать'}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="mt-6 flex justify-end gap-3">
                                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-300 transition-colors">Отмена</button>
                                <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors">Сохранить</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ─────── Modal: SKU Reuse Confirmation ─────── */}
            {skuReuseId && (
                <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
                        <div className="flex items-start gap-3 mb-4">
                            <div className="p-2 bg-amber-100 rounded-lg flex-shrink-0">
                                <AlertTriangle className="h-5 w-5 text-amber-600" />
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-slate-900">Артикул уже использовался</h3>
                                <p className="text-sm text-slate-600 mt-1">
                                    Товар с артикулом <span className="font-mono font-semibold">{formData.sku}</span> ранее был удалён и находится в архиве.
                                </p>
                                <p className="text-sm text-slate-600 mt-2">
                                    Создать новую карточку с этим артикулом? Старая удалённая карточка останется в архиве.
                                </p>
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 mt-6">
                            <button onClick={() => { setSkuReuseId(null); setPendingFormData(null); }} className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-300 transition-colors">
                                Отмена
                            </button>
                            <button onClick={handleConfirmSkuReuse} className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-sm transition-colors">
                                Создать новую карточку
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─────── Modal: Adjust Stock ─────── */}
            {isAdjustOpen && selectedProduct && (
                <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
                        <h3 className="text-lg font-bold text-slate-900">Корректировка остатка</h3>
                        <p className="text-sm text-slate-500 mt-1 mb-6">Товар: {selectedProduct.name}</p>
                        <form onSubmit={handleAdjust} className="space-y-6">
                            <div className="bg-slate-50 p-4 rounded-lg flex justify-between items-center border border-slate-100">
                                <span className="text-sm text-slate-500">Текущий остаток:</span>
                                <span className="font-bold text-lg text-slate-900">{selectedProduct.total}</span>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Дельта (изменить на)</label>
                                <div className="flex rounded-md shadow-sm">
                                    <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-slate-300 bg-slate-50 text-slate-500 text-sm">+/-</span>
                                    <input type="number" required value={adjustDelta} onChange={e => setAdjustDelta(parseInt(e.target.value) || 0)} className="flex-1 block w-full rounded-none rounded-r-md sm:text-sm border-slate-300 focus:ring-indigo-500 focus:border-indigo-500 border px-3 py-2 outline-none" />
                                </div>
                                <p className="mt-1 text-xs text-slate-500">Итого будет: {Math.max(0, selectedProduct.total + adjustDelta)}</p>
                            </div>
                            <div className="flex justify-end gap-3">
                                <button type="button" onClick={() => setIsAdjustOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-300 transition-colors">Отмена</button>
                                <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors">Применить</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ─────── Modal: Import Preview ─────── */}
            {importPreview && (
                <div className="fixed inset-0 bg-slate-900/60 flex items-start justify-center p-4 z-50 overflow-y-auto">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl my-8 flex flex-col">
                        <div className="p-6 border-b border-slate-200">
                            <h3 className="text-xl font-bold text-slate-900">Предпросмотр импорта</h3>
                            <p className="text-sm text-slate-500 mt-1">Проверьте данные перед применением</p>

                            {/* Summary */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
                                    <div className="text-2xl font-bold text-emerald-700">{importPreview.summary.create}</div>
                                    <div className="text-xs text-emerald-600 mt-0.5">Создать</div>
                                </div>
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                                    <div className="text-2xl font-bold text-blue-700">{importPreview.summary.update}</div>
                                    <div className="text-xs text-blue-600 mt-0.5">Обновить</div>
                                </div>
                                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                                    <div className="text-2xl font-bold text-red-700">{importPreview.summary.manualReview}</div>
                                    <div className="text-xs text-red-600 mt-0.5">Требует проверки</div>
                                </div>
                                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-center">
                                    <div className="text-2xl font-bold text-slate-700">{importPreview.summary.skip}</div>
                                    <div className="text-xs text-slate-500 mt-0.5">Пропустить</div>
                                </div>
                            </div>

                            {importPreview.summary.manualReview > 0 && (
                                <div className="mt-3 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                                    Строки с ошибками будут пропущены при применении. Исправьте данные и повторите импорт.
                                </div>
                            )}
                        </div>

                        {/* Items table */}
                        <div className="flex-1 overflow-y-auto max-h-96">
                            <table className="min-w-full divide-y divide-slate-100">
                                <thead className="bg-slate-50 sticky top-0">
                                    <tr>
                                        <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 w-10">#</th>
                                        <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">SKU</th>
                                        <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Название</th>
                                        <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 w-32">Действие</th>
                                        <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Предупреждения</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {importPreview.items.map((item) => (
                                        <tr key={item.rowNumber} className={`${item.action === 'MANUAL_REVIEW' ? 'bg-red-50/50' : ''}`}>
                                            <td className="px-4 py-2 text-xs text-slate-400">{item.rowNumber}</td>
                                            <td className="px-4 py-2 text-xs font-mono text-slate-700">{item.raw.sku || '—'}</td>
                                            <td className="px-4 py-2 text-xs text-slate-700 max-w-[160px] truncate">{item.raw.name || '—'}</td>
                                            <td className="px-4 py-2">
                                                <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_COLORS[item.action]}`}>
                                                    {ACTION_LABELS[item.action]}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2">
                                                {item.errors.map((err, i) => (
                                                    <div key={i} className="flex items-center gap-1 text-xs text-red-600">
                                                        <XCircle className="h-3 w-3 flex-shrink-0" />
                                                        {err.message}
                                                    </div>
                                                ))}
                                                {item.sourceConflict && (
                                                    <div className="flex items-center gap-1 text-xs text-amber-600">
                                                        <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                                                        Перезапишет ручные изменения
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
                            <button onClick={() => setImportPreview(null)} className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-300 transition-colors">
                                Отмена
                            </button>
                            <button
                                onClick={handleCommitImport}
                                disabled={importCommitting || importPreview.summary.create + importPreview.summary.update === 0}
                                className="px-5 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
                            >
                                {importCommitting ? (
                                    <>
                                        <RefreshCw size={16} className="animate-spin" />
                                        Применяю...
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle size={16} />
                                        Применить ({importPreview.summary.create + importPreview.summary.update} строк)
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
