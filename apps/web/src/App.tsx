import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Register from './pages/Register';
import VerifyEmail from './pages/VerifyEmail';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Products from './pages/Products';
import Inventory from './pages/Inventory';
import Warehouses from './pages/Warehouses';
import MarketplaceAccounts from './pages/MarketplaceAccounts';
import SyncRuns from './pages/SyncRuns';
import History from './pages/History';
import Orders from './pages/Orders';
import Analytics from './pages/Analytics';
import UnitEconomics from './pages/UnitEconomics';
import Settings from './pages/Settings';
import Team from './pages/Team';
import ReferralCenter from './pages/ReferralCenter';
import Notifications from './pages/Notifications';
import AcceptInvite from './pages/AcceptInvite';
import OnboardingPage from './pages/OnboardingPage';
import TenantPicker from './pages/TenantPicker';
import MainLayout from './layouts/MainLayout';
import { useAuth } from './context/AuthContext';

function PrivateRoute({ children }: { children: React.ReactNode }) {
    const { user, loading, nextRoute } = useAuth();

    if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">Загрузка...</div>;
    if (!user) return <Navigate to="/login" replace />;
    if (nextRoute === '/onboarding') return <Navigate to="/onboarding" replace />;
    if (nextRoute === '/tenant-picker') return <Navigate to="/tenant-picker" replace />;

    return <>{children}</>;
}

function AuthenticatedOnly({ children }: { children: React.ReactNode }) {
    const { user, loading } = useAuth();

    if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">Загрузка...</div>;
    if (!user) return <Navigate to="/login" replace />;

    return <>{children}</>;
}

function App() {
    return (
        <Routes>
            {/* Public auth routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            {/* Onboarding — requires auth, no active tenant */}
            <Route path="/onboarding" element={
                <AuthenticatedOnly>
                    <OnboardingPage />
                </AuthenticatedOnly>
            } />

            {/* Tenant picker — requires auth, multiple tenants */}
            <Route path="/tenant-picker" element={
                <AuthenticatedOnly>
                    <TenantPicker />
                </AuthenticatedOnly>
            } />

            {/* Invite accept — public page, handles auth check internally */}
            <Route path="/invite/:token" element={<AcceptInvite />} />

            {/* Protected app routes — require auth + active tenant */}
            <Route path="/app" element={
                <PrivateRoute>
                    <MainLayout />
                </PrivateRoute>
            }>
                <Route index element={<Products />} />
                <Route path="inventory" element={<Inventory />} />
                <Route path="warehouses" element={<Warehouses />} />
                <Route path="integrations" element={<MarketplaceAccounts />} />
                <Route path="sync" element={<SyncRuns />} />
                <Route path="analytics" element={<Analytics />} />
                <Route path="finance" element={<UnitEconomics />} />
                <Route path="history" element={<History />} />
                <Route path="orders" element={<Orders />} />
                <Route path="notifications" element={<Notifications />} />
                <Route path="settings" element={<Settings />} />
                <Route path="team" element={<Team />} />
                <Route path="referrals" element={<ReferralCenter />} />
            </Route>

            <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
    );
}

export default App;
