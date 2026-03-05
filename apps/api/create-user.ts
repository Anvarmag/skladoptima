import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function createUser(email: string, passwordPlain: string) {
    try {
        const existingUser = await prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            console.log(`User with email ${email} already exists.`);
            return;
        }

        const hashedPassword = await bcrypt.hash(passwordPlain, 10);

        const newUser = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                store: {
                    create: { name: `Склад ${email}` }
                }
            },
        });

        console.log(`Success! Created user: ${newUser.email}`);
    } catch (error) {
        console.error('Error creating user:', error);
    } finally {
        await prisma.$disconnect();
    }
}

// Запуск скрипта
// Запускать так: npx ts-node create-user.ts "новый_email" "новый_пароль"
const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
    console.log('Пожалуйста, укажите email и пароль.');
    console.log('Пример: npx ts-node create-user.ts newuser@example.com mypassword123');
    process.exit(1);
}

createUser(email, password);
