import { useState, useEffect } from 'react';
import axios from 'axios';
import {
    Calculator, Receipt,
    ArrowUpRight, Info, Download, Trash2, Edit3, X
} from 'lucide-react';

export default function UnitEconomics() {
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingProduct, setEditingProduct] = useState<any>(null);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editForm, setEditForm] = useState({
        purchasePrice: 0,
        commissionRate: 0,
        logisticsCost: 0,
        width: 0,
        height: 0,
        length: 0,
        weight: 0
    });

    useEffect(() => {
        const fetchData = async () => {
            try {
                const res = await axios.get('/finance/unit-economics');
                setData(res.data);
            } catch (err) {
                console.error('Failed to fetch finance data', err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    const handleExport = () => {
        if (!data || data.length === 0) return;

        const headers = ['SKU', 'Маркетплейс', 'Название', 'Закупка', 'Продажа', 'Комиссия', 'Логистика', 'Налог', 'Чистая прибыль', 'ROI', 'Маржа'];
        const csvRows = [
            headers.join(','),
            ...data.map(p => [
                `"${p.sku}"`,
                `"${p.marketplace}"`,
                `"${p.name.replace(/"/g, '""')}"`,
                p.purchasePrice,
                p.avgSalePrice,
                p.commission,
                p.logistics,
                p.tax,
                p.netProfit,
                `"${p.roi}"`,
                `"${p.margin}"`
            ].join(','))
        ].join('\n');

        const blob = new Blob(['\ufeff' + csvRows], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `unit_economics_${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleDelete = async (productId: string, sku: string) => {
        if (!window.confirm(`Вы уверены, что хотите удалить товар ${sku}? он будет скрыт из всех отчетов.`)) {
            return;
        }

        try {
            await axios.delete(`/products/${productId}`);
            setData(prev => prev.filter(p => p.productId !== productId));
        } catch (err) {
            console.error('Failed to delete product', err);
            alert('Ошибка при удалении товара');
        }
    };

    const handleEditClick = (product: any) => {
        setEditingProduct(product);
        setEditForm({
            purchasePrice: product.purchasePrice || 0,
            commissionRate: product.marketplace === 'WB' ? (product.commissionRate || 18) : (product.commissionRate || 15),
            logisticsCost: product.logisticsCost || 0,
            width: product.width || 0,
            height: product.height || 0,
            length: product.length || 0,
            weight: product.weight || 0
        });
        setIsEditModalOpen(true);
    };

    const handleSaveEdit = async () => {
        try {
            await axios.put(`/products/${editingProduct.productId}`, editForm);
            // Refresh data
            const res = await axios.get('/finance/unit-economics');
            setData(res.data);
            setIsEditModalOpen(false);
            setEditingProduct(null);
        } catch (err) {
            console.error('Failed to save product settings', err);
            alert('Ошибка при сохранении настроек');
        }
    };

    if (loading) return <div className="p-8 text-center text-slate-500">Загрузка финансовых данных...</div>;

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Юнит-экономика</h1>
                    <p className="text-slate-500 text-sm">Детальный расчет прибыльности по каждому товару</p>
                </div>
                <button
                    onClick={handleExport}
                    className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-sm"
                >
                    <Download className="h-4 w-4" /> Экспорт в CSV (Excel)
                </button>
            </div>

            {/* Highlights */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                    <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">Ср. Маржинальность</p>
                    <div className="flex items-baseline justify-between">
                        <h2 className="text-2xl font-bold text-slate-900">32.4%</h2>
                        <div className="flex items-center text-green-600 text-xs font-bold">
                            <ArrowUpRight className="h-3 w-3 mr-0.5" /> 2.1%
                        </div>
                    </div>
                </div>
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                    <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">Налоги к уплате (мес)</p>
                    <h2 className="text-2xl font-bold text-slate-900">124 500 ₽</h2>
                </div>
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                    <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">Заморожено в стоке</p>
                    <h2 className="text-2xl font-bold text-slate-900">2.1 млн ₽</h2>
                </div>
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                    <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">ROI (Средний)</p>
                    <h2 className="text-2xl font-bold text-slate-900 text-blue-600">145%</h2>
                </div>
            </div>

            {/* Main Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                        <Calculator className="h-5 w-5 text-blue-600" />
                        Расчет по артикулам
                    </h3>
                    <div className="bg-slate-50 px-3 py-1 rounded-lg text-xs font-bold text-slate-600 border border-slate-100">
                        Система: {data[0]?.taxSystem || 'УСН 6%'}
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="bg-slate-50 text-slate-500 text-[11px] font-bold uppercase tracking-wider border-b border-slate-200">
                                <th className="px-6 py-4 w-10">МП</th>
                                <th className="px-6 py-4">Товар (SKU)</th>
                                <th className="px-6 py-4">Закупка / Продажа</th>
                                <th className="px-6 py-4">Комиссия + Логист.</th>
                                <th className="px-6 py-4">Налог (с цены ЛК)</th>
                                <th className="px-6 py-4">Чистая прибыль</th>
                                <th className="px-6 py-4 text-right">ROI / Маржа</th>
                                <th className="px-6 py-4 w-10"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 italic-last-row">
                            {data.map((p) => (
                                <tr key={p.id} className="hover:bg-blue-50/30 transition-colors">
                                    <td className="px-6 py-4">
                                        {p.marketplace === 'WB' ? (
                                            <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center font-black text-purple-700 text-[10px] shadow-sm" title="Wildberries">WB</div>
                                        ) : (
                                            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center font-black text-blue-700 text-[10px] shadow-sm" title="Ozon">OZ</div>
                                        )}
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="font-bold text-slate-900">{p.sku}</div>
                                        <div className="text-[11px] text-slate-500 truncate max-w-[150px]">{p.name}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="text-slate-400 text-xs">{Math.round(p.purchasePrice)} ₽</div>
                                        <div className="font-bold text-slate-900">{Math.round(p.avgSalePrice)} ₽</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="text-slate-700 font-medium">-{Math.round(p.commission + p.logistics)} ₽</div>
                                        <div className="text-[10px] text-slate-400">Комиссия: {p.marketplace === 'WB' ? '18%' : '15%'}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="text-red-500 font-bold">-{Math.round(p.tax)} ₽</div>
                                        <div className="text-[10px] text-slate-400 flex items-center gap-0.5">
                                            <Receipt className="h-3 w-3" /> от {Math.round(p.sellerPrice || p.avgSalePrice)} ₽
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className={`text-base font-black ${p.netProfit > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {Math.round(p.netProfit)} ₽
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="text-blue-600 font-bold">{p.roi}</div>
                                        <div className="text-[10px] text-slate-500">Маржа: {p.margin}</div>
                                    </td>
                                    <td className="px-6 py-4 flex items-center gap-1">
                                        <button
                                            onClick={() => handleEditClick(p)}
                                            className="p-1 text-slate-400 hover:text-blue-600 transition-colors"
                                            title="Редактировать расходы"
                                        >
                                            <Edit3 size={16} />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(p.productId, p.sku)}
                                            className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                                            title="Удалить товар"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Tax Info Alert */}
            <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl flex gap-3">
                <Info className="h-5 w-5 text-blue-600 shrink-0" />
                <div>
                    <p className="text-sm text-blue-900 font-bold">Как мы считаем налоги?</p>
                    <p className="text-xs text-blue-700 mt-1">
                        Для системы <b>{data[0]?.taxSystem || 'УСН 6%'}</b> налог рассчитывается от «Цены до скидок маркетплейса» (Seller Price), которую вы установили в личном кабинете.
                        Это гарантирует соответствие требованиям ФНС при работе по договору реализации.
                    </p>
                </div>
            </div>
            {/* Edit Modal */}
            {isEditModalOpen && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md">
                        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                            <h3 className="text-lg font-bold text-slate-900">Настройка расходов: {editingProduct?.sku}</h3>
                            <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Себестоимость закупки (₽)</label>
                                <input
                                    type="number"
                                    value={editForm.purchasePrice}
                                    onChange={e => setEditForm({ ...editForm, purchasePrice: parseFloat(e.target.value) || 0 })}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                />
                                <p className="text-[10px] text-slate-400 mt-1 italic">Введите вашу реальную цену закупки ед. товара</p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Комиссия МП (%)</label>
                                    <input
                                        type="number"
                                        value={editForm.commissionRate}
                                        onChange={e => setEditForm({ ...editForm, commissionRate: parseFloat(e.target.value) || 0 })}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-4 gap-2">
                            <div>
                                <label className="block text-[10px] font-medium text-slate-700 mb-1">Ширина (см)</label>
                                <input
                                    type="number"
                                    value={editForm.width}
                                    onChange={e => setEditForm({ ...editForm, width: parseFloat(e.target.value) || 0 })}
                                    className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-medium text-slate-700 mb-1">Высота (см)</label>
                                <input
                                    type="number"
                                    value={editForm.height}
                                    onChange={e => setEditForm({ ...editForm, height: parseFloat(e.target.value) || 0 })}
                                    className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-medium text-slate-700 mb-1">Длина (см)</label>
                                <input
                                    type="number"
                                    value={editForm.length}
                                    onChange={e => setEditForm({ ...editForm, length: parseFloat(e.target.value) || 0 })}
                                    className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-medium text-slate-700 mb-1">Вес (кг)</label>
                                <input
                                    type="number"
                                    value={editForm.weight}
                                    onChange={e => setEditForm({ ...editForm, weight: parseFloat(e.target.value) || 0 })}
                                    className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                            </div>
                        </div>

                        <p className="text-xs text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-100 italic">
                            💡 Если «Логистика» не указана вручную, она будет рассчитана автоматически на основе габаритов.
                        </p>
                    </div>
                    <div className="p-6 border-t border-slate-100 flex justify-end gap-3">
                        <button
                            onClick={() => setIsEditModalOpen(false)}
                            className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 rounded-lg transition-all"
                        >
                            Отмена
                        </button>
                        <button
                            onClick={handleSaveEdit}
                            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold shadow-md transition-all"
                        >
                            Сохранить
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
