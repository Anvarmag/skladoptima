import { useState, useEffect } from 'react';
import axios from 'axios';
import { Save, CheckCircle, Loader, Store, Bell, Lock, Mail, Smartphone, XCircle, ChevronRight, Clock, Download, MessageCircle, LogOut, Settings as SettingsIcon, Plug, RefreshCw } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { notificationsApi, type NotificationPreferences } from '../api/notifications';
import { S, PageHeader, Card, Btn, Input, FieldLabel, Toggle } from '../components/ui';

function useIsDesktop() {
    const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 768);
    useEffect(() => {
        const mq = window.matchMedia('(min-width: 768px)');
        const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);
    return isDesktop;
}

const MANDATORY_CATEGORIES = new Set(['auth', 'billing', 'system']);
const CATEGORY_LABELS: Record<string, string> = {
    auth:     'Безопасность и авторизация',
    billing:  'Подписка и оплата',
    sync:     'Синхронизация',
    inventory:'Остатки',
    referral: 'Реферальная программа',
    system:   'Системные уведомления',
};

const TAX_OPTIONS = [
    { value: 'USN_6',  label: 'УСН Доходы (6%)' },
    { value: 'USN_15', label: 'УСН Доходы-Расходы (15%)' },
    { value: 'OSNO',   label: 'ОСНО (Общая система)' },
    { value: 'NPD',    label: 'НПД (Самозанятый)' },
];

