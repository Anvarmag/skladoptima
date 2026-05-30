import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
    Plus, Edit2, Archive, ArrowDownUp, Search,
    RefreshCw, ImageDown, RotateCcw, AlertTriangle,
    CheckCircle, XCircle, AlertCircle, Download,
    Package, Lock, Unlock, Trash2, MessageSquare,
    ArrowUp, ArrowDown, ChevronsUpDown, Link2, Crown, Unlink,
} from 'lucide-react';
import {
    fetchLocksForProduct, createLock, removeLock,
    type StockLock, type LockType, type Marketplace as LockMarketplace,
} from '../api/stockLocks';
import { useAuth } from '../context/AuthContext';
import AccessStateBanner from '../components/AccessStateBanner';
import ProductMediaWidget from '../components/ProductMediaWidget';
import ProductDetailPanel from '../components/ProductDetailPanel';
import { S, PageHeader, Card, Btn, Badge, MPBadge, Input, Modal, TH, FieldLabel, SkuTag } from '../components/ui';

// ─────────────────────────────── types ───────────────────────────────

interface GroupMember {
    id: string;
    sku: string;
    name: string;
    photo: string | null;
    mainImageFileId: string | null;
    total: number;
    groupRole: 'PRIMARY' | 'SECONDARY' | null;
    channelMappings: Array<{ id: string; marketplace: string; externalProductId: string }>;
}

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
    groupId?: string | null;
    groupRole?: 'PRIMARY' | 'SECONDARY' | null;
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
    const [totalCount, setTotalCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [statusFilter, setStatusFilter] = useState<'active' | 'deleted'>('active');
    const [pageSize, setPageSize] = useState(20);
    const [pageSizeOpen, setPageSizeOpen] = useState(false);
    const [sortBy, setSortBy] = useState<string>('createdAt');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

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

    // Group members in edit modal
    const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
    const [groupLoading, setGroupLoading] = useState(false);
    const [groupLinkOpen, setGroupLinkOpen] = useState(false);
    const [groupLinkQuery, setGroupLinkQuery] = useState('');
    const [groupLinkResults, setGroupLinkResults] = useState<GroupMember[]>([]);
    const [groupLinkSearching, setGroupLinkSearching] = useState(false);
    const [groupLinkError, setGroupLinkError] = useState<string | null>(null);

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

    // Photos
    const [fetchingPhotos, setFetchingPhotos] = useState(false);

    // Import from WB / Ozon
    const [importingFromWb, setImportingFromWb] = useState(false);
    const [importingFromOzon, setImportingFromOzon] = useState(false);

    // Detail panel
    const [detailProduct, setDetailProduct] = useState<Product | null>(null);
    const [detailInitialTab, setDetailInitialTab] = useState<'stocks' | 'orders' | 'diary'>('stocks');

    // Notes count per product (for badge in actions)
    const [notesCountMap, setNotesCountMap] = useState<Record<string, number>>({});

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
                limit: String(pageSize),
                search: search || '',
                sortBy,
                sortDir,
                hideGroupSecondary: 'true',
                ...(statusFilter === 'deleted' ? { status: 'deleted' } : {}),
            });
            const { data } = await axios.get(`/products?${params}`);
            setProducts(data.data);
            setTotalPages(data.meta.lastPage || 1);
            setTotalCount(data.meta.total ?? 0);
            const ids: string[] = (data.data as Product[]).map((p: Product) => p.id);
            if (ids.length > 0) {
                try {
                    const nr = await axios.get<Record<string, number>>('/product-notes-count', { params: { ids: ids.join(',') } });
                    setNotesCountMap(nr.data);
                } catch {
                    setNotesCountMap({});
                }
            } else {
                setNotesCountMap({});
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, search, statusFilter, sortBy, sortDir]);

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
    useEffect(() => { setPage(1); }, [search, statusFilter, pageSize, sortBy, sortDir]);

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

    const handleImportFromOzon = async () => {
        setImportingFromOzon(true);
        try {
            const res = await axios.post('/sync/import/ozon');
            const created = res.data?.created ?? 0;
            const updated = res.data?.updated ?? 0;
            alert(
                created > 0 || updated > 0
                    ? `Загружено из Ozon: новых ${created}, обновлено ${updated}`
                    : 'Новых товаров из Ozon не найдено.',
            );
            fetchProducts();
        } catch (err: any) {
            const msg = err?.response?.data?.message ?? err?.response?.data?.error ?? err?.message ?? 'неизвестная ошибка';
            alert(`Ошибка при загрузке товаров из Ozon: ${msg}`);
        } finally {
            setImportingFromOzon(false);
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
            const msg = err?.response?.data?.message ?? err?.response?.data?.code ?? '';
            if (msg === 'MARKETPLACE_ACCOUNT_NOT_ACTIVE') {
                setLockFormError('Нет активного подключения к этому маркетплейсу. Перейдите в раздел «Подключения» и добавьте аккаунт.');
            } else {
                setLockFormError(msg || 'Не удалось создать блокировку');
            }
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
        setGroupMembers([]);
        setGroupLinkOpen(false);
        setGroupLinkQuery('');
        setGroupLinkError(null);
        setIsModalOpen(true);
        if (p.groupId) loadGroupMembers(p.groupId);
    };

    const loadGroupMembers = async (groupId: string) => {
        setGroupLoading(true);
        try {
            const res = await axios.get(`/catalog/groups/${groupId}/members`);
            setGroupMembers(res.data.products ?? []);
        } catch {
            setGroupMembers([]);
        } finally {
            setGroupLoading(false);
        }
    };

    const handleGroupUnlink = async (memberId: string) => {
        if (!selectedProduct) return;
        try {
            await axios.delete(`/catalog/groups/unlink/${memberId}`);
            // Refresh: if we unlinked self, close group section
            const updated = await axios.get(`/catalog/products/${memberId}`).catch(() => null);
            if (memberId === selectedProduct.id) {
                setGroupMembers([]);
                setSelectedProduct(prev => prev ? { ...prev, groupId: null, groupRole: null } : prev);
            } else if (selectedProduct.groupId) {
                loadGroupMembers(selectedProduct.groupId);
            }
            fetchProducts();
        } catch { /* ignore */ }
    };

    const handleGroupSetPrimary = async (memberId: string) => {
        try {
            await axios.post(`/catalog/groups/primary/${memberId}`);
            if (selectedProduct?.groupId) loadGroupMembers(selectedProduct.groupId);
            fetchProducts();
        } catch { /* ignore */ }
    };

    const handleGroupLink = async (targetId: string) => {
        if (!selectedProduct) return;
        setGroupLinkError(null);
        try {
            const res = await axios.post('/catalog/groups/link', { productAId: selectedProduct.id, productBId: targetId });
            const newGroupId = res.data?.id ?? selectedProduct.groupId;
            setGroupLinkOpen(false);
            setGroupLinkQuery('');
            // Update selectedProduct with new groupId
            const updatedGroup = newGroupId;
            setSelectedProduct(prev => prev ? { ...prev, groupId: updatedGroup } : prev);
            loadGroupMembers(newGroupId);
            fetchProducts();
        } catch (e: any) {
            const code = e?.response?.data?.code;
            if (code === 'BOTH_IN_DIFFERENT_GROUPS') {
                setGroupLinkError('Оба товара уже в разных группах. Сначала отвяжите один из них.');
            } else if (code === 'ALREADY_LINKED') {
                setGroupLinkError('Товары уже в одной группе.');
            } else {
                setGroupLinkError(e?.response?.data?.message ?? 'Ошибка связки');
            }
        }
    };

    // ─────────── group link search ───────────
    useEffect(() => {
        if (!groupLinkOpen || groupLinkQuery.trim().length < 1) { setGroupLinkResults([]); return; }
        const t = setTimeout(async () => {
            setGroupLinkSearching(true);
            try {
                const res = await axios.get('/catalog/groups/search', {
                    params: { q: groupLinkQuery.trim(), excludeId: selectedProduct?.id },
                });
                setGroupLinkResults(res.data);
            } catch { setGroupLinkResults([]); }
            finally { setGroupLinkSearching(false); }
        }, 250);
        return () => clearTimeout(t);
    }, [groupLinkQuery, groupLinkOpen, selectedProduct?.id]);

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
                                cursor: 'pointer',
                            }} onClick={() => { setDetailInitialTab('stocks'); setDetailProduct(p); }}>
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
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        {(notesCountMap[p.id] ?? 0) > 0 && (
                                            <span style={{
                                                display: 'inline-flex', alignItems: 'center', gap: 3,
                                                background: '#dcfce7', color: S.green,
                                                borderRadius: 6, padding: '2px 6px',
                                                fontFamily: 'Inter', fontSize: 10, fontWeight: 600,
                                            }}>
                                                <MessageSquare size={10} />
                                                {notesCountMap[p.id]}
                                            </span>
                                        )}
                                        <Badge label={avail === 0 ? 'Нет' : avail <= 5 ? 'Мало' : 'В наличии'} bg={ac.bg} color={ac.color} />
                                    </div>
                                </div>
                                {/* Кнопки действий */}
                                {!isReadOnly && (
                                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }} onClick={e => e.stopPropagation()}>
                                        <button onClick={() => openEdit(p)} style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1px solid #e2e8f0', background: 'transparent', fontFamily: 'Inter', fontSize: 12, fontWeight: 500, color: '#0f172a', cursor: 'pointer' }}>
                                            Редактировать
                                        </button>
                                        <button onClick={() => openAdjust(p)} style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', background: '#f1f5f9', fontFamily: 'Inter', fontSize: 12, fontWeight: 500, color: '#0f172a', cursor: 'pointer' }}>
                                            Остатки
                                        </button>
                                        <button
                                            onClick={() => { setDetailInitialTab('diary'); setDetailProduct(p); }}
                                            style={{
                                                position: 'relative', padding: '8px 10px', borderRadius: 8,
                                                border: 'none', background: '#f1f5f9', cursor: 'pointer',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                color: (notesCountMap[p.id] ?? 0) > 0 ? S.green : '#94a3b8',
                                            }}
                                            title="Заметки"
                                        >
                                            <MessageSquare size={15} />
                                            {(notesCountMap[p.id] ?? 0) > 0 && (
                                                <span style={{
                                                    position: 'absolute', top: 2, right: 2,
                                                    minWidth: 13, height: 13, borderRadius: 7,
                                                    background: S.green, color: '#fff',
                                                    fontSize: 8, fontWeight: 700, fontFamily: 'Inter',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    lineHeight: 1, padding: '0 2px',
                                                }}>
                                                    {notesCountMap[p.id]}
                                                </span>
                                            )}
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

                {/* ─── Product detail panel ─── */}
                {detailProduct && (
                    <ProductDetailPanel
                        product={detailProduct}
                        onClose={() => setDetailProduct(null)}
                        onNotesChange={(pid, count) => setNotesCountMap(prev => ({ ...prev, [pid]: count }))}
                        initialTab={detailInitialTab}
                    />
                )}
            </div>
        );
    }

    const handleSort = (field: string) => {
        if (sortBy === field) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(field);
            setSortDir('asc');
        }
    };

    const SortIcon = ({ field }: { field: string }) => {
        const active = sortBy === field;
        if (!active) return <ChevronsUpDown size={14} style={{ opacity: 0.35, flexShrink: 0 }} />;
        return sortDir === 'asc'
            ? <ArrowUp size={14} color={S.blue} style={{ flexShrink: 0 }} />
            : <ArrowDown size={14} color={S.blue} style={{ flexShrink: 0 }} />;
    };

    const SortTh = ({
        field, label, sortBy: curSort, onSort, thSt: style, children,
    }: {
        field: string; label: string; sortBy: string;
        onSort: (f: string) => void; thSt: React.CSSProperties; children: React.ReactNode;
    }) => {
        const active = curSort === field;
        return (
            <th
                style={style}
                onClick={() => onSort(field)}
                onMouseEnter={e => {
                    (e.currentTarget as HTMLTableCellElement).style.color = S.blue;
                    (e.currentTarget as HTMLTableCellElement).style.background = '#eff6ff';
                }}
                onMouseLeave={e => {
                    (e.currentTarget as HTMLTableCellElement).style.color = active ? S.blue : '';
                    (e.currentTarget as HTMLTableCellElement).style.background = '';
                }}
            >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: active ? S.blue : undefined }}>
                    {label}
                    {children}
                </span>
            </th>
        );
    };

    const thSt: React.CSSProperties = { fontFamily: 'Inter', fontSize: 12, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '10px 16px', textAlign: 'left', verticalAlign: 'middle', whiteSpace: 'nowrap' };
    const thSortSt: React.CSSProperties = { ...thSt, cursor: 'pointer', userSelect: 'none' };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {accessState && <AccessStateBanner accessState={accessState} />}

            {/* Header */}
            <PageHeader title="Остатки товаров" subtitle="Управление запасами по всем маркетплейсам">
                {!isReadOnly && (
                    <Btn variant="ghost" size="sm" onClick={handleFetchPhotos} disabled={fetchingPhotos} title="Обновить фото товаров с маркетплейсов">
                        <ImageDown size={13} style={{ animation: fetchingPhotos ? 'spin 1s linear infinite' : undefined }} />
                        {fetchingPhotos ? 'Обновление…' : 'Обновить фото'}
                    </Btn>
                )}
                {!isReadOnly && (
                    <Btn variant="wb" size="sm" onClick={handleImportFromWb} disabled={importingFromWb} title="Синхронизировать товары с Wildberries">
                        <Download size={13} />
                        {importingFromWb ? 'Загрузка…' : 'Синхр. WB'}
                    </Btn>
                )}
                {!isReadOnly && (
                    <Btn variant="oz" size="sm" onClick={handleImportFromOzon} disabled={importingFromOzon} title="Синхронизировать товары с Ozon">
                        <Download size={13} />
                        {importingFromOzon ? 'Загрузка…' : 'Синхр. Ozon'}
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

                {/* Table */}
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                    <colgroup>
                        <col style={{ width: 104 }} />
                        <col style={{ width: '28%' }} />
                        <col style={{ width: '16%' }} />
                        {statusFilter === 'active' && <>
                            <col style={{ width: '11%' }} />
                            <col style={{ width: '11%' }} />
                            <col style={{ width: '11%' }} />
                            <col style={{ width: '9%' }} />
                        </>}
                        {statusFilter === 'deleted' && <col style={{ width: '12%' }} />}
                        <col style={{ width: '14%' }} />
                    </colgroup>
                    <thead>
                        <tr style={{ background: '#fafbfc', borderBottom: `1px solid ${S.border}` }}>
                            <th style={thSt}>Фото</th>
                            <SortTh field="name" label="Название" sortBy={sortBy} onSort={handleSort} thSt={thSortSt}><SortIcon field="name" /></SortTh>
                            <SortTh field="sku" label="SKU" sortBy={sortBy} onSort={handleSort} thSt={thSortSt}><SortIcon field="sku" /></SortTh>
                            {statusFilter === 'active' && <>
                                <SortTh field="total" label="Склад" sortBy={sortBy} onSort={handleSort} thSt={{ ...thSortSt, borderLeft: `1px solid ${S.border}` }}><SortIcon field="total" /></SortTh>
                                <th style={thSt}><span style={{ color: S.wb }}>WB</span> FBS/FBO</th>
                                <th style={thSt}><span style={{ color: S.oz }}>Ozon</span> FBS/FBO</th>
                                <th style={thSt}>Доступно</th>
                            </>}
                            {statusFilter === 'deleted' && <th style={thSt}>Удалён</th>}
                            <th style={{ ...thSt, borderLeft: `1px solid ${S.border}` }}>Действия</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={99} style={{ padding: '32px 24px', textAlign: 'center', fontFamily: 'Inter', fontSize: 13, color: S.muted }}>Загрузка…</td></tr>
                        )}
                        {!loading && products.length === 0 && (
                            <tr><td colSpan={99} style={{ padding: '32px 24px', textAlign: 'center', fontFamily: 'Inter', fontSize: 13, color: S.muted }}>{statusFilter === 'deleted' ? 'Архив пуст.' : 'Товары не найдены.'}</td></tr>
                        )}
                        {products.map((p) => {
                    const ac = availColor(p.available);
                    return (
                        <tr
                            key={p.id}
                            style={{ borderBottom: `1px solid ${S.border}`, transition: 'background 0.15s', opacity: statusFilter === 'deleted' ? 0.75 : 1 }}
                            onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                            {/* Photo */}
                            <td style={{ padding: '8px 16px', verticalAlign: 'middle' }}>
                                <div style={{ width: 72, height: 96, borderRadius: 10, overflow: 'hidden' }}>
                                    <ProductMediaWidget
                                        productId={p.id}
                                        mainImageFileId={p.mainImageFileId}
                                        legacyPhotoUrl={p.photo}
                                        isReadOnly={isReadOnly || statusFilter === 'deleted'}
                                        onMediaUpdated={(newFileId) => handleMediaUpdated(p.id, newFileId)}
                                    />
                                </div>
                            </td>

                            {/* Name */}
                            <td style={{ padding: '0 16px', verticalAlign: 'middle', cursor: 'pointer' }} onClick={() => { setDetailInitialTab('stocks'); setDetailProduct(p); }}>
                                <div style={{ fontFamily: 'Inter', fontSize: 15, fontWeight: 600, color: S.ink, marginBottom: 2 }}>{p.name}</div>
                                {p.brand && <div style={{ fontFamily: 'Inter', fontSize: 13, color: S.muted }}>{p.brand}</div>}
                                {p.sourceOfTruth === 'IMPORT' && <span style={{ display: 'inline-block', fontFamily: 'Inter', fontSize: 10, color: S.blue, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 4, padding: '1px 5px', marginTop: 2 }}>import</span>}
                                {p.sourceOfTruth === 'SYNC' && <span style={{ display: 'inline-block', fontFamily: 'Inter', fontSize: 10, color: S.green, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 4, padding: '1px 5px', marginTop: 2 }}>sync</span>}
                            </td>

                            {/* SKU */}
                            <td style={{ padding: '0 16px', verticalAlign: 'middle', cursor: 'pointer' }} onClick={() => { setDetailInitialTab('stocks'); setDetailProduct(p); }}>
                                <SkuTag>{p.sku}</SkuTag>
                                {p.wbBarcode && <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: S.muted, marginTop: 3 }}>WB: {p.wbBarcode}</div>}
                            </td>

                            {/* Stock columns (active) */}
                            {statusFilter === 'active' && <>
                                <td style={{ padding: '0 16px', verticalAlign: 'middle', borderLeft: `1px solid ${S.border}` }}>
                                    {editingStock?.id === p.id && editingStock?.field === 'total' ? (
                                        <input type="number" autoFocus style={{ width: 60, padding: '4px 8px', border: `1px solid ${S.blue}`, borderRadius: 6, fontFamily: 'Inter', fontSize: 13, outline: 'none' }} value={editingStock.value} onChange={e => setEditingStock({ ...editingStock, value: e.target.value })} onBlur={() => handleStockUpdate(p.id, 'total', editingStock.value)} onKeyDown={e => handleKeyDown(e, p.id, 'total')} />
                                    ) : (
                                        <span style={{ fontFamily: 'Inter', fontSize: 16, fontWeight: 700, color: S.ink, cursor: isReadOnly ? 'default' : 'pointer' }} onClick={() => !isReadOnly && setEditingStock({ id: p.id, field: 'total', value: String(p.total) })}>{p.total}</span>
                                    )}
                                    <span style={{ fontFamily: 'Inter', fontSize: 13, color: S.muted }}> / резерв {p.reserved}</span>
                                </td>
                                <td style={{ padding: '0 16px', verticalAlign: 'middle' }}>
                                    {editingStock?.id === p.id && editingStock?.field === 'wbFbs' ? (
                                        <input type="number" autoFocus style={{ width: 50, padding: '4px 6px', border: `1px solid ${S.wb}`, borderRadius: 6, fontFamily: 'Inter', fontSize: 12, outline: 'none' }} value={editingStock.value} onChange={e => setEditingStock({ ...editingStock, value: e.target.value })} onBlur={() => handleStockUpdate(p.id, 'wbFbs', editingStock.value)} onKeyDown={e => handleKeyDown(e, p.id, 'wbFbs')} />
                                    ) : (
                                        <span style={{ fontFamily: 'Inter', fontSize: 14, color: S.wb, fontWeight: 600, cursor: isReadOnly ? 'default' : 'pointer' }} onClick={() => !isReadOnly && setEditingStock({ id: p.id, field: 'wbFbs', value: String(p.wbFbs) })}>{p.wbFbs}</span>
                                    )}
                                    <span style={{ color: S.muted, fontFamily: 'Inter', fontSize: 14 }}>/</span>
                                    <span style={{ fontFamily: 'Inter', fontSize: 14, color: S.wb, fontWeight: 600 }}>{p.wbFbo}</span>
                                </td>
                                <td style={{ padding: '0 16px', verticalAlign: 'middle' }}>
                                    {editingStock?.id === p.id && editingStock?.field === 'ozonFbs' ? (
                                        <input type="number" autoFocus style={{ width: 50, padding: '4px 6px', border: `1px solid ${S.oz}`, borderRadius: 6, fontFamily: 'Inter', fontSize: 12, outline: 'none' }} value={editingStock.value} onChange={e => setEditingStock({ ...editingStock, value: e.target.value })} onBlur={() => handleStockUpdate(p.id, 'ozonFbs', editingStock.value)} onKeyDown={e => handleKeyDown(e, p.id, 'ozonFbs')} />
                                    ) : (
                                        <span style={{ fontFamily: 'Inter', fontSize: 14, color: S.oz, fontWeight: 600, cursor: isReadOnly ? 'default' : 'pointer' }} onClick={() => !isReadOnly && setEditingStock({ id: p.id, field: 'ozonFbs', value: String(p.ozonFbs) })}>{p.ozonFbs}</span>
                                    )}
                                    <span style={{ color: S.muted, fontFamily: 'Inter', fontSize: 14 }}>/</span>
                                    <span style={{ fontFamily: 'Inter', fontSize: 14, color: S.oz, fontWeight: 600 }}>{p.ozonFbo}</span>
                                </td>
                                <td style={{ padding: '0 16px', verticalAlign: 'middle' }}>
                                    <Badge label={`${p.available} шт.`} bg={ac.bg} color={ac.color} />
                                </td>
                            </>}

                            {/* Deleted at */}
                            {statusFilter === 'deleted' && (
                                <td style={{ padding: '0 16px', verticalAlign: 'middle', fontFamily: 'Inter', fontSize: 12, color: S.muted }}>
                                    {p.deletedAt ? new Date(p.deletedAt).toLocaleDateString('ru-RU') : '—'}
                                </td>
                            )}

                            {/* Actions */}
                            <td style={{ padding: '0 12px', verticalAlign: 'middle', borderLeft: `1px solid ${S.border}` }} onClick={e => e.stopPropagation()}>
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
                                            <ActionBtn onClick={() => handleSync(p.id)} disabled={syncingId === p.id} title="Синхронизировать остатки">
                                                <RefreshCw size={18} style={{ animation: syncingId === p.id ? 'spin 1s linear infinite' : undefined }} />
                                            </ActionBtn>
                                            <ActionBtn onClick={() => openAdjust(p)} title="Корректировка остатка">
                                                <ArrowDownUp size={18} />
                                            </ActionBtn>
                                            <ActionBtn onClick={() => openEdit(p)} title="Редактировать">
                                                <Edit2 size={18} />
                                            </ActionBtn>
                                            <ActionBtn onClick={() => { setDetailInitialTab('diary'); setDetailProduct(p); }} title="Заметки">
                                                <div style={{ position: 'relative', display: 'flex' }}>
                                                    <MessageSquare size={18} />
                                                    {(notesCountMap[p.id] ?? 0) > 0 && (
                                                        <span style={{
                                                            position: 'absolute', top: -5, right: -6,
                                                            minWidth: 14, height: 14, borderRadius: 7,
                                                            background: S.blue, color: '#fff',
                                                            fontSize: 9, fontWeight: 700, fontFamily: 'Inter',
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            lineHeight: 1, padding: '0 3px',
                                                        }}>
                                                            {notesCountMap[p.id]}
                                                        </span>
                                                    )}
                                                </div>
                                            </ActionBtn>
                                            <ActionBtn onClick={() => openLockModal(p)} title="Блокировки остатков">
                                                {(locksMap[p.id]?.length ?? 0) > 0 ? <Lock size={18} /> : <Unlock size={18} />}
                                            </ActionBtn>
                                            <ActionBtn onClick={() => handleDelete(p.id)} title="В архив">
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
                            </td>
                        </tr>
                    );
                })}
                    </tbody>
                </table>

                {/* Pagination */}
                <div style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${S.border}` }}>
                    {/* Строк на странице */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
                        <span style={{ fontFamily: 'Inter', fontSize: 13, color: S.muted }}>Строк на странице:</span>
                        <button
                            onClick={() => setPageSizeOpen(v => !v)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 4,
                                padding: '4px 10px', border: `1px solid ${S.border}`, borderRadius: 7,
                                background: '#fff', fontFamily: 'Inter', fontSize: 13, fontWeight: 600,
                                color: S.ink, cursor: 'pointer',
                            }}
                        >
                            {pageSize}
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: pageSizeOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }}>
                                <path d="M2 4l4 4 4-4" stroke={S.muted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>
                        {pageSizeOpen && (
                            <>
                                <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setPageSizeOpen(false)} />
                                <div style={{
                                    position: 'absolute', bottom: '100%', left: 0, marginBottom: 4, zIndex: 100,
                                    background: '#fff', border: `1px solid ${S.border}`, borderRadius: 10,
                                    boxShadow: '0 4px 16px rgba(0,0,0,0.1)', overflow: 'hidden', minWidth: 80,
                                }}>
                                    {[5, 10, 20, 50, 100].map(n => (
                                        <button
                                            key={n}
                                            onClick={() => { setPageSize(n); setPageSizeOpen(false); }}
                                            style={{
                                                display: 'block', width: '100%', textAlign: 'left',
                                                padding: '8px 16px', border: 'none', cursor: 'pointer',
                                                fontFamily: 'Inter', fontSize: 13, fontWeight: n === pageSize ? 700 : 400,
                                                background: n === pageSize ? '#f1f5f9' : 'transparent',
                                                color: n === pageSize ? S.blue : S.ink,
                                            }}
                                        >{n}</button>
                                    ))}
                                </div>
                            </>
                        )}
                        <span style={{ fontFamily: 'Inter', fontSize: 13, color: S.muted }}>
                            {totalCount > 0 && `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, totalCount)} из ${totalCount}`}
                        </span>
                    </div>
                    {/* Навигация */}
                    <div style={{ display: 'flex', gap: 4 }}>
                        <Btn variant="secondary" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>← Назад</Btn>
                        {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                            const p = i + 1;
                            const isActive = p === page;
                            return (
                                <div key={p} onClick={() => setPage(p)} style={{
                                    width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: isActive ? S.ink : '#fff',
                                    border: isActive ? 'none' : `1px solid ${S.border}`,
                                    borderRadius: 8, fontFamily: 'Inter', fontSize: 13, fontWeight: 600,
                                    color: isActive ? '#fff' : S.ink, cursor: 'pointer',
                                }}>{p}</div>
                            );
                        })}
                        <Btn variant="secondary" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Вперёд →</Btn>
                    </div>
                </div>
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

                    {/* ── Связанные товары (group members) ── */}
                    {modalMode === 'edit' && (
                        <div style={{ borderTop: `1px solid ${S.border}`, paddingTop: 14 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: S.ink }}>
                                    <Link2 size={14} color={S.blue} />
                                    Связанные товары
                                    {groupMembers.length > 0 && (
                                        <span style={{ fontSize: 11, color: S.muted, fontWeight: 400 }}>· {groupMembers.length} {groupMembers.length === 1 ? 'товар' : 'товара'}</span>
                                    )}
                                </div>
                                {!isReadOnly && (
                                    <Btn variant="ghost" size="sm" type="button" onClick={() => { setGroupLinkOpen(v => !v); setGroupLinkError(null); setGroupLinkQuery(''); }}>
                                        <Plus size={12} /> Добавить
                                    </Btn>
                                )}
                            </div>

                            {groupLoading && <p style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted }}>Загрузка…</p>}

                            {!groupLoading && groupMembers.length === 0 && !groupLinkOpen && (
                                <p style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted }}>Нет связанных товаров</p>
                            )}

                            {!groupLoading && groupMembers.map(m => {
                                const thumb = m.mainImageFileId ? `/api/files/${m.mainImageFileId}/thumb` : m.photo ?? null;
                                const isPrimary = m.groupRole === 'PRIMARY';
                                const isSelf = m.id === selectedProduct?.id;
                                return (
                                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${S.border}` }}>
                                        {/* thumb */}
                                        <div style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0, background: '#f1f5f9', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${S.border}` }}>
                                            {thumb ? <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Package size={16} color="#94a3b8" />}
                                        </div>
                                        {/* info */}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                                <SkuTag>{m.sku}</SkuTag>
                                                {isPrimary && (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700, color: '#92400e', background: '#fef3c7', padding: '1px 6px', borderRadius: 4 }}>
                                                        <Crown size={9} /> Главный
                                                    </span>
                                                )}
                                                {isSelf && <span style={{ fontSize: 10, color: S.muted, fontStyle: 'italic' }}>этот товар</span>}
                                            </div>
                                            <div style={{ fontFamily: 'Inter', fontSize: 12, color: S.sub, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                                        </div>
                                        {/* actions */}
                                        {!isReadOnly && !isSelf && (
                                            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                                {!isPrimary && (
                                                    <button type="button" onClick={() => handleGroupSetPrimary(m.id)} title="Сделать главным" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px 6px', borderRadius: 4, fontFamily: 'Inter', fontSize: 11, color: S.amber, display: 'flex', alignItems: 'center', gap: 3 }}>
                                                        <Crown size={11} /> Главным
                                                    </button>
                                                )}
                                                <button type="button" onClick={() => handleGroupUnlink(m.id)} title="Отвязать" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px 6px', borderRadius: 4, fontFamily: 'Inter', fontSize: 11, color: S.red, display: 'flex', alignItems: 'center', gap: 3 }}>
                                                    <Unlink size={11} /> Отвязать
                                                </button>
                                            </div>
                                        )}
                                        {!isReadOnly && isSelf && (
                                            <button type="button" onClick={() => handleGroupUnlink(m.id)} title="Покинуть группу" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px 6px', borderRadius: 4, fontFamily: 'Inter', fontSize: 11, color: S.red, display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                                                <Unlink size={11} /> Отвязать
                                            </button>
                                        )}
                                    </div>
                                );
                            })}

                            {/* Link picker inline */}
                            {groupLinkOpen && (
                                <div style={{ marginTop: 10, background: '#f8fafc', border: `1px solid ${S.border}`, borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div style={{ position: 'relative' }}>
                                        <Search size={13} color={S.muted} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                                        <input
                                            autoFocus
                                            type="text"
                                            value={groupLinkQuery}
                                            onChange={e => setGroupLinkQuery(e.target.value)}
                                            placeholder="Поиск по названию или SKU…"
                                            style={{ width: '100%', padding: '7px 10px 7px 28px', borderRadius: 8, border: `1px solid ${S.border}`, fontFamily: 'Inter', fontSize: 12, color: S.ink, outline: 'none', boxSizing: 'border-box' }}
                                        />
                                    </div>
                                    {groupLinkError && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'Inter', fontSize: 12, color: S.red, background: 'rgba(239,68,68,0.06)', borderRadius: 6, padding: '6px 8px' }}>
                                            <AlertCircle size={12} /> {groupLinkError}
                                        </div>
                                    )}
                                    {groupLinkSearching && <p style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted, margin: 0 }}>Поиск…</p>}
                                    {!groupLinkSearching && groupLinkQuery.trim().length > 0 && groupLinkResults.length === 0 && (
                                        <p style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted, margin: 0 }}>Товары не найдены</p>
                                    )}
                                    {!groupLinkSearching && groupLinkQuery.trim().length === 0 && (
                                        <p style={{ fontFamily: 'Inter', fontSize: 12, color: S.muted, margin: 0 }}>Введите название или SKU товара</p>
                                    )}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 160, overflowY: 'auto' }}>
                                        {groupLinkResults.map(r => (
                                            <button key={r.id} type="button" onClick={() => handleGroupLink(r.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 8, border: 'none', background: '#fff', cursor: 'pointer', textAlign: 'left', width: '100%' }}
                                                onMouseEnter={e => (e.currentTarget.style.background = '#f1f5f9')}
                                                onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                                            >
                                                <SkuTag>{r.sku}</SkuTag>
                                                <span style={{ fontFamily: 'Inter', fontSize: 12, color: S.ink, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                                                {r.groupRole === 'PRIMARY' && <span style={{ fontSize: 10, color: '#92400e', background: '#fef3c7', padding: '1px 5px', borderRadius: 4, flexShrink: 0 }}>Главный</span>}
                                                {r.groupId && r.groupRole !== 'PRIMARY' && <span style={{ fontSize: 10, color: S.muted, background: '#f1f5f9', padding: '1px 5px', borderRadius: 4, flexShrink: 0 }}>В группе</span>}
                                            </button>
                                        ))}
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                        <Btn type="button" variant="secondary" size="sm" onClick={() => { setGroupLinkOpen(false); setGroupLinkError(null); }}>Отмена</Btn>
                                    </div>
                                </div>
                            )}
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

            {/* ─── Product detail panel ─── */}
            {detailProduct && (
                <ProductDetailPanel
                    product={detailProduct}
                    onClose={() => setDetailProduct(null)}
                    onNotesChange={(pid, count) => setNotesCountMap(prev => ({ ...prev, [pid]: count }))}
                    initialTab={detailInitialTab}
                />
            )}
        </div>
    );
}

// ─── Action button helper ─────────────────────────────────────────────────────
function ActionBtn({ children, onClick, disabled, title }: {
    children: React.ReactNode; onClick?: () => void; disabled?: boolean; color?: string; title?: string;
}) {
    const [hovered, setHovered] = useState(false);
    return (
        <button
            onClick={onClick} disabled={disabled} title={title}
            style={{
                background: hovered ? `${S.blue}15` : 'transparent',
                border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
                padding: 7, borderRadius: 6, color: hovered ? S.blue : '#64748b',
                display: 'flex', opacity: disabled ? 0.4 : 1, transition: 'all 0.15s',
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >{children}</button>
    );
}
