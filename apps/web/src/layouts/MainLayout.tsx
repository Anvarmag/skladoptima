import { Outlet, NavLink, useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
    Package, History, LogOut, Settings, ShoppingCart, BarChart3,
    Users, Building2, Plug, Gift, Bell, ClipboardList, Tag,
    ChevronDown, ChevronLeft, ChevronRight, X,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { notificationsApi } from '../api/notifications';
import OnboardingWidget from '../components/OnboardingWidget';

// ─── Design tokens — светлая тема ──────────────────────────────────────────
const SB = {
    bg: '#ffffff',
    border: '#e5e9f0',
    text: '#64748b',
    textActive: '#1e40af',
    sectionLabel: '#94a3b8',
    hover: '#eff6ff',        // light-blue bg on hover
    active: '#dbeafe',       // blue-100
    activeBorder: '#3b82f6', // синяя полоска у активного пункта
    icon: '#94a3b8',
    iconActive: '#2563eb',
};

// ─── Nav structure ──────────────────────────────────────────────────────────
const NAV_PRIMARY = [
    { to: '/app',            end: true,  icon: Package,       label: 'Остатки'        },
    { to: '/app/products',   end: false, icon: Tag,           label: 'Товары'         },
    { to: '/app/analytics',  end: false, icon: BarChart3,     label: 'Аналитика'      },
    { to: '/app/orders',     end: false, icon: ShoppingCart,  label: 'Заказы'         },
    { to: '/app/history',    end: false, icon: History,       label: 'История'        },
];

const NAV_OPS = [
    { to: '/app/warehouses',   end: false, icon: Building2,   label: 'Склады'         },
    { to: '/app/integrations', end: false, icon: Plug,        label: 'Подключения'    },
];

const NAV_PERSONAL = [
    { to: '/app/tasks',         end: false, icon: ClipboardList, label: 'Задачи'       },
    { to: '/app/notifications', end: false, icon: Bell,          label: 'Уведомления', badge: true },
    { to: '/app/settings',      end: false, icon: Settings,      label: 'Настройки'    },
];

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

const SIDEBAR_EXPANDED_W = 260;
const SIDEBAR_COLLAPSED_W = 72;

const TRIAL_DAYS = 14;

function useTrialBanner(activeTenant: { accessState: string; tenantCreatedAt?: string } | null) {
    const [dismissed, setDismissed] = useState(false);
    if (!activeTenant || activeTenant.accessState !== 'TRIAL_ACTIVE' || dismissed) return { show: false, daysLeft: 0, dismiss: () => {} };
    const createdAt = activeTenant.tenantCreatedAt ? new Date(activeTenant.tenantCreatedAt) : null;
    if (!createdAt) return { show: false, daysLeft: 0, dismiss: () => {} };
    const trialEnd = new Date(createdAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const daysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
    return { show: true, daysLeft, dismiss: () => setDismissed(true) };
}

function pluralDays(n: number) {
    if (n === 1) return '1 день';
    if (n >= 2 && n <= 4) return `${n} дня`;
    return `${n} дней`;
}

export default function MainLayout() {
    const { user, activeTenant, tenants, switchTenant, logout, isTelegram } = useAuth();
    const canSeeTeam = activeTenant?.role !== 'STAFF';
    const isOwner = activeTenant?.role === 'OWNER';
    const navigate = useNavigate();
    const location = useLocation();
    const isDesktop = useIsDesktop();

    const [unreadCount, setUnreadCount] = useState(0);
    const [tenantOpen, setTenantOpen] = useState(false);
    const [collapsed, setCollapsed] = useState(false);

    const trial = useTrialBanner(activeTenant);

    const sidebarW = collapsed ? SIDEBAR_COLLAPSED_W : SIDEBAR_EXPANDED_W;

    useEffect(() => {
        if (!activeTenant) return;
        notificationsApi.getInbox({ limit: 1, unreadOnly: true })
            .then(r => setUnreadCount(r.unreadCount))
            .catch(() => {});
    }, [activeTenant]);

    useEffect(() => {
        const tg = window.Telegram?.WebApp;
        if (!tg || !isTelegram) return;
        const isMain = location.pathname === '/app';
        isMain ? tg.BackButton.hide() : tg.BackButton.show();
        const back = () => navigate(-1);
        tg.BackButton.onClick(back);
        return () => tg.BackButton.offClick(back);
    }, [location.pathname, isTelegram, navigate]);

    const handleLogout = async () => { await logout(); navigate('/login'); };

    const availableTenants = tenants.filter(t => t.isAvailable);
    const initials = (activeTenant?.name ?? user?.email ?? '?')
        .split(' ').slice(0, 2).map(w => w[0]?.toUpperCase()).join('');

    return (
        <div style={{ display: 'flex', height: '100vh', background: '#f1f5f9', fontFamily: "'Inter', sans-serif" }}>

            {/* ── Desktop Sidebar ── */}
            {isDesktop && (
                <aside style={{
                    width: sidebarW,
                    flexShrink: 0,
                    height: '100vh',
                    position: 'sticky',
                    top: 0,
                    background: SB.bg,
                    display: 'flex',
                    flexDirection: 'column',
                    borderRight: `1px solid ${SB.border}`,
                    transition: 'width 0.2s ease',
                    overflow: 'hidden',
                }}>
                    {/* Logo + collapse toggle */}
                    <div style={{
                        padding: collapsed ? '16px 0' : '16px 14px 10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: collapsed ? 'center' : 'space-between',
                        gap: 8,
                        minHeight: 56,
                    }}>
                        {!collapsed && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Package size={28} color="#3b82f6" strokeWidth={1.6} />
                                <span style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', letterSpacing: '-0.01em' }}>
                                    Sklad Optima
                                </span>
                            </div>
                        )}
                        {collapsed && (
                            <Package size={30} color="#3b82f6" strokeWidth={1.6} />
                        )}
                        {!collapsed && (
                            <button
                                onClick={() => setCollapsed(true)}
                                title="Свернуть панель"
                                style={{
                                    border: 'none', background: 'transparent', cursor: 'pointer',
                                    padding: 4, borderRadius: 6, color: SB.icon, display: 'flex',
                                    flexShrink: 0,
                                }}
                                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = SB.hover; (e.currentTarget as HTMLButtonElement).style.color = SB.iconActive; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = SB.icon; }}
                            >
                                <ChevronLeft size={16} />
                            </button>
                        )}
                    </div>

                    {/* Expand button when collapsed */}
                    {collapsed && (
                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
                            <button
                                onClick={() => setCollapsed(false)}
                                title="Развернуть панель"
                                style={{
                                    border: 'none', background: 'transparent', cursor: 'pointer',
                                    padding: 5, borderRadius: 6, color: SB.icon, display: 'flex',
                                }}
                                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = SB.hover; (e.currentTarget as HTMLButtonElement).style.color = SB.iconActive; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = SB.icon; }}
                            >
                                <ChevronRight size={16} />
                            </button>
                        </div>
                    )}

                    {/* Tenant selector */}
                    {activeTenant && !collapsed && (
                        <div style={{ padding: '0 10px 12px', position: 'relative' }}>
                            <button
                                onClick={() => setTenantOpen(o => !o)}
                                style={{
                                    width: '100%', padding: '7px 10px', borderRadius: 8,
                                    border: `1px solid ${SB.border}`,
                                    background: tenantOpen ? SB.hover : '#f8fafc',
                                    cursor: availableTenants.length > 1 ? 'pointer' : 'default',
                                    display: 'flex', alignItems: 'center', gap: 8,
                                }}
                                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = SB.hover; }}
                                onMouseLeave={e => { if (!tenantOpen) (e.currentTarget as HTMLButtonElement).style.background = '#f8fafc'; }}
                            >
                                <div style={{
                                    width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                                    background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <span style={{ fontSize: 9, fontWeight: 800, color: '#fff' }}>
                                        {initials.slice(0, 2)}
                                    </span>
                                </div>
                                <span style={{
                                    flex: 1, fontSize: 12, fontWeight: 500, color: '#334155',
                                    textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                }}>
                                    {activeTenant.name}
                                </span>
                                {availableTenants.length > 1 && (
                                    <ChevronDown size={13} color={SB.sectionLabel}
                                        style={{ transform: tenantOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
                                    />
                                )}
                            </button>

                            {/* Tenant dropdown */}
                            {tenantOpen && availableTenants.length > 1 && (
                                <div style={{
                                    position: 'absolute', top: '100%', left: 10, right: 10, zIndex: 50,
                                    background: '#fff', borderRadius: 10, border: `1px solid ${SB.border}`,
                                    boxShadow: '0 8px 24px rgba(0,0,0,0.08)', overflow: 'hidden',
                                }}>
                                    {availableTenants.map(t => (
                                        <button
                                            key={t.id}
                                            onClick={async () => { setTenantOpen(false); await switchTenant(t.id); }}
                                            style={{
                                                width: '100%', padding: '9px 12px', border: 'none', cursor: 'pointer',
                                                background: t.id === activeTenant.id ? SB.active : 'transparent',
                                                display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                                            }}
                                            onMouseEnter={e => { if (t.id !== activeTenant.id) (e.currentTarget as HTMLButtonElement).style.background = SB.hover; }}
                                            onMouseLeave={e => { if (t.id !== activeTenant.id) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                                        >
                                            <div style={{
                                                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                                                background: t.id === activeTenant.id ? '#3b82f6' : '#cbd5e1',
                                            }} />
                                            <span style={{
                                                fontSize: 12, color: '#334155',
                                                fontWeight: t.id === activeTenant.id ? 600 : 400,
                                            }}>
                                                {t.name}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    <div style={{ height: 1, background: SB.border, margin: collapsed ? '0 10px 10px' : '0 12px 8px' }} />

                    {/* Nav */}
                    <nav style={{
                        flex: 1,
                        padding: collapsed ? '0 8px' : '0 10px',
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1,
                    }}>
                        {NAV_PRIMARY.map(item => (
                            <SideNavItem key={item.to} {...item} unread={0} collapsed={collapsed} />
                        ))}

                        {!collapsed && <SectionLabel label="Операции" />}
                        {collapsed && <div style={{ height: 8 }} />}

                        {NAV_OPS.map(item => (
                            <SideNavItem key={item.to} {...item} unread={0} collapsed={collapsed} />
                        ))}

                        {!collapsed && <SectionLabel label="Личное" />}
                        {collapsed && <div style={{ height: 8 }} />}

                        {NAV_PERSONAL.map(item => (
                            <SideNavItem
                                key={item.to} {...item}
                                unread={item.badge ? unreadCount : 0}
                                collapsed={collapsed}
                            />
                        ))}

                        {canSeeTeam && (
                            <SideNavItem to="/app/team" end={false} icon={Users} label="Команда" unread={0} collapsed={collapsed} />
                        )}
                        {isOwner && (
                            <SideNavItem to="/app/referrals" end={false} icon={Gift} label="Рефералы" unread={0} collapsed={collapsed} />
                        )}
                    </nav>

                    {/* User footer */}
                    <div style={{ padding: collapsed ? '10px 8px' : '10px 10px', borderTop: `1px solid ${SB.border}` }}>
                        {collapsed ? (
                            <div style={{ display: 'flex', justifyContent: 'center' }}>
                                <button
                                    onClick={handleLogout}
                                    title="Выйти"
                                    style={{
                                        border: 'none', background: 'transparent', cursor: 'pointer',
                                        padding: 7, borderRadius: 7, color: SB.icon, display: 'flex',
                                    }}
                                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#fee2e2'; (e.currentTarget as HTMLButtonElement).style.color = '#ef4444'; }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = SB.icon; }}
                                >
                                    <LogOut size={15} />
                                </button>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8 }}>
                                <div style={{
                                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                                    background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <span style={{ fontSize: 10, fontWeight: 700, color: '#fff' }}>
                                        {(user?.email ?? '?')[0].toUpperCase()}
                                    </span>
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                        fontSize: 11, fontWeight: 600, color: '#334155',
                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                    }}>
                                        {user?.email}
                                    </div>
                                    <div style={{ fontSize: 10, color: SB.sectionLabel }}>
                                        {activeTenant?.role === 'OWNER' ? 'Владелец'
                                            : activeTenant?.role === 'ADMIN' ? 'Администратор'
                                            : 'Сотрудник'}
                                    </div>
                                </div>
                                <button
                                    onClick={handleLogout}
                                    title="Выйти"
                                    style={{
                                        background: 'transparent', border: 'none', cursor: 'pointer',
                                        padding: 5, borderRadius: 6, display: 'flex', color: SB.icon,
                                    }}
                                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#fee2e2'; (e.currentTarget as HTMLButtonElement).style.color = '#ef4444'; }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = SB.icon; }}
                                >
                                    <LogOut size={14} />
                                </button>
                            </div>
                        )}
                    </div>
                </aside>
            )}

            {/* ── Mobile top bar ── */}
            {!isDesktop && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40,
                    height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: '#fff', borderBottom: `1px solid ${SB.border}`, padding: '0 16px',
                }}>
                    <Link to="/app" style={{ display: 'flex', alignItems: 'center', gap: 7, textDecoration: 'none' }}>
                        <Package size={24} color="#3b82f6" strokeWidth={1.6} />
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Sklad Optima</span>
                    </Link>
                    <button onClick={handleLogout} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: SB.icon, padding: 6 }}>
                        <LogOut size={18} />
                    </button>
                </div>
            )}

            {/* ── Main content ── */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', marginTop: isDesktop ? 0 : 52 }}>
                {/* Trial banner */}
                {trial.show && (
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '9px 20px',
                        background: '#fefce8',
                        borderBottom: '1px solid #fde68a',
                        flexShrink: 0,
                    }}>
                        <span style={{ fontFamily: 'Inter', fontSize: 13, color: '#92400e' }}>
                            Бесплатный период заканчивается через{' '}
                            <strong>{pluralDays(trial.daysLeft)}</strong>
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                            <Link
                                to="/app/settings"
                                style={{ fontFamily: 'Inter', fontSize: 13, fontWeight: 600, color: '#b45309', textDecoration: 'underline' }}
                            >
                                Выбрать тариф
                            </Link>
                            <button
                                onClick={trial.dismiss}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#92400e', display: 'flex' }}
                            >
                                <X size={14} />
                            </button>
                        </div>
                    </div>
                )}
                <main style={{
                    flex: 1, overflowY: 'auto', background: '#f1f5f9',
                    padding: '20px 24px 24px',
                    paddingBottom: isDesktop ? 24 : 80,
                }}>
                    <Outlet />
                </main>
            </div>

            <OnboardingWidget />

            {/* ── Mobile bottom nav ── */}
            {!isDesktop && (
                <div style={{
                    position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 40,
                    background: 'rgba(255,255,255,0.95)',
                    backdropFilter: 'blur(20px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                    borderTop: `1px solid ${SB.border}`,
                    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                }}>
                    <div style={{ display: 'flex', padding: '8px 4px 4px' }}>
                        {[
                            { to: '/app',           end: true,  icon: Package,      label: 'Остатки'  },
                            { to: '/app/analytics', end: false, icon: BarChart3,     label: 'Аналитика' },
                            { to: '/app/orders',    end: false, icon: ShoppingCart,  label: 'Заказы'   },
                            { to: '/app/settings',  end: false, icon: Settings,      label: 'Ещё'      },
                        ].map(item => (
                            <NavLink key={item.to} to={item.to} end={item.end} style={({ isActive }) => ({
                                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                                gap: 3, padding: '6px 4px', textDecoration: 'none', border: 'none',
                                background: 'transparent', cursor: 'pointer',
                                color: isActive ? '#2563eb' : '#94a3b8',
                                fontSize: 10, fontWeight: isActive ? 700 : 500,
                                letterSpacing: '-0.01em',
                            })}>
                                {({ isActive }) => (
                                    <>
                                        <item.icon size={22} color={isActive ? '#2563eb' : '#94a3b8'} strokeWidth={isActive ? 2.2 : 1.75} />
                                        {item.label}
                                    </>
                                )}
                            </NavLink>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Sidebar nav item ────────────────────────────────────────────────────────
function SideNavItem({
    to, end, icon: Icon, label, unread, collapsed,
}: {
    to: string; end: boolean; icon: React.ElementType; label: string; unread: number; collapsed: boolean;
}) {
    return (
        <NavLink
            to={to}
            end={end}
            title={collapsed ? label : undefined}
            style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                gap: collapsed ? 0 : 9,
                padding: collapsed ? '10px 0' : '8px 10px',
                borderRadius: 8,
                textDecoration: 'none',
                transition: 'background 0.1s, color 0.1s',
                background: isActive ? SB.active : 'transparent',
                color: isActive ? SB.textActive : SB.text,
                position: 'relative',
            })}
            onMouseEnter={e => {
                const el = e.currentTarget as HTMLAnchorElement;
                if (el.getAttribute('aria-current') !== 'page') el.style.background = SB.hover;
            }}
            onMouseLeave={e => {
                const el = e.currentTarget as HTMLAnchorElement;
                if (el.getAttribute('aria-current') !== 'page') el.style.background = 'transparent';
            }}
        >
            {({ isActive }) => (
                <>
                    {/* Синяя полоска слева у активного пункта */}
                    {isActive && !collapsed && (
                        <span style={{
                            position: 'absolute', left: 0, top: '20%', bottom: '20%',
                            width: 3, borderRadius: 2,
                            background: SB.activeBorder,
                        }} />
                    )}
                    <Icon
                        size={collapsed ? 22 : 16}
                        strokeWidth={isActive ? 2.2 : 1.75}
                        color={isActive ? SB.iconActive : SB.icon}
                    />
                    {!collapsed && (
                        <span style={{
                            fontSize: 13.5,
                            fontWeight: isActive ? 600 : 400,
                            flex: 1,
                            letterSpacing: '-0.01em',
                        }}>
                            {label}
                        </span>
                    )}
                    {!collapsed && unread > 0 && (
                        <span style={{
                            background: '#3b82f6', color: '#fff', fontSize: 9, fontWeight: 700,
                            padding: '1px 5px', borderRadius: 999, lineHeight: '14px',
                        }}>
                            {unread > 99 ? '99+' : unread}
                        </span>
                    )}
                    {collapsed && unread > 0 && (
                        <span style={{
                            position: 'absolute', top: 4, right: 8,
                            width: 7, height: 7, borderRadius: '50%',
                            background: '#3b82f6', border: '1.5px solid #fff',
                        }} />
                    )}
                </>
            )}
        </NavLink>
    );
}

// ─── Section divider label ──────────────────────────────────────────────────
function SectionLabel({ label }: { label: string }) {
    return (
        <div style={{
            padding: '10px 10px 4px',
            fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: SB.sectionLabel,
        }}>
            {label}
        </div>
    );
}
