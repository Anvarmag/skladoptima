import React, { createContext, useContext, useEffect, useState } from 'react';
import axios from 'axios';

// Configure global axios defaults
axios.defaults.baseURL = import.meta.env.VITE_API_URL || '/api';
axios.defaults.withCredentials = true; // Send httpOnly cookies

// Telegram WebApp type declarations
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

interface User {
    id: string;
    email: string;
}

interface AuthContextType {
    user: User | null;
    loading: boolean;
    isTelegram: boolean;
    checkAuth: () => Promise<void>;
    logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
    isTelegram: false,
    checkAuth: async () => { },
    logout: async () => { },
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [isTelegram, setIsTelegram] = useState(false);

    const checkAuth = async () => {
        try {
            const res = await axios.get('/auth/me');
            setUser(res.data);
        } catch (error) {
            setUser(null);
        } finally {
            setLoading(false);
        }
    };

    const loginViaTelegram = async (initData: string) => {
        try {
            const res = await axios.post('/auth/telegram', { initData });
            setUser(res.data.user);
        } catch (error) {
            console.error('Telegram auth failed, falling back to cookie auth', error);
            // Fallback to standard cookie auth
            await checkAuth();
        } finally {
            setLoading(false);
        }
    };

    const logout = async () => {
        try {
            await axios.post('/auth/logout');
            setUser(null);
        } catch (error) {
            console.error('Logout error', error);
        }
    };

    useEffect(() => {
        const tg = window.Telegram?.WebApp;
        if (tg && tg.initData) {
            // Running inside Telegram Mini App
            setIsTelegram(true);
            tg.ready();
            tg.expand();
            loginViaTelegram(tg.initData);
        } else {
            // Standard browser — use cookie auth
            checkAuth();
        }
    }, []);

    return (
        <AuthContext.Provider value={{ user, loading, isTelegram, checkAuth, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
