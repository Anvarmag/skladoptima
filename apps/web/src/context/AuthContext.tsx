import React, { createContext, useContext, useEffect, useState } from 'react';
import axios from 'axios';

axios.defaults.baseURL = import.meta.env.VITE_API_URL || '/api';
axios.defaults.withCredentials = true;

// CSRF: store token fetched from server, attach to all mutating requests
let _csrfToken = '';
const MUTATING_METHODS = ['post', 'put', 'patch', 'delete'];

async function refreshCsrfToken(): Promise<void> {
    try {
        const res = await axios.get('/auth/csrf-token');
        _csrfToken = res.data.csrfToken ?? '';
    } catch {
        // non-fatal — server will reject mutations with CSRF_TOKEN_INVALID if needed
    }
}

axios.interceptors.request.use((config) => {
    if (config.method && MUTATING_METHODS.includes(config.method.toLowerCase())) {
        config.headers['X-CSRF-Token'] = _csrfToken;
    }
    return config;
});

declare global {
    interface Window {
        Telegram?: {
            WebApp: {
                initData: string;
                initDataUnsafe: any;
                ready: () => void;
                expand: () => void;
                close: () => void;
                isExpanded: boolean;
                platform: string;
                colorScheme: 'light' | 'dark';
                themeParams: Record<string, string>;
                BackButton: {
                    show: () => void;
                    hide: () => void;
                    onClick: (cb: () => void) => void;
                    offClick: (cb: () => void) => void;
                    isVisible: boolean;
                };
                MainButton: {
                    show: () => void;
                    hide: () => void;
                    setText: (text: string) => void;
                    onClick: (cb: () => void) => void;
                };
            };
        };
    }
}

export interface AuthUser {
    id: string;
    email: string;
    phone?: string | null;
    status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'LOCKED' | 'DELETED';
    emailVerifiedAt?: string | null;
    lastLoginAt?: string | null;
    memberships?: Array<{
        id: string;
        role: string;
        tenantId: string;
        tenant: { id: string; name: string; accessState: string };
    }>;
    preferences?: { lastUsedTenantId?: string | null; locale?: string | null; timezone?: string | null } | null;
}

export interface ActiveTenant {
    id: string;
    name: string;
    accessState: string;
    role: string;
}

export interface TenantSummary {
    id: string;
    name: string;
    accessState: string;
    status: string;
    role: string;
    isAvailable: boolean;
}

interface AuthContextType {
    user: AuthUser | null;
    activeTenant: ActiveTenant | null;
    tenants: TenantSummary[];
    loading: boolean;
    isTelegram: boolean;
    nextRoute: string | null;
    checkAuth: () => Promise<string | null>;
    logout: () => Promise<void>;
    switchTenant: (tenantId: string) => Promise<void>;
    linkAccountViaTelegram: (email: string, password: string) => Promise<any>;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    activeTenant: null,
    tenants: [],
    loading: true,
    isTelegram: false,
    nextRoute: null,
    checkAuth: async () => null,
    logout: async () => {},
    switchTenant: async () => {},
    linkAccountViaTelegram: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [activeTenant, setActiveTenant] = useState<ActiveTenant | null>(null);
    const [tenants, setTenants] = useState<TenantSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [isTelegram, setIsTelegram] = useState(false);
    const [nextRoute, setNextRoute] = useState<string | null>(null);

    const checkAuth = async (): Promise<string | null> => {
        try {
            const res = await axios.get('/auth/me');
            setUser(res.data.user);
            setActiveTenant(res.data.activeTenant ?? null);
            setTenants(res.data.tenants ?? []);
            setNextRoute(res.data.nextRoute ?? null);
            return res.data.nextRoute ?? null;
        } catch {
            setUser(null);
            setActiveTenant(null);
            setTenants([]);
            setNextRoute(null);
            return null;
        } finally {
            setLoading(false);
        }
    };

    const switchTenant = async (tenantId: string): Promise<void> => {
        await axios.post(`/tenants/${tenantId}/switch`);
        await checkAuth();
    };

    const loginViaTelegram = async (initData: string) => {
        try {
            await axios.post('/auth/telegram', { initData });
            await checkAuth();
        } catch (error: any) {
            if (error.response?.data?.message === 'account_not_linked') {
                setUser(null);
            } else {
                console.error('Telegram auth failed', error);
                await checkAuth();
            }
        } finally {
            setLoading(false);
        }
    };

    const linkAccountViaTelegram = async (email: string, password: string) => {
        const tg = window.Telegram?.WebApp;
        if (!tg || !tg.initData) return;
        const res = await axios.post('/auth/telegram/link', {
            initData: tg.initData,
            email,
            password,
        });
        await checkAuth();
        return res.data;
    };

    const logout = async () => {
        try {
            if (isTelegram) {
                await axios.post('/auth/telegram/unlink');
            } else {
                await axios.post('/auth/logout');
            }
        } catch (error) {
            console.error('Logout error', error);
        } finally {
            setUser(null);
            setActiveTenant(null);
            setTenants([]);
            setNextRoute(null);
        }
    };

    useEffect(() => {
        const tg = window.Telegram?.WebApp;
        refreshCsrfToken().then(() => {
            if (tg && tg.initData) {
                setIsTelegram(true);
                tg.ready();
                tg.expand();
                loginViaTelegram(tg.initData);
            } else {
                checkAuth();
            }
        });
    }, []);

    return (
        <AuthContext.Provider value={{ user, activeTenant, tenants, loading, isTelegram, nextRoute, checkAuth, logout, switchTenant, linkAccountViaTelegram }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
