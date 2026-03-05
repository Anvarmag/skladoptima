import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const products = await prisma.product.findMany({
        select: {
            id: true,
            sku: true,
            name: true,
            photo: true,
            storeId: true
        }
    });

    console.log('--- PRODUCTS PHOTO CHECK ---');
    products.forEach(p => {
        console.log(`[${p.sku}] Name: ${p.name}`);
        console.log(`      Photo: ${p.photo ? `"${p.photo}"` : 'NULL'}`);
        console.log(`      Store: ${p.storeId}`);
    });
    console.log('--- END ---');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
