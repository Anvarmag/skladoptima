import React, { useEffect } from 'react';
import { ImportControls } from '../components/stocks/ImportControls';
import { StockTable } from '../components/stocks/StockTable';

const Stocks = () => {
    // We could add some page-level effects here if needed
    return (
        <div className="space-y-6">
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
