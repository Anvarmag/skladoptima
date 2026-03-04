import { useState, useEffect, Fragment } from 'react';
import axios from 'axios';
import { RefreshCw, AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Clock, MapPin, Banknote, Loader2 } from 'lucide-react';

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
    const [isPolling, setIsPolling] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<'ALL' | 'WB' | 'OZON'>('ALL');
    const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
    const [orderDetails, setOrderDetails] = useState<any>(null);

    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [statusFilter, setStatusFilter] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    const handleRowClick = async (orderId: string) => {
        if (expandedOrderId === orderId) {
            setExpandedOrderId(null);
            return;
        }
        setExpandedOrderId(orderId);
        setOrderDetails(null);
        try {
            const res = await axios.get(`/sync/order/${orderId}/details`);
            setOrderDetails(res.data);
        } catch (err) {
            setOrderDetails({ success: false, error: 'Ошибка загрузки данных с маркетплейса' });
        }
    };

    const fetchOrders = async () => {
        try {
            setLoading(true);
            const q = new URLSearchParams({
                page: page.toString(),
                limit: '20',
                ...(filter !== 'ALL' && { marketplace: filter }),
                ...(statusFilter && { status: statusFilter }),
                ...(dateFrom && { dateFrom }),
                ...(dateTo && { dateTo })
            });
            const res = await axios.get(`/sync/orders?${q.toString()}`);
            if (Array.isArray(res.data)) {
                setOrders(res.data);
                setTotalPages(1);
            } else {
                setOrders(res.data?.data || []);
                setTotalPages(res.data?.meta?.lastPage || 1);
            }
            setError(null);
        } catch (err: any) {
            setError('Не удалось загрузить список заказов');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const timer = setTimeout(() => fetchOrders(), 300);
        return () => clearTimeout(timer);
    }, [page, filter, statusFilter, dateFrom, dateTo]);

    const handlePoll = async () => {
        try {
            setIsPolling(true);
            await axios.post('/sync/orders/poll');
            fetchOrders();
        } catch (err: any) {
            setError('Ошибка ручного обновления от маркетплейсов');
        } finally {
            setIsPolling(false);
        }
    };


    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getTimePassed = (dateStr?: string | null) => {
        if (!dateStr) return '';
        const diff = new Date().getTime() - new Date(dateStr).getTime();
        if (diff < 0) return '';
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        return `${hours} ч ${minutes} мин назад`;
    };

    if (loading && (orders || []).length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64">
                <RefreshCw className="h-8 w-8 text-blue-500 animate-spin mb-4" />
                <p className="text-slate-500 font-medium">Загрузка заказов...</p>
            </div>
        );
    }

    const translateStatus = (statusStr?: string | null) => {
        if (!statusStr) return null;
        const s = statusStr.toLowerCase();

        // Ozon Statuses
        if (s === 'awaiting_packaging') return 'Ожидает сборки';
        if (s === 'awaiting_deliver') return 'Ожидает отгрузки';
        if (s === 'delivering') return 'Доставляется';
        if (s === 'delivered') return 'Доставлен';
        if (s === 'cancelled') return 'Отменен';
        if (s === 'dispute') return 'Спорный';

        // WB Statuses
        if (s === 'new') return 'Новое';
        if (s === 'confirm') return 'На сборке';
        if (s === 'complete') return 'В доставке';
        if (s === 'cancel') return 'Отменено продавцом';
        if (s === 'client_cancel') return 'Отменено клиентом';
        if (s === 'decline') return 'Отклонено';
        if (s === 'ready_for_pickup') return 'Ожидает отгрузки';

        // Base case fallback
        return statusStr;
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Заказы маркетплейсов</h1>
                    <p className="text-slate-500 mt-1 text-xs sm:text-sm">История продаж с Wildberries и Ozon, которые повлияли на остаток</p>
                </div>
                <button
                    onClick={handlePoll}
                    disabled={isPolling}
                    className="inline-flex items-center px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-all hover:shadow-sm disabled:opacity-50"
                >
                    <RefreshCw className={`h-4 w-4 mr-2 ${isPolling ? 'animate-spin' : ''}`} />
                    Обновить
                </button>
            </div>

            {error && (
                <div className="flex items-center p-4 bg-red-50 text-red-700 rounded-xl border border-red-100 animate-in fade-in slide-in-from-top-4 duration-300">
                    <AlertCircle className="h-5 w-5 mr-3 shrink-0" />
                    <p className="text-sm font-medium">{error}</p>
                </div>
            )}

            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Статус заказа</label>
                    <select
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition-colors bg-white"
                        value={statusFilter}
                        onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                    >
                        <option value="">Все статусы</option>
                        <optgroup label="Wildberries">
                            <option value="new">Новое</option>
                            <option value="confirm">На сборке</option>
                            <option value="ready_for_pickup">Ожидает отгрузки</option>
                            <option value="complete">В доставке</option>
                            <option value="cancel">Отменено продавцом</option>
                            <option value="client_cancel">Отменено клиентом</option>
                            <option value="decline">Отклонено</option>
                        </optgroup>
                        <optgroup label="Ozon">
                            <option value="awaiting_packaging">Ожидает сборки</option>
                            <option value="awaiting_deliver">Ожидает отгрузки</option>
                            <option value="delivering">Доставляется</option>
                            <option value="delivered">Доставлен</option>
                            <option value="cancelled">Отменен</option>
                            <option value="dispute">Спорный</option>
                        </optgroup>
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Дата с</label>
                    <input
                        type="date"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition-colors"
                        value={dateFrom}
                        onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                    />
                </div>
                <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Дата по</label>
                    <input
                        type="date"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition-colors"
                        value={dateTo}
                        onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                    />
                </div>
            </div>

            <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl w-fit">
                {(['ALL', 'WB', 'OZON'] as const).map((tag) => (
                    <button
                        key={tag}
                        onClick={() => { setFilter(tag); setPage(1); }}
                        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${filter === tag
                            ? 'bg-white text-blue-600 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                            }`}
                    >
                        {tag === 'ALL' ? 'Все' : tag}
                    </button>
                ))}
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50/50 border-b border-slate-100">
                                <th className="w-8 sm:w-10 px-2 sm:px-4"></th>
                                <th className="px-2 sm:px-4 lg:px-6 py-3 sm:py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Дата заказа</th>
                                <th className="hidden md:table-cell px-2 sm:px-4 lg:px-6 py-3 sm:py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Отгрузка до</th>
                                <th className="px-2 sm:px-4 lg:px-6 py-3 sm:py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Источник</th>
                                <th className="px-2 sm:px-4 lg:px-6 py-3 sm:py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Номер заказа</th>
                                <th className="hidden sm:table-cell px-2 sm:px-4 lg:px-6 py-3 sm:py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Товары / Артикул</th>
                                <th className="hidden lg:table-cell px-2 sm:px-4 lg:px-6 py-3 sm:py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">Кол-во</th>
                                <th className="hidden md:table-cell px-2 sm:px-4 lg:px-6 py-3 sm:py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Сумма</th>
                                <th className="px-2 sm:px-4 lg:px-6 py-3 sm:py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Статус</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {(!orders || orders.length === 0) ? (
                                <tr>
                                    <td colSpan={10} className="px-6 py-12 text-center text-slate-400 italic">
                                        {filter === 'ALL' ? 'Заказов пока нет' : `Заказов ${filter} пока нет`}
                                    </td>
                                </tr>
                            ) : (
                                (orders || []).map((order) => (
                                    <Fragment key={order.id}>
                                        <tr
                                            onClick={() => handleRowClick(order.id)}
                                            className={`transition-colors cursor-pointer ${expandedOrderId === order.id ? 'bg-blue-50/50' : 'hover:bg-slate-50/50'}`}
                                        >
                                            <td className="px-2 sm:px-4 py-3 sm:py-4 text-slate-400">
                                                {expandedOrderId === order.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                            </td>
                                            <td className="px-2 sm:px-4 lg:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm text-slate-600 font-medium">
                                                <div className="flex flex-col">
                                                    <span>{formatDate(order.marketplaceCreatedAt || order.createdAt)}</span>
                                                    <span className="text-[10px] sm:text-xs text-green-600 font-semibold bg-green-50 px-1 sm:px-1.5 py-0.5 rounded w-fit mt-1">
                                                        {getTimePassed(order.marketplaceCreatedAt || order.createdAt)}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="hidden md:table-cell px-2 sm:px-4 lg:px-6 py-3 sm:py-4 whitespace-nowrap text-sm">
                                                {order.shipmentDate ? (
                                                    <span className={`font-semibold ${new Date(order.shipmentDate) < new Date() ? 'text-red-600' : 'text-slate-900'}`}>
                                                        {new Date(order.shipmentDate).toLocaleDateString('ru-RU')}
                                                    </span>
                                                ) : '-'}
                                            </td>
                                            <td className="px-2 sm:px-4 lg:px-6 py-3 sm:py-4 whitespace-nowrap">
                                                <div className="flex flex-col">
                                                    <span className={`inline-flex items-center px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-bold ring-1 ring-inset w-fit ${order.marketplace === 'WB'
                                                        ? 'bg-purple-50 text-purple-700 ring-purple-200'
                                                        : 'bg-blue-50 text-blue-700 ring-blue-200'
                                                        }`}>
                                                        {order.marketplace}
                                                    </span>
                                                    {order.deliveryMethod && (
                                                        <span className="text-[10px] text-slate-400 mt-1 hidden sm:inline">{order.deliveryMethod}</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-2 sm:px-4 lg:px-6 py-3 sm:py-4 whitespace-nowrap text-xs sm:text-sm font-mono text-slate-900 font-semibold uppercase tracking-tight">
                                                {order.marketplaceOrderId}
                                            </td>
                                            <td className="hidden sm:table-cell px-2 sm:px-4 lg:px-6 py-3 sm:py-4 text-sm text-slate-600 max-w-xs">
                                                <div className="truncate font-medium text-slate-800" title={order.productNames || ''}>
                                                    {order.productNames || 'Без названия'}
                                                </div>
                                                <div className="text-xs text-slate-400 mt-0.5 font-mono">
                                                    {order.productSku || '-'}
                                                </div>
                                            </td>
                                            <td className="hidden lg:table-cell px-2 sm:px-4 lg:px-6 py-3 sm:py-4 whitespace-nowrap text-sm text-slate-900 font-bold text-center">
                                                {order.quantity}
                                            </td>
                                            <td className="hidden md:table-cell px-2 sm:px-4 lg:px-6 py-3 sm:py-4 whitespace-nowrap text-sm font-bold text-slate-900">
                                                {order.totalAmount ? `${order.totalAmount.toLocaleString('ru-RU')} ₽` : '-'}
                                            </td>
                                            <td className="px-2 sm:px-4 lg:px-6 py-3 sm:py-4 whitespace-nowrap text-right">
                                                <div className="flex flex-col items-end">
                                                    <span className="inline-flex items-center text-green-600 font-medium text-[10px] sm:text-xs">
                                                        <CheckCircle2 className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-1" />
                                                        Учтено
                                                    </span>
                                                    {order.status && (
                                                        <span className="text-[10px] text-slate-500 font-medium mt-0.5">
                                                            {translateStatus(order.status)}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                        {expandedOrderId === order.id && (
                                            <tr className="bg-slate-50 border-b border-slate-100">
                                                <td colSpan={10} className="p-0">
                                                    <div className="px-4 sm:px-8 lg:px-14 py-4 sm:py-6 text-sm text-slate-700 animate-in fade-in slide-in-from-top-2 duration-200">
                                                        {!orderDetails ? (
                                                            <div className="flex items-center text-slate-500">
                                                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                                                Загрузка данных с маркетплейса...
                                                            </div>
                                                        ) : !orderDetails.success ? (
                                                            <div className="text-red-500 font-medium flex items-center">
                                                                <AlertCircle className="h-4 w-4 mr-2" />
                                                                {orderDetails.error || 'Информация не найдена'}
                                                            </div>
                                                        ) : (
                                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                                                {/* Ozon Details */}
                                                                {orderDetails.marketplace === 'OZON' && orderDetails.data && (
                                                                    <>
                                                                        <div>
                                                                            <h4 className="font-semibold text-slate-900 flex items-center mb-2">
                                                                                <MapPin className="h-4 w-4 mr-1.5 text-slate-400" />
                                                                                Доставка
                                                                            </h4>
                                                                            <p className="text-slate-600"><span className="text-slate-400">Направление:</span> {orderDetails.data.analytics_data?.city || orderDetails.data.analytics_data?.region || orderDetails.data.financial_data?.cluster_to || '-'}</p>
                                                                            <p className="text-slate-600"><span className="text-slate-400">Склад Ozon:</span> {orderDetails.data.delivery_method?.warehouse || '-'}</p>
                                                                            <p className="text-slate-600"><span className="text-slate-400">Ожидается у клиента:</span> {orderDetails.data.analytics_data?.delivery_date_end ? new Date(orderDetails.data.analytics_data.delivery_date_end).toLocaleDateString('ru-RU') : '-'}</p>
                                                                        </div>
                                                                        <div>
                                                                            <h4 className="font-semibold text-slate-900 flex items-center mb-2">
                                                                                <Banknote className="h-4 w-4 mr-1.5 text-slate-400" />
                                                                                Финансы (по API)
                                                                            </h4>
                                                                            <p className="text-slate-600"><span className="text-slate-400">Комиссия:</span> {orderDetails.data.financial_data?.products?.[0]?.commission_amount || 0} ₽</p>
                                                                            <p className="text-slate-600">
                                                                                <span className="text-slate-400">К выплате:</span>{' '}
                                                                                {orderDetails.data.financial_data?.products?.[0]?.payout
                                                                                    ? `${orderDetails.data.financial_data?.products?.[0]?.payout} ₽`
                                                                                    : <span className="text-slate-400 italic text-xs">Будет рассчитано позже</span>}
                                                                            </p>
                                                                        </div>
                                                                    </>
                                                                )}

                                                                {/* WB Details */}
                                                                {orderDetails.marketplace === 'WB' && orderDetails.data ? (
                                                                    <>
                                                                        <div>
                                                                            <h4 className="font-semibold text-slate-900 flex items-center mb-2">
                                                                                <MapPin className="h-4 w-4 mr-1.5 text-slate-400" />
                                                                                Доставка
                                                                            </h4>
                                                                            <p className="text-slate-600">
                                                                                <span className="text-slate-400">{orderDetails.data.address?.fullAddress ? 'Адрес:' : 'СЦ назначения:'}</span>{' '}
                                                                                {orderDetails.data.address?.fullAddress || (orderDetails.data.offices?.length > 0 ? orderDetails.data.offices.join(', ') : '-')}
                                                                            </p>
                                                                            <p className="text-slate-600"><span className="text-slate-400">Склад WB:</span> {orderDetails.data.deliveryType || 'FBS'}</p>
                                                                        </div>
                                                                        <div>
                                                                            <h4 className="font-semibold text-slate-900 flex items-center mb-2">
                                                                                <Clock className="h-4 w-4 mr-1.5 text-slate-400" />
                                                                                События
                                                                            </h4>
                                                                            <p className="text-slate-600"><span className="text-slate-400">Передано в WB:</span> {orderDetails.data.createdAt ? new Date(orderDetails.data.createdAt).toLocaleString('ru-RU') : '-'}</p>
                                                                        </div>
                                                                    </>
                                                                ) : orderDetails.marketplace === 'WB' && (
                                                                    <div className="text-slate-500 italic">Свежие данные по заказу не найдены в активных.</div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="bg-slate-50 px-4 py-3 border-t border-slate-200 flex items-center justify-between sm:px-6">
                    <button
                        disabled={page === 1}
                        onClick={() => setPage(prev => prev - 1)}
                        className="relative inline-flex items-center px-4 py-2 border border-slate-300 text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50 transition-colors"
                    >
                        Назад
                    </button>
                    <span className="text-sm text-slate-700">Страница <span className="font-semibold">{page}</span> из <span className="font-semibold">{totalPages}</span></span>
                    <button
                        disabled={page >= totalPages}
                        onClick={() => setPage(prev => prev + 1)}
                        className="relative inline-flex items-center px-4 py-2 border border-slate-300 text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50 transition-colors"
                    >
                        Вперед
                    </button>
                </div>
            </div>
        </div>
    );
}
