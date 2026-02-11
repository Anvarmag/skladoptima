import * as XLSX from 'xlsx';

export const parseExcel = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = e.target.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];

                // Convert to JSON with headers
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                if (jsonData.length < 2) {
                    resolve([]);
                    return;
                }

                const headers = jsonData[0]; // First row is header
                const rows = jsonData.slice(1);

                // Map columns by name
                // Mapping: 
                // Баркод -> barcode
                // Количество -> stock (App calls it "Склад")
                // Предмет -> subject
                // Бренд -> brand
                // Наименование -> name
                // Размер -> size
                // Артикул продавца -> sellerSku

                const colMap = {};
                headers.forEach((h, index) => {
                    if (!h) return;
                    const lowerH = h.toString().trim().toLowerCase();
                    if (lowerH.includes('баркод')) colMap['barcode'] = index;
                    else if (lowerH.includes('количество')) colMap['stock'] = index;
                    else if (lowerH.includes('предмет')) colMap['subject'] = index;
                    else if (lowerH.includes('бренд')) colMap['brand'] = index;
                    else if (lowerH.includes('наименование')) colMap['name'] = index;
                    else if (lowerH.includes('артикул')) colMap['sellerSku'] = index;
                });

                const items = rows.map((row) => {
                    // Function to get safe value
                    const getVal = (key) => {
                        const idx = colMap[key];
                        return (idx !== undefined && row[idx] !== undefined) ? row[idx] : '';
                    };

                    return {
                        barcode: getVal('barcode') || `GEN-${Math.random().toString(36).substr(2, 9)}`, // fallback if missing
                        stock: Number(getVal('stock')) || 0,
                        subject: getVal('subject'),
                        brand: getVal('brand'),
                        name: getVal('name'),
                        sellerSku: getVal('sellerSku'),
                        wb: 0, // default
                        ozon: 0 // default
                    };
                }).filter(item => item.barcode); // Filter out empty lines if any

                resolve(items);
            } catch (err) {
                reject(err);
            }
        };

        reader.onerror = (err) => reject(err);
        reader.readAsBinaryString(file);
    });
};

export const exportExcel = (items) => {
    // Map internal keys back to Russian headers in new order
    const data = items.map(item => ({
        'Наименование': item.name,
        'Бренд': item.brand,
        'Артикул продавца': item.sellerSku,
        'Баркод': item.barcode,
        'Предмет': item.subject,
        'Количество': item.stock,
        'WB склад': item.wb,
        'Ozon склад': item.ozon
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Остатки");

    XLSX.writeFile(workbook, "Skladoptima_Stocks.xlsx");
};
