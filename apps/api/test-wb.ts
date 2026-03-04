import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const settings = await prisma.marketplaceSettings.findFirst();
    if (!settings?.wbApiKey) {
        console.log('No WB API Key found');
        return;
    }

    try {
        const res = await axios.get('https://marketplace-api.wildberries.ru/api/v3/orders/new', {
            headers: { Authorization: settings.wbApiKey }
        });

        console.log('New orders count:', res.data?.orders?.length);
        if (res.data?.orders?.length > 0) {
            console.log('First new order data:', JSON.stringify(res.data.orders[0], null, 2));
        }

        const dateFrom = Math.floor((Date.now() - 4 * 24 * 60 * 60 * 1000) / 1000);
        const res2 = await axios.get(`https://marketplace-api.wildberries.ru/api/v3/orders?limit=10&next=0&dateFrom=${dateFrom}`, {
            headers: { Authorization: settings.wbApiKey }
        });

        console.log('\nAll orders count:', res2.data?.orders?.length);
        if (res2.data?.orders?.length > 0) {
            console.log('First all order data:', JSON.stringify(res2.data.orders[0], null, 2));
        }
    } catch (e: any) {
        console.error('API Error:', e.response?.data || e.message);
    }
}

main().finally(() => prisma.$disconnect());
