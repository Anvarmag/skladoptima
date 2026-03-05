import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsService {
    constructor(private prisma: PrismaService) { }

    async getSettings(storeId: string) {
        let settings = await this.prisma.marketplaceSettings.findUnique({
            where: { storeId }
        });

        if (!settings) {
            settings = await this.prisma.marketplaceSettings.create({
                data: { storeId }
            });
        }

        return settings;
    }

    async getStore(storeId: string) {
        return this.prisma.store.findUnique({
            where: { id: storeId }
        });
    }

    async updateStore(storeId: string, name: string) {
        return this.prisma.store.update({
            where: { id: storeId },
            data: { name }
        });
    }

    async updateSettings(storeId: string, dto: any) {
        const settings = await this.getSettings(storeId);

        const allowed = ['ozonClientId', 'ozonApiKey', 'ozonWarehouseId', 'wbApiKey', 'wbStatApiKey', 'wbWarehouseId'];
        const data: any = {};

        for (const key of allowed) {
            if (dto[key] !== undefined) {
                data[key] = dto[key];
            }
        }

        return this.prisma.marketplaceSettings.update({
            where: { id: settings.id },
            data,
        });
    }
}
