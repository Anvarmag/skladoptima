import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MarketplaceType } from '@prisma/client';

@Injectable()
export class SettingsService {
    constructor(private prisma: PrismaService) { }

    async getSettings(tenantId: string) {
        // Эмуляция старого ответа
        const wb = await this.prisma.marketplaceAccount.findFirst({
            where: { tenantId, marketplace: MarketplaceType.WB }
        });
        const ozon = await this.prisma.marketplaceAccount.findFirst({
            where: { tenantId, marketplace: MarketplaceType.OZON }
        });

        return {
            ozonClientId: ozon?.clientId || null,
            ozonApiKey: ozon?.apiKey || null,
            ozonWarehouseId: ozon?.warehouseId || null,
            wbApiKey: wb?.apiKey || null,
            wbStatApiKey: wb?.statApiKey || null,
            wbWarehouseId: wb?.warehouseId || null,
            lastWbSyncAt: wb?.lastSyncAt || null,
            lastWbSyncError: wb?.lastSyncError || null,
            lastOzonSyncAt: ozon?.lastSyncAt || null,
            lastOzonSyncError: ozon?.lastSyncError || null,
        };
    }

    async getStore(tenantId: string) {
        return this.prisma.tenant.findUnique({
            where: { id: tenantId }
        });
    }

    async updateStore(tenantId: string, dto: { name?: string, taxSystem?: any, vatThresholdExceeded?: boolean }) {
        return this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                name: dto.name,
                taxSystem: dto.taxSystem,
                vatThresholdExceeded: dto.vatThresholdExceeded
            }
        });
    }

    async updateSettings(tenantId: string, dto: any) {
        // Разбиваем старый плоский DTO на аккаунты
        
        if (dto.wbApiKey !== undefined || dto.wbWarehouseId !== undefined) {
            let wb = await this.prisma.marketplaceAccount.findFirst({ where: { tenantId, marketplace: MarketplaceType.WB } });
            if (!wb) {
                wb = await this.prisma.marketplaceAccount.create({ data: { tenantId, marketplace: MarketplaceType.WB, name: 'Wildberries' } });
            }
            await this.prisma.marketplaceAccount.update({
                where: { id: wb.id },
                data: {
                    apiKey: dto.wbApiKey !== undefined ? dto.wbApiKey : wb.apiKey,
                    warehouseId: dto.wbWarehouseId !== undefined ? dto.wbWarehouseId : wb.warehouseId,
                    statApiKey: dto.wbStatApiKey !== undefined ? dto.wbStatApiKey : wb.statApiKey,
                }
            });
        }

        if (dto.ozonClientId !== undefined || dto.ozonApiKey !== undefined || dto.ozonWarehouseId !== undefined) {
            let ozon = await this.prisma.marketplaceAccount.findFirst({ where: { tenantId, marketplace: MarketplaceType.OZON } });
            if (!ozon) {
                ozon = await this.prisma.marketplaceAccount.create({ data: { tenantId, marketplace: MarketplaceType.OZON, name: 'Ozon' } });
            }
            await this.prisma.marketplaceAccount.update({
                where: { id: ozon.id },
                data: {
                    clientId: dto.ozonClientId !== undefined ? dto.ozonClientId : ozon.clientId,
                    apiKey: dto.ozonApiKey !== undefined ? dto.ozonApiKey : ozon.apiKey,
                    warehouseId: dto.ozonWarehouseId !== undefined ? dto.ozonWarehouseId : ozon.warehouseId,
                }
            });
        }

        return this.getSettings(tenantId);
    }
}
