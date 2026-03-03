import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsService implements OnModuleInit {
    constructor(private prisma: PrismaService) { }

    async onModuleInit() {
        // Add warehouse ID columns if they don't exist (raw SQL, no prisma generate needed)
        try {
            await this.prisma.$executeRawUnsafe(`
                ALTER TABLE "MarketplaceSettings"
                ADD COLUMN IF NOT EXISTS "ozonWarehouseId" TEXT,
                ADD COLUMN IF NOT EXISTS "wbWarehouseId" TEXT,
                ADD COLUMN IF NOT EXISTS "wbStatApiKey" TEXT
            `);
        } catch (e: any) {
            console.warn('[Settings] Migration note:', e?.message);
        }

        // Ensure the single settings record exists
        const count = await this.prisma.marketplaceSettings.count();
        if (count === 0) {
            await this.prisma.marketplaceSettings.create({ data: { id: '1' } });
        }
    }

    async getSettings() {
        // Use raw query to include columns not yet in Prisma schema
        const rows = await this.prisma.$queryRawUnsafe<any[]>(
            `SELECT * FROM "MarketplaceSettings" WHERE id = '1' LIMIT 1`
        );
        return rows[0] ?? null;
    }

    async updateSettings(dto: any) {
        const fields: string[] = [];
        const values: any[] = [];
        let i = 1;

        const allowed = ['ozonClientId', 'ozonApiKey', 'ozonWarehouseId', 'wbApiKey', 'wbStatApiKey', 'wbWarehouseId'];
        for (const key of allowed) {
            if (dto[key] !== undefined) {
                fields.push(`"${key}" = $${i++}`);
                values.push(dto[key]);
            }
        }

        if (fields.length === 0) return this.getSettings();

        fields.push(`"updatedAt" = NOW()`);
        values.push('1');

        await this.prisma.$executeRawUnsafe(
            `UPDATE "MarketplaceSettings" SET ${fields.join(', ')} WHERE id = $${i}`,
            ...values,
        );
        return this.getSettings();
    }
}
