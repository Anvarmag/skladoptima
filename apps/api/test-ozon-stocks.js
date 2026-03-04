const { PrismaClient } = require('@prisma/client');
const axios = require('axios');

const prisma = new PrismaClient();

async function main() {
    const settings = await prisma.marketplaceSettings.findFirst();
    if (!settings || !settings.ozonApiKey || !settings.ozonClientId) {
        console.log('No Ozon API Keys found');
        return;
    }

    try {
        const res = await axios.post('https://api-seller.ozon.ru/v4/product/info/stocks', {
            filter: { visibility: 'ALL' },
            last_id: '',
            limit: 10
        }, {
            headers: { 'Client-Id': settings.ozonClientId, 'Api-Key': settings.ozonApiKey }
        });

        console.log('Ozon Stocks payload:', JSON.stringify(res.data, null, 2));

    } catch (e) {
        console.error('API Error:', e.response ? JSON.stringify(e.response.data, null, 2) : e.message);
    }
}

main().finally(() => prisma.$disconnect());
