import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Package, History, LogOut, Settings, ShoppingCart } from 'lucide-react';

export default function MainLayout() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

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

    return (
        <div className="flex h-screen bg-slate-50">
            {/* Sidebar */}
            <div className="hidden md:flex md:w-64 md:flex-col border-r border-slate-200 bg-white">
                <div className="flex h-16 shrink-0 items-center px-6 border-b border-slate-200">
                    <Package className="h-8 w-8 text-blue-600 mr-2" />
                    <span className="text-xl font-bold text-slate-900 tracking-tight">Sklad Optima</span>
                </div>
                <div className="flex flex-1 flex-col overflow-y-auto">
                    <nav className="flex-1 space-y-1 px-4 py-6">
                        <NavLink to="/app" end className={navClass}>
                            {({ isActive }) => (
                                <>
                                    <Package className={iconClass(isActive)} />
                                    Остатки
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
                        <NavLink to="/app/settings" className={navClass}>
                            {({ isActive }) => (
                                <>
                                    <Settings className={iconClass(isActive)} />
                                    Настройки
                                </>
                            )}
                        </NavLink>
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
            <div className="md:hidden flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 fixed top-0 w-full z-10">
                <div className="flex items-center">
                    <Package className="h-8 w-8 text-blue-600" />
                    <span className="ml-2 text-xl font-bold text-slate-900">Sklad</span>
                </div>
                <button onClick={handleLogout} className="text-slate-500 hover:text-slate-900">
                    <LogOut className="h-6 w-6" />
                </button>
            </div>

            {/* Main content */}
            <div className="flex flex-1 flex-col overflow-hidden md:mt-0 mt-16">
                <main className="flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-6 lg:p-8">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
