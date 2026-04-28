import { useState, useEffect, useCallback } from 'react';
import {
    Bell, CheckCheck, RefreshCw, Loader,
    ShieldCheck, CreditCard, Boxes, Gift, AlertTriangle, Plug,
} from 'lucide-react';
import { notificationsApi, type InboxItem } from '../api/notifications';

function formatRelativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'только что';
    if (mins < 60) return `${mins} мин назад`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ч назад`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'вчера';
    if (days < 30) return `${days} дн назад`;
    return new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function getCategoryMeta(title: string): { Icon: React.ElementType; color: string } {
    const t = title.toLowerCase();
    if (t.includes('синхрониза') || t.includes('токен') || t.includes('переподключ'))
        return { Icon: RefreshCw, color: 'text-amber-500' };
    if (t.includes('подписк') || t.includes('оплат') || t.includes('биллинг') || t.includes('тариф') || t.includes('аккаунт приостановлен') || t.includes('пробный'))
        return { Icon: CreditCard, color: 'text-orange-500' };
    if (t.includes('остаток') || t.includes('товар') || t.includes('склад') || t.includes('конфликт остатк'))
        return { Icon: Boxes, color: 'text-blue-500' };
    if (t.includes('реферал') || t.includes('бонус'))
        return { Icon: Gift, color: 'text-purple-500' };
    if (t.includes('безопасност') || t.includes('пароль') || t.includes('email') || t.includes('вход') || t.includes('приглашени'))
        return { Icon: ShieldCheck, color: 'text-green-600' };
    if (t.includes('техническ') || t.includes('инцидент') || t.includes('системн'))
        return { Icon: AlertTriangle, color: 'text-red-500' };
    return { Icon: Plug, color: 'text-slate-400' };
}

export default function Notifications() {
    const [items, setItems] = useState<InboxItem[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'all' | 'unread'>('all');
    const [markingAll, setMarkingAll] = useState(false);
    const [error, setError] = useState('');

    const fetchInbox = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const data = await notificationsApi.getInbox({
                unreadOnly: filter === 'unread',
                limit: 50,
            });
            setItems(data.items);
            setUnreadCount(data.unreadCount);
        } catch {
            setError('Не удалось загрузить уведомления');
        } finally {
            setLoading(false);
        }
    }, [filter]);

    useEffect(() => { fetchInbox(); }, [fetchInbox]);

    const handleMarkRead = async (id: string) => {
        try {
            await notificationsApi.markRead(id);
            setItems(prev => prev.map(item =>
                item.id === id ? { ...item, isRead: true, readAt: new Date().toISOString() } : item,
            ));
            setUnreadCount(prev => Math.max(0, prev - 1));
        } catch {
            /* silent — not critical */
        }
    };

    const handleMarkAllRead = async () => {
        const unread = items.filter(i => !i.isRead);
        if (unread.length === 0) return;
        setMarkingAll(true);
        try {
            await Promise.all(unread.map(i => notificationsApi.markRead(i.id)));
            setItems(prev => prev.map(i => ({ ...i, isRead: true, readAt: new Date().toISOString() })));
            setUnreadCount(0);
        } catch {
            /* silent */
        } finally {
            setMarkingAll(false);
        }
    };

    const displayItems = filter === 'unread' ? items.filter(i => !i.isRead) : items;

    return (
        <div className="max-w-2xl mx-auto animate-fade-in pb-12">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Уведомления</h1>
                    {unreadCount > 0 && (
                        <span className="inline-flex items-center justify-center h-6 min-w-[24px] px-1.5 text-xs font-bold rounded-full bg-blue-600 text-white">
                            {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                    )}
                </div>
                {unreadCount > 0 && (
                    <button
                        onClick={handleMarkAllRead}
                        disabled={markingAll}
                        className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium disabled:opacity-60"
                    >
                        {markingAll
                            ? <Loader size={14} className="animate-spin" />
                            : <CheckCheck size={14} />
                        }
                        Отметить все
                    </button>
                )}
            </div>

            {/* Filter tabs */}
            <div className="flex gap-1 mb-4 bg-slate-100 rounded-lg p-1 w-fit">
                {(['all', 'unread'] as const).map(f => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                            filter === f
                                ? 'bg-white text-slate-900 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        {f === 'all' ? 'Все' : `Непрочитанные${unreadCount > 0 ? ` (${unreadCount})` : ''}`}
                    </button>
                ))}
            </div>

            {/* Error */}
            {error && (
                <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700 mb-4">
                    {error}
                </div>
            )}

            {/* Loading */}
            {loading && (
                <div className="flex items-center justify-center py-16 text-slate-400">
                    <Loader size={24} className="animate-spin mr-2" />
                    <span className="text-sm">Загрузка...</span>
                </div>
            )}

            {/* Empty state */}
            {!loading && !error && displayItems.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                    <Bell size={40} className="mb-3 opacity-30" />
                    <p className="text-sm font-medium">
                        {filter === 'unread' ? 'Нет непрочитанных уведомлений' : 'Уведомлений пока нет'}
                    </p>
                </div>
            )}

            {/* Notifications list */}
            {!loading && displayItems.length > 0 && (
                <div className="space-y-1">
                    {displayItems.map(item => {
                        const { Icon, color } = getCategoryMeta(item.title);
                        return (
                            <div
                                key={item.id}
                                onClick={() => !item.isRead && handleMarkRead(item.id)}
                                className={`group relative flex items-start gap-4 px-4 py-4 rounded-xl border transition-all ${
                                    item.isRead
                                        ? 'bg-white border-slate-100 cursor-default'
                                        : 'bg-blue-50/60 border-blue-100 cursor-pointer hover:bg-blue-50 hover:border-blue-200'
                                }`}
                            >
                                {/* Unread dot */}
                                {!item.isRead && (
                                    <span className="absolute top-4 left-1.5 w-1.5 h-1.5 rounded-full bg-blue-600 mt-1" />
                                )}

                                {/* Icon */}
                                <div className={`flex-shrink-0 mt-0.5 ${color} ${item.isRead ? 'opacity-50' : ''}`}>
                                    <Icon size={18} />
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <p className={`text-sm leading-snug ${item.isRead ? 'font-normal text-slate-700' : 'font-semibold text-slate-900'}`}>
                                        {item.title}
                                    </p>
                                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                                        {item.message}
                                    </p>
                                    <p className="text-[10px] text-slate-400 mt-1">
                                        {formatRelativeTime(item.createdAt)}
                                    </p>
                                </div>

                                {/* Mark read hint */}
                                {!item.isRead && (
                                    <span className="flex-shrink-0 text-[10px] text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 font-medium whitespace-nowrap">
                                        Прочитано
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
