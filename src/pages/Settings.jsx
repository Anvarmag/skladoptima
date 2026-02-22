import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';
import useStocksStore from '../store/stocksStore';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { User, Monitor, Database, LogOut, Key, Eye, EyeOff, Store, Save, ExternalLink } from 'lucide-react';
import { useToast } from '../components/ui/Toast';

const SecretInput = ({ label, value, onChange, placeholder }) => {
    const [visible, setVisible] = useState(false);
    return (
        <div>
            <label className="text-xs font-medium text-gray-500 uppercase block mb-1">{label}</label>
            <div className="relative">
                <input
                    type={visible ? 'text' : 'password'}
                    value={value || ''}
                    onChange={onChange}
                    placeholder={placeholder}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
                <button
                    type="button"
                    onClick={() => setVisible(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                >
                    {visible ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
            </div>
        </div>
    );
};

const Settings = () => {
    const { user, logout } = useAuthStore();
    const { stores, activeStoreId, updateStore, viewSettings, toggleCompactMode, clearData } = useStocksStore();
    const navigate = useNavigate();
    const toast = useToast();

    // Находим текущий активный магазин
    const activeStore = stores.find(s => s.id === activeStoreId);

    const [formData, setFormData] = useState({
        name: '',
        wbToken: '',
        wbWarehouseId: '',
        ozonClientId: '',
        ozonApiKey: '',
        ozonWarehouseId: ''
    });

    const [isSaving, setIsSaving] = useState(false);

    // При смене активного магазина или загрузке данных — обновляем форму
    useEffect(() => {
        if (activeStore) {
            setFormData({
                name: activeStore.name || '',
                wbToken: activeStore.wbToken || '',
                wbWarehouseId: activeStore.wbWarehouseId || '',
                ozonClientId: activeStore.ozonClientId || '',
                ozonApiKey: activeStore.ozonApiKey || '',
                ozonWarehouseId: activeStore.ozonWarehouseId || ''
            });
        }
    }, [activeStore]);

    const handleSave = async (e) => {
        e.preventDefault();
        if (!activeStoreId) return;

        setIsSaving(true);
        const res = await updateStore(activeStoreId, formData);
        setIsSaving(false);

        if (res.success) {
            toast('Настройки магазина сохранены', 'success');
        } else {
            toast(res.error || 'Ошибка при сохранении', 'error');
        }
    };

    if (!activeStoreId || !activeStore) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] text-center space-y-4">
                <div className="bg-blue-50 p-6 rounded-full text-blue-500 mb-2">
                    <Store size={48} />
                </div>
                <h2 className="text-xl font-bold text-gray-900">Магазин не выбран</h2>
                <p className="text-gray-500 max-w-sm">
                    Пожалуйста, выберите существующий магазин в шапке сайта или создайте новый на странице "Магазины", чтобы настроить его ключи.
                </p>
                <Button onClick={() => navigate('/app/stores')} className="mt-4">
                    Перейти к магазинам
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-5xl mx-auto pb-12">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex flex-col gap-2">
                    <h1 className="text-2xl font-bold text-gray-900">Настройки магазина</h1>
                    <p className="text-gray-500 text-sm flex items-center gap-2">
                        Редактирование параметров для: <span className="font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">{activeStore.name}</span>
                    </p>
                </div>
                <Button onClick={handleSave} disabled={isSaving} className="shadow-lg shadow-blue-500/20 gap-2">
                    <Save size={18} />
                    {isSaving ? 'Сохранение...' : 'Сохранить изменения'}
                </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-8">
                    {/* Общая информация */}
                    <Card className="border-none shadow-sm overflow-hidden">
                        <CardHeader className="bg-gray-50/50 border-b border-gray-100 py-4">
                            <CardTitle className="text-gray-700 flex items-center gap-2">
                                <Store size={18} className="text-blue-600" />
                                Основная информация
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-6">
                            <div>
                                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Название магазина в системе</label>
                                <input
                                    required
                                    type="text"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full border-gray-200 border p-2.5 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                    placeholder="Напр: ИП Иванов / Магазин Одежды"
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Ключи маркетплейсов */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Секция WB */}
                        <div className="space-y-4 p-6 rounded-3xl bg-purple-50/30 border border-purple-100 relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                                <div className="text-purple-600 font-bold text-6xl">WB</div>
                            </div>

                            <div className="flex items-center gap-2 mb-4">
                                <div className="w-10 h-10 rounded-xl bg-purple-600 flex items-center justify-center text-white font-bold">WB</div>
                                <div>
                                    <span className="font-bold text-gray-800 block">Wildberries</span>
                                    <span className="text-[10px] text-purple-600 font-medium uppercase truncate">API V3 (Marketplace)</span>
                                </div>
                            </div>

                            <SecretInput
                                label="Стандартный API Токен"
                                value={formData.wbToken}
                                onChange={e => setFormData({ ...formData, wbToken: e.target.value })}
                                placeholder="eyJhbGciOiJIUzI1NiIsInR5..."
                            />

                            <div>
                                <label className="text-xs font-medium text-gray-500 uppercase block mb-1">ID Склада WB</label>
                                <input
                                    type="text"
                                    value={formData.wbWarehouseId}
                                    onChange={e => setFormData({ ...formData, wbWarehouseId: e.target.value })}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    placeholder="123456"
                                />
                            </div>

                            <div className="pt-2 text-[11px] text-gray-400 italic">
                                * Токен должен иметь права на "Маркетплейс" и "Статистика"
                            </div>
                        </div>

                        {/* Секция Ozon */}
                        <div className="space-y-4 p-6 rounded-3xl bg-blue-50/30 border border-blue-100 relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                                <div className="text-blue-600 font-bold text-6xl">OZ</div>
                            </div>

                            <div className="flex items-center gap-2 mb-4">
                                <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold">OZ</div>
                                <div>
                                    <span className="font-bold text-gray-800 block">Ozon</span>
                                    <span className="text-[10px] text-blue-600 font-medium uppercase">API Seller</span>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-4">
                                <div>
                                    <label className="text-xs font-medium text-gray-500 uppercase block mb-1">Client ID</label>
                                    <input
                                        type="text"
                                        value={formData.ozonClientId}
                                        onChange={e => setFormData({ ...formData, ozonClientId: e.target.value })}
                                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                                        placeholder="123456"
                                    />
                                </div>
                                <SecretInput
                                    label="API Key"
                                    value={formData.ozonApiKey}
                                    onChange={e => setFormData({ ...formData, ozonApiKey: e.target.value })}
                                    placeholder="00000000-0000-0000..."
                                />
                                <div>
                                    <label className="text-xs font-medium text-gray-500 uppercase block mb-1">ID Склада Ozon</label>
                                    <input
                                        type="text"
                                        value={formData.ozonWarehouseId}
                                        onChange={e => setFormData({ ...formData, ozonWarehouseId: e.target.value })}
                                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        placeholder="2345678910"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Настройки интерфейса */}
                    <Card className="border-none shadow-sm overflow-hidden">
                        <CardHeader className="bg-gray-50/50 border-b border-gray-100 py-4">
                            <CardTitle className="text-gray-700 flex items-center gap-2">
                                <Monitor size={18} className="text-purple-600" />
                                Параметры интерфейса
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-6">
                            <div className="flex items-center justify-between p-4 rounded-2xl bg-gray-50/50 border border-gray-100">
                                <div>
                                    <p className="font-bold text-gray-900 text-sm">Компактный режим таблицы</p>
                                    <p className="text-xs text-gray-500">Уменьшает высоту строк для отображения большего количества товаров</p>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" className="sr-only peer" checked={viewSettings.compactMode} onChange={toggleCompactMode} />
                                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all" />
                                </label>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div className="space-y-6">
                    {/* Профиль */}
                    <Card className="border-none shadow-sm overflow-hidden">
                        <CardHeader className="bg-blue-50/50 border-b border-blue-100 py-4">
                            <CardTitle className="text-blue-800 flex items-center gap-2">
                                <User size={18} />
                                Профиль
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-6 space-y-4">
                            <div>
                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1">Email аккаунта</label>
                                <p className="font-semibold text-gray-900 break-all">{user?.email}</p>
                            </div>
                            <Button variant="secondary" onClick={() => { logout(); navigate('/login'); }} className="w-full text-red-600 bg-red-50 border-red-100 hover:bg-red-100 hover:border-red-200 transition-all">
                                <LogOut size={16} className="mr-2" /> Выйти из системы
                            </Button>
                        </CardContent>
                    </Card>

                    {/* Опасная зона */}
                    <Card className="border-red-100 shadow-sm overflow-hidden bg-red-50/10">
                        <CardHeader className="bg-red-50/50 border-b border-red-100 py-4">
                            <CardTitle className="text-red-900 flex items-center gap-2">
                                <Database size={18} />
                                Данные магазина
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-6">
                            <p className="text-xs text-gray-500 mb-4 leading-relaxed">
                                Очистка приведет к удалению всех товаров и остатков только в текущем магазине (<span className="font-bold">{activeStore.name}</span>). Это действие нельзя отменить.
                            </p>
                            <Button variant="danger" onClick={() => { if (confirm('Удалить всё?')) clearData(); }} className="w-full shadow-lg shadow-red-500/20">
                                Очистить склад
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
};

export default Settings;
