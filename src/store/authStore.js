import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * authStore — управляет авторизацией пользователя и JWT токеном.
 */
const useAuthStore = create(
    persist(
        (set) => ({
            user: null,
            token: null,
            isAuthenticated: false,

            setAuth: (user, token) => set({
                user,
                token,
                isAuthenticated: true
            }),

            logout: () => set({
                user: null,
                token: null,
                isAuthenticated: false
            }),
        }),
        { name: 'auth-storage' }
    )
);

export default useAuthStore;
