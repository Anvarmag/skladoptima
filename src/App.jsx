import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Register from './pages/Register';
import Stocks from './pages/Stocks';
import Settings from './pages/Settings';
import Stores from './pages/Stores';
import { MainLayout } from './components/layout/MainLayout';
import { ToastProvider } from './components/ui/Toast';
import useAuthStore from './store/authStore';
import useStocksStore from './store/stocksStore';

const ProtectedRoute = ({ children }) => {
    const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
    return isAuthenticated ? children : <Navigate to="/login" replace />;
};

const StoreGuard = ({ children }) => {
    const { stores, fetchStores } = useStocksStore();
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        const init = async () => {
            await fetchStores();
            setLoading(false);
        };
        init();
    }, []);

    if (loading) return <div className="flex h-screen items-center justify-center">Загрузка...</div>;

    if (stores.length === 0) {
        return <Navigate to="/app/stores" replace />;
    }

    return children;
};

function App() {
    return (
        <ToastProvider>
            <BrowserRouter>
                <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />

                    <Route path="/app" element={
                        <ProtectedRoute>
                            <MainLayout />
                        </ProtectedRoute>
                    }>
                        <Route path="stocks" element={
                            <StoreGuard>
                                <Stocks />
                            </StoreGuard>
                        } />
                        <Route path="settings" element={<Settings />} />
                        <Route path="stores" element={<Stores />} />
                        <Route path="" element={<Navigate to="stocks" replace />} />
                    </Route>

                    <Route path="/" element={<Navigate to="/app/stocks" replace />} />
                    <Route path="*" element={<Navigate to="/login" replace />} />
                </Routes>
            </BrowserRouter>
        </ToastProvider>
    );
}

export default App;
