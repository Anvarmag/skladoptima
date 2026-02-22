import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Package, Settings, Box, Store } from 'lucide-react';
import { cn } from '../../utils/cn';

export const Sidebar = () => {
    const location = useLocation();

    const navItems = [
        { path: '/app/stocks', label: 'Остатки', icon: Package },
        { path: '/app/stores', label: 'Магазины', icon: Store },
        { path: '/app/settings', label: 'Настройки', icon: Settings },
    ];

    return (
        <aside className="w-64 bg-white border-r border-gray-200 flex flex-col h-screen fixed left-0 top-0 z-10">
            <div className="px-6 py-8 flex items-center gap-3 border-b border-gray-50">
                <div className="bg-blue-600 p-2 rounded-lg text-white">
                    <Box size={24} />
                </div>
                <span className="text-xl font-bold bg-gradient-to-r from-blue-700 to-blue-500 bg-clip-text text-transparent">
                    Skladoptima
                </span>
            </div>

            <nav className="flex-1 px-4 py-6 space-y-2">
                {navItems.map((item) => {
                    const isActive = location.pathname.startsWith(item.path);
                    return (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            className={({ isActive }) => cn(
                                "flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium text-sm",
                                isActive
                                    ? "bg-blue-50 text-blue-700 shadow-sm border border-blue-100"
                                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                            )}
                        >
                            <item.icon size={20} className={isActive ? "text-blue-600" : "text-gray-400"} />
                            {item.label}
                        </NavLink>
                    );
                })}
            </nav>

            <div className="p-4 border-t border-gray-100">
                <div className="bg-gradient-to-br from-indigo-50 to-blue-50 rounded-xl p-4 border border-blue-100">
                    <p className="text-xs font-semibold text-blue-800 mb-1">Нужна помощь?</p>
                    <p className="text-xs text-blue-600/80">Обратитесь в поддержку</p>
                </div>
            </div>
        </aside>
    );
};
