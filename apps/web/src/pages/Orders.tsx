import { useState, useEffect } from 'react';
import axios from 'axios';
import { RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';

interface Order {
    id: string;
    marketplaceOrderId: string;
    marketplace: 'WB' | 'OZON';
    productSku: string | null;
    productNames?: string | null;
    quantity: number;
    status?: string | null;
    totalAmount?: number | null;
    shipmentDate?: string | null;
    marketplaceCreatedAt?: string | null;
    deliveryMethod?: string | null;
    createdAt: string;
}

export default function Orders() {
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<'ALL' | 'WB' | 'OZON'>('ALL');

    const fetchOrders = async () => {
        try {
            setLoading(true);
            const res = await axios.get('/sync/orders');
            setOrders(res.data);
            setError(null);
        } catch (err: any) {
            setError('Не удалось загрузить список заказов');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchOrders();
    }, []);

    const filteredOrders = orders.filter(o =>
        filter === 'ALL' ? true : o.marketplace === filter
    );

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    if (loading && orders.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64">
                <RefreshCw className="h-8 w-8 text-blue-500 animate-spin mb-4" />
                <p className="text-slate-500 font-medium">Загрузка заказов...</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Заказы маркетплейсов</h1>
                    <p className="text-slate-500 mt-1 text-sm">История продаж с Wildberries и Ozon, которые повлияли на остаток</p>
                </div>
                <button
                    onClick={fetchOrders}
                    disabled={loading}
                    className="inline-flex items-center px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-all hover:shadow-sm disabled:opacity-50"
                >
                    <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                    Обновить
                </button>
            </div>

            {error && (
                <div className="flex items-center p-4 bg-red-50 text-red-700 rounded-xl border border-red-100 animate-in fade-in slide-in-from-top-4 duration-300">
                    <AlertCircle className="h-5 w-5 mr-3 shrink-0" />
                    <p className="text-sm font-medium">{error}</p>
                </div>
            )}

            <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl w-fit">
                {(['ALL', 'WB', 'OZON'] as const).map((tag) => (
                    <button
                        key={tag}
                        onClick={() => setFilter(tag)}
                        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${filter === tag
                            ? 'bg-white text-blue-600 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                            }`}
                    >
                        {tag === 'ALL' ? 'Все' : tag}
                        {tag !== 'ALL' && (
                            <span className="ml-2 py-0.5 px-1.5 bg-slate-200 text-slate-600 rounded text-[10px]">
                                {orders.filter(o => o.marketplace === tag).length}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50/50 border-b border-slate-100">
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Дата заказа</th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Отгрузка до</th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Источник</th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Номер заказа</th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Товары / Артикул</th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">Кол-во</th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Сумма</th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Статус</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredOrders.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="px-6 py-12 text-center text-slate-400 italic">
                                        {filter === 'ALL' ? 'Заказов пока нет' : `Заказов ${filter} пока нет`}
                                    </td>
                                </tr>
                            ) : (
                                filteredOrders.map((order) => (
                                    <tr key={order.id} className="hover:bg-slate-50/50 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600 font-medium">
                                            {formatDate(order.marketplaceCreatedAt || order.createdAt)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                                            {order.shipmentDate ? (
                                                <span className={`font-semibold ${new Date(order.shipmentDate) < new Date() ? 'text-red-600' : 'text-slate-900'}`}>
                                                    {new Date(order.shipmentDate).toLocaleDateString('ru-RU')}
                                                </span>
                                            ) : '-'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex flex-col">
                                                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ring-1 ring-inset w-fit ${order.marketplace === 'WB'
                                                    ? 'bg-purple-50 text-purple-700 ring-purple-200'
                                                    : 'bg-blue-50 text-blue-700 ring-blue-200'
                                                    }`}>
                                                    {order.marketplace}
                                                </span>
                                                {order.deliveryMethod && (
                                                    <span className="text-[10px] text-slate-400 mt-1">{order.deliveryMethod}</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-slate-900 font-semibold uppercase tracking-tight">
                                            {order.marketplaceOrderId}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-slate-600 max-w-xs">
                                            <div className="truncate font-medium text-slate-800" title={order.productNames || ''}>
                                                {order.productNames || 'Без названия'}
                                            </div>
                                            <div className="text-xs text-slate-400 mt-0.5 font-mono">
                                                {order.productSku || '-'}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 font-bold text-center">
                                            {order.quantity}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-slate-900">
                                            {order.totalAmount ? `${order.totalAmount.toLocaleString('ru-RU')} ₽` : '-'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right">
                                            <div className="flex flex-col items-end">
                                                <span className="inline-flex items-center text-green-600 font-medium text-xs">
                                                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                                                    Учтено
                                                </span>
                                                {order.status && (
                                                    <span className="text-[10px] text-slate-500 font-medium mt-0.5">
                                                        {order.status.toLowerCase() === 'awaiting_packaging' ? 'Ожидает сборки' :
                                                            order.status.toLowerCase() === 'awaiting_deliver' ? 'Ожидает отгрузки' :
                                                                order.status.toLowerCase() === 'delivering' ? 'Доставляется' :
                                                                    order.status.toLowerCase() === 'delivered' ? 'Доставлен' :
                                                                        order.status.toLowerCase() === 'cancelled' ? 'Отменен' :
                                                                            order.status.toLowerCase() === 'dispute' ? 'Спорный' :
                                                                                order.status}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
