import React from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Outlet, Navigate } from 'react-router-dom';
import useAuthStore from '../../store/authStore';

export const MainLayout = () => {
    const { isAuthenticated } = useAuthStore();

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    return (
        <div className="min-h-screen bg-gray-50/50">
            <Sidebar />
            <Header />
            <main className="pl-64 pt-16 min-h-screen transition-all">
                <div className="p-8 max-w-[1600px] mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <Outlet />
                </div>
            </main>
        </div>
    );
};
