import { useState, useEffect } from 'react';
import axios from 'axios';
import { Save, CheckCircle, XCircle, Loader, Store, Bell, Lock, Mail, Smartphone } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { notificationsApi, type NotificationPreferences } from '../api/notifications';

type TestStatus = 'idle' | 'loading' | 'ok' | 'error';

// ── Toggle switch ──────────────────────────────────────────────────────────
function Toggle({
    checked, onChange, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
    return (
        <button
            type="button"
            onClick={() => !disabled && onChange(!checked)}
            disabled={disabled}
            aria-checked={checked}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${checked ? 'bg-blue-600' : 'bg-slate-300'} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
    );
}

const MANDATORY_CATEGORIES = new Set(['auth', 'billing', 'system']);
const CATEGORY_LABELS: Record<string, string> = {
    auth: 'Безопасность и авторизация',
    billing: 'Подписка и оплата',
    sync: 'Синхронизация',
    inventory: 'Остатки',
    referral: 'Реферальная программа',
    system: 'Системные уведомления',
};

export default function Settings() {
    const { activeTenant } = useAuth();
    const isOwner = activeTenant?.role === 'OWNER';

    const [ozonClientId, setOzonClientId] = useState('');
    const [ozonApiKey, setOzonApiKey] = useState('');
    const [ozonWarehouseId, setOzonWarehouseId] = useState('');
    const [wbApiKey, setWbApiKey] = useState('');
    const [wbWarehouseId, setWbWarehouseId] = useState('');
    const [storeName, setStoreName] = useState('');
    const [taxSystem, setTaxSystem] = useState('USN_6');
    const [vatExceeded, setVatExceeded] = useState(false);
    const [lastWbSync, setLastWbSync] = useState<{ at: string | null; error: string | null }>({ at: null, error: null });
    const [lastOzonSync, setLastOzonSync] = useState<{ at: string | null; error: string | null }>({ at: null, error: null });
    const [saving, setSaving] = useState(false);
    const [savingStore, setSavingStore] = useState(false);
    const [message, setMessage] = useState({ text: '', type: '' });
    const [wbTest, setWbTest] = useState<{ status: TestStatus; msg: string }>({ status: 'idle', msg: '' });
    const [ozonTest, setOzonTest] = useState<{ status: TestStatus; msg: string }>({ status: 'idle', msg: '' });
    const [syncing, setSyncing] = useState(false);

    // ── Notification preferences state (owner only) ──────────────────────
    const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences | null>(null);
    const [savingPrefs, setSavingPrefs] = useState(false);
    const [prefsSaved, setPrefsSaved] = useState(false);

    useEffect(() => {
        if (!isOwner) return;
        notificationsApi.getPreferences()
            .then(setNotifPrefs)
            .catch(() => { /* silent — section hidden if failed */ });
    }, [isOwner]);

    const handleToggleChannel = (key: keyof NotificationPreferences['channels'], value: boolean) => {
        if (!notifPrefs) return;
        setNotifPrefs({ ...notifPrefs, channels: { ...notifPrefs.channels, [key]: value } });
    };

    const handleToggleCategory = (key: keyof NotificationPreferences['categories'], value: boolean) => {
        if (!notifPrefs) return;
        setNotifPrefs({ ...notifPrefs, categories: { ...notifPrefs.categories, [key]: value } });
    };

    const handleSavePrefs = async () => {
        if (!notifPrefs) return;
        setSavingPrefs(true);
        try {
            const updated = await notificationsApi.updatePreferences({
                channels: notifPrefs.channels,
                categories: notifPrefs.categories,
            });
            setNotifPrefs(updated);
            setPrefsSaved(true);
            setTimeout(() => setPrefsSaved(false), 3000);
        } catch {
            setMessage({ text: 'Не удалось сохранить настройки уведомлений', type: 'error' });
            setTimeout(() => setMessage({ text: '', type: '' }), 4000);
        } finally {
            setSavingPrefs(false);
        }
    };

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const [settingsRes, storeRes] = await Promise.all([
                    axios.get('/settings/marketplaces'),
                    axios.get('/settings/store')
                ]);

                if (settingsRes.data) {
                    setOzonClientId(settingsRes.data.ozonClientId || '');
                    setOzonApiKey(settingsRes.data.ozonApiKey || '');
                    setOzonWarehouseId(settingsRes.data.ozonWarehouseId || '');
                    setWbApiKey(settingsRes.data.wbApiKey || '');
                    setWbWarehouseId(settingsRes.data.wbWarehouseId || '');
                    setLastWbSync({
                        at: settingsRes.data.lastWbSyncAt,
                        error: settingsRes.data.lastWbSyncError
                    });
                    setLastOzonSync({
                        at: settingsRes.data.lastOzonSyncAt,
                        error: settingsRes.data.lastOzonSyncError
                    });
                }
                if (storeRes.data) {
                    setStoreName(storeRes.data.name || '');
                    setTaxSystem(storeRes.data.taxSystem || 'USN_6');
                    setVatExceeded(storeRes.data.vatThresholdExceeded || false);
                }
            } catch (err) {
                console.error('Failed to load settings', err);
            }
        };
        fetchSettings();
    }, []);

    const handleSaveStore = async (e: React.FormEvent) => {
        e.preventDefault();
        setSavingStore(true);
        setMessage({ text: '', type: '' });
        try {
            await axios.put('/settings/store', {
                name: storeName,
                taxSystem,
                vatThresholdExceeded: vatExceeded
            });
            setMessage({ text: 'Настройки магазина обновлены', type: 'success' });
        } catch (err) {
            setMessage({ text: 'Ошибка обновления магазина', type: 'error' });
        } finally {
            setSavingStore(false);
            setTimeout(() => setMessage({ text: '', type: '' }), 4000);
        }
    };

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

    const handleFullSync = async () => {
        setSyncing(true);
        setMessage({ text: '', type: '' });
        try {
            const { data } = await axios.post('/sync/full-sync');
            if (data.success) {
                setMessage({ text: 'Синхронизация успешно завершена!', type: 'success' });
            } else {
                setMessage({ text: 'Ошибка синхронизации: ' + data.error, type: 'error' });
            }
        } catch (err) {
            setMessage({ text: 'Произошла ошибка при синхронизации', type: 'error' });
        } finally {
            setSyncing(false);
            setTimeout(() => setMessage({ text: '', type: '' }), 4000);
        }
    };

    const SyncStatusWidget = ({ data }: { marketplace: 'WB' | 'OZON', data: { at: string | null, error: string | null } }) => {
        if (!data.at && !data.error) return null;

        const date = data.at ? new Date(data.at).toLocaleString('ru-RU') : 'Никогда';
        const isError = !!data.error;

        return (
            <div className={`mt-2 p-3 rounded-lg border ${isError ? 'bg-red-50 border-red-100' : 'bg-emerald-50 border-emerald-100'}`}>
                <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Посл. синхронизация: {date}</span>
                    {isError ? (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-red-600 uppercase"><XCircle size={10} /> Ошибка</span>
                    ) : (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 uppercase"><CheckCircle size={10} /> Успешно</span>
                    )}
                </div>
                {isError && (
                    <p className="text-xs text-red-700 font-medium break-all">
                        {data.error?.includes('Api-key is deactivated')
                            ? 'API ключ деактивирован. Перевыпустите его в ЛК маркетплейса.'
                            : data.error?.includes('403') || data.error?.includes('401')
                                ? 'Ошибка авторизации. Проверьте права токена (Контент + Статистика).'
                                : data.error}
                    </p>
                )}
            </div>
        );
    };

    const TestBadge = ({ state }: { state: typeof wbTest }) => {
        if (state.status === 'idle') return null;
        if (state.status === 'loading') return <span className="flex items-center gap-1 text-sm text-slate-500"><Loader size={14} className="animate-spin" /> Проверка...</span>;
        if (state.status === 'ok') return <span className="flex items-center gap-1 text-sm text-emerald-600 font-medium"><CheckCircle size={14} /> {state.msg || 'Подключено!'}</span>;
        return <span className="flex items-center gap-1 text-sm text-red-600 font-medium"><XCircle size={14} /> {state.msg || 'Ошибка'}</span>;
    };

    return (
        <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 animate-fade-in pb-12">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Настройки</h1>

            {/* ── Store Info ────────────────────────────────────── */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <div className="flex items-center mb-6 border-b border-slate-100 pb-4">
                    <div className="w-10 h-10 rounded bg-slate-100 flex items-center justify-center mr-4 text-slate-600">
                        <Store size={24} />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-slate-900">Ваш магазин</h2>
                        <p className="text-sm text-slate-500">Настройки отображения в сервисе.</p>
                    </div>
                </div>

                <form onSubmit={handleSaveStore} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Название магазина</label>
                            <input
                                type="text"
                                value={storeName}
                                onChange={e => setStoreName(e.target.value)}
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Система налогообложения</label>
                            <select
                                value={taxSystem}
                                onChange={e => setTaxSystem(e.target.value)}
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            >
                                <option value="USN_6">УСН Доходы (6%)</option>
                                <option value="USN_15">УСН Доходы-Расходы (15%)</option>
                                <option value="OSNO">ОСНО (Общая система)</option>
                                <option value="NPD">НПД (Самозанятый)</option>
                            </select>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 py-2">
                        <input
                            type="checkbox"
                            id="vat"
                            checked={vatExceeded}
                            onChange={e => setVatExceeded(e.target.checked)}
                            className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                        />
                        <label htmlFor="vat" className="text-sm font-medium text-slate-700">
                            Превышен лимит 60 млн руб (НДС с 2025 года)
                        </label>
                    </div>

                    <div className="flex justify-end pt-2">
                        <button
                            type="submit"
                            disabled={savingStore}
                            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm transition-all font-medium disabled:bg-blue-400 text-sm"
                        >
                            {savingStore ? 'Сохранение...' : 'Обновить настройки'}
                        </button>
                    </div>
                </form>
            </div>

            {/* ── Full Sync Control ─────────────────────────────── */}
            <div className="bg-blue-600 p-6 rounded-xl shadow-md border border-blue-500 text-white relative overflow-hidden">
                <div className="relative z-10">
                    <h2 className="text-lg font-bold mb-2 flex items-center gap-2">
                        <Loader className={`h-5 w-5 ${syncing ? 'animate-spin' : ''}`} />
                        Полная синхронизация
                    </h2>
                    <p className="text-blue-100 text-sm mb-4 max-w-xl">
                        Нажмите кнопку ниже, чтобы подтянуть актуальные данные по товарам, заказам и рейтингам из WB и Ozon.
                        Это необходимо для работы разделов «Аналитика» и «Юнит-экономика».
                    </p>
                    <button
                        onClick={handleFullSync}
                        disabled={syncing}
                        className="bg-white text-blue-600 px-6 py-2.5 rounded-lg font-bold hover:bg-blue-50 transition-colors disabled:opacity-70 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {syncing ? <><Loader className="animate-spin h-4 w-4" /> Синхронизация...</> : 'Запустить полное обновление данных'}
                    </button>
                </div>
                <div className="absolute top-0 right-0 p-8 text-blue-500/20 pointer-events-none">
                    <Loader size={120} className={syncing ? 'animate-spin' : ''} />
                </div>
            </div>

            {/* ── Ozon ──────────────────────────────────────────── */}
            <form onSubmit={handleSave} className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
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

                <SyncStatusWidget marketplace="OZON" data={lastOzonSync} />

                <div className="flex justify-end border-t border-slate-50 pt-4 mt-4">
                    <button type="submit" disabled={saving}
                        className="flex items-center px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 shadow-sm transition-all font-medium disabled:bg-slate-400 text-sm">
                        <Save size={16} className="mr-2" />
                        Сохранить Ozon
                    </button>
                </div>
            </form>

            {/* ── Wildberries ───────────────────────────────────── */}
            <form onSubmit={handleSave} className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
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

                <SyncStatusWidget marketplace="WB" data={lastWbSync} />

                <div className="flex justify-end border-t border-slate-50 pt-4 mt-4">
                    <button type="submit" disabled={saving}
                        className="flex items-center px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 shadow-sm transition-all font-medium disabled:bg-slate-400 text-sm">
                        <Save size={16} className="mr-2" />
                        Сохранить WB
                    </button>
                </div>
            </form>

            {/* ── Notification Preferences ─────────────────────── */}
            {isOwner && notifPrefs && (
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <div className="flex items-center mb-6 border-b border-slate-100 pb-4">
                        <div className="w-10 h-10 rounded bg-slate-100 flex items-center justify-center mr-4 text-slate-600">
                            <Bell size={24} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-900">Уведомления</h2>
                            <p className="text-sm text-slate-500">Каналы и категории доставки уведомлений.</p>
                        </div>
                    </div>

                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg px-4 py-3 mb-6 text-sm text-amber-800">
                        <Lock size={14} className="mt-0.5 flex-shrink-0 text-amber-600" />
                        <span>Критичные уведомления безопасности, оплаты и системных сбоев доставляются всегда и не могут быть отключены полностью.</span>
                    </div>

                    <div className="mb-6">
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Каналы доставки</p>
                        <div className="space-y-1">
                            <div className="flex items-center justify-between py-2.5 border-b border-slate-50">
                                <div className="flex items-center gap-2">
                                    <Smartphone size={16} className="text-slate-400" />
                                    <span className="text-sm font-medium text-slate-700">В приложении</span>
                                    <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded font-medium">всегда активен для критичных</span>
                                </div>
                                <Toggle
                                    checked={notifPrefs.channels.in_app}
                                    onChange={v => handleToggleChannel('in_app', v)}
                                />
                            </div>
                            <div className="flex items-center justify-between py-2.5">
                                <div className="flex items-center gap-2">
                                    <Mail size={16} className="text-slate-400" />
                                    <span className="text-sm font-medium text-slate-700">Email</span>
                                </div>
                                <Toggle
                                    checked={notifPrefs.channels.email}
                                    onChange={v => handleToggleChannel('email', v)}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="mb-6">
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Категории</p>
                        <div className="space-y-0">
                            {(Object.keys(notifPrefs.categories) as Array<keyof NotificationPreferences['categories']>).map(key => {
                                const mandatory = MANDATORY_CATEGORIES.has(key);
                                const val = notifPrefs.categories[key];
                                return (
                                    <div key={key} className="flex items-center justify-between py-2.5 border-b border-slate-50 last:border-0">
                                        <div className="flex items-center gap-2">
                                            {mandatory && <Lock size={12} className="text-amber-500 flex-shrink-0" />}
                                            <span className="text-sm text-slate-700">{CATEGORY_LABELS[key] ?? key}</span>
                                            {mandatory && <span className="text-[10px] text-amber-600 font-medium">обязательно</span>}
                                        </div>
                                        <Toggle
                                            checked={val}
                                            onChange={v => handleToggleCategory(key, v)}
                                            disabled={mandatory}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
                        {prefsSaved && (
                            <span className="flex items-center gap-1 text-sm text-emerald-600 font-medium">
                                <CheckCircle size={14} /> Сохранено
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={handleSavePrefs}
                            disabled={savingPrefs}
                            className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm transition-all font-medium disabled:bg-blue-400 text-sm"
                        >
                            {savingPrefs
                                ? <><Loader size={14} className="animate-spin" /> Сохранение...</>
                                : <><Save size={14} /> Сохранить</>
                            }
                        </button>
                    </div>
                </div>
            )}

            {/* ── Status Message ──────────────────────────────────── */}
            {message.text && (
                <div className={`fixed bottom-6 right-6 px-6 py-3 rounded-xl shadow-lg border animate-slide-up z-50 flex items-center gap-3 ${message.type === 'success' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-700'
                    }`}>
                    {message.type === 'success' ? <CheckCircle size={20} /> : <XCircle size={20} />}
                    <span className="font-medium">{message.text}</span>
                </div>
            )}
        </div>
    );
}
