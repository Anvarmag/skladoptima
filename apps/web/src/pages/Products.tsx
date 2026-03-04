import { useState, useEffect } from 'react';
import axios from 'axios';
import { Plus, Edit2, Archive, ArrowDownUp, Search, Package, RefreshCw, ImageDown } from 'lucide-react';

interface Product {
    id: string;
    sku: string;
    name: string;
    total: number;
    reserved: number;
    available: number;
    photo: string | null;
    ozonFbs: number;
    ozonFbo: number;
    wbFbs: number;
    wbFbo: number;
    wbBarcode?: string;
}

export default function Products() {
    const [products, setProducts] = useState<Product[]>([]);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(false);
    const [editingStock, setEditingStock] = useState<{ id: string; field: keyof Product; value: string } | null>(null);
    const [syncingId, setSyncingId] = useState<string | null>(null);
    const [syncResult, setSyncResult] = useState<{ id: string; data: any } | null>(null);

    // Modals state
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

    // Stock adjust state
    const [isAdjustOpen, setIsAdjustOpen] = useState(false);
    const [adjustDelta, setAdjustDelta] = useState(0);

    // Form state
    const [formData, setFormData] = useState({
        name: '',
        sku: '',
        wbBarcode: '',
        initialTotal: '0',
        file: null as File | null,
    });

    const fetchProducts = async () => {
        setLoading(true);
        try {
            const { data } = await axios.get(`/products?page=${page}&search=${search}`);
            setProducts(data.data);
            setTotalPages(data.meta.lastPage || 1);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const timer = setTimeout(() => fetchProducts(), 300);
        return () => clearTimeout(timer);
    }, [search, page]);

    // Обновляем список товаров каждые 30 секунд — сервер сам опрашивает WB в фоне
    useEffect(() => {
        const interval = setInterval(() => fetchProducts(), 30_000);
        return () => clearInterval(interval);
    }, [search, page]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        const data = new FormData();
        data.append('name', formData.name);
        data.append('sku', formData.sku);
        if (formData.wbBarcode) data.append('wbBarcode', formData.wbBarcode);
        if (formData.file) {
            data.append('photo', formData.file);
        }

        try {
            if (modalMode === 'create') {
                data.append('initialTotal', formData.initialTotal);
                await axios.post('/products', data);
                // Auto-fetch photo from marketplace if no photo was uploaded
                if (!formData.file) {
                    try { await axios.post('/sync/metadata'); } catch { /* ignore */ }
                }
            } else if (selectedProduct) {
                await axios.put(`/ products / ${selectedProduct.id} `, data);
            }
            setIsModalOpen(false);
            fetchProducts();
        } catch (err) {
            alert('Ошибка при сохранении, возможно такой SKU уже есть');
        }
    };

    const [fetchingPhotos, setFetchingPhotos] = useState(false);
    const handleFetchPhotos = async () => {
        setFetchingPhotos(true);
        try {
            const res = await axios.post('/sync/metadata');
            const updated = res.data?.updated ?? 0;
            alert(updated > 0 ? `Обновлено фото: ${updated} ` : 'Новых фото не найдено');
            fetchProducts();
        } catch {
            alert('Ошибка при подтягивании фото');
        } finally {
            setFetchingPhotos(false);
        }
    };

    const handleAdjust = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (!selectedProduct) return;
            await axios.post(`/ products / ${selectedProduct.id}/stock-adjust`, {
                delta: adjustDelta,
                note: 'Ручная корректировка',
            });
            setIsAdjustOpen(false);
            fetchProducts();
        } catch (err) {
            alert('Ошибка при корректировке (остаток не может быть меньше 0)');
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('Точно удалить этот товар?')) return;
        try {
            await axios.delete(`/products/${id}`);
            fetchProducts();
        } catch (err) {
            console.error(err);
        }
    };

    const handleStockUpdate = async (id: string, field: keyof Product, value: string) => {
        const numValue = parseInt(value) || 0;
        const isSyncField = field === 'total' || field === 'wbFbs' || field === 'ozonFbs';

        // Optimistically update all synced fields at once
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
                // Adjust internal stock
                const delta = numValue - product.total;
                if (delta !== 0) {
                    await axios.post(`/products/${id}/stock-adjust`, {
                        delta,
                        note: '\u0421\u0438\u043d\u0445\u0440\u043e\u043d\u0438\u0437\u0430\u0446\u0438\u044f',
                    });
                }
                // Update WB FBS and Ozon FBS to same value
                await axios.put(`/products/${id}`, { wbFbs: numValue, ozonFbs: numValue });
            } else {
                await axios.put(`/products/${id}`, { [field]: numValue });
            }

            handleSync(id);
            fetchProducts();
        } catch (err) {
            alert('\u041e\u0448\u0438\u0431\u043a\u0430 \u043f\u0440\u0438 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0438');
            fetchProducts();
        }
    };

    const handleSync = async (id: string) => {
        setSyncingId(id);
        setSyncResult(null);
        try {
            const { data } = await axios.post(`/sync/product/${id}`);
            setSyncResult({ id, data } as any);
            setTimeout(() => setSyncResult(null), 8000);
        } catch (e: any) {
            setSyncResult({ id, data: { wb: { success: false, error: 'Ошибка сервера' }, ozon: { success: false, error: 'Ошибка сервера' } } } as any);
            setTimeout(() => setSyncResult(null), 8000);
        } finally {
            setSyncingId(null);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent, id: string, field: keyof Product) => {
        if (e.key === 'Enter') {
            handleStockUpdate(id, field, editingStock!.value);
        } else if (e.key === 'Escape') {
            setEditingStock(null);
        }
    };

    const openCreate = () => {
        setModalMode('create');
        setSelectedProduct(null);
        setFormData({ name: '', sku: '', wbBarcode: '', initialTotal: '0', file: null });
        setIsModalOpen(true);
    };

    const openEdit = (p: Product) => {
        setModalMode('edit');
        setSelectedProduct(p);
        setFormData({ name: p.name, sku: p.sku, wbBarcode: (p as any).wbBarcode || '', initialTotal: '0', file: null });
        setIsModalOpen(true);
    };

    const openAdjust = (p: Product) => {
        setSelectedProduct(p);
        setAdjustDelta(0);
        setIsAdjustOpen(true);
    };

    const getImageUrl = (path: string | null) => {
        if (!path) return '';
        if (path.startsWith('http')) return path;
        // Vite proxy forwards /uploads to localhost:3000, so use the path directly
        return path.startsWith('/') ? path : `/${path}`;
    };

    return (
        <div className="space-y-6 animate-fade-in pb-12">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Управление Товарами</h1>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={handleFetchPhotos}
                        disabled={fetchingPhotos}
                        className="inline-flex items-center px-3 sm:px-4 py-2 bg-white border border-slate-200 rounded-lg text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-50 transition-all hover:shadow-sm disabled:opacity-50"
                    >
                        <ImageDown className={`h-4 w-4 mr-1.5 ${fetchingPhotos ? 'animate-pulse' : ''}`} />
                        <span className="hidden sm:inline">Подтянуть фото с МП</span>
                        <span className="sm:hidden">Фото МП</span>
                    </button>
                    <input
                        type="file"
                        id="wb-import-file"
                        className="hidden"
                        accept=".xlsx, .xls, .csv"
                        onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;

                            // We'll use xlsx if available, otherwise fallback to simple CSV parsing if it's a CSV
                            const reader = new FileReader();
                            reader.onload = async (evt) => {
                                try {
                                    const bstr = evt.target?.result;
                                    // @ts-ignore
                                    const XLSX = window.XLSX;

                                    if (!XLSX) {
                                        alert('Библиотека для чтения Excel еще загружается. Попробуйте через 5 секунд или используйте CSV.');
                                        return;
                                    }

                                    const wb = XLSX.read(bstr, { type: 'binary' });
                                    const wsname = wb.SheetNames[0];
                                    const ws = wb.Sheets[wsname];
                                    const data = XLSX.utils.sheet_to_json(ws);

                                    // Map WB Excel columns to our format
                                    // Баркод -> wbBarcode
                                    // Наименование -> name
                                    // Артикул продавца -> sku
                                    const items = data.map((row: any) => ({
                                        wbBarcode: String(row['Баркод'] || row['Barcode'] || ''),
                                        name: String(row['Наименование'] || row['Name'] || ''),
                                        sku: String(row['Артикул продавца'] || row['Vendor code'] || '')
                                    })).filter((i: any) => i.sku);

                                    if (items.length === 0) {
                                        alert('Не удалось найти данные в файле. Проверьте заголовки: Баркод, Наименование, Артикул продавца.');
                                        return;
                                    }

                                    const res = await axios.post('/products/import', { items });
                                    if (res.data.success) {
                                        alert(`✓ Импорт завершен! Создано: ${res.data.created}, Обновлено: ${res.data.updated}`);
                                        fetchProducts();
                                    }
                                } catch (err) {
                                    console.error(err);
                                    alert('Ошибка при чтении файла');
                                }
                            };
                            reader.readAsBinaryString(file);
                        }}
                    />
                    <button
                        onClick={() => document.getElementById('wb-import-file')?.click()}
                        className="flex items-center px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 shadow-sm transition-all text-sm font-medium"
                        title="Загрузить товары из Excel файла WB (Баркод, Наименование, Артикул продавца)"
                    >
                        <ArrowDownUp size={16} className="mr-2" />
                        Импорт WB
                    </button>
                    <button
                        onClick={openCreate}
                        className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm transition-all text-sm font-medium"
                    >
                        <Plus size={18} className="mr-2" />
                        Новый товар
                    </button>
                </div>
            </div>

            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Search className="h-5 w-5 text-slate-400" />
                    </div>
                    <input
                        type="text"
                        placeholder="Поиск по названию или SKU..."
                        className="block w-full pl-10 pr-3 py-3 border border-slate-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition-colors"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
            </div>

            <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-50">
                            <tr>
                                <th scope="col" className="px-2 sm:px-4 py-3 sm:py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                    Фото
                                </th>
                                <th scope="col" className="px-2 sm:px-4 py-3 sm:py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                    Название
                                </th>
                                <th scope="col" className="hidden sm:table-cell px-2 sm:px-4 py-3 sm:py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                    SKU
                                </th>
                                <th scope="col" className="px-2 sm:px-4 py-3 sm:py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                    Наш склад
                                </th>
                                <th scope="col" className="hidden md:table-cell px-2 sm:px-4 py-3 sm:py-4 text-left text-xs font-semibold text-[#cb11ab]">
                                    WB (FBS / FBO)
                                </th>
                                <th scope="col" className="hidden md:table-cell px-2 sm:px-4 py-3 sm:py-4 text-left text-xs font-semibold text-[#005bff]">
                                    Ozon (FBS / FBO)
                                </th>
                                <th scope="col" className="hidden lg:table-cell px-2 sm:px-4 py-3 sm:py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                    Доступно
                                </th>
                                <th scope="col" className="px-2 sm:px-4 py-3 sm:py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                    Действия
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-slate-200">
                            {products.map((p) => (
                                <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                                    {/* Фото */}
                                    <td className="px-2 sm:px-4 py-2 sm:py-3">
                                        <div className="flex-shrink-0 w-16 h-16 sm:w-28 sm:h-28 lg:w-48 lg:h-48">
                                            {p.photo ? (
                                                <img className="w-full h-full rounded-lg sm:rounded-xl object-cover shadow-md border border-slate-100" src={getImageUrl(p.photo)} alt={p.name} />
                                            ) : (
                                                <div className="w-full h-full rounded-lg sm:rounded-xl bg-slate-100 flex items-center justify-center border border-slate-200">
                                                    <Package className="h-6 w-6 sm:h-10 sm:w-10 lg:h-12 lg:w-12 text-slate-400" />
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    {/* Название */}
                                    <td className="px-2 sm:px-4 py-2 sm:py-3">
                                        <div className="text-xs sm:text-sm font-semibold text-slate-900 max-w-[120px] sm:max-w-xs break-words">{p.name}</div>
                                        {/* Show SKU inline on mobile where SKU column is hidden */}
                                        <div className="sm:hidden text-[10px] font-mono text-slate-500 mt-0.5">{p.sku}</div>
                                    </td>
                                    {/* SKU + Barcode — hidden on mobile */}
                                    <td className="hidden sm:table-cell px-2 sm:px-4 py-2 sm:py-3 min-w-[140px]">
                                        <div className="text-xs font-mono text-slate-700 bg-slate-100 px-2 py-1 rounded inline-block mb-1">{p.sku}</div>
                                        {p.wbBarcode && (
                                            <div className="text-[10px] text-slate-400 font-mono">WB: {p.wbBarcode}</div>
                                        )}
                                    </td>
                                    {/* Наш склад */}
                                    <td className="px-2 sm:px-4 lg:px-6 py-2 sm:py-4">
                                        <div className="text-xs sm:text-sm text-slate-900 font-medium flex items-center gap-1 mb-1">
                                            {editingStock?.id === p.id && editingStock?.field === 'total' ? (
                                                <input
                                                    type="number"
                                                    autoFocus
                                                    className="w-16 sm:w-20 px-2 border border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-300"
                                                    value={editingStock.value}
                                                    onChange={e => setEditingStock({ ...editingStock, value: e.target.value })}
                                                    onBlur={() => handleStockUpdate(p.id, 'total', editingStock.value)}
                                                    onKeyDown={(e) => handleKeyDown(e, p.id, 'total')}
                                                />
                                            ) : (
                                                <span
                                                    className="cursor-pointer text-base sm:text-lg font-bold hover:text-blue-600 hover:underline"
                                                    title="Кликните чтобы изменить"
                                                    onClick={() => setEditingStock({ id: p.id, field: 'total', value: String(p.total) })}
                                                >{p.total}</span>
                                            )}
                                            <span className="text-slate-500 text-[10px] sm:text-xs">всего</span>
                                        </div>
                                        <div className="text-xs sm:text-sm text-yellow-600 font-medium">{p.reserved} <span className="text-slate-500 font-normal text-[10px] sm:text-xs">в резерве (Ozon)</span></div>
                                    </td>
                                    <td className="hidden md:table-cell px-2 sm:px-4 lg:px-6 py-2 sm:py-4">
                                        <div className="text-xs sm:text-sm font-medium text-[#cb11ab] flex items-center gap-1 mb-1">
                                            <span>FBS:</span>
                                            {editingStock?.id === p.id && editingStock?.field === 'wbFbs' ? (
                                                <input type="number" autoFocus className="w-14 sm:w-16 px-1 border border-[#cb11ab] rounded focus:outline-none" value={editingStock.value} onChange={e => setEditingStock({ ...editingStock, value: e.target.value })} onBlur={() => handleStockUpdate(p.id, 'wbFbs', editingStock.value)} onKeyDown={(e) => handleKeyDown(e, p.id, 'wbFbs')} />
                                            ) : (
                                                <span className="cursor-pointer hover:underline" onClick={() => setEditingStock({ id: p.id, field: 'wbFbs', value: String(p.wbFbs) })}>{p.wbFbs} шт.</span>
                                            )}
                                        </div>
                                        <div className="text-xs sm:text-sm text-slate-400 flex items-center gap-1">
                                            <span>FBO:</span>
                                            <span title="Автоматически из WB">{p.wbFbo} шт.</span>
                                        </div>
                                    </td>
                                    <td className="hidden md:table-cell px-2 sm:px-4 lg:px-6 py-2 sm:py-4">
                                        <div className="text-xs sm:text-sm font-medium text-[#005bff] flex items-center gap-1 mb-1">
                                            <span>FBS:</span>
                                            {editingStock?.id === p.id && editingStock?.field === 'ozonFbs' ? (
                                                <input type="number" autoFocus className="w-14 sm:w-16 px-1 border border-[#005bff] rounded focus:outline-none" value={editingStock.value} onChange={e => setEditingStock({ ...editingStock, value: e.target.value })} onBlur={() => handleStockUpdate(p.id, 'ozonFbs', editingStock.value)} onKeyDown={(e) => handleKeyDown(e, p.id, 'ozonFbs')} />
                                            ) : (
                                                <span className="cursor-pointer hover:underline" onClick={() => setEditingStock({ id: p.id, field: 'ozonFbs', value: String(p.ozonFbs) })}>{p.ozonFbs} шт.</span>
                                            )}
                                        </div>
                                        <div className="text-xs sm:text-sm text-slate-400 flex items-center gap-1">
                                            <span>FBO:</span>
                                            <span title="Автоматически из Ozon">{p.ozonFbo} шт.</span>
                                        </div>
                                    </td>

                                    <td className="hidden lg:table-cell px-2 sm:px-4 lg:px-6 py-2 sm:py-4 whitespace-nowrap">
                                        <span className={`px-2 sm:px-3 py-1 inline-flex text-xs sm:text-sm leading-5 font-semibold rounded-full ${p.available > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                                            {p.available} шт.
                                        </span>
                                    </td>
                                    <td className="px-2 sm:px-4 lg:px-6 py-2 sm:py-4 text-right text-sm font-medium min-w-[100px] sm:min-w-[200px]">
                                        <div className="flex flex-col items-end gap-1 mb-2 max-w-[250px] ml-auto">
                                            {(syncResult as any)?.id === p.id && (() => {
                                                const sr = (syncResult as any).data;
                                                return (
                                                    <div className="flex flex-col gap-1 text-xs text-right w-full">
                                                        <span className={`px-2 py-1 rounded border ${sr?.wb?.success ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-orange-50 border-orange-200 text-orange-700'} whitespace-normal break-words`}
                                                            title={sr?.wb?.error || 'OK'}>
                                                            <b>WB:</b> {sr?.wb?.success ? 'Обновлено ✅' : sr?.wb?.error}
                                                        </span>
                                                        <span className={`px-2 py-1 rounded border ${sr?.ozon?.success ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-orange-50 border-orange-200 text-orange-700'} whitespace-normal break-words`}
                                                            title={sr?.ozon?.error || 'OK'}>
                                                            <b>Ozon:</b> {sr?.ozon?.success ? 'Обновлено ✅' : sr?.ozon?.error}
                                                        </span>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                        <div className="flex justify-end gap-2 items-center">
                                            <button onClick={() => handleSync(p.id)} disabled={syncingId === p.id} className="p-2 text-emerald-600 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50" title="Синхронизировать остатки на WB и Ozon">
                                                <RefreshCw size={18} className={syncingId === p.id ? 'animate-spin' : ''} />
                                            </button>
                                            <button onClick={() => openAdjust(p)} className="p-2 text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors" title="Скорректировать остаток">
                                                <ArrowDownUp size={18} />
                                            </button>
                                            <button onClick={() => openEdit(p)} className="p-2 text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors" title="Редактировать">
                                                <Edit2 size={18} />
                                            </button>
                                            <button onClick={() => handleDelete(p.id)} className="p-2 text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors" title="Удалить">
                                                <Archive size={18} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {products.length === 0 && !loading && (
                                <tr>
                                    <td colSpan={8} className="px-6 py-12 text-center text-slate-500">
                                        Товары не найдены.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination placeholder */}
                <div className="bg-slate-50 px-4 py-3 border-t border-slate-200 flex items-center justify-between sm:px-6">
                    <button
                        disabled={page === 1}
                        onClick={() => setPage(prev => prev - 1)}
                        className="relative inline-flex items-center px-4 py-2 border border-slate-300 text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50"
                    >
                        Назад
                    </button>
                    <span className="text-sm text-slate-700">Страница <span className="font-semibold">{page}</span> из <span className="font-semibold">{totalPages}</span></span>
                    <button
                        disabled={page >= totalPages}
                        onClick={() => setPage(prev => prev + 1)}
                        className="relative inline-flex items-center px-4 py-2 border border-slate-300 text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50"
                    >
                        Вперед
                    </button>
                </div>
            </div>

            {/* Editor Modal */}
            {
                isModalOpen && (
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
                                    <input type="text" value={formData.wbBarcode} onChange={e => setFormData({ ...formData, wbBarcode: e.target.value })}
                                        placeholder="Например: 2043309181375"
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:ring-pink-500 focus:border-pink-500 outline-none font-mono" />
                                    <p className="text-xs text-slate-400 mt-1">ЛК WB → Мои товары → Карточка → Баркод / Штрихкод</p>
                                </div>

                                {modalMode === 'create' && (
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">Начальный общий остаток</label>
                                        <input required type="number" min="0" value={formData.initialTotal} onChange={e => setFormData({ ...formData, initialTotal: e.target.value })} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                                    </div>
                                )}

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Изображение (опционально)</label>
                                    <input type="file" accept="image/*" onChange={e => setFormData({ ...formData, file: e.target.files?.[0] || null })} className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                                </div>

                                <div className="mt-8 flex justify-end gap-3">
                                    <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-300 transition-colors">Отмена</button>
                                    <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors">Сохранить</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }

            {/* Adjust Stock Modal */}
            {
                isAdjustOpen && selectedProduct && (
                    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
                            <h3 className="text-lg font-bold text-slate-900">Корректировка остатка</h3>
                            <p className="text-sm text-slate-500 mt-1 mb-6">Товар: {selectedProduct.name}</p>

                            <form onSubmit={handleAdjust} className="space-y-6">
                                <div className="bg-slate-50 p-4 rounded-lg flex justify-between items-center border border-slate-100">
                                    <span className="text-sm text-slate-500">Текущий общий:</span>
                                    <span className="font-bold text-lg text-slate-900">{selectedProduct.total}</span>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Дельта (изменить на)</label>
                                    <div className="flex rounded-md shadow-sm">
                                        <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-slate-300 bg-slate-50 text-slate-500 text-sm">+/-</span>
                                        <input type="number" required value={adjustDelta} onChange={e => setAdjustDelta(parseInt(e.target.value) || 0)} className="flex-1 block w-full rounded-none rounded-r-md sm:text-sm border-slate-300 focus:ring-indigo-500 focus:border-indigo-500 border px-3 py-2 outline-none" />
                                    </div>
                                    <p className="mt-1 text-xs text-slate-500">Например, 5 или -2. Итого будет {Math.max(0, selectedProduct.total + adjustDelta)}</p>
                                </div>

                                <div className="flex justify-end gap-3">
                                    <button type="button" onClick={() => setIsAdjustOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-300 transition-colors">Отмена</button>
                                    <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors">Применить</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }
        </div >
    );
}
