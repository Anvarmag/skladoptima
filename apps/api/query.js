const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const logs = await prisma.auditLog.findMany({
        where: { productSku: 'M12Setka5' },
        orderBy: { createdAt: 'desc' },
        take: 10
    });
    console.log(logs);

    const prod = await prisma.product.findUnique({ where: { sku: 'M12Setka5' } });
    console.log(prod);
}
main().finally(() => prisma.$disconnect());
