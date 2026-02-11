import React, { useRef, useState } from 'react';
import { Upload, FileDown, Trash2, FileSpreadsheet } from 'lucide-react';
import { Button } from '../ui/Button';
import { parseExcel, exportExcel } from '../../utils/xlsxHelpers';
import useStocksStore from '../../store/stocksStore';

export const ImportControls = () => {
    const fileInputRef = useRef(null);
    const [loading, setLoading] = useState(false);
    const { addItems, items, clearData } = useStocksStore();

    const handleFileUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setLoading(true);
        try {
            const data = await parseExcel(file);
            addItems(data);
            // Could add toast here
        } catch (error) {
            console.error("Import failed", error);
            alert("Import failed: " + error.message);
        } finally {
            setLoading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleExport = () => {
        if (items.length === 0) return;
        exportExcel(items);
    };

    const loadDemoData = () => {
        const demoData = Array.from({ length: 50 }).map((_, i) => ({
            barcode: `204${Math.floor(10000000 + Math.random() * 90000000)}`,
            stock: Math.floor(Math.random() * 100),
            subject: ['Столы', 'Стулья', 'Кровати'][i % 3],
            brand: 'BUENOFURNI',
            name: `Товар тестовый ${i + 1}`,
            sellerSku: `BF${i + 1}SKU`,
            wb: Math.floor(Math.random() * 20),
            ozon: Math.floor(Math.random() * 10),
        }));
        addItems(demoData);
    };

    return (
        <div className="flex items-center gap-3 mb-6 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".xlsx, .xls"
                className="hidden"
            />

            <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                className="shadow-sm gap-2"
            >
                <Upload size={18} />
                {loading ? 'Importing...' : 'Import XLSX'}
            </Button>

            <Button
                variant="secondary"
                onClick={loadDemoData}
                className="gap-2"
            >
                <FileSpreadsheet size={18} className="text-green-600" />
                Load Demo
            </Button>

            <div className="h-6 w-px bg-gray-200 mx-2" />

            <Button
                variant="secondary"
                onClick={handleExport}
                disabled={items.length === 0}
                className="gap-2"
            >
                <FileDown size={18} />
                Export
            </Button>

            {items.length > 0 && (
                <Button
                    variant="ghost"
                    onClick={() => {
                        if (confirm('Are you sure you want to clear all data?')) clearData();
                    }}
                    className="ml-auto text-red-600 hover:bg-red-50 hover:text-red-700 gap-2"
                >
                    <Trash2 size={18} />
                    Clear
                </Button>
            )}
        </div>
    );
};
