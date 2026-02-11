import React from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import useStocksStore from '../store/stocksStore';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { User, Monitor, Database, LogOut } from 'lucide-react';

const Settings = () => {
    const { user, logout } = useAuthStore();
    const { viewSettings, toggleCompactMode, clearData } = useStocksStore();
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const handleClearData = () => {
        if (confirm('Вы уверены, что хотите удалить ВСЕ данные? Это действие необратимо.')) {
            clearData();
        }
    };

    return (
        <div className="space-y-6 max-w-2xl">
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold text-gray-900">Настройки</h1>
                <p className="text-gray-500 text-sm">Управление профилем и параметрами приложения.</p>
            </div>

            <Card>
                <CardHeader className="flex flex-row items-center gap-4 py-4">
                    <div className="bg-blue-100 p-2 rounded-full text-blue-600">
                        <User size={24} />
                    </div>
                    <div>
                        <CardTitle>Профиль</CardTitle>
                        <p className="text-sm text-gray-500">Текущая сессия</p>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                            <label className="text-xs font-medium text-gray-500 uppercase">Email</label>
                            <p className="font-medium text-gray-900">{user?.email || 'Guest'}</p>
                        </div>
                        <div className="flex justify-end items-center">
                            <Button
                                variant="secondary"
                                onClick={handleLogout}
                                className="text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200"
                            >
                                <LogOut size={16} className="mr-2" />
                                Выйти
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center gap-4 py-4">
                    <div className="bg-purple-100 p-2 rounded-full text-purple-600">
                        <Monitor size={24} />
                    </div>
                    <div>
                        <CardTitle>Отображение</CardTitle>
                        <p className="text-sm text-gray-500">Настройки интерфейса</p>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="font-medium text-gray-900">Компактный режим таблицы</p>
                            <p className="text-sm text-gray-500">Уменьшает отступы в строках таблицы для вмещения большего количества данных</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={viewSettings.compactMode}
                                onChange={toggleCompactMode}
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-row items-center gap-4 py-4">
                    <div className="bg-red-100 p-2 rounded-full text-red-600">
                        <Database size={24} />
                    </div>
                    <div>
                        <CardTitle>Данные</CardTitle>
                        <p className="text-sm text-gray-500">Управление данными приложения</p>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-between p-4 bg-red-50 rounded-lg border border-red-100">
                        <div>
                            <p className="font-medium text-red-900">Очистить все данные</p>
                            <p className="text-sm text-red-700">Удаляет все импортированные товары и сбрасывает состояние.</p>
                        </div>
                        <Button variant="danger" onClick={handleClearData}>
                            Очистить
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default Settings;
