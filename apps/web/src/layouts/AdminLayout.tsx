import { Outlet, Link, useNavigate, NavLink } from 'react-router-dom';
import { useAdminAuth } from '../context/AdminAuthContext';
import { ShieldAlert, LogOut, Users, KeyRound, Eye } from 'lucide-react';

/// Admin layout — намеренно отличается от tenant `MainLayout`:
///   • тёмная "internal control plane" hat;
///   • amber-warning ribbon, чтобы оператор всегда видел, что находится в
///     internal-only контуре, а не в tenant-кабинете;
///   • role badge SUPPORT_ADMIN/SUPPORT_READONLY — defines visible affordances
///     (read-only роль не видит CTA на high-risk actions, но всё равно может
///     открыть tenant 360 и notes).
export default function AdminLayout() {
    const { supportUser, isAdmin, isReadonly, logout } = useAdminAuth();
    const navigate = useNavigate();

    const handleLogout = async () => {
        await logout();
        navigate('/admin/login');
    };

    const navClass = ({ isActive }: { isActive: boolean }) =>
        `flex items-center px-4 py-2.5 text-sm font-medium rounded-md transition-colors ${
            isActive
                ? 'bg-slate-700 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
        }`;

    return (
        <div className="flex h-screen bg-slate-100">
            {/* Sidebar — намеренно тёмная, чтобы визуально не путать с tenant UI */}
            <aside className="hidden md:flex md:w-64 md:flex-col bg-slate-900 text-slate-100">
                <Link
                    to="/admin"
                    className="flex h-16 shrink-0 items-center px-6 border-b border-slate-800 hover:bg-slate-800 transition-colors"
                >
                    <ShieldAlert className="h-7 w-7 text-amber-400 mr-2" />
                    <div>
                        <div className="text-lg font-bold text-white tracking-tight leading-tight">
                            Internal Admin
                        </div>
                        <div className="text-[10px] uppercase tracking-wider text-amber-400 font-bold">
                            Support control plane
                        </div>
                    </div>
                </Link>
                <nav className="flex-1 px-4 py-6 space-y-1">
                    <NavLink to="/admin" end className={navClass}>
                        <Users className="mr-3 h-5 w-5" />
                        Tenant directory
                    </NavLink>
                    <NavLink to="/admin/change-password" className={navClass}>
                        <KeyRound className="mr-3 h-5 w-5" />
                        Сменить пароль
                    </NavLink>
                </nav>
                <div className="border-t border-slate-800 p-4">
                    {supportUser && (
                        <div className="text-xs space-y-2">
                            <div className="text-slate-400">Operator</div>
                            <div className="font-mono text-slate-200 truncate" title={supportUser.id}>
                                {supportUser.email || supportUser.id.slice(0, 8) + '…'}
                            </div>
                            <div className="flex items-center gap-1.5">
                                {isAdmin && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                        SUPPORT_ADMIN
                                    </span>
                                )}
                                {isReadonly && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-700 text-slate-300 border border-slate-600">
                                        <Eye className="h-3 w-3" />
                                        SUPPORT_READONLY
                                    </span>
                                )}
                            </div>
                            <button
                                onClick={handleLogout}
                                className="text-xs font-medium text-slate-400 hover:text-red-400 flex items-center mt-2"
                            >
                                <LogOut className="h-3 w-3 mr-1" />
                                Выйти
                            </button>
                        </div>
                    )}
                </div>
            </aside>

            {/* Mobile top bar (admin) */}
            <div className="md:hidden flex h-14 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900 px-4 fixed top-0 w-full z-10">
                <Link to="/admin" className="flex items-center text-white">
                    <ShieldAlert className="h-6 w-6 text-amber-400 mr-2" />
                    <span className="font-bold">Internal Admin</span>
                </Link>
                <button onClick={handleLogout} className="text-slate-300 hover:text-white p-2">
                    <LogOut className="h-5 w-5" />
                </button>
            </div>

            <div className="flex flex-1 flex-col overflow-hidden md:mt-0 mt-14">
                {/* Внутренний warning-ribbon — постоянно видим что это internal surface */}
                <div className="bg-amber-100 border-b border-amber-300 text-amber-900 text-xs px-4 py-1.5 flex items-center gap-2">
                    <ShieldAlert className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>
                        Internal control plane. Любое mutating действие требует обоснования и
                        попадает в audit log.
                    </span>
                </div>
                <main className="flex-1 overflow-y-auto bg-slate-100 p-3 sm:p-4 md:p-6 lg:p-8">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
