import { useState, useEffect } from 'react';
import axios from 'axios';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface AuditLog {
    id: string;
    actionType: string;
    createdAt: string;
    productId: string | null;
    productSku: string | null;
    beforeTotal: number | null;
    afterTotal: number | null;
    delta: number | null;
    beforeName: string | null;
    afterName: string | null;
    actorEmail: string;
    note: string | null;
}

export default function History() {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(false);

    const [actionType, setActionType] = useState('');
    const [search, setSearch] = useState('');

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const q = new URLSearchParams({
                page: page.toString(),
                limit: '20',
                ...(actionType && { actionType }),
                ...(search && { search })
            });
            const { data } = await axios.get(`/audit?${q.toString()}`);
            setLogs(data.data);
            setTotalPages(data.meta.lastPage || 1);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const timer = setTimeout(() => fetchLogs(), 300);
        return () => clearTimeout(timer);
    }, [page, actionType, search]);

    const translateActionType = (type: string) => {
        switch (type) {
            case 'PRODUCT_CREATED': return { label: 'Создание', color: 'bg-emerald-100 text-emerald-800' };
            case 'PRODUCT_UPDATED': return { label: 'Ред. инфо', color: 'bg-blue-100 text-blue-800' };
            case 'PRODUCT_DELETED': return { label: 'Удаление', color: 'bg-red-100 text-red-800' };
            case 'STOCK_ADJUSTED': return { label: 'Корректировка', color: 'bg-indigo-100 text-indigo-800' };
            default: return { label: type, color: 'bg-slate-100 text-slate-800' };
        }
    };

    const formatChanges = (log: AuditLog) => {
        if (log.actionType === 'STOCK_ADJUSTED') {
            return (
                <div className="text-sm">
                    <span className="text-slate-500">Остаток: </span>
                    {log.beforeTotal} → <span className="font-semibold">{log.afterTotal}</span>
                    <span className={`ml-2 font-medium ${log.delta! > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        ({log.delta! > 0 ? '+' : ''}{log.delta})
                    </span>
                    {log.note && <div className="text-xs text-slate-500 mt-0.5 whitespace-normal">Примечание: {log.note}</div>}
                </div>
            );
        }
        if (log.actionType === 'PRODUCT_UPDATED') {
            return (
                <div className="text-sm text-slate-600">
                    {log.beforeName !== log.afterName && (
                        <div>Название: <span className="line-through text-slate-400">{log.beforeName}</span> → {log.afterName}</div>
                    )}
                    {log.beforeName === log.afterName && <span>Обновлены другие поля</span>}
                </div>
            );
        }
        if (log.actionType === 'PRODUCT_CREATED') {
            return <div className="text-sm text-slate-500">Начальный остаток: <span className="font-semibold text-slate-900">{log.afterTotal}</span></div>;
        }
        return <span className="text-xs text-slate-400">—</span>;
    };

    return (
        <div className="space-y-6 animate-fade-in pb-12">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h1 className="text-2xl font-bold text-slate-900">История изменений</h1>
            </div>

            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Поиск по артикулу (SKU)</label>
                    <input
                        type="text"
                        placeholder="SKU товара..."
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition-colors"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Тип действия</label>
                    <select
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition-colors bg-white"
                        value={actionType}
                        onChange={(e) => setActionType(e.target.value)}
                    >
                        <option value="">Все действия</option>
                        <option value="PRODUCT_CREATED">Создание товара</option>
                        <option value="PRODUCT_UPDATED">Редактирование инфо</option>
                        <option value="STOCK_ADJUSTED">Изменение остатков</option>
                        <option value="PRODUCT_DELETED">Удаление товара</option>
                    </select>
                </div>
            </div>

            <div className="bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-50">
                            <tr>
                                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Дата и Время</th>
                                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Автор</th>
                                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Действие</th>
                                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Товар (SKU)</th>
                                <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Изменения</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-slate-200">
                            {logs.map((log) => {
                                const actionBadge = translateActionType(log.actionType);
                                return (
                                    <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 border-l-[3px] border-transparent hover:border-blue-500 transition-colors">
                                            {format(new Date(log.createdAt), 'dd MMM yyyy, HH:mm', { locale: ru })}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 font-medium">
                                            {log.actorEmail}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-2.5 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${actionBadge.color}`}>
                                                {actionBadge.label}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 font-medium">
                                            {log.productSku || <span className="text-slate-400 italic">неизвестно</span>}
                                        </td>
                                        <td className="px-6 py-4 w-1/3 max-w-sm">
                                            {formatChanges(log)}
                                        </td>
                                    </tr>
                                );
                            })}
                            {logs.length === 0 && !loading && (
                                <tr>
                                    <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                                        Логов по вашему запросу не найдено.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
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
        </div>
    );
}
