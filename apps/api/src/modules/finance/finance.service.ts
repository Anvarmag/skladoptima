import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TaxSystem, MarketplaceType } from '@prisma/client';

@Injectable()
export class FinanceService {
    private readonly logger = new Logger(FinanceService.name);

    constructor(private readonly prisma: PrismaService) { }

    /**
     * Calculate detailed unit economics for a store or specific product.
     */
    async calculateUnitEconomics(tenantId: string, productId?: string) {
        const products = await this.prisma.product.findMany({
            where: {
                tenantId,
                id: productId, // Optional filter
                deletedAt: null
            },
            include: {
                tenant: true,
            },
        });

        const store = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!store) return [];

        const results = [];
        const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        for (const product of products) {
            // Get orders for this product grouped by marketplace
            const marketplaces = [MarketplaceType.WB, MarketplaceType.OZON];

            for (const mp of marketplaces) {
                const orders = await this.prisma.marketplaceOrder.findMany({
                    where: {
                        tenantId,
                        productSku: product.sku,
                        marketplace: mp,
                        marketplaceCreatedAt: { gte: last30Days }
                    }
                });

                const totalQuantity = orders.reduce((sum, o) => sum + (o.quantity || 0), 0);
                const totalRevenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
                const avgSalePrice = totalQuantity > 0 ? totalRevenue / totalQuantity : 0;

                // If no orders for this marketplace, we skip it for unit-economics unless it's the primary one
                if (totalQuantity === 0 && mp === 'OZON') continue;
                if (totalQuantity === 0 && mp === 'WB' && products.length > 5) continue; // Noise reduction

                // TAX CALCULATION
                const taxBase = product.minPrice || avgSalePrice || 0;
                let tax = 0;

                if (store.taxSystem === TaxSystem.USN_6) {
                    tax = taxBase * 0.06;
                } else if (store.taxSystem === TaxSystem.NPD) {
                    tax = taxBase * 0.04;
                } else if (store.taxSystem === TaxSystem.USN_15) {
                    const profitBasis = Math.max(0, taxBase - (product.purchasePrice || 0));
                    tax = profitBasis * 0.15;
                } else if (store.taxSystem === TaxSystem.OSNO) {
                    tax = taxBase * 0.36;
                }

                // Marketplace Specific Costs (using product settings or defaults)
                const purchasePrice = product.purchasePrice || 0;

                // Use product-specific settings if available, otherwise fallback to automated calculation or general estimates
                let logistics = product.logisticsCost;
                if (logistics === null || logistics === undefined) {
                    // Automated calculation based on dimensions if available
                    if (product.width && product.height && product.length) {
                        const volumeLiters = (product.width * product.height * product.length) / 1000;
                        if (mp === 'WB') {
                            // WB basic: 50 + 7 per liter > 1L
                            logistics = 50 + Math.max(0, volumeLiters - 1) * 7;
                        } else {
                            // Ozon simplified: 60 + 5 per liter
                            logistics = 60 + volumeLiters * 5;
                        }
                    } else {
                        logistics = mp === 'WB' ? 120 : 85;
                    }
                }

                const commissionRate = product.commissionRate ? (product.commissionRate / 100) : (mp === 'WB' ? 0.18 : 0.15);

                const commission = avgSalePrice * commissionRate;

                const netProfit = avgSalePrice - purchasePrice - logistics - commission - tax;
                const roi = purchasePrice > 0 ? (netProfit / purchasePrice) * 100 : 0;

                results.push({
                    id: `${product.id}-${mp}`,
                    productId: product.id,
                    sku: product.sku,
                    name: product.name,
                    marketplace: mp,
                    purchasePrice,
                    avgSalePrice,
                    logistics,
                    commission,
                    tax,
                    netProfit,
                    roi: roi.toFixed(1) + '%',
                    margin: avgSalePrice > 0 ? ((netProfit / avgSalePrice) * 100).toFixed(1) + '%' : '0%',
                    taxSystem: store.taxSystem,
                    width: product.width,
                    height: product.height,
                    length: product.length,
                    weight: product.weight,
                });
            }
        }

        return results;
    }

    /**
     * Import marketplace financial reports (Realization Reports)
     */
    async importMarketplaceReport(tenantId: string, data: any) {
        // This will be expanded to parse WB v5 Report and Ozon Transactions
        this.logger.log(`Importing report for store ${tenantId}`);
        return { success: true, count: 0 };
    }
}
