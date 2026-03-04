const { PrismaClient } = require('@prisma/client');
const axios = require('axios');

const prisma = new PrismaClient();

async function main() {
    const settingsList = await prisma.marketplaceSettings.findMany();
    console.log(`Found ${settingsList.length} settings rows.`);
    const settings = settingsList.find(s => s.ozonApiKey && s.ozonClientId);

    if (!settings) {
        console.log('No Ozon API Keys found in any settings row');
        return;
    }

    try {
        const order = await prisma.marketplaceOrder.findFirst({
            where: { marketplace: 'OZON', status: { not: 'cancelled' } },
            orderBy: { marketplaceCreatedAt: 'desc' }
        });

        if (!order) {
            console.log('No Ozon orders found in DB.');

            // Just hit list to see what we get
            console.log('Fetching list directly from API...');
            const now = new Date();
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const res = await axios.post('https://api-seller.ozon.ru/v3/posting/fbs/list', {
                filter: { since: sevenDaysAgo.toISOString(), to: now.toISOString() },
                dir: 'DESC', offset: 0, limit: 10, with: { analytics_data: true, financial_data: true }
            }, {
                headers: { 'Client-Id': settings.ozonClientId, 'Api-Key': settings.ozonApiKey }
            });
            console.log('Ozon List Result:', JSON.stringify(res.data.result.postings?.[0] || 'No recent', null, 2));
            return;
        }

        console.log('Found Ozon Order in DB:', order.marketplaceOrderId);

        const res = await axios.post('https://api-seller.ozon.ru/v3/posting/fbs/get', {
            posting_number: order.marketplaceOrderId,
            with: { analytics_data: true, financial_data: true }
        }, {
            headers: { 'Client-Id': settings.ozonClientId, 'Api-Key': settings.ozonApiKey }
        });

        console.log('Ozon Order Details:', JSON.stringify(res.data.result, null, 2));

    } catch (e) {
        console.error('API Error:', e.response ? e.response.data : e.message);
    }
}

main().finally(() => prisma.$disconnect());
