import { useState, useEffect } from 'react';
import axios from 'axios';
import { Save, CheckCircle, XCircle, Loader } from 'lucide-react';

type TestStatus = 'idle' | 'loading' | 'ok' | 'error';

export default function Settings() {
    const [ozonClientId, setOzonClientId] = useState('');
    const [ozonApiKey, setOzonApiKey] = useState('');
    const [ozonWarehouseId, setOzonWarehouseId] = useState('');
    const [wbApiKey, setWbApiKey] = useState('');
    const [wbWarehouseId, setWbWarehouseId] = useState('');
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState({ text: '', type: '' });
    const [wbTest, setWbTest] = useState<{ status: TestStatus; msg: string }>({ status: 'idle', msg: '' });
    const [ozonTest, setOzonTest] = useState<{ status: TestStatus; msg: string }>({ status: 'idle', msg: '' });

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const { data } = await axios.get('/settings/marketplaces');
                if (data) {
                    setOzonClientId(data.ozonClientId || '');
                    setOzonApiKey(data.ozonApiKey || '');
                    setOzonWarehouseId(data.ozonWarehouseId || '');
                    setWbApiKey(data.wbApiKey || '');
                    setWbWarehouseId(data.wbWarehouseId || '');
                }
            } catch (err) {
                console.error('Failed to load settings', err);
            }
        };
        fetchSettings();
    }, []);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setMessage({ text: '', type: '' });
        try {
            await axios.put('/settings/marketplaces', {
                ozonClientId,
                ozonApiKey,
                ozonWarehouseId,
                wbApiKey,
                wbWarehouseId,
            });
            setMessage({ text: 'Настройки успешно сохранены!', type: 'success' });
        } catch (err) {
            setMessage({ text: 'Ошибка при сохранении настроек', type: 'error' });
        } finally {
            setSaving(false);
            setTimeout(() => setMessage({ text: '', type: '' }), 4000);
        }
    };

    const testWb = async () => {
        setWbTest({ status: 'loading', msg: '' });
        try {
            // Save first, then test
            await axios.put('/settings/marketplaces', { wbApiKey, wbWarehouseId, ozonClientId, ozonApiKey, ozonWarehouseId });
            const { data } = await axios.post('/sync/test/wb');
            setWbTest({ status: data.success ? 'ok' : 'error', msg: data.message || data.error || '' });
        } catch {
            setWbTest({ status: 'error', msg: 'Ошибка запроса' });
        }
    };

    const testOzon = async () => {
        setOzonTest({ status: 'loading', msg: '' });
        try {
            await axios.put('/settings/marketplaces', { wbApiKey, wbWarehouseId, ozonClientId, ozonApiKey, ozonWarehouseId });
            const { data } = await axios.post('/sync/test/ozon');
            setOzonTest({ status: data.success ? 'ok' : 'error', msg: data.message || data.error || '' });
        } catch {
            setOzonTest({ status: 'error', msg: 'Ошибка запроса' });
        }
    };

    const TestBadge = ({ state }: { state: typeof wbTest }) => {
        if (state.status === 'idle') return null;
        if (state.status === 'loading') return <span className="flex items-center gap-1 text-sm text-slate-500"><Loader size={14} className="animate-spin" /> Проверка...</span>;
        if (state.status === 'ok') return <span className="flex items-center gap-1 text-sm text-emerald-600 font-medium"><CheckCircle size={14} /> {state.msg || 'Подключено!'}</span>;
        return <span className="flex items-center gap-1 text-sm text-red-600 font-medium"><XCircle size={14} /> {state.msg || 'Ошибка'}</span>;
    };

    return (
        <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 animate-fade-in pb-12">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Настройки интеграций</h1>

            <form onSubmit={handleSave} className="space-y-8">

                {/* ── Ozon ──────────────────────────────────────────── */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <div className="flex items-center mb-4 sm:mb-6 border-b border-slate-100 pb-3 sm:pb-4">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded bg-[#005bff] flex items-center justify-center mr-3 sm:mr-4">
                            <span className="text-white font-bold text-lg sm:text-xl">O</span>
                        </div>
                        <div className="flex-1 min-w-0">
                            <h2 className="text-base sm:text-lg font-bold text-slate-900">Ozon API</h2>
                            <p className="text-xs sm:text-sm text-slate-500">Для синхронизации FBS-остатков с Ozon.</p>
                        </div>
                        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2 sm:gap-3">
                            <TestBadge state={ozonTest} />
                            <button type="button" onClick={testOzon} className="px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm border border-[#005bff] text-[#005bff] rounded-lg hover:bg-blue-50 transition-colors font-medium whitespace-nowrap">
                                Проверить
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Client ID</label>
                            <input type="text" value={ozonClientId} onChange={e => setOzonClientId(e.target.value)}
                                placeholder="Например: 123456"
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                            <p className="text-xs text-slate-400 mt-1">ЛК Ozon → API ключи → Client ID</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">ID склада FBS</label>
                            <input type="text" value={ozonWarehouseId} onChange={e => setOzonWarehouseId(e.target.value)}
                                placeholder="Например: 22655170"
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                            <p className="text-xs text-slate-400 mt-1">ЛК Ozon → Логистика → Мои склады → ID</p>
                        </div>
                        <div className="sm:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-1">API Key</label>
                            <input type="password" value={ozonApiKey} onChange={e => setOzonApiKey(e.target.value)}
                                placeholder="Ваш Ozon API ключ"
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                            <p className="text-xs text-slate-400 mt-1">ЛК Ozon → API ключи → API ключ</p>
                        </div>
                    </div>
                </div>

                {/* ── Wildberries ───────────────────────────────────── */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <div className="flex items-center mb-4 sm:mb-6 border-b border-slate-100 pb-3 sm:pb-4">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded bg-[#cb11ab] flex items-center justify-center mr-3 sm:mr-4">
                            <span className="text-white font-bold text-lg sm:text-xl">W</span>
                        </div>
                        <div className="flex-1 min-w-0">
                            <h2 className="text-base sm:text-lg font-bold text-slate-900">Wildberries API</h2>
                            <p className="text-xs sm:text-sm text-slate-500">Для синхронизации FBS-остатков с Wildberries.</p>
                        </div>
                        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2 sm:gap-3">
                            <TestBadge state={wbTest} />
                            <button type="button" onClick={testWb} className="px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm border border-[#cb11ab] text-[#cb11ab] rounded-lg hover:bg-pink-50 transition-colors font-medium whitespace-nowrap">
                                Проверить
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">ID склада FBS</label>
                            <input type="text" value={wbWarehouseId} onChange={e => setWbWarehouseId(e.target.value)}
                                placeholder="Например: 123456"
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none" />
                            <p className="text-xs text-slate-400 mt-1">ЛК WB → Поставки → Склады → ваш склад → ID</p>
                        </div>
                        <div className="sm:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-1">API Токен</label>
                            <input type="password" value={wbApiKey} onChange={e => setWbApiKey(e.target.value)}
                                placeholder="Ваш Wildberries API токен"
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:ring-2 focus:ring-pink-500 focus:border-pink-500 outline-none" />
                            <p className="text-xs text-slate-400 mt-1">ЛК WB → Настройки → Доступ к API → Токен. Чтобы видеть FBO-остатки, выберите права: <strong>Склад + Статистика</strong></p>
                        </div>
                    </div>
                </div>

                {/* ── Save ──────────────────────────────────────────── */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-100 p-3 sm:p-4 rounded-xl border border-slate-200">
                    <div>
                        {message.text && (
                            <span className={`text-xs sm:text-sm font-medium px-3 py-1 rounded-full ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {message.text}
                            </span>
                        )}
                    </div>
                    <button type="submit" disabled={saving}
                        className="flex items-center justify-center px-4 sm:px-6 py-2 sm:py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm transition-all font-medium disabled:bg-blue-400 text-sm">
                        <Save size={18} className="mr-2" />
                        {saving ? 'Сохранение...' : 'Сохранить'}
                    </button>
                </div>
            </form>
        </div>
    );
}