export default function Settings() {
    const { activeTenant, user, logout } = useAuth();
    const isOwner = activeTenant?.role === 'OWNER';
    const isDesktop = useIsDesktop();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const showForm = searchParams.get('form') === '1';

    const [storeName, setStoreName] = useState('');
    const [taxSystem, setTaxSystem] = useState('USN_6');
    const [vatExceeded, setVatExceeded] = useState(false);
    const [savingStore, setSavingStore] = useState(false);
    const [message, setMessage] = useState({ text: '', type: '' });

    const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences | null>(null);
    const [savingPrefs, setSavingPrefs] = useState(false);
    const [prefsSaved, setPrefsSaved] = useState(false);

    useEffect(() => {
        if (!isOwner) return;
        notificationsApi.getPreferences()
            .then(setNotifPrefs)
            .catch(() => {});
    }, [isOwner]);

    useEffect(() => {
        axios.get('/settings/store')
            .then(res => {
                if (res.data) {
                    setStoreName(res.data.name || '');
                    setTaxSystem(res.data.taxSystem || 'USN_6');
                    setVatExceeded(res.data.vatThresholdExceeded || false);
                }
            })
            .catch(() => {});
    }, []);

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

    const handleSaveStore = async (e: React.SyntheticEvent) => {
        e.preventDefault();
        setSavingStore(true);
        setMessage({ text: '', type: '' });
        try {
            await axios.put('/settings/store', { name: storeName, taxSystem, vatThresholdExceeded: vatExceeded });
            setMessage({ text: 'Настройки магазина обновлены', type: 'success' });
        } catch {
            setMessage({ text: 'Ошибка обновления магазина', type: 'error' });
        } finally {
            setSavingStore(false);
            setTimeout(() => setMessage({ text: '', type: '' }), 4000);
        }
    };

    const initials = (activeTenant?.name ?? user?.email ?? '?')
        .split(' ').slice(0, 2).map((w: string) => w[0]?.toUpperCase()).join('');

    if (!isDesktop && !showForm) {
        const taxLabel = TAX_OPTIONS.find(o => o.value === taxSystem)?.label ?? taxSystem;

        type MSection = { label: string; items: { id: string; icon: React.ReactNode; label: string; hint: string; to?: string; danger?: boolean; dot?: 'green' | 'red' }[] };
        const sections: MSection[] = [
            {
                label: 'УПРАВЛЕНИЕ',
                items: [
                    { id: 'history',       icon: <Clock size={15} color={S.sub} />,        label: 'История изменений', hint: 'Журнал событий',        to: '/app/history' },
                    { id: 'notifications', icon: <Bell size={15} color={S.sub} />,         label: 'Уведомления',       hint: 'Telegram · в приложении', to: '/app/notifications' },
                    { id: 'settings',      icon: <SettingsIcon size={15} color={S.sub} />, label: 'Настройки',         hint: 'Магазин и API ключи',    to: '/app/settings?form=1' },
                ],
            },
            {
                label: 'ИНТЕГРАЦИИ',
                items: [
                    { id: 'integrations', icon: <Plug size={15} color={S.sub} />, label: 'Подключения', hint: 'Маркетплейсы и склады', to: '/app/integrations' },
                    { id: 'sync',         icon: <RefreshCw size={15} color={S.sub} />, label: 'Синхронизация', hint: 'Запуски и статусы',   to: '/app/sync' },
                ],
            },
            {
                label: 'ДРУГОЕ',
                items: [
                    { id: 'export',   icon: <Download size={15} color={S.sub} />,       label: 'Экспорт данных', hint: 'CSV / Excel' },
                    { id: 'support',  icon: <MessageCircle size={15} color={S.sub} />,   label: 'Поддержка',      hint: 'Чат в Telegram' },
                    { id: 'logout',   icon: <LogOut size={15} color={S.red} />,          label: 'Выйти',          hint: user?.email ?? '', danger: true },
                ],
            },
        ];

        const handleRowClick = async (item: MSection['items'][number]) => {
            if (item.danger) { await logout(); navigate('/login'); return; }
            if (item.to) navigate(item.to);
        };

        return (
            <div style={{ background: '#f8fafc', minHeight: '100vh' }}>
                {/* Заголовок */}
                <div style={{ padding: '8px 20px 16px' }}>
                    <div style={{ fontFamily: 'Inter', fontWeight: 800, fontSize: 26, color: S.ink, letterSpacing: '-0.02em', lineHeight: 1.1 }}>Ещё</div>
                </div>

                {/* Карточка пользователя */}
                <div style={{ padding: '0 20px 20px' }}>
                    <div style={{ background: '#fff', borderRadius: 16, padding: 14, border: `1px solid ${S.border}`, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                        onClick={() => navigate('/app/settings-full')}
                    >
                        <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <span style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 14, color: '#fff' }}>{initials.slice(0, 2) || '?'}</span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 14, color: S.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeTenant?.name || user?.email}</div>
                            <div style={{ fontFamily: 'Inter', fontSize: 11, color: S.muted, marginTop: 2 }}>{user?.email} · {taxLabel}</div>
                        </div>
                        <ChevronRight size={16} color={S.muted} />
                    </div>
                </div>

                {/* Секции */}
                <div style={{ padding: '0 20px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {sections.map(sec => (
                        <div key={sec.label}>
                            <div style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, paddingLeft: 4 }}>{sec.label}</div>
                            <div style={{ background: '#fff', borderRadius: 14, border: `1px solid ${S.border}`, overflow: 'hidden' }}>
                                {sec.items.map((item, i) => {
                                    const isLast = i === sec.items.length - 1;
                                    return (
                                        <button key={item.id} onClick={() => handleRowClick(item)} style={{
                                            width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                                            padding: '13px 14px', border: 'none', background: 'transparent', cursor: 'pointer',
                                            borderBottom: isLast ? 'none' : `1px solid ${S.border}`, textAlign: 'left',
                                        }}>
                                            <div style={{ width: 32, height: 32, borderRadius: 8, background: item.danger ? 'rgba(239,68,68,0.08)' : '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                {item.icon}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                                                <div style={{ fontFamily: 'Inter', fontWeight: 500, fontSize: 13, color: item.danger ? S.red : S.ink }}>{item.label}</div>
                                                <div style={{ fontFamily: 'Inter', fontSize: 11, color: S.muted, marginTop: 1 }}>{item.hint}</div>
                                            </div>
                                            {item.dot && <div style={{ width: 7, height: 7, borderRadius: '50%', background: item.dot === 'green' ? S.green : S.red, flexShrink: 0, marginRight: 4 }} />}
                                            {!item.danger && <ChevronRight size={14} color={S.muted} />}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                {message.text && (
                    <div style={{ position: 'fixed', bottom: 90, left: 20, right: 20, padding: '12px 16px', borderRadius: 14, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', background: message.type === 'success' ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)', border: `1px solid ${message.type === 'success' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`, color: message.type === 'success' ? '#065f46' : '#7f1d1d', display: 'flex', alignItems: 'center', gap: 10, zIndex: 50, fontFamily: 'Inter', fontSize: 13, fontWeight: 500 }}>
                        {message.type === 'success' ? <CheckCircle size={16} color={S.green} /> : <XCircle size={16} color={S.red} />}
                        {message.text}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div style={{ maxWidth: 720, margin: '0 auto', paddingBottom: 48 }}>
            <PageHeader title="Настройки" />

            {/* ── Store Info ─────────────────────────────────────── */}
            <Card style={{ marginBottom: 16 }}>
                {/* Section header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${S.border}` }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: S.bg, border: `1px solid ${S.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Store size={20} color={S.sub} />
                    </div>
                    <div>
                        <div style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 15, color: S.ink }}>Ваш магазин</div>
                        <div style={{ fontFamily: 'Inter', fontSize: 13, color: S.sub, marginTop: 2 }}>Настройки отображения в сервисе.</div>
                    </div>
                </div>

                <form onSubmit={handleSaveStore}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                        <div>
                            <FieldLabel>Название магазина</FieldLabel>
                            <Input
                                value={storeName}
                                onChange={e => setStoreName(e.target.value)}
                                placeholder="Название вашего магазина"
                            />
                        </div>
                        <div>
                            <FieldLabel>Система налогообложения</FieldLabel>
                            <select
                                value={taxSystem}
                                onChange={e => setTaxSystem(e.target.value)}
                                style={{
                                    width: '100%', padding: '8px 12px', borderRadius: 8,
                                    border: `1px solid ${S.border}`, fontFamily: 'Inter', fontSize: 13,
                                    color: S.ink, background: '#fff', outline: 'none',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                                }}
                            >
                                {TAX_OPTIONS.map(o => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 20 }}>
                        <input
                            type="checkbox"
                            id="vat"
                            checked={vatExceeded}
                            onChange={e => setVatExceeded(e.target.checked)}
                            style={{ width: 16, height: 16, accentColor: S.blue }}
                        />
                        <span style={{ fontFamily: 'Inter', fontSize: 13, color: S.ink }}>
                            Превышен лимит 60 млн руб (НДС с 2025 года)
                        </span>
                    </label>

                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <Btn type="submit" variant="primary" disabled={savingStore}>
                            {savingStore ? 'Сохранение...' : 'Обновить настройки'}
                        </Btn>
                    </div>
                </form>
            </Card>

            {/* ── Notification Preferences ──────────────────────── */}
            {isOwner && notifPrefs && (
                <Card>
                    {/* Section header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${S.border}` }}>
                        <div style={{ width: 40, height: 40, borderRadius: 10, background: S.bg, border: `1px solid ${S.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Bell size={20} color={S.sub} />
                        </div>
                        <div>
                            <div style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: 15, color: S.ink }}>Уведомления</div>
                            <div style={{ fontFamily: 'Inter', fontSize: 13, color: S.sub, marginTop: 2 }}>Каналы и категории доставки уведомлений.</div>
                        </div>
                    </div>

                    {/* Info banner */}
                    <div style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        background: 'rgba(245,158,11,0.06)', border: `1px solid rgba(245,158,11,0.2)`,
                        borderRadius: 10, padding: '12px 14px', marginBottom: 20,
                        fontFamily: 'Inter', fontSize: 13, color: '#92400e',
                    }}>
                        <Lock size={14} style={{ marginTop: 1, flexShrink: 0, color: S.amber }} />
                        <span>Критичные уведомления безопасности, оплаты и системных сбоев доставляются всегда и не могут быть отключены полностью.</span>
                    </div>

                    {/* Delivery channels */}
                    <div style={{ marginBottom: 24 }}>
                        <div style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
                            Каналы доставки
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                            {/* in_app */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: `1px solid ${S.border}` }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <Smartphone size={16} color={S.muted} />
                                    <span style={{ fontFamily: 'Inter', fontSize: 14, fontWeight: 500, color: S.ink }}>В приложении</span>
                                    <span style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 600, color: S.muted, background: S.bg, border: `1px solid ${S.border}`, borderRadius: 4, padding: '1px 6px' }}>
                                        всегда активен для критичных
                                    </span>
                                </div>
                                <Toggle on={notifPrefs.channels.in_app} onChange={v => handleToggleChannel('in_app', v)} />
                            </div>
                            {/* email */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <Mail size={16} color={S.muted} />
                                    <span style={{ fontFamily: 'Inter', fontSize: 14, fontWeight: 500, color: S.ink }}>Email</span>
                                </div>
                                <Toggle on={notifPrefs.channels.email} onChange={v => handleToggleChannel('email', v)} />
                            </div>
                        </div>
                    </div>

                    {/* Categories */}
                    <div style={{ marginBottom: 20 }}>
                        <div style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 700, color: S.muted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
                            Категории
                        </div>
                        <div>
                            {(Object.keys(notifPrefs.categories) as Array<keyof NotificationPreferences['categories']>).map((key, i, arr) => {
                                const mandatory = MANDATORY_CATEGORIES.has(key);
                                const val = notifPrefs.categories[key];
                                const isLast = i === arr.length - 1;
                                return (
                                    <div key={key} style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        padding: '12px 0',
                                        borderBottom: isLast ? 'none' : `1px solid ${S.border}`,
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            {mandatory && <Lock size={12} color={S.amber} style={{ flexShrink: 0 }} />}
                                            <span style={{ fontFamily: 'Inter', fontSize: 14, color: S.ink }}>{CATEGORY_LABELS[key] ?? key}</span>
                                            {mandatory && (
                                                <span style={{ fontFamily: 'Inter', fontSize: 10, fontWeight: 600, color: S.amber }}>обязательно</span>
                                            )}
                                        </div>
                                        <Toggle on={val} onChange={v => handleToggleCategory(key, v)} />
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Save row */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, borderTop: `1px solid ${S.border}`, paddingTop: 16 }}>
                        {prefsSaved && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'Inter', fontSize: 13, fontWeight: 500, color: S.green }}>
                                <CheckCircle size={14} /> Сохранено
                            </span>
                        )}
                        <Btn variant="primary" onClick={handleSavePrefs} disabled={savingPrefs}>
                            {savingPrefs
                                ? <><Loader size={14} style={{ animation: 'spin 0.7s linear infinite' }} /> Сохранение...</>
                                : <><Save size={14} /> Сохранить</>
                            }
                        </Btn>
                    </div>
                </Card>
            )}

            {/* ── Toast ─────────────────────────────────────────── */}
            {message.text && (
                <div style={{
                    position: 'fixed', bottom: 24, right: 24,
                    padding: '12px 20px', borderRadius: 14,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                    border: `1px solid ${message.type === 'success' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
                    background: message.type === 'success' ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
                    color: message.type === 'success' ? '#065f46' : '#7f1d1d',
                    display: 'flex', alignItems: 'center', gap: 10, zIndex: 50,
                    fontFamily: 'Inter', fontSize: 13, fontWeight: 500,
                }}>
                    {message.type === 'success'
                        ? <CheckCircle size={18} color={S.green} />
                        : <XCircle size={18} color={S.red} />
                    }
                    {message.text}
                </div>
            )}
        </div>
    );
}
