import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useStocksStore = create(
    persist(
        (set, get) => ({
            items: [],
            viewSettings: {
                compactMode: false,
            },
            visibleColumns: {
                wb: false,
                ozon: false,
            },

            // Actions
            setItems: (newItems) => set({ items: newItems }),

            updateItem: (barcode, field, value) => {
                const items = get().items.map((item) => {
                    if (item.barcode === barcode) {
                        const updatedItem = { ...item, [field]: value };

                        // Sync stock fields: if one changes, all should follow the new value
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

            addItems: (newItems) => {
                // Simple merge or append? Requirement says "Import", usually replaces or appends.
                // Let's replace for simplicity as per "Import XLSX" usually invalidates old state in simple apps, 
                // or we can append. The prompt says "Import data... then show in table". 
                // Also "Clean" button deletes data.
                // Let's append but check for duplicates? Or just replace?
                // Let's replace for now to avoid complexity of merging.
                set({ items: newItems });
            },

            clearData: () => set({ items: [] }),

            toggleColumn: (column) => set((state) => ({
                visibleColumns: {
                    ...state.visibleColumns,
                    [column]: !state.visibleColumns[column]
                }
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
                    compactMode: !state.viewSettings.compactMode
                }
            })),
        }),
        {
            name: 'stocks-storage',
        }
    )
);

export default useStocksStore;
