const { PrismaClient } = require('@prisma/client');
const axios = require('axios');

const prisma = new PrismaClient();

async function main() {
    const settings = await prisma.marketplaceSettings.findFirst();
    if (!settings || !settings.wbApiKey || !settings.wbWarehouseId) {
        console.log('No WB API Keys or Warehouse ID found');
        return;
    }

    try {
        const res = await axios.post(`https://marketplace-api.wildberries.ru/api/v3/stocks/${settings.wbWarehouseId}`, {
            skus: ["2047224523814"] // Known barcode
        }, {
            headers: { 'Authorization': `Bearer ${settings.wbApiKey}` }
        });

        console.log('WB Stocks payload:', JSON.stringify(res.data, null, 2));

    } catch (e) {
        console.error('API Error:', e.response ? e.response.data : e.message);
    }
}

main().finally(() => prisma.$disconnect());
