import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const API = 'http://localhost:3000/api';

/**
 * settingsStore — хранит API-ключи маркетплейсов.
 * Данные сохраняются локально (persist) и синхронизируются с бэкендом (Settings table).
 */
const useSettingsStore = create(
    persist(
        (set, get) => ({
            // State
            wbToken: '',
            wbWarehouseId: '',
            ozonClientId: '',
            ozonApiKey: '',
            ozonWarehouseId: '',
            loading: false,

            /** Загрузить ключи из бэкенда при инициализации */
            loadApiKeys: async () => {
                try {
                    set({ loading: true });
                    const res = await fetch(`${API}/settings`);
                    if (res.ok) {
                        const data = await res.json();
                        // Убираем служебные поля Prisma перед сохранением в стейт
                        const { id, updatedAt, ...keys } = data;
                        set({ ...keys });
                    }
                } catch (err) {
                    console.error('[loadApiKeys]', err.message);
                } finally {
                    set({ loading: false });
                }
            },

            /** Обновить ключи локально и отправить на бэкенд */
            setApiKeys: async (keys) => {
                // 1. Сначала локально (optimistic)
                set((state) => ({ ...state, ...keys }));

                // 2. Отправляем на бэкенд
                try {
                    const res = await fetch(`${API}/settings`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(keys),
                    });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    console.log('[setApiKeys] ✅ Ключи сохранены на бэкенде');
                } catch (err) {
                    console.error('[setApiKeys] ❌ Ошибка сохранения на бэкенде:', err.message);
                }
            },
        }),
        { name: 'settings-storage' }
    )
);

export default useSettingsStore;
