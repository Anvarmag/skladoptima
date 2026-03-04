// Script to fix all existing Ozon orders that have a null productSku
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');

const prisma = new PrismaClient();

async function main() {
    console.log('Fetching all Ozon orders with null productSku...');
    const invalidOrders = await prisma.marketplaceOrder.findMany({
        where: {
            marketplace: 'OZON',
            productSku: null
        }
    });

    console.log(`Found ${invalidOrders.length} orders to fix.`);

    if (invalidOrders.length === 0) {
        return;
    }

    const settings = await prisma.marketplaceSettings.findFirst();
    if (!settings?.ozonApiKey || !settings?.ozonClientId) {
        console.log('No Ozon API Key, cannot fix retro-actively');
        return;
    }

    // We will do one big fetch of the last 7 days of orders from Ozon to map them
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const res = await axios.post('https://api-seller.ozon.ru/v3/posting/fbs/list', {
        filter: { since: sevenDaysAgo.toISOString(), to: now.toISOString() },
        dir: 'DESC', offset: 0, limit: 1000
    }, {
        headers: { 'Client-Id': settings.ozonClientId, 'Api-Key': settings.ozonApiKey }
    });

    const postings = res.data?.result?.postings || [];
    console.log(`Fetched ${postings.length} recent postings from Ozon.`);

    // Map order number -> sku string
    const skuMap = {};
    for (const posting of postings) {
        if (posting.products && posting.products.length > 0) {
            skuMap[posting.posting_number] = posting.products.map(p => p.offer_id).join(', ');
        }
    }

    let fixedCount = 0;
    for (const order of invalidOrders) {
        const skuStr = skuMap[order.marketplaceOrderId];
        if (skuStr) {
            await prisma.marketplaceOrder.update({
                where: { id: order.id },
                data: { productSku: skuStr }
            });
            fixedCount++;
        }
    }

    console.log(`Successfully fixed ${fixedCount} orders!`);
}

main().finally(() => prisma.$disconnect());
