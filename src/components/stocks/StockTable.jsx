import React, { useState, useMemo, useEffect } from 'react';
import useStocksStore from '../../store/stocksStore';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { ArrowUpDown, Search, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useToast } from '../ui/Toast';

export const StockTable = () => {
    const toast = useToast();
    const { items, updateItem, visibleColumns, viewSettings, deleteItem, deleteMultipleItems, loadProducts, updateStockOnServer } = useStocksStore();

    // Загружаем товары с бэкенда при монтировании компонента
    useEffect(() => {
        loadProducts(toast);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    const [search, setSearch] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);

    // Selection state
    const [selectedBarcodes, setSelectedBarcodes] = useState([]);

    // Edit state
    const [editingCell, setEditingCell] = useState(null); // { barcode, field }
    const [editValue, setEditValue] = useState('');

    // Filter & Sort
    const filteredItems = useMemo(() => {
        let result = [...items];

        if (search) {
            const q = search.toLowerCase();
            result = result.filter(item =>
                item.barcode?.toLowerCase().includes(q) ||
                item.name?.toLowerCase().includes(q) ||
                item.sellerSku?.toLowerCase().includes(q)
            );
        }

        if (sortConfig.key) {
            result.sort((a, b) => {
                const aVal = a[sortConfig.key];
                const bVal = b[sortConfig.key];

                if (typeof aVal === 'number' && typeof bVal === 'number') {
                    return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
                }
                return sortConfig.direction === 'asc'
                    ? String(aVal).localeCompare(String(bVal))
                    : String(bVal).localeCompare(String(aVal));
            });
        }

        return result;
    }, [items, search, sortConfig]);

    // Pagination
    const totalPages = Math.ceil(filteredItems.length / pageSize);
    const currentItems = filteredItems.slice((page - 1) * pageSize, page * pageSize);

    const handleSort = (key) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const toggleSelectAll = () => {
        if (selectedBarcodes.length === currentItems.length) {
            setSelectedBarcodes([]);
        } else {
            setSelectedBarcodes(currentItems.map(item => item.barcode));
        }
    };

    const toggleSelectItem = (barcode) => {
        setSelectedBarcodes(prev =>
            prev.includes(barcode)
                ? prev.filter(b => b !== barcode)
                : [...prev, barcode]
        );
    };

    const handleDeleteSelected = () => {
        if (confirm(`Удалить выбранные товары (${selectedBarcodes.length})?`)) {
            deleteMultipleItems(selectedBarcodes);
            setSelectedBarcodes([]);
        }
    };

    const handleDeleteOne = (barcode) => {
        if (confirm('Удалить этот товар?')) {
            deleteItem(barcode);
            setSelectedBarcodes(prev => prev.filter(b => b !== barcode));
        }
    };

    const startEdit = (item, field) => {
        setEditingCell({ barcode: item.barcode, field });
        setEditValue(item[field]);
    };

    const saveEdit = () => {
        if (editingCell) {
            let val = Number(editValue);
            if (val < 0) val = 0;

            // 1. Обновляем локальный стейт сразу (optimistic update)
            updateItem(editingCell.barcode, editingCell.field, val);

            // 2. Находим sku товара для PUT-запроса
            const item = items.find(i => i.barcode === editingCell.barcode);
            if (item?.sellerSku) {
                updateStockOnServer(item.sellerSku, editingCell.field, val, toast);
            }

            setEditingCell(null);
        }
    };

    const LoadingSkeleton = () => (
        <div className="animate-pulse space-y-4">
            {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-gray-100 rounded-lg" />
            ))}
        </div>
    );

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col h-[calc(100vh-200px)]">

            <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 flex-1">
                    <div className="relative w-full max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        <Input
                            className="pl-10"
                            placeholder="Поиск по названию, артикулу, баркоду..."
                            value={search}
                            onChange={e => { setSearch(e.target.value); setPage(1); }}
                        />
                    </div>

                    {selectedBarcodes.length > 0 && (
                        <Button
                            variant="danger"
                            size="sm"
                            onClick={handleDeleteSelected}
                            className="gap-2 animate-in fade-in slide-in-from-left-2"
                        >
                            Удалить ({selectedBarcodes.length})
                        </Button>
                    )}
                </div>

                <div className="flex items-center gap-2 text-sm text-gray-500">
                    <span>Строк:</span>
                    <select
                        className="border rounded px-2 py-1 bg-gray-50 outline-none focus:ring-2 focus:ring-blue-500"
                        value={pageSize}
                        onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                    >
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                    </select>
                </div>
            </div>

            {/* Table Content */}
            <div className="flex-1 overflow-auto relative">
                <table className="w-full text-left text-sm whitespace-nowrap border-separate border-spacing-0">
                    <thead className="sticky top-0 z-20">
                        <tr className="bg-gray-50">
                            <th className="px-6 py-3 border-b border-gray-100 bg-gray-50 first:rounded-tl-xl last:rounded-tr-xl">
                                <input
                                    type="checkbox"
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                                    checked={currentItems.length > 0 && selectedBarcodes.length === currentItems.length}
                                    onChange={toggleSelectAll}
                                />
                            </th>
                            <th className="px-6 py-3 font-medium text-gray-500 border-b border-gray-100 bg-gray-50">Наименование</th>
                            <th className="px-6 py-3 font-medium text-gray-500 border-b border-gray-100 bg-gray-50">Бренд</th>
                            <th className="px-6 py-3 font-medium text-gray-500 border-b border-gray-100 bg-gray-50">Артикул</th>
                            <th className="px-6 py-3 font-medium text-gray-500 border-b border-gray-100 bg-gray-50">Barcode</th>
                            <th className="px-6 py-3 font-medium text-gray-500 border-b border-gray-100 bg-gray-50">Предмет</th>

                            <th
                                className="px-6 py-3 font-medium text-gray-700 cursor-pointer hover:bg-gray-100 transition-colors group border-b border-gray-100 bg-gray-50"
                                onClick={() => handleSort('stock')}
                            >
                                <div className="flex items-center gap-1">
                                    Склад
                                    <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                            </th>

                            {visibleColumns.wb && (
                                <th className="px-6 py-3 font-medium text-purple-600 bg-purple-50/50 border-b border-gray-100">WB Склад</th>
                            )}
                            {visibleColumns.ozon && (
                                <th className="px-6 py-3 font-medium text-blue-600 bg-blue-50/50 border-b border-gray-100">Ozon Склад</th>
                            )}
                            <th className="px-6 py-3 font-medium text-gray-500 border-b border-gray-100 bg-gray-50 text-right">Действие</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {(!currentItems || currentItems.length === 0) ? (
                            <tr>
                                <td colSpan={10} className="px-6 py-12 text-center text-gray-400">
                                    Товары не найдены
                                </td>
                            </tr>
                        ) : (
                            currentItems.map((item, idx) => (
                                <tr
                                    key={item.barcode + idx}
                                    className={cn(
                                        "hover:bg-blue-50/50 transition-colors group",
                                        viewSettings.compactMode ? "h-10" : "h-14"
                                    )}
                                >
                                    <td className="px-6 border-b border-gray-50">
                                        <input
                                            type="checkbox"
                                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                                            checked={selectedBarcodes.includes(item.barcode)}
                                            onChange={() => toggleSelectItem(item.barcode)}
                                        />
                                    </td>
                                    <td className="px-6 text-gray-600 truncate max-w-[200px] border-b border-gray-50" title={item.name}>{item.name}</td>
                                    <td className="px-6 text-gray-600 truncate max-w-[150px] border-b border-gray-50" title={item.brand}>{item.brand}</td>
                                    <td className="px-6 text-gray-500 border-b border-gray-50">{item.sellerSku}</td>
                                    <td className="px-6 text-gray-500 font-mono text-xs border-b border-gray-50">{item.barcode}</td>
                                    <td className="px-6 text-gray-600 truncate max-w-[150px] border-b border-gray-50" title={item.subject}>{item.subject}</td>

                                    {/* Ediitables */}
                                    <td className="px-6 font-medium text-gray-900 border-b border-gray-50">
                                        {editingCell?.barcode === item.barcode && editingCell?.field === 'stock' ? (
                                            <input
                                                type="number"
                                                className="w-16 px-1 py-0.5 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                value={editValue}
                                                onChange={e => setEditValue(e.target.value)}
                                                onBlur={saveEdit}
                                                onKeyDown={e => e.key === 'Enter' && saveEdit()}
                                                autoFocus
                                                min="0"
                                            />
                                        ) : (
                                            <div
                                                onClick={() => startEdit(item, 'stock')}
                                                className="cursor-pointer hover:text-blue-600 px-2 -ml-2 py-1 rounded hover:bg-white/50 border border-transparent hover:border-gray-200 border-dashed"
                                            >
                                                {item.stock}
                                            </div>
                                        )}
                                    </td>

                                    {visibleColumns.wb && (
                                        <td className="px-6 font-medium text-purple-700 bg-purple-50/10 border-b border-gray-50">
                                            {editingCell?.barcode === item.barcode && editingCell?.field === 'wb' ? (
                                                <input
                                                    type="number"
                                                    className="w-16 px-1 py-0.5 border rounded focus:outline-none focus:ring-purple-500"
                                                    value={editValue}
                                                    onChange={e => setEditValue(e.target.value)}
                                                    onBlur={saveEdit}
                                                    onKeyDown={e => e.key === 'Enter' && saveEdit()}
                                                    autoFocus
                                                    min="0"
                                                />
                                            ) : (
                                                <div
                                                    onClick={() => startEdit(item, 'wb')}
                                                    className="cursor-pointer hover:text-purple-600 px-2 -ml-2 py-1 rounded hover:bg-white/50 border border-transparent hover:border-purple-200 border-dashed"
                                                >
                                                    {item.wb}
                                                </div>
                                            )}
                                        </td>
                                    )}

                                    {visibleColumns.ozon && (
                                        <td className="px-6 font-medium text-blue-700 bg-blue-50/10 border-b border-gray-50">
                                            {editingCell?.barcode === item.barcode && editingCell?.field === 'ozon' ? (
                                                <input
                                                    type="number"
                                                    className="w-16 px-1 py-0.5 border rounded focus:outline-none focus:ring-blue-500"
                                                    value={editValue}
                                                    onChange={e => setEditValue(e.target.value)}
                                                    onBlur={saveEdit}
                                                    onKeyDown={e => e.key === 'Enter' && saveEdit()}
                                                    autoFocus
                                                    min="0"
                                                />
                                            ) : (
                                                <div
                                                    onClick={() => startEdit(item, 'ozon')}
                                                    className="cursor-pointer hover:text-blue-600 px-2 -ml-2 py-1 rounded hover:bg-white/50 border border-transparent hover:border-blue-200 border-dashed"
                                                >
                                                    {item.ozon}
                                                </div>
                                            )}
                                        </td>
                                    )}
                                    <td className="px-6 text-right border-b border-gray-50">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleDeleteOne(item.barcode)}
                                            className="text-gray-400 hover:text-red-600 p-1 h-8 w-8"
                                        >
                                            <Trash2 size={16} />
                                        </Button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination Footer */}
            <div className="p-4 border-t border-gray-100 flex items-center justify-between bg-gray-50/50 rounded-b-xl">
                <span className="text-sm text-gray-500">
                    Page {page} of {Math.max(1, totalPages)} ({filteredItems.length} items)
                </span>
                <div className="flex gap-2">
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                    >
                        <ChevronLeft size={16} />
                    </Button>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages}
                    >
                        <ChevronRight size={16} />
                    </Button>
                </div>
            </div>
        </div>
    );
};
