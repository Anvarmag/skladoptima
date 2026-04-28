import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { MarketplaceType } from '@prisma/client';

@Injectable()
export class SettingsService {
    private readonly logger = new Logger(SettingsService.name);

    constructor(
        private prisma: PrismaService,
        private readonly onboardingService: OnboardingService,
    ) { }

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
            where: { id: tenantId },
            include: { settings: true },
        });
    }

    async updateStore(tenantId: string, dto: { name?: string, taxSystem?: any, vatThresholdExceeded?: boolean }) {
        const updates: Promise<any>[] = [];

        if (dto.name !== undefined) {
            updates.push(
                this.prisma.tenant.update({
                    where: { id: tenantId },
                    data: { name: dto.name },
                }),
            );
        }

        if (dto.taxSystem !== undefined || dto.vatThresholdExceeded !== undefined) {
            updates.push(
                this.prisma.tenantSettings.upsert({
                    where: { tenantId },
                    create: {
                        tenantId,
                        taxSystem: dto.taxSystem,
                        vatThresholdExceeded: dto.vatThresholdExceeded ?? false,
                    },
                    update: {
                        ...(dto.taxSystem !== undefined && { taxSystem: dto.taxSystem }),
                        ...(dto.vatThresholdExceeded !== undefined && { vatThresholdExceeded: dto.vatThresholdExceeded }),
                    },
                }),
            );
        }

        await Promise.all(updates);
        return this.getStore(tenantId);
    }

    async updateSettings(tenantId: string, dto: any) {
        // Разбиваем старый плоский DTO на аккаунты
        let didUpdate = false;

        if (dto.wbApiKey !== undefined || dto.wbWarehouseId !== undefined) {
            let wb = await this.prisma.marketplaceAccount.findFirst({ where: { tenantId, marketplace: MarketplaceType.WB } });
            if (!wb) {
                wb = await this.prisma.marketplaceAccount.create({ data: { tenantId, marketplace: MarketplaceType.WB, name: 'Wildberries', label: 'Wildberries' } });
            }
            await this.prisma.marketplaceAccount.update({
                where: { id: wb.id },
                data: {
                    apiKey: dto.wbApiKey !== undefined ? dto.wbApiKey : wb.apiKey,
                    warehouseId: dto.wbWarehouseId !== undefined ? dto.wbWarehouseId : wb.warehouseId,
                    statApiKey: dto.wbStatApiKey !== undefined ? dto.wbStatApiKey : wb.statApiKey,
                }
            });
            didUpdate = true;
        }

        if (dto.ozonClientId !== undefined || dto.ozonApiKey !== undefined || dto.ozonWarehouseId !== undefined) {
            let ozon = await this.prisma.marketplaceAccount.findFirst({ where: { tenantId, marketplace: MarketplaceType.OZON } });
            if (!ozon) {
                ozon = await this.prisma.marketplaceAccount.create({ data: { tenantId, marketplace: MarketplaceType.OZON, name: 'Ozon', label: 'Ozon' } });
            }
            await this.prisma.marketplaceAccount.update({
                where: { id: ozon.id },
                data: {
                    clientId: dto.ozonClientId !== undefined ? dto.ozonClientId : ozon.clientId,
                    apiKey: dto.ozonApiKey !== undefined ? dto.ozonApiKey : ozon.apiKey,
                    warehouseId: dto.ozonWarehouseId !== undefined ? dto.ozonWarehouseId : ozon.warehouseId,
                }
            });
            didUpdate = true;
        }

        // T4-04: domain event — подключение маркетплейса завершает шаг connect_marketplace
        if (didUpdate) {
            this.onboardingService.markStepDone('TENANT_ACTIVATION', tenantId, 'connect_marketplace', 'domain_event').catch((err: unknown) =>
                this.logger.warn(JSON.stringify({ event: 'onboarding_step_update_failed', stepKey: 'connect_marketplace', err: (err as any)?.message })),
            );
        }

        return this.getSettings(tenantId);
    }
}
