import { PrismaClient, TaxSystem, Role, MarketplaceType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
    const email = 'admin@sklad.ru';
    const password = 'admin777';
    const hashedPassword = await bcrypt.hash(password, 10);

    // 1. Create or update User, Tenant & Membership
    let admin = await prisma.user.findUnique({ where: { email } });
    let tenantIdStr = '';
    
    if (admin) {
        admin = await prisma.user.update({
            where: { email },
            data: { passwordHash: hashedPassword }
        });
        const mem = await prisma.membership.findFirst({ where: { userId: admin.id } });
        if (mem) tenantIdStr = mem.tenantId;
    } else {
        const tenant = await prisma.tenant.create({
            data: {
                name: 'Demo Sklad Analytics',
                settings: {
                    create: { taxSystem: TaxSystem.USN_6 },
                },
            },
        });
        tenantIdStr = tenant.id;

        admin = await prisma.user.create({
            data: {
                email,
                passwordHash: hashedPassword,
                status: 'ACTIVE',
                emailVerifiedAt: new Date(),
                memberships: {
                    create: {
                        tenantId: tenant.id,
                        role: Role.OWNER,
                        status: 'ACTIVE',
                        joinedAt: new Date(),
                    }
                }
            }
        });
    }

    const tenantId = tenantIdStr;
    console.log(`Setting up demo data for Tenant (ID: ${tenantId})`);

    // 2. Create Demo Products
    const productsData = [
        { sku: 'SKU-DRONE-X1', name: 'Квадрокоптер X-PRO 4K', purchasePrice: 25000, minPrice: 42000, total: 45, rating: 4.8, wbBarcode: '200010001' },
        { sku: 'SKU-LAMP-RGB', name: 'Умная RGB лампа v2', purchasePrice: 800, minPrice: 1550, total: 250, rating: 4.2, wbBarcode: '200010002' },
        { sku: 'SKU-MICRO-01', name: 'Студийный микрофон SOLO', purchasePrice: 5000, minPrice: 8900, total: 12, rating: 4.9, wbBarcode: '200010003' },
        { sku: 'SKU-CHAIR-G', name: 'Игровое кресло Stealth', purchasePrice: 12000, minPrice: 19900, total: 5, rating: 3.8, wbBarcode: '200010004' },
        { sku: 'SKU-CASE-I15', name: 'Чехол iPhone 15 Silicone', purchasePrice: 150, minPrice: 890, total: 500, rating: 4.5, wbBarcode: '200010005' },
    ];

    for (const p of productsData) {
        await prisma.product.upsert({
            where: { tenantId_sku: { tenantId, sku: p.sku } },
            update: { ...p },
            create: { ...p, tenantId }
        });
    }

    // 3. Create Demo Orders (Historical for the past 30 days)
    const now = new Date();
    const orders = [];

    // Heavy sales for SKU-DRONE-X1 (Category A)
    for (let i = 0; i < 20; i++) {
        orders.push({
            marketplaceOrderId: `WB-AD-${1000 + i}`,
            marketplace: MarketplaceType.WB,
            productSku: 'SKU-DRONE-X1',
            productNames: 'Квадрокоптер X-PRO 4K',
            quantity: 1,
            totalAmount: 43500 + Math.random() * 500,
            sellerPrice: 45000,
            region: 'Moscow',
            createdAt: new Date(now.getTime() - Math.random() * 30 * 24 * 60 * 60 * 1000),
            tenantId
        });
    }

    // Medium sales for SKU-LAMP-RGB (Category B)
    for (let i = 0; i < 50; i++) {
        orders.push({
            marketplaceOrderId: `WB-AL-${2000 + i}`,
            marketplace: MarketplaceType.WB,
            productSku: 'SKU-LAMP-RGB',
            productNames: 'Умная RGB лампа v2',
            quantity: 2,
            totalAmount: 3100,
            sellerPrice: 3200,
            region: 'Saint-Petersburg',
            createdAt: new Date(now.getTime() - Math.random() * 30 * 24 * 60 * 60 * 1000),
            tenantId
        });
    }

    // Low sales/Problematic for SKU-CHAIR-G (Category C)
    for (let i = 0; i < 3; i++) {
        orders.push({
            marketplaceOrderId: `WB-AC-${3000 + i}`,
            marketplace: MarketplaceType.WB,
            productSku: 'SKU-CHAIR-G',
            productNames: 'Игровое кресло Stealth',
            quantity: 1,
            totalAmount: 18500,
            sellerPrice: 19900,
            region: 'Kazan',
            createdAt: new Date(now.getTime() - Math.random() * 30 * 24 * 60 * 60 * 1000),
            tenantId
        });
    }

    await prisma.marketplaceOrder.createMany({
        data: orders,
        skipDuplicates: true
    });

    console.log('Seeding finished.');
    console.log('User: admin@sklad.ru / Password: admin777');
    console.log(`Created: 5 Products, ${orders.length} Orders for last 30 days.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
