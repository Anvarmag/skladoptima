import { Outlet, NavLink, useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
    Package, History, LogOut, Settings, ShoppingCart, BarChart3, PieChart,
    Users, Building2, Plug, Gift, Bell, ClipboardList, Boxes,
    ChevronDown,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { notificationsApi } from '../api/notifications';
import AccessStateBanner from '../components/AccessStateBanner';
import OnboardingWidget from '../components/OnboardingWidget';

// ─── Design tokens (matching hi-fi) ────────────────────────────────────────
const SB = {
    bg: '#0f172a',
    hover: 'rgba(255,255,255,0.06)',
    active: 'rgba(255,255,255,0.10)',
    border: 'rgba(255,255,255,0.07)',
    text: '#94a3b8',
    textActive: '#ffffff',
};

// ─── Nav structure ──────────────────────────────────────────────────────────
const NAV_PRIMARY = [
    { to: '/app',            end: true,  icon: Package,       label: 'Остатки'        },
    { to: '/app/inventory',  end: false, icon: Boxes,         label: 'Учёт остатков'  },
    { to: '/app/orders',     end: false, icon: ShoppingCart,  label: 'Заказы'         },
    { to: '/app/analytics',  end: false, icon: BarChart3,     label: 'Аналитика'      },
    { to: '/app/finance',    end: false, icon: PieChart,      label: 'Юнит-экономика' },
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

export default function MainLayout() {
    const { user, activeTenant, tenants, switchTenant, logout, isTelegram } = useAuth();
    const canSeeTeam = activeTenant?.role !== 'STAFF';
    const isOwner = activeTenant?.role === 'OWNER';
    const navigate = useNavigate();
    const location = useLocation();
    const isDesktop = useIsDesktop();

    const [unreadCount, setUnreadCount] = useState(0);
    const [tenantOpen, setTenantOpen] = useState(false);

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
        <div style={{ display: 'flex', height: '100vh', background: '#f8fafc', fontFamily: "'Inter', sans-serif" }}>

            {/* ── Desktop Sidebar ── */}
            {isDesktop && <aside style={{
                width: 232, flexShrink: 0, height: '100vh', position: 'sticky', top: 0,
                background: SB.bg, display: 'flex', flexDirection: 'column',
                borderRight: `1px solid ${SB.border}`,
            }}>
                {/* Logo */}
                <div style={{ padding: '18px 16px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                        width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                        background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <Package size={15} color="#fff" strokeWidth={2} />
                    </div>
                    <span style={{ fontWeight: 700, fontSize: 14, color: '#fff', letterSpacing: '-0.01em' }}>
                        Sklad Optima
                    </span>
                </div>

                {/* Tenant selector */}
                {activeTenant && (
                    <div style={{ padding: '0 10px 12px', position: 'relative' }}>
                        <button
                            onClick={() => setTenantOpen(o => !o)}
                            style={{
                                width: '100%', padding: '7px 10px', borderRadius: 8, border: 'none',
                                background: SB.hover, cursor: availableTenants.length > 1 ? 'pointer' : 'default',
                                display: 'flex', alignItems: 'center', gap: 8,
                            }}
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
                                flex: 1, fontSize: 12, fontWeight: 500, color: '#e2e8f0',
                                textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>
                                {activeTenant.name}
                            </span>
                            {availableTenants.length > 1 && (
                                <ChevronDown size={13} color={SB.text} />
                            )}
                        </button>

                        {/* Tenant dropdown */}
                        {tenantOpen && availableTenants.length > 1 && (
                            <div style={{
                                position: 'absolute', top: '100%', left: 10, right: 10, zIndex: 50,
                                background: '#1e293b', borderRadius: 10, border: `1px solid ${SB.border}`,
                                boxShadow: '0 16px 32px rgba(0,0,0,0.4)', overflow: 'hidden',
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
                                            background: t.id === activeTenant.id ? '#3b82f6' : SB.text,
                                        }} />
                                        <span style={{ fontSize: 12, color: '#e2e8f0', fontWeight: t.id === activeTenant.id ? 600 : 400 }}>
                                            {t.name}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                <div style={{ height: 1, background: SB.border, margin: '0 12px 10px' }} />

                {/* Nav */}
                <nav style={{ flex: 1, padding: '0 8px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {NAV_PRIMARY.map(item => (
                        <SideNavItem key={item.to} {...item} unread={0} />
                    ))}

                    <SectionLabel label="Операции" />

                    {NAV_OPS.map(item => (
                        <SideNavItem key={item.to} {...item} unread={0} />
                    ))}

                    <SectionLabel label="Личное" />

                    {NAV_PERSONAL.map(item => (
                        <SideNavItem
                            key={item.to} {...item}
                            unread={item.badge ? unreadCount : 0}
                        />
                    ))}

                    {canSeeTeam && (
                        <SideNavItem to="/app/team" end={false} icon={Users} label="Команда" unread={0} />
                    )}
                    {isOwner && (
                        <SideNavItem to="/app/referrals" end={false} icon={Gift} label="Рефералы" unread={0} />
                    )}
                </nav>

                {/* User footer */}
                <div style={{ padding: '10px 8px', borderTop: `1px solid ${SB.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8 }}>
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
                                fontSize: 11, fontWeight: 600, color: '#e2e8f0',
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>
                                {user?.email}
                            </div>
                            <div style={{ fontSize: 10, color: SB.text }}>
                                {activeTenant?.role === 'OWNER' ? 'Владелец'
                                    : activeTenant?.role === 'ADMIN' ? 'Администратор'
                                    : 'Сотрудник'}
                            </div>
                        </div>
                        <button
                            onClick={handleLogout}
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 5, borderRadius: 6, display: 'flex', color: SB.text }}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = SB.hover; (e.currentTarget as HTMLButtonElement).style.color = '#fff'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = SB.text; }}
                            title="Выйти"
                        >
                            <LogOut size={14} />
                        </button>
                    </div>
                </div>
            </aside>}

            {/* ── Mobile top bar ── */}
            {!isDesktop && (
            <div style={{
                position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40,
                height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: SB.bg, borderBottom: `1px solid ${SB.border}`, padding: '0 16px',
            }}>
                <Link to="/app" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
                    <div style={{
                        width: 26, height: 26, borderRadius: 7,
                        background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <Package size={13} color="#fff" />
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Sklad Optima</span>
                </Link>
                <button onClick={handleLogout} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: SB.text, padding: 6 }}>
                    <LogOut size={18} />
                </button>
            </div>
            )}

            {/* ── Main content ── */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', marginTop: isDesktop ? 0 : 52 }}>
                <main style={{
                    flex: 1, overflowY: 'auto', background: '#f8fafc',
                    padding: '20px 20px 24px',
                    paddingBottom: isDesktop ? 24 : 80,
                }}>
                    {activeTenant && (
                        <div style={{ marginBottom: 12 }}>
                            <AccessStateBanner accessState={activeTenant.accessState} />
                        </div>
                    )}
                    <Outlet />
                </main>
            </div>

            <OnboardingWidget />

            {/* ── Mobile bottom nav ── */}
            {!isDesktop && <div style={{
                position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 40,
                background: 'rgba(255,255,255,0.92)',
                backdropFilter: 'blur(20px) saturate(180%)',
                WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                borderTop: '1px solid #e2e8f0',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}>
                <div style={{ display: 'flex', padding: '8px 4px 4px' }}>
                {[
                    { to: '/app',           end: true,  icon: Package,      label: 'Остатки'  },
                    { to: '/app/analytics', end: false, icon: BarChart3,     label: 'Аналитика' },
                    { to: '/app/finance',   end: false, icon: PieChart,      label: 'Юнит'     },
                    { to: '/app/orders',    end: false, icon: ShoppingCart,  label: 'Заказы'   },
                    { to: '/app/settings',  end: false, icon: Settings,      label: 'Ещё'      },
                ].map(item => (
                    <NavLink key={item.to} to={item.to} end={item.end} style={({ isActive }) => ({
                        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                        gap: 3, padding: '6px 4px', textDecoration: 'none', border: 'none',
                        background: 'transparent', cursor: 'pointer',
                        color: isActive ? '#0f172a' : '#94a3b8',
                        fontSize: 10, fontWeight: isActive ? 700 : 500,
                        letterSpacing: '-0.01em',
                    })}>
                        {({ isActive }) => (
                            <>
                                <item.icon size={22} color={isActive ? '#0f172a' : '#94a3b8'} strokeWidth={isActive ? 2.2 : 1.75} />
                                {item.label}
                            </>
                        )}
                    </NavLink>
                ))}
                </div>
            </div>}
        </div>
    );
}

// ─── Sidebar nav item ────────────────────────────────────────────────────────
function SideNavItem({
    to, end, icon: Icon, label, unread,
}: {
    to: string; end: boolean; icon: React.ElementType; label: string; unread: number;
}) {
    return (
        <NavLink to={to} end={end} style={({ isActive }) => ({
            display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px',
            borderRadius: 7, textDecoration: 'none', transition: 'background 0.12s',
            background: isActive ? SB.active : 'transparent',
            color: isActive ? SB.textActive : SB.text,
        })}
            onMouseEnter={e => {
                const el = e.currentTarget as HTMLAnchorElement;
                if (!el.classList.contains('active')) el.style.background = SB.hover;
            }}
            onMouseLeave={e => {
                const el = e.currentTarget as HTMLAnchorElement;
                if (!el.classList.contains('active')) el.style.background = 'transparent';
            }}
        >
            {({ isActive }) => (
                <>
                    <Icon size={15} strokeWidth={isActive ? 2.1 : 1.75} />
                    <span style={{ fontSize: 13, fontWeight: isActive ? 600 : 400, flex: 1 }}>
                        {label}
                    </span>
                    {unread > 0 && (
                        <span style={{
                            background: '#3b82f6', color: '#fff', fontSize: 9, fontWeight: 700,
                            padding: '1px 5px', borderRadius: 999, lineHeight: '14px',
                        }}>
                            {unread > 99 ? '99+' : unread}
                        </span>
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
            fontSize: 10, fontWeight: 700, letterSpacing: '0.07em',
            textTransform: 'uppercase', color: 'rgba(148,163,184,0.5)',
        }}>
            {label}
        </div>
    );
}
