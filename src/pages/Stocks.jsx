import React, { useEffect } from 'react';
import { ImportControls } from '../components/stocks/ImportControls';
import { StockTable } from '../components/stocks/StockTable';

import useStocksStore from '../store/stocksStore';

const Stocks = () => {
    const { loadProducts, activeStoreId, loading } = useStocksStore();

    useEffect(() => {
        if (activeStoreId) {
            loadProducts();
        }
    }, [activeStoreId]);

    return (
        <div className="space-y-6 relative">
            {loading && (
                <div className="absolute inset-0 bg-white/50 z-50 flex items-center justify-center backdrop-blur-[1px]">
                    <div className="bg-white p-4 rounded-xl shadow-xl border border-blue-100 flex items-center gap-3">
                        <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                        <span className="text-sm font-medium text-blue-600">Загрузка данных...</span>
                    </div>
                </div>
            )}

            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold text-gray-900">Управление остатками</h1>
                <p className="text-gray-500 text-sm">Импортируйте данные из Excel или управляйте текущими остатками вручную.</p>
            </div>

            <ImportControls />
            <StockTable />
        </div>
    );
};

export default Stocks;
