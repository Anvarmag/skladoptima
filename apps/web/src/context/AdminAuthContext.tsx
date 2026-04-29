import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
    adminAuthApi,
    refreshAdminCsrfToken,
    extractApiError,
    type SupportUser,
    type SupportUserRole,
} from '../api/admin';

interface AdminAuthContextType {
    supportUser: SupportUser | null;
    sessionId: string | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
    refresh: () => Promise<void>;
    isAdmin: boolean;
    isReadonly: boolean;
}

const AdminAuthContext = createContext<AdminAuthContextType>({
    supportUser: null,
    sessionId: null,
    loading: true,
    login: async () => {},
    logout: async () => {},
    refresh: async () => {},
    isAdmin: false,
    isReadonly: false,
});

/// Изолированный admin auth provider. Не делит state с tenant-facing AuthProvider —
/// support роль `SUPPORT_ADMIN` ≠ tenant `OWNER`. Подписан на свой набор cookies.
export const AdminAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [supportUser, setSupportUser] = useState<SupportUser | null>(null);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        try {
            const me = await adminAuthApi.me();
            setSupportUser({
                id: me.supportUser.id,
                email: '',
                role: me.supportUser.role as SupportUserRole,
            });
            setSessionId(me.sessionId);
        } catch {
            setSupportUser(null);
            setSessionId(null);
        } finally {
            setLoading(false);
        }
    }, []);

    const login = useCallback(async (email: string, password: string) => {
        const result = await adminAuthApi.login(email, password);
        setSupportUser(result.supportUser);
        // sessionId возвращается через /me — подгрузим контекст полностью
        try {
            const me = await adminAuthApi.me();
            setSessionId(me.sessionId);
            // /me не возвращает email, но логин вернул — мержим
            setSupportUser((prev) => prev ?? { ...result.supportUser });
        } catch {
            // soft-fail: основная сессия уже установлена через cookie
        }
    }, []);

    const logout = useCallback(async () => {
        try {
            await adminAuthApi.logout();
        } catch {
            // даже если сервер ответил ошибкой — сбрасываем локальное состояние
        } finally {
            setSupportUser(null);
            setSessionId(null);
        }
    }, []);

    useEffect(() => {
        refreshAdminCsrfToken().then(refresh);
    }, [refresh]);

    return (
        <AdminAuthContext.Provider
            value={{
                supportUser,
                sessionId,
                loading,
                login,
                logout,
                refresh,
                isAdmin: supportUser?.role === 'SUPPORT_ADMIN',
                isReadonly: supportUser?.role === 'SUPPORT_READONLY',
            }}
        >
            {children}
        </AdminAuthContext.Provider>
    );
};

export const useAdminAuth = () => useContext(AdminAuthContext);

export { extractApiError };
