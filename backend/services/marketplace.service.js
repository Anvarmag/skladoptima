/**
 * marketplace.service.js
 * Функции для обновления остатков на маркетплейсах WB и Ozon.
 */

const axios = require('axios');

// ─── Wildberries ──────────────────────────────────────────────────────────────

/**
 * Обновляет остаток товара на складе Wildberries.
 * @param {string} barcode      - Штрихкод товара (WB принимает barcode в поле "sku")
 * @param {number} amount       - Новый остаток
 * @param {string} token        - Bearer-токен WB Seller API
 * @param {string} warehouseId  - ID склада WB
 */
const updateWbStock = async (barcode, amount, token, warehouseId) => {
    const url = `https://marketplace-api.wildberries.ru/api/v3/stocks/${warehouseId}`;

    try {
        const response = await axios.put(
            url,
            { stocks: [{ sku: String(barcode), amount: Number(amount) }] },
            {
                headers: {
                    Authorization: token,
                    'Content-Type': 'application/json',
                },
                timeout: 10000,
            }
        );

        console.log(`[WB] ✅ Остаток обновлён: barcode=${barcode}, amount=${amount}, status=${response.status}`);
        return { success: true, status: response.status };
    } catch (err) {
        const status = err.response?.status;
        const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        console.error(`[WB] ❌ Ошибка обновления (barcode=${barcode}): HTTP ${status} — ${detail}`);
        return { success: false, status, error: detail };
    }
};

// ─── Ozon ─────────────────────────────────────────────────────────────────────

/**
 * Обновляет остаток товара на Ozon.
 * @param {string} offerId     - Артикул товара (offer_id) у продавца
 * @param {number} amount      - Новый остаток
 * @param {string} clientId    - Ozon Client-Id
 * @param {string} apiKey      - Ozon Api-Key
 * @param {string} warehouseId - ID склада Ozon
 */
const updateOzonStock = async (offerId, amount, clientId, apiKey, warehouseId) => {
    const url = 'https://api-seller.ozon.ru/v2/products/stocks';

    try {
        const response = await axios.post(
            url,
            {
                stocks: [
                    {
                        offer_id: String(offerId),
                        stock: Number(amount),
                        warehouse_id: parseInt(warehouseId, 10)
                    }
                ]
            },
            {
                headers: {
                    'Client-Id': clientId,
                    'Api-Key': apiKey,
                    'Content-Type': 'application/json',
                },
                timeout: 10000,
            }
        );

        console.log(`[Ozon] ✅ Остаток обновлён: offer_id=${offerId}, stock=${amount}, warehouse_id=${warehouseId}, status=${response.status}`);
        return { success: true, status: response.status };
    } catch (err) {
        const status = err.response?.status;
        const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        console.error(`[Ozon] ❌ Ошибка обновления (offer_id=${offerId}): HTTP ${status} — ${detail}`);
        return { success: false, status, error: detail };
    }
};

module.exports = { updateWbStock, updateOzonStock };
