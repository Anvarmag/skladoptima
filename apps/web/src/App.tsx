import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Register from './pages/Register';
import Products from './pages/Products';
import History from './pages/History';
import Orders from './pages/Orders';
import Analytics from './pages/Analytics';
import UnitEconomics from './pages/UnitEconomics';
import Settings from './pages/Settings';
import MainLayout from './layouts/MainLayout';
import { useAuth } from './context/AuthContext';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return <div className="min-h-screen flex items-center justify-center">Загрузка...</div>;
  if (!user) return <Navigate to="/login" replace />;

  return <>{children}</>;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route path="/app" element={
        <PrivateRoute>
          <MainLayout />
        </PrivateRoute>
      }>
        <Route index element={<Products />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="finance" element={<UnitEconomics />} />
        <Route path="history" element={<History />} />
        <Route path="orders" element={<Orders />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}

export default App;
