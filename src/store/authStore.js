import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useAuthStore = create(
    persist(
        (set) => ({
            user: null,
            isAuthenticated: false,
            login: (email, password) => {
                // Specific credentials as requested: admin / 1234
                if (email === 'admin' && password === '1234') {
                    set({
                        user: { email },
                        isAuthenticated: true
                    });
                    return true;
                }
                return false;
            },
            logout: () => set({ user: null, isAuthenticated: false }),
        }),
        {
            name: 'auth-storage', // name of the item in the storage (must be unique)
        }
    )
);

export default useAuthStore;
