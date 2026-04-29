import { Outlet, NavLink, useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Package, History, LogOut, Settings, ShoppingCart, BarChart3, PieChart, Users, Boxes, Building2, Plug, RefreshCw, Gift, Bell, ClipboardList } from 'lucide-react';
import { useState, useEffect } from 'react';
import { notificationsApi } from '../api/notifications';
import AccessStateBanner from '../components/AccessStateBanner';
import OnboardingWidget from '../components/OnboardingWidget';

export default function MainLayout() {
    const { user, activeTenant, logout, isTelegram } = useAuth();
    const canSeeTeam = activeTenant?.role !== 'STAFF';
    const isOwner = activeTenant?.role === 'OWNER';
    const navigate = useNavigate();
    const location = useLocation();

    const [unreadCount, setUnreadCount] = useState(0);

    useEffect(() => {
        if (!activeTenant) return;
        notificationsApi.getInbox({ limit: 1, unreadOnly: true })
            .then(r => setUnreadCount(r.unreadCount))
            .catch(() => { /* non-critical */ });
    }, [activeTenant]);

    // Telegram BackButton support
    useEffect(() => {
        const tg = window.Telegram?.WebApp;
        if (!tg || !isTelegram) return;

        const isMainPage = location.pathname === '/app';
        if (isMainPage) {
            tg.BackButton.hide();
        } else {
            tg.BackButton.show();
        }

        const handleBack = () => navigate(-1);
        tg.BackButton.onClick(handleBack);
        return () => tg.BackButton.offClick(handleBack);
    }, [location.pathname, isTelegram, navigate]);

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    const navClass = ({ isActive }: { isActive: boolean }) =>
        `group flex items-center px-4 py-3 text-sm font-medium rounded-md transition-colors ${isActive
            ? 'bg-blue-50 text-blue-700'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }`;

    const iconClass = (isActive: boolean) =>
        `mr-3 flex-shrink-0 h-6 w-6 ${isActive ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-500'}`;

    const mobileNavClass = ({ isActive }: { isActive: boolean }) =>
        `flex flex-col items-center justify-center py-2 px-1 text-[10px] font-medium transition-colors ${isActive
            ? 'text-blue-600'
            : 'text-slate-400'
        }`;

    const mobileIconClass = (isActive: boolean) =>
        `h-5 w-5 mb-0.5 ${isActive ? 'text-blue-600' : 'text-slate-400'}`;

    return (
        <div className="flex h-screen bg-slate-50">
            {/* Desktop Sidebar */}
            <div className="hidden md:flex md:w-64 md:flex-col border-r border-slate-200 bg-white">
                <Link to="/app" className="flex h-16 shrink-0 items-center px-6 border-b border-slate-200 hover:bg-slate-50 transition-colors">
                    <Package className="h-8 w-8 text-blue-600 mr-2" />
                    <div>
                        <div className="text-xl font-bold text-slate-900 tracking-tight leading-tight">Sklad Optima</div>
                        {activeTenant?.name && (
                            <div className="text-[10px] uppercase tracking-wider text-blue-600 font-bold truncate max-w-[160px]">
                                {activeTenant.name}
                            </div>
                        )}
                    </div>
                </Link>
                <div className="flex flex-1 flex-col overflow-y-auto">
                    <nav className="flex-1 space-y-1 px-4 py-6">
                        <NavLink to="/app" end className={navClass}>
                            {({ isActive }) => (
                                <>
                                    <Package className={iconClass(isActive)} />
                                    Каталог
                                </>
                            )}
                        </NavLink>
                        <NavLink to="/app/inventory" className={navClass}>
                            {({ isActive }) => (
                                <>
                                    <Boxes className={iconClass(isActive)} />
                                    Учёт остатков
                                </>
                            )}
                        </NavLink>
                        <NavLink to="/app/warehouses" className={navClass}>
                            {({ isActive }) => (
                                <>
                                    <Building2 className={iconClass(isActive)} />
                                    Склады
                                </>
                            )}
                        </NavLink>
                        <NavLink to="/app/integrations" className={navClass}>
                            {({ isActive }) => (
                                <>
                                    <Plug className={iconClass(isActive)} />
                                    Подключения
                                </>
                            )}
                        </NavLink>
                        <NavLink to="/app/sync" className={navClass}>
                            {({ isActive }) => (
                                <>
                                    <RefreshCw className={iconClass(isActive)} />
                                    Синхронизация
                                </>
                            )}
                        </NavLink>
                        <NavLink to="/app/analytics" className={navClass}>
                            {({ isActive }) => (
                                <>
                                    <BarChart3 className={iconClass(isActive)} />
                                    Аналитика
                                </>
                            )}
                        </NavLink>
                        <NavLink to="/app/finance" className={navClass}>
                            {({ isActive }) => (
                                <>
                                    <PieChart className={iconClass(isActive)} />
                                    Юнит-экономика
                                </>
                            )}
                        </NavLink>
                        <NavLink to="/app/history" className={navClass}>
                            {({ isActive }) => (
                                <>
                                    <History className={iconClass(isActive)} />
                                    История
                                </>
                            )}
                        </NavLink>
                        <NavLink to="/app/orders" className={navClass}>
                            {({ isActive }) => (
                                <>
                                    <ShoppingCart className={iconClass(isActive)} />
                                    Заказы
                                </>
                            )}
                        </NavLink>
                        <NavLink to="/app/tasks" className={navClass}>
                            {({ isActive }) => (
                                <>
                                    <ClipboardList className={iconClass(isActive)} />
                                    Задачи
                                </>
                            )}
                        </NavLink>
                        <NavLink to="/app/notifications" className={navClass}>
                            {({ isActive }) => (
                                <>
                                    <div className={`relative mr-3 flex-shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-500'}`}>
                                        <Bell className="h-6 w-6" />
                                        {unreadCount > 0 && (
                                            <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-blue-600 px-0.5 text-[9px] font-bold text-white">
                                                {unreadCount > 99 ? '99+' : unreadCount}
                                            </span>
                                        )}
                                    </div>
                                    Уведомления
                                </>
                            )}
                        </NavLink>
                        <NavLink to="/app/settings" className={navClass}>
                            {({ isActive }) => (
                                <>
                                    <Settings className={iconClass(isActive)} />
                                    Настройки
                                </>
                            )}
                        </NavLink>
                        {canSeeTeam && (
                            <NavLink to="/app/team" className={navClass}>
                                {({ isActive }) => (
                                    <>
                                        <Users className={iconClass(isActive)} />
                                        Команда
                                    </>
                                )}
                            </NavLink>
                        )}
                        {isOwner && (
                            <NavLink to="/app/referrals" className={navClass}>
                                {({ isActive }) => (
                                    <>
                                        <Gift className={iconClass(isActive)} />
                                        Рефералы
                                    </>
                                )}
                            </NavLink>
                        )}
                    </nav>
                </div>
                <div className="border-t border-slate-200 p-4">
                    <div className="flex items-center">
                        <div className="ml-3">
                            <p className="text-sm font-medium text-slate-700">{user?.email}</p>
                            <button
                                onClick={handleLogout}
                                className="text-xs font-medium text-slate-500 hover:text-red-600 flex items-center mt-1"
                            >
                                <LogOut className="h-3 w-3 mr-1" />
                                Выйти
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Mobile top bar */}
            <div className="md:hidden flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 fixed top-0 w-full z-10">
                <Link to="/app" className="flex items-center">
                    <Package className="h-7 w-7 text-blue-600" />
                    <div className="ml-2 flex flex-col">
                        <span className="text-lg font-bold text-slate-900 leading-none">Sklad</span>
                        {activeTenant?.name && (
                            <span className="text-[10px] text-blue-600 font-bold truncate max-w-[120px]">
                                {activeTenant.name}
                            </span>
                        )}
                    </div>
                </Link>
                <button onClick={handleLogout} className="text-slate-500 hover:text-slate-900 p-2">
                    <LogOut className="h-5 w-5" />
                </button>
            </div>

            {/* Main content */}
            <div className="flex flex-1 flex-col overflow-hidden md:mt-0 mt-14">
                <main className="flex-1 overflow-y-auto bg-slate-50 p-3 sm:p-4 md:p-6 lg:p-8 pb-20 md:pb-8">
                    {activeTenant && (
                        <div className="mb-4">
                            <AccessStateBanner accessState={activeTenant.accessState} />
                        </div>
                    )}
                    <Outlet />
                </main>
            </div>

            <OnboardingWidget />

            {/* Mobile bottom navigation */}
            <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-10 safe-area-bottom">
                <nav className="flex items-stretch justify-around">
                    <NavLink to="/app" end className={mobileNavClass}>
                        {({ isActive }) => (
                            <>
                                <Package className={mobileIconClass(isActive)} />
                                <span>Каталог</span>
                            </>
                        )}
                    </NavLink>
                    <NavLink to="/app/inventory" className={mobileNavClass}>
                        {({ isActive }) => (
                            <>
                                <Boxes className={mobileIconClass(isActive)} />
                                <span>Остатки</span>
                            </>
                        )}
                    </NavLink>
                    <NavLink to="/app/warehouses" className={mobileNavClass}>
                        {({ isActive }) => (
                            <>
                                <Building2 className={mobileIconClass(isActive)} />
                                <span>Склады</span>
                            </>
                        )}
                    </NavLink>
                    <NavLink to="/app/analytics" className={mobileNavClass}>
                        {({ isActive }) => (
                            <>
                                <BarChart3 className={mobileIconClass(isActive)} />
                                <span>Аналитика</span>
                            </>
                        )}
                    </NavLink>
                    <NavLink to="/app/finance" className={mobileNavClass}>
                        {({ isActive }) => (
                            <>
                                <PieChart className={mobileIconClass(isActive)} />
                                <span>Финансы</span>
                            </>
                        )}
                    </NavLink>
                    <NavLink to="/app/history" className={mobileNavClass}>
                        {({ isActive }) => (
                            <>
                                <History className={mobileIconClass(isActive)} />
                                <span>История</span>
                            </>
                        )}
                    </NavLink>
                    <NavLink to="/app/orders" className={mobileNavClass}>
                        {({ isActive }) => (
                            <>
                                <ShoppingCart className={mobileIconClass(isActive)} />
                                <span>Заказы</span>
                            </>
                        )}
                    </NavLink>
                    <NavLink to="/app/tasks" className={mobileNavClass}>
                        {({ isActive }) => (
                            <>
                                <ClipboardList className={mobileIconClass(isActive)} />
                                <span>Задачи</span>
                            </>
                        )}
                    </NavLink>
                    <NavLink to="/app/notifications" className={mobileNavClass}>
                        {({ isActive }) => (
                            <>
                                <div className="relative">
                                    <Bell className={mobileIconClass(isActive)} />
                                    {unreadCount > 0 && (
                                        <span className="absolute -top-1 -right-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-blue-600 px-0.5 text-[8px] font-bold text-white">
                                            {unreadCount > 9 ? '9+' : unreadCount}
                                        </span>
                                    )}
                                </div>
                                <span>Уведомл.</span>
                            </>
                        )}
                    </NavLink>
                    <NavLink to="/app/settings" className={mobileNavClass}>
                        {({ isActive }) => (
                            <>
                                <Settings className={mobileIconClass(isActive)} />
                                <span>Настройки</span>
                            </>
                        )}
                    </NavLink>
                    {canSeeTeam && (
                        <NavLink to="/app/team" className={mobileNavClass}>
                            {({ isActive }) => (
                                <>
                                    <Users className={mobileIconClass(isActive)} />
                                    <span>Команда</span>
                                </>
                            )}
                        </NavLink>
                    )}
                    {isOwner && (
                        <NavLink to="/app/referrals" className={mobileNavClass}>
                            {({ isActive }) => (
                                <>
                                    <Gift className={mobileIconClass(isActive)} />
                                    <span>Рефералы</span>
                                </>
                            )}
                        </NavLink>
                    )}
                </nav>
            </div>
        </div>
    );
}
