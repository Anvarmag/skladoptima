import React from 'react';
import { LogOut } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import useAuthStore from '../../store/authStore';
import useStocksStore from '../../store/stocksStore';
import { Button } from '../ui/Button';

export const Header = () => {
    const { user, logout } = useAuthStore();
    const { visibleColumns, toggleColumn } = useStocksStore();
    const location = useLocation();
    const navigate = useNavigate();

    const isStocksPage = location.pathname === '/app/stocks';

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    return (
        <header className="h-16 bg-white border-b border-gray-200 px-8 flex items-center justify-between fixed top-0 left-64 right-0 z-10">
            <div className="flex items-center gap-4">
                <h2 className="text-xl font-bold text-gray-800">
                    {isStocksPage ? 'Управление остатками' : 'Настройки'}
                </h2>
            </div>

            <div className="flex items-center gap-4">
                {isStocksPage && (
                    <div className="flex bg-gray-100 p-1 rounded-lg mr-4">
                        <button
                            onClick={() => toggleColumn('wb')}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${visibleColumns.wb
                                    ? 'bg-white text-blue-600 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            WB Склад
                        </button>
                        <button
                            onClick={() => toggleColumn('ozon')}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${visibleColumns.ozon
                                    ? 'bg-white text-blue-600 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            Ozon Склад
                        </button>
                    </div>
                )}

                <div className="flex items-center gap-3 pl-4 border-l border-gray-200">
                    <span className="text-sm font-medium text-gray-700">{user?.email}</span>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleLogout}
                        className="text-gray-500 hover:text-red-600 hover:bg-red-50"
                        title="Выйти"
                    >
                        <LogOut size={18} />
                    </Button>
                </div>
            </div>
        </header>
    );
};
