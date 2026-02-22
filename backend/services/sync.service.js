/**
 * sync.service.js
 * Фоновая синхронизация остатков (Pull) для всех магазинов.
 */

const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const { updateWbStock, updateOzonStock } = require('./marketplace.service');

const prisma = new PrismaClient();

/**
 * Основная функция синхронизации
 */
const runSync = async () => {
    console.log(`[Sync] 🕒 Запуск фоновой синхронизации: ${new Date().toLocaleString()}`);

    try {
        // 1. Загружаем все магазины
        const stores = await prisma.store.findMany();
        if (stores.length === 0) {
            console.log('[Sync] ⚠️ Магазины не найдены.');
            return;
        }

        for (const store of stores) {
            console.log(`[Sync] 🏪 Обработка магазина: ${store.name}`);

            // 2. Загружаем товары этого магазина
            const products = await prisma.product.findMany({ where: { storeId: store.id } });
            if (products.length === 0) continue;

            const skus = products.map(p => p.sku);
            const barcodes = products.filter(p => p.barcode).map(p => p.barcode);

            let wbStocksMap = new Map();
            let ozonStocksMap = new Map();

            // 3. Получаем остатки с Wildberries
            if (store.wbToken && store.wbWarehouseId && barcodes.length > 0) {
                try {
                    const wbRes = await axios.post(
                        `https://marketplace-api.wildberries.ru/api/v3/stocks/${store.wbWarehouseId}`,
                        { skus: barcodes },
                        { headers: { Authorization: store.wbToken } }
                    );
                    wbRes.data.stocks?.forEach(s => {
                        wbStocksMap.set(String(s.sku), s.amount);
                    });
                } catch (err) {
                    console.error(`[Sync] [WB] ❌ Ошибка (${store.name}):`, err.response?.data || err.message);
                }
            }

            // 4. Получаем остатки с Ozon (V2 Stocks by Warehouse)
            let ozonItems = [];
            if (store.ozonClientId && store.ozonApiKey && store.ozonWarehouseId) {
                try {
                    const ozonRes = await axios.post(
                        'https://api-seller.ozon.ru/v2/product/info/stocks-by-warehouse/fbs',
                        { offer_id: skus, limit: 1000 },
                        {
                            headers: {
                                'Client-Id': store.ozonClientId,
                                'Api-Key': store.ozonApiKey
                            }
                        }
                    );
                    // В V2 API массив данных лежит в .products, а не в .result
                    if (ozonRes.data?.error) {
                        console.error(`[Sync] [Ozon API Error] ${store.name}:`, ozonRes.data.error);
                    }

                    ozonItems = ozonRes.data.products || [];
                } catch (error) {
                    console.error(`[Sync] [Ozon Error] Магазин ${store.name}:`, error.response?.data || error.message);
                }
            }

            // 5. Обработка каждого товара (Pull-синхронизация)
            for (const product of products) {
                const remoteWb = wbStocksMap.get(String(product.barcode)) ?? null;

                // Поиск строго по Артикулу (offer_id) и Складу
                const matchedOzon = ozonItems.find(row =>
                    String(row.offer_id).trim() === String(product.sku).trim() &&
                    String(row.warehouse_id).trim() === String(store.ozonWarehouseId).trim()
                );

                const ozonStock = matchedOzon ? Number(matchedOzon.present) : null;
                const wbStockRemote = remoteWb;
                const dbStock = Number(product.stock_master);

                // --- ЛОГИКА СИНХРОНИЗАЦИИ ---
                // Важно: Пользуемся логикой 'else if'. Если Ozon инициировал обновление, 
                // мы пропускаем проверку WB в этом цикле, так как данные в wbStocksMap стали устаревшими.

                if (ozonStock !== null && ozonStock !== dbStock) {
                    console.log(`[Sync] 📥 Изменение на Ozon (${product.sku})! ${dbStock} -> ${ozonStock}. Обновляем БД и WB...`);

                    await prisma.product.update({
                        where: { sku_storeId: { sku: product.sku, storeId: store.id } },
                        data: { stock_master: ozonStock, stock_ozon: ozonStock }
                    });

                    if (store.wbToken && store.wbWarehouseId && product.barcode) {
                        const wbPush = await updateWbStock(product.barcode, ozonStock, store.wbToken, store.wbWarehouseId);
                        if (wbPush.success) {
                            await prisma.product.update({
                                where: { sku_storeId: { sku: product.sku, storeId: store.id } },
                                data: { stock_wb: ozonStock }
                            });
                        }
                    }
                }
                else if (wbStockRemote !== null && wbStockRemote !== dbStock) {
                    console.log(`[Sync] 📥 Изменение на WB (${product.sku})! ${dbStock} -> ${wbStockRemote}. Обновляем БД и Ozon...`);

                    await prisma.product.update({
                        where: { sku_storeId: { sku: product.sku, storeId: store.id } },
                        data: { stock_master: wbStockRemote, stock_wb: wbStockRemote }
                    });

                    if (store.ozonClientId && store.ozonApiKey && store.ozonWarehouseId) {
                        const ozonPush = await updateOzonStock(product.sku, wbStockRemote, store.ozonClientId, store.ozonApiKey, store.ozonWarehouseId);
                        if (ozonPush.success) {
                            await prisma.product.update({
                                where: { sku_storeId: { sku: product.sku, storeId: store.id } },
                                data: { stock_ozon: wbStockRemote }
                            });
                        }
                    }
                }
            }
        }

        console.log('[Sync] ✅ Синхронизация завершена успешно.');
    } catch (err) {
        console.error('[Sync] 🔥 Критическая ошибка воркера:', err.message);
    }
};

module.exports = { runSync };
