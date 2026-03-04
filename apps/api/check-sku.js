const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const products = await prisma.product.findMany({
        where: {
            OR: [
                { sku: 'VishnevyjSetka5' },
                { wbBarcode: 'VishnevyjSetka5' }
            ]
        }
    });

    console.log('Found products with VishnevyjSetka5:', JSON.stringify(products, null, 2));

    const orders = await prisma.marketplaceOrder.findMany({
        where: {
            marketplaceOrderId: { contains: '83123903-0261' }
        }
    });

    console.log('Orders with 83123903-0261:', JSON.stringify(orders, null, 2));
}

main().finally(() => prisma.$disconnect());
