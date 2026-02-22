import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useStocksStore from '../store/stocksStore';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Store, Plus, Trash2, Eye, EyeOff, ExternalLink } from 'lucide-react';

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

const Stores = () => {
    const { stores, fetchStores, addStore, deleteStore } = useStocksStore();
    const [isAdding, setIsAdding] = useState(false);
    const [newStore, setNewStore] = useState({
        name: '',
        wbToken: '',
        wbWarehouseId: '',
        ozonClientId: '',
        ozonApiKey: '',
        ozonWarehouseId: ''
    });
    const navigate = useNavigate();

    useEffect(() => {
        fetchStores();
    }, []);

    const handleAddStore = async (e) => {
        e.preventDefault();
        const res = await addStore(newStore);
        if (res.success) {
            setIsAdding(false);
            setNewStore({
                name: '',
                wbToken: '',
                wbWarehouseId: '',
                ozonClientId: '',
                ozonApiKey: '',
                ozonWarehouseId: ''
            });
        } else {
            alert(res.error);
        }
    };

    return (
        <div className="max-w-5xl mx-auto space-y-6 py-8 px-4">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold text-gray-900">Мои магазины</h1>
                <p className="text-gray-500 text-sm">Подключите кабинеты WB и Ozon для одновременной синхронизации.</p>
            </div>

            <div className="grid grid-cols-1 gap-6">
                <Card className="border-none shadow-sm overflow-hidden">
                    <CardHeader className="flex flex-row items-center justify-between py-4 bg-gray-50/50 border-b border-gray-100">
                        <CardTitle className="flex items-center gap-2 text-gray-700">
                            <Store size={20} className="text-blue-600" />
                            Подключенные аккаунты
                        </CardTitle>
                        <Button size="sm" onClick={() => setIsAdding(!isAdding)} className="rounded-full shadow-sm">
                            {isAdding ? 'Отмена' : <><Plus size={16} className="mr-1" /> Добавить магазин</>}
                        </Button>
                    </CardHeader>
                    <CardContent className="p-6">
                        {isAdding && (
                            <form onSubmit={handleAddStore} className="mb-10 p-6 bg-white rounded-2xl border-2 border-blue-50 shadow-xl shadow-blue-500/5 space-y-6">
                                <div>
                                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Общая информация</label>
                                    <input
                                        required
                                        type="text"
                                        value={newStore.name}
                                        onChange={e => setNewStore({ ...newStore, name: e.target.value })}
                                        className="w-full border-gray-200 border p-2.5 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                        placeholder="Напр: ИП Иванов / Магазин Одежды"
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    {/* Секция WB */}
                                    <div className="space-y-4 p-4 rounded-2xl bg-purple-50/30 border border-purple-100">
                                        <div className="flex items-center gap-2 mb-2">
                                            <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center text-white font-bold text-xs">WB</div>
                                            <span className="font-bold text-gray-700 text-sm">Wildberries</span>
                                        </div>
                                        <SecretInput
                                            label="API Токен"
                                            value={newStore.wbToken}
                                            onChange={e => setNewStore({ ...newStore, wbToken: e.target.value })}
                                            placeholder="Standard token..."
                                        />
                                        <div>
                                            <label className="text-xs font-medium text-gray-500 uppercase block mb-1">ID Склада WB</label>
                                            <input
                                                type="text"
                                                value={newStore.wbWarehouseId}
                                                onChange={e => setNewStore({ ...newStore, wbWarehouseId: e.target.value })}
                                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                                placeholder="123456"
                                            />
                                        </div>
                                    </div>

                                    {/* Секция Ozon */}
                                    <div className="space-y-4 p-4 rounded-2xl bg-blue-50/30 border border-blue-100">
                                        <div className="flex items-center gap-2 mb-2">
                                            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-xs">OZ</div>
                                            <span className="font-bold text-gray-700 text-sm">Ozon</span>
                                        </div>
                                        <div className="grid grid-cols-1 gap-4">
                                            <div>
                                                <label className="text-xs font-medium text-gray-500 uppercase block mb-1">Client-Id</label>
                                                <input
                                                    type="text"
                                                    value={newStore.ozonClientId}
                                                    onChange={e => setNewStore({ ...newStore, ozonClientId: e.target.value })}
                                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                    placeholder="123456"
                                                />
                                            </div>
                                            <SecretInput
                                                label="Api-Key"
                                                value={newStore.ozonApiKey}
                                                onChange={e => setNewStore({ ...newStore, ozonApiKey: e.target.value })}
                                                placeholder="xxxxxxxx-xxxx-xxxx..."
                                            />
                                            <div>
                                                <label className="text-xs font-medium text-gray-500 uppercase block mb-1">ID Склада Ozon</label>
                                                <input
                                                    type="text"
                                                    value={newStore.ozonWarehouseId}
                                                    onChange={e => setNewStore({ ...newStore, ozonWarehouseId: e.target.value })}
                                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                    placeholder="123456"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex justify-end pt-4">
                                    <Button type="submit" className="w-full md:w-auto px-12 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-lg shadow-blue-500/20">
                                        Сохранить магазин
                                    </Button>
                                </div>
                            </form>
                        )}

                        <div className="space-y-4">
                            {stores.length === 0 ? (
                                <div className="text-center py-20 bg-gray-50/50 rounded-3xl border-2 border-dashed border-gray-200">
                                    <div className="bg-white w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-sm">
                                        <Store className="text-blue-500" size={40} />
                                    </div>
                                    <h3 className="text-xl font-bold text-gray-800 mb-2">У вас пока нет магазинов</h3>
                                    <p className="text-gray-500 max-w-xs mx-auto mb-8">Добавьте первый магазин и подключите к нему свои API-ключи маркетплейсов</p>
                                    <Button onClick={() => setIsAdding(true)} variant="secondary">
                                        Добавить сейчас
                                    </Button>
                                </div>
                            ) : (
                                stores.map(store => (
                                    <div key={store.id} className="group relative bg-white border border-gray-100 rounded-3xl p-6 hover:shadow-xl hover:border-blue-100 transition-all duration-300">
                                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                                            <div className="flex items-start gap-4">
                                                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center">
                                                    <Store className="text-blue-600" size={28} />
                                                </div>
                                                <div>
                                                    <h3 className="text-xl font-bold text-gray-900 mb-1">{store.name}</h3>
                                                    <div className="flex flex-wrap gap-2 mt-2">
                                                        {store.wbToken && (
                                                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-purple-50 text-purple-700 border border-purple-100">
                                                                Wildberries Active
                                                            </span>
                                                        )}
                                                        {store.ozonClientId && (
                                                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-100">
                                                                Ozon Active
                                                            </span>
                                                        )}
                                                        {!store.wbToken && !store.ozonClientId && (
                                                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-gray-50 text-gray-400">
                                                                No API keys set
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-3">
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    className="bg-gray-50 hover:bg-blue-50 hover:text-blue-600 border-none rounded-xl px-4 font-bold"
                                                    onClick={() => navigate('/app/stocks')}
                                                >
                                                    К товарам <ExternalLink size={14} className="ml-2" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => { if (confirm(`Удалить магазин "${store.name}"?`)) deleteStore(store.id); }}
                                                    className="text-gray-400 hover:bg-red-50 hover:text-red-500 rounded-xl"
                                                >
                                                    <Trash2 size={20} />
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default Stores;
