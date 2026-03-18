import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
    private readonly logger = new Logger(AnalyticsService.name);

    constructor(private readonly prisma: PrismaService) { }

    /**
     * Perform ABC/XYZ analysis and stock forecasting
     */
    async getRecommendations(storeId: string) {
        const products = await this.prisma.product.findMany({
            where: { storeId, deletedAt: null },
        });

        const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const results = [];

        for (const p of products) {
            const marketplaces = ['WB', 'OZON'];
            for (const mp of marketplaces) {
                const orders = await this.prisma.marketplaceOrder.findMany({
                    where: {
                        storeId,
                        productSku: p.sku,
                        marketplace: mp,
                        marketplaceCreatedAt: { gte: last30Days }
                    }
                });

                const revenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
                const salesCount = orders.reduce((sum, o) => sum + (o.quantity || 0), 0);

                if (salesCount === 0 && products.length > 10) continue; // Skip inactive platforms if many products

                const dailyVelocity = salesCount / 30;
                const daysRemaining = dailyVelocity > 0 ? Math.floor(p.total / dailyVelocity) : 999;

                let recommendation = 'Держим позиции';
                let priority = 'low';

                if (daysRemaining < 7 && p.total > 0) {
                    recommendation = `Пополнить ${mp}! Лимит на ${daysRemaining} дн.`;
                    priority = 'high';
                } else if (p.rating && p.rating < 4) {
                    recommendation = `Низкий рейтинг на ${mp} (${p.rating})`;
                    priority = 'medium';
                }

                results.push({
                    id: `${p.id}-${mp}`,
                    sku: p.sku,
                    name: p.name,
                    marketplace: mp,
                    revenue,
                    salesCount,
                    dailyVelocity: dailyVelocity.toFixed(2),
                    daysRemaining,
                    recommendation,
                    priority,
                    rating: p.rating
                });
            }
        }

        // Simple ABC grouping by Revenue across all platforms
        const sorted = [...results].sort((a, b) => b.revenue - a.revenue);
        const totalRev = sorted.reduce((sum, r) => sum + r.revenue, 0);
        let running = 0;

        return sorted.map(r => {
            running += r.revenue;
            const share = totalRev > 0 ? running / totalRev : 1;
            let abcClass = 'C';
            if (share <= 0.8) abcClass = 'A';
            else if (share <= 0.95) abcClass = 'B';

            return { ...r, abcClass };
        });
    }

    /**
     * Get Regional Sales distribution
     */
    async getGeoAnalytics(storeId: string) {
        const orders = await this.prisma.marketplaceOrder.groupBy({
            by: ['region'],
            where: { storeId, NOT: { region: null } },
            _count: { _all: true },
            _sum: { totalAmount: true }
        });

        return orders.map(o => ({
            region: o.region,
            orderCount: o._count._all,
            revenue: o._sum.totalAmount
        })).sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
    }

    /**
     * Get Revenue Dynamics for the last 14 days, split by marketplace
     */
    async getRevenueDynamics(storeId: string) {
        const days = 14;
        const result = [];
        const now = new Date();

        for (let i = days; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            date.setHours(0, 0, 0, 0);

            const nextDate = new Date(date);
            nextDate.setDate(nextDate.getDate() + 1);

            const wbRevenue = await this.prisma.marketplaceOrder.aggregate({
                where: {
                    storeId,
                    marketplace: 'WB',
                    marketplaceCreatedAt: { gte: date, lt: nextDate }
                },
                _sum: { totalAmount: true }
            });

            const ozonRevenue = await this.prisma.marketplaceOrder.aggregate({
                where: {
                    storeId,
                    marketplace: 'OZON',
                    marketplaceCreatedAt: { gte: date, lt: nextDate }
                },
                _sum: { totalAmount: true }
            });

            result.push({
                name: date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
                wb: wbRevenue._sum.totalAmount || 0,
                ozon: ozonRevenue._sum.totalAmount || 0,
                total: (wbRevenue._sum.totalAmount || 0) + (ozonRevenue._sum.totalAmount || 0)
            });
        }

        return result;
    }
}
