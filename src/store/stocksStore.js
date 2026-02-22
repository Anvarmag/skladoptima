import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import useAuthStore from './authStore';

const API = '/api';

const handleUnauthorized = () => {
    const { logout } = useAuthStore.getState();
    logout();
    window.location.href = '/login';
};

/**
 * Маппинг: бэкенд → фронтенд
 * backend: stock_master / stock_wb / stock_ozon / sku
 * frontend: stock      / wb        / ozon        / sellerSku
 */
const fromApi = (p) => ({
    ...p,
    sellerSku: p.sku,
    stock: p.stock_master,
    wb: p.stock_wb,
    ozon: p.stock_ozon,
});

/** Маппинг поля фронтенда в поле бэкенда */
const fieldToApi = { stock: 'stock_master', wb: 'stock_wb', ozon: 'stock_ozon' };

const useStocksStore = create(
    persist(
        (set, get) => ({
            items: [],
            stores: [],
            activeStoreId: null,
            loading: false,
            viewSettings: { compactMode: false },
            visibleColumns: { wb: false, ozon: false },

            // ── API: управление магазинами ────────────────────────────────
            fetchStores: async () => {
                const { token } = useAuthStore.getState();
                if (!token) return;
                try {
                    const res = await fetch(`${API}/stores`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.status === 401) return handleUnauthorized();
                    if (res.ok) {
                        const stores = await res.json();
                        set({ stores });
                        // Если нет активного магазина — выбираем первый
                        if (stores.length > 0 && !get().activeStoreId) {
                            get().setActiveStore(stores[0].id);
                        }
                    }
                } catch (err) {
                    console.error('[fetchStores]', err);
                }
            },

            setActiveStore: (id) => {
                set({ activeStoreId: id });
                get().loadProducts();
            },

            addStore: async (storeData) => {
                const { token } = useAuthStore.getState();
                if (!token) return;
                try {
                    const res = await fetch(`${API}/stores`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify(storeData)
                    });
                    if (res.status === 401) return handleUnauthorized();
                    if (res.ok) {
                        await get().fetchStores();
                        return { success: true };
                    }
                    return { success: false, error: 'Ошибка создания' };
                } catch (err) {
                    console.error('[addStore]', err);
                    return { success: false, error: err.message };
                }
            },

            deleteStore: async (id) => {
                const { token } = useAuthStore.getState();
                if (!token) return;
                try {
                    const res = await fetch(`${API}/stores/${id}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.status === 401) return handleUnauthorized();
                    if (res.ok) {
                        const newStores = get().stores.filter(s => s.id !== id);
                        set({ stores: newStores });
                        if (get().activeStoreId === id) {
                            set({ activeStoreId: newStores[0]?.id || null });
                            get().loadProducts();
                        }
                    }
                } catch (err) {
                    console.error('[deleteStore]', err);
                }
            },

            updateStore: async (id, storeData) => {
                const { token } = useAuthStore.getState();
                if (!token) return;
                try {
                    const res = await fetch(`${API}/stores/${id}`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify(storeData)
                    });
                    if (res.status === 401) return handleUnauthorized();
                    if (res.ok) {
                        await get().fetchStores();
                        return { success: true };
                    }
                    return { success: false, error: 'Ошибка обновления' };
                } catch (err) {
                    console.error('[updateStore]', err);
                    return { success: false, error: err.message };
                }
            },

            // ── API: загрузить товары с сервера ───────────────────────────
            loadProducts: async (toast) => {
                const { token } = useAuthStore.getState();
                const storeId = get().activeStoreId;
                if (!token) return;
                if (!storeId) {
                    set({ items: [], loading: false });
                    return;
                }

                set({ loading: true });
                try {
                    const res = await fetch(`${API}/products`, {
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'store-id': storeId
                        }
                    });
                    if (res.status === 401) return handleUnauthorized();
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const data = await res.json();
                    set({ items: data.map(fromApi), loading: false });
                } catch (err) {
                    console.error('[loadProducts]', err.message);
                    set({ loading: false });
                    toast?.('Не удалось загрузить данные с сервера', 'error');
                }
            },

            // ── API: синхронизировать массив товаров (Импорт) ──────────────
            syncProducts: async (items, toast) => {
                const { token } = useAuthStore.getState();
                const storeId = get().activeStoreId;
                if (!token || !storeId) {
                    toast?.('Магазин не выбран или вы не вошли', 'error');
                    return false;
                }

                try {
                    const payload = items.map(p => ({
                        sku: p.sellerSku || p.barcode,
                        barcode: p.barcode || null,
                        name: p.name || 'Без названия',
                        stock_master: Number(p.stock) || 0,
                        stock_wb: Number(p.wb) || 0,
                        stock_ozon: Number(p.ozon) || 0,
                    }));

                    const res = await fetch(`${API}/products`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`,
                            'store-id': storeId
                        },
                        body: JSON.stringify(payload),
                    });

                    if (res.status === 401) return handleUnauthorized();
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);

                    const result = await res.json();
                    toast?.(`Синхронизировано: ${result.length ?? 0} товаров`, 'success');
                    await get().loadProducts();
                    return true;
                } catch (err) {
                    console.error('[syncProducts]', err.message);
                    toast?.('Не удалось синхронизировать с бэкендом', 'error');
                    return false;
                }
            },

            // ── API: обновить остаток на сервере ──────────────────────────
            updateStockOnServer: async (sku, field, value, toast) => {
                const { token } = useAuthStore.getState();
                const storeId = get().activeStoreId;
                if (!token || !storeId) return;

                const apiField = fieldToApi[field];
                if (!sku || !apiField) return;

                try {
                    const res = await fetch(`${API}/products/${encodeURIComponent(sku)}`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`,
                            'store-id': storeId
                        },
                        body: JSON.stringify({ [apiField]: Number(value) }),
                    });
                    if (res.status === 401) return handleUnauthorized();
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const data = await res.json();

                    // Отображаем статус маркетплейсов в уведомлении
                    const mp = data._marketplaces;
                    if (mp) {
                        const parts = [];
                        if (mp.wb === 'ok') parts.push('WB ✅');
                        else if (mp.wb === 'error') parts.push('WB ❌');
                        if (mp.ozon === 'ok') parts.push('Ozon ✅');
                        else if (mp.ozon === 'error') parts.push('Ozon ❌');
                        toast?.(parts.length ? `Остаток сохранён: ${parts.join(', ')}` : 'Остаток сохранён', 'success');
                    } else {
                        toast?.('Остаток сохранён', 'success');
                    }
                } catch (err) {
                    console.error('[updateStockOnServer]', err.message);
                    toast?.('Ошибка сохранения на сервере', 'error');
                }
            },

            // ── Локальные actions (без изменений) ─────────────────────────
            setItems: (newItems) => set({ items: newItems }),

            updateItem: (barcode, field, value) => {
                const items = get().items.map((item) => {
                    if (item.barcode === barcode) {
                        const updatedItem = { ...item, [field]: value };
                        if (['stock', 'wb', 'ozon'].includes(field)) {
                            updatedItem.stock = value;
                            updatedItem.wb = value;
                            updatedItem.ozon = value;
                        }
                        return updatedItem;
                    }
                    return item;
                });
                set({ items });
            },

            addItems: (newItems) => set({ items: newItems }),

            clearData: () => set({ items: [] }),

            toggleColumn: (column) => set((state) => ({
                visibleColumns: {
                    ...state.visibleColumns,
                    [column]: !state.visibleColumns[column],
                },
            })),

            deleteItem: (barcode) => {
                const items = get().items.filter(item => item.barcode !== barcode);
                set({ items });
            },

            deleteMultipleItems: (barcodes) => {
                const items = get().items.filter(item => !barcodes.includes(item.barcode));
                set({ items });
            },

            toggleCompactMode: () => set((state) => ({
                viewSettings: {
                    ...state.viewSettings,
                    compactMode: !state.viewSettings.compactMode,
                },
            })),
        }),
        { name: 'stocks-storage' }
    )
);

export default useStocksStore;
