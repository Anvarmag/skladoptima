const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const count = await prisma.user.deleteMany({
        where: {
            telegramId: { not: null }
        }
    });
    console.log(`Deleted ${count.count} legacy TG users`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
