import { Navigate, Outlet } from 'react-router-dom';
import { AdminAuthProvider, useAdminAuth } from '../context/AdminAuthContext';

/// Mounts AdminAuthProvider only under /admin/* — иначе провайдер слал бы
/// `GET /admin/auth/me` на каждой загрузке tenant-страницы (ненужная нагрузка
/// и шум в support_security_events).
export default function AdminRoot() {
    return (
        <AdminAuthProvider>
            <Outlet />
        </AdminAuthProvider>
    );
}

/// Guard для защищённых /admin/* маршрутов. На анонимной сессии редиректит
/// на /admin/login — отдельно от tenant-facing /login.
export function AdminPrivateRoute({ children }: { children: React.ReactNode }) {
    const { supportUser, loading } = useAdminAuth();
    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">
                Загрузка admin-сессии…
            </div>
        );
    }
    if (!supportUser) {
        return <Navigate to="/admin/login" replace />;
    }
    return <>{children}</>;
}

/// Анти-guard для /admin/login: если уже авторизован — отправляем сразу
/// в directory, чтобы оператор не попадал в логин-форму повторно.
export function AdminPublicOnly({ children }: { children: React.ReactNode }) {
    const { supportUser, loading } = useAdminAuth();
    if (loading) return null;
    if (supportUser) return <Navigate to="/admin" replace />;
    return <>{children}</>;
}
