import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActionType } from '@prisma/client';
import axios, { AxiosError } from 'axios';

@Injectable()
export class SyncService implements OnModuleInit {
    private readonly logger = new Logger(SyncService.name);
    // Для предотвращения эффекта "пинг-понга" (бесконечных циклов синхронизации)
    // Храним время последнего ПУША на маркетплейс для каждого товара по его ID
    private lastPush = new Map<string, { wb?: number, ozon?: number }>();
    private readonly COOLDOWN_MS = 2 * 60_000; // 2 минуты "режима тишины"

    constructor(private readonly prisma: PrismaService) { }

    async onModuleInit() {
        // Фоновый опрос маркетплейсов каждые 60 секунд на стороне сервера
        const INTERVAL_MS = 60_000;
        setTimeout(async () => {
            this.logger.log('Background multi-tenant marketplace poll started');
            const run = async () => {
                try {
                    const stores = await this.prisma.store.findMany();
                    for (const store of stores) {
                        try {
                            await this.syncStore(store.id);
                        } catch (err: any) {
                            this.logger.error(`Error syncing store ${store.id}: ${err.message}`);
                        }
                    }
                } catch (e: any) {
                    this.logger.warn(`Background poll error: ${e?.message}`);
                }
            };
            run();
            setInterval(run, INTERVAL_MS);
        }, 5_000);
    }

    async syncStore(storeId: string) {
        const wbResult: any = await this.pullFromWb(storeId);
        if (wbResult.updated > 0) {
            this.logger.log(`[Store ${storeId}] WB FBS pull: updated ${wbResult.updated} products`);
        }

        const wbFboResult: any = await this.pullWbFbo(storeId);
        if (wbFboResult.updated > 0) {
            this.logger.log(`[Store ${storeId}] WB FBO pull: updated ${wbFboResult.updated} products`);
        }

        const ozonResult: any = await this.pullFromOzon(storeId);
        if (ozonResult.updated > 0) {
            this.logger.log(`[Store ${storeId}] Ozon pull: updated ${ozonResult.updated} products`);
        }

        await this.processWbOrders(storeId);
        await this.processOzonOrders(storeId);
        await this.syncProductMetadata(storeId, false);
    }

    private async getSettings(storeId: string): Promise<any> {
        return this.prisma.marketplaceSettings.findUnique({
            where: { storeId }
        });
    }

    // ─── Batch Sync to WB ──────────────────────────────────────────────────────
    private async syncBatchToWb(settings: any, items: Array<{ id: string, sku: string, wbBarcode: string, amount: number }>) {
        if (!settings?.wbApiKey || !settings?.wbWarehouseId) return;
        if (items.length === 0) return;

        try {
            const url = `https://marketplace-api.wildberries.ru/api/v3/stocks/${settings.wbWarehouseId}`;
            const body = { stocks: items.map(i => ({ sku: i.wbBarcode, amount: i.amount })) };

            this.logger.log(`WB BATCH PUSH → products: ${items.length}`);
            await axios.put(url, body, {
                headers: { Authorization: settings.wbApiKey, 'Content-Type': 'application/json' },
                timeout: 15_000,
            });

            // SUCCESS! Update DB and Cooldown
            const now = Date.now();
            for (const item of items) {
                await this.prisma.$executeRawUnsafe(
                    `UPDATE "Product" SET "wbFbs" = $1 WHERE id = $2`,
                    item.amount, item.id
                );
                const cd = this.lastPush.get(item.id) || {};
                this.lastPush.set(item.id, { ...cd, wb: now });
            }
        } catch (err: any) {
            this.logger.error(`WB BATCH FAIL: ${err.message}`);
        }
    }

    // ─── WB FBS stock update (Individual) ────────────────────────────────────────
    private async syncToWb(settings: any, product: any, amount: number) {
        await this.syncBatchToWb(settings, [{ id: product.id, sku: product.sku, wbBarcode: product.wbBarcode, amount }]);
        return { success: true };
    }

    // ─── Batch Sync to Ozon ────────────────────────────────────────────────────
    private async syncBatchToOzon(settings: any, items: Array<{ id: string, sku: string, amount: number }>) {
        if (!settings?.ozonApiKey || !settings?.ozonClientId || !settings?.ozonWarehouseId) return;
        if (items.length === 0) return;

        try {
            const url = 'https://api-seller.ozon.ru/v2/products/stocks';
            const body = {
                stocks: items.map(i => ({
                    offer_id: i.sku,
                    stock: i.amount,
                    warehouse_id: parseInt(settings.ozonWarehouseId, 10)
                }))
            };

            this.logger.log(`OZON BATCH PUSH → products: ${items.length}`);
            await axios.post(url, body, {
                headers: { 'Client-Id': settings.ozonClientId, 'Api-Key': settings.ozonApiKey, 'Content-Type': 'application/json' },
                timeout: 30_000,
            });

            // Update DB and Cooldown for each product in batch
            const now = Date.now();
            for (const item of items) {
                await this.prisma.$executeRawUnsafe(
                    `UPDATE "Product" SET "ozonFbs" = $1 WHERE id = $2`,
                    item.amount, item.id
                );
                const cd = this.lastPush.get(item.id) || {};
                this.lastPush.set(item.id, { ...cd, ozon: now });
            }
        } catch (err: any) {
            this.logger.error(`OZON BATCH FAIL: ${err.message} ${JSON.stringify(err.response?.data)}`);
        }
    }

    // ─── Ozon FBS stock update (Individual) ───────────────────────────────────────
    private async syncToOzon(settings: any, product: any, amount: number) {
        await this.syncBatchToOzon(settings, [{ id: product.id, sku: product.sku, amount }]);
        return { success: true };
    }

    // ─── Push one product to marketplaces ──────────────────────────────────────
    async syncProductToMarketplaces(productId: string, storeId: string) {
        const settings = await this.getSettings(storeId);
        if (!settings) return { success: false, error: 'Settings not configured' };

        const product = await this.prisma.product.findUnique({
            where: { id: productId }
        });
        if (!product || product.storeId !== storeId || product.deletedAt) {
            return { success: false, error: 'Product not found or access denied' };
        }

        // available - это то, что мы физически можем продать прямо сейчас
        const available = Math.max(0, product.total);

        const [wb, ozon] = await Promise.all([
            this.syncToWb(settings, product, available),
            this.syncToOzon(settings, product, available),
        ]);

        return { wb, ozon, amount: available };
    }

    // ─── Pull from WB → update our DB ────────────────────────────────────────────
    async pullFromWb(storeId: string) {
        const settings = await this.getSettings(storeId);
        if (!settings?.wbApiKey) return { success: false, error: 'WB API ключ не задан' };
        if (!settings?.wbWarehouseId) return { success: false, error: 'ID склада WB не задан' };

        try {
            // Fetch all our barcodes to check their stock on WB
            const localProducts = await this.prisma.product.findMany({
                where: { storeId, deletedAt: null, wbBarcode: { not: null } },
                select: { wbBarcode: true }
            });
            const skus = [...new Set(localProducts.map(p => p.wbBarcode))].filter((b): b is string => !!b);

            if (skus.length === 0) return { success: true, updated: 0, total: 0, message: 'Нет товаров с WB-баркодами' };

            const res = await axios.post(
                `https://marketplace-api.wildberries.ru/api/v3/stocks/${settings.wbWarehouseId}`,
                { skus },
                { headers: { Authorization: settings.wbApiKey, 'Content-Type': 'application/json' }, timeout: 15_000 },
            );

            const wbStocks: Array<{ sku: string; amount: number }> = res.data?.stocks ?? [];
            if (wbStocks.length === 0) return { success: true, updated: 0, total: 0, message: 'Нет товаров на WB-складе' };

            // Get all our products that have wbBarcode set
            const products = await this.prisma.product.findMany({
                where: { storeId, deletedAt: null, wbBarcode: { not: null } }
            });

            // Build map: wbBarcode → product
            const barcodeMap = new Map<string, any>();
            for (const p of products) {
                if (p.wbBarcode) barcodeMap.set(p.wbBarcode, p);
            }

            const now = Date.now();
            let updatedCount = 0;
            const wbReconcileQueue: any[] = [];

            for (const stock of wbStocks) {
                const product = barcodeMap.get(stock.sku);
                if (!product) continue;

                // Ping-Pong prevention
                const lastWbPush = this.lastPush.get(product.id)?.wb || 0;
                if (now - lastWbPush < this.COOLDOWN_MS) {
                    continue;
                }

                // 1. Всегда обновляем кэшированное поле в БД (аналитика)
                await this.prisma.product.update({
                    where: { id: product.id },
                    data: { wbFbs: stock.amount }
                });

                // Если наше расчетное значение "Total" расходится с WB
                const currentAvailable = Math.max(0, product.total);
                if (stock.amount !== currentAvailable) {
                    this.logger.log(`[Store ${storeId}] [Reconcile WB] Mismatch for ${product.sku}: WB=${stock.amount}, App=${currentAvailable}. Adding to push queue.`);
                    wbReconcileQueue.push({ id: product.id, sku: product.sku, wbBarcode: product.wbBarcode, amount: currentAvailable });
                }
            }

            // Push updates back to WB if we have mismatches
            if (wbReconcileQueue.length > 0) {
                await this.syncBatchToWb(settings, wbReconcileQueue);
                updatedCount += wbReconcileQueue.length;
            }

            return { success: true, updated: updatedCount, total: wbStocks.length };
        } catch (err) {
            const e = err as AxiosError;
            return { success: false, error: e.message, body: e.response?.data };
        }
    }

    // ─── Fetch WB FBO Stocks ─────────────────────────────────────────────────────
    async pullWbFbo(storeId: string) {
        const settings = await this.getSettings(storeId);
        if (!settings?.wbApiKey) return { success: false, error: 'WB API ключ не задан' };

        try {
            // "dateFrom" determines how far back to look for stock updates.
            const dateFrom = '2020-01-01';

            const res = await axios.get(
                `https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=${dateFrom}`,
                {
                    headers: { Authorization: settings.wbApiKey },
                    timeout: 20_000
                }
            );

            const stocks: any[] = res.data ?? [];
            if (!Array.isArray(stocks) || stocks.length === 0) {
                return { success: true, updated: 0, message: 'Нет FBO остатков' };
            }

            // Group by barcode
            const fboMap = new Map<string, number>();
            for (const item of stocks) {
                const bc = item.barcode;
                const qty = item.quantity || 0;
                if (bc) {
                    fboMap.set(bc, (fboMap.get(bc) || 0) + qty);
                }
            }

            // Fetch our products
            const products = await this.prisma.product.findMany({
                where: { storeId, deletedAt: null, wbBarcode: { not: null } }
            });

            let updatedCount = 0;

            for (const product of products) {
                if (!product.wbBarcode) continue;

                const fboQty = fboMap.get(product.wbBarcode) || 0;

                if (product.wbFbo !== fboQty) {
                    await this.prisma.product.update({
                        where: { id: product.id },
                        data: { wbFbo: fboQty }
                    });
                    updatedCount++;
                }
            }

            return { success: true, updated: updatedCount };
        } catch (err: any) {
            const msg = err.response?.status === 401 || err.response?.status === 403
                ? 'Нет прав на API Статистики WB'
                : err.message;
            this.logger.error(`[Store ${storeId}] [WB FBO] Error: ${msg}`);
            return { success: false, error: msg };
        }
    }

    // ─── Полная выгрузка всего на Ozon ─────────────────────────────────────────
    async syncAllToOzon(storeId: string) {
        const settings = await this.getSettings(storeId);
        if (!settings?.ozonApiKey || !settings?.ozonClientId || !settings?.ozonWarehouseId) return { success: false, error: 'Ozon ключи или склад не настроены' };

        const products = await this.prisma.product.findMany({
            where: { storeId, deletedAt: null }
        });

        if (products.length === 0) return { success: true, updated: 0, total: 0 };

        let updatedCount = 0;
        const now = Date.now();
        const chunkSize = 100;

        for (let i = 0; i < products.length; i += chunkSize) {
            const chunk = products.slice(i, i + chunkSize);
            const itemsToPush: any[] = [];

            for (const product of chunk) {
                const cd = this.lastPush.get(product.id)?.ozon || 0;
                if (now - cd < this.COOLDOWN_MS) continue;

                const newAvailable = Math.max(0, product.total);
                const lastKnownOzon = product.ozonFbs || 0;

                if (newAvailable !== lastKnownOzon) {
                    itemsToPush.push({ id: product.id, sku: product.sku, amount: newAvailable });
                }
            }

            if (itemsToPush.length > 0) {
                await this.syncBatchToOzon(settings, itemsToPush);
                updatedCount += itemsToPush.length;
            }
        }

        return { success: true, updated: updatedCount, total: products.length };
    }

    // ─── Pull from Ozon → update our DB ──────────────────────────────────────────
    async pullFromOzon(storeId: string) {
        const settings = await this.getSettings(storeId);
        if (!settings?.ozonApiKey || !settings?.ozonClientId) return { success: false, error: 'Ozon API ключи не заданы' };

        try {
            // 1. Получаем наши товары с SKU
            const products = await this.prisma.product.findMany({
                where: { storeId, deletedAt: null }
            });
            const skus = products.map(p => p.sku).filter(Boolean);
            if (skus.length === 0) return { success: true, updated: 0, total: 0 };

            // 2. Запрашиваем остатки у Ozon через v4
            const res = await axios.post(
                'https://api-seller.ozon.ru/v4/product/info/stocks',
                {
                    filter: { offer_id: skus, visibility: 'ALL' },
                    limit: 1000,
                    last_id: ''
                },
                {
                    headers: { 'Client-Id': settings.ozonClientId, 'Api-Key': settings.ozonApiKey, 'Content-Type': 'application/json' },
                    timeout: 20_000
                }
            );

            const ozonItems: any[] = res.data?.items ?? [];
            if (ozonItems.length === 0) return { success: true, updated: 0, total: 0 };

            const productMap = new Map<string, any>();
            for (const p of products) productMap.set(p.sku, p);

            const now = Date.now();
            let updatedCount = 0;
            const ozonReconcileQueue: any[] = [];

            for (const item of ozonItems) {
                const product = productMap.get(item.offer_id);
                if (!product) continue;

                // Извлекаем FBS и FBO из массива stocks
                const fbsEntry = item.stocks?.find((s: any) => s.type === 'fbs');
                const fboEntry = item.stocks?.find((s: any) => s.type === 'fbo');
                const ozonFbsPresent = fbsEntry?.present ?? 0;
                const ozonFbsReserved = fbsEntry?.reserved ?? 0;
                const ozonFboPresent = fboEntry?.present ?? 0;

                // Всегда обновляем кэш по FBS/FBO и РЕЗЕРВ (аналитика)
                await this.prisma.product.update({
                    where: { id: product.id },
                    data: {
                        ozonFbs: ozonFbsPresent,
                        ozonFbo: ozonFboPresent,
                        reserved: ozonFbsReserved
                    }
                });

                // Если наше расчетное значение "Total" расходится с Ozon
                const currentAvailable = Math.max(0, product.total);
                if (ozonFbsPresent !== currentAvailable) {
                    this.logger.log(`[Store ${storeId}] [Reconcile Ozon] Mismatch for ${product.sku}: Ozon=${ozonFbsPresent}, App=${currentAvailable}. Adding to push queue.`);
                    ozonReconcileQueue.push({ id: product.id, sku: product.sku, amount: currentAvailable });
                }
            }

            // Push updates back to Ozon if we have mismatches
            if (ozonReconcileQueue.length > 0) {
                await this.syncBatchToOzon(settings, ozonReconcileQueue);
                updatedCount += ozonReconcileQueue.length;
            }

            return { success: true, updated: updatedCount, total: ozonItems.length };
        } catch (err) {
            const e = err as AxiosError;
            this.logger.error(`[Store ${storeId}] Ozon Pull Loop error: ${e.message}`);
            return { success: false, error: e.message, body: e.response?.data };
        }
    }

    // ─── Test connections ─────────────────────────────────────────────────────────
    async testWbConnection(storeId: string) {
        const settings = await this.getSettings(storeId);
        if (!settings?.wbApiKey) return { success: false, error: 'WB API ключ не задан' };
        try {
            await axios.get('https://common-api.wildberries.ru/api/v1/seller-info', {
                headers: { Authorization: settings.wbApiKey },
                timeout: 8_000,
            });
            return { success: true, message: 'WB подключение успешно!' };
        } catch (err) {
            const e = err as AxiosError;
            if (e.response?.status === 401) return { success: false, error: 'Неверный токен WB' };
            if (e.response?.status === 403) return { success: false, error: 'Токен WB не имеет нужных прав' };
            return { success: false, error: `Ошибка: ${e.message}` };
        }
    }

    async testOzonConnection(storeId: string) {
        const settings = await this.getSettings(storeId);
        if (!settings?.ozonApiKey || !settings?.ozonClientId) {
            return { success: false, error: 'Ozon Client ID или API ключ не задан' };
        }
        try {
            await axios.post('https://api-seller.ozon.ru/v1/warehouse/list', {}, {
                headers: { 'Client-Id': settings.ozonClientId, 'Api-Key': settings.ozonApiKey },
                timeout: 8_000,
            });
            return { success: true, message: 'Ozon подключение успешно!' };
        } catch (err) {
            const e = err as AxiosError;
            if (e.response?.status === 401 || e.response?.status === 403) {
                return { success: false, error: 'Неверные ключи Ozon' };
            }
            return { success: false, error: `Ошибка: ${e.message}` };
        }
    }

    // ─── Fetch raw WB stocks for debugging ───────────────────────────────────────
    async fetchWbStocks(storeId: string) {
        const settings = await this.getSettings(storeId);
        if (!settings?.wbApiKey) return { error: 'WB API ключ не задан' };
        if (!settings?.wbWarehouseId) return { error: 'ID склада WB не задан' };
        try {
            const res = await axios.post(
                `https://marketplace-api.wildberries.ru/api/v3/stocks/${settings.wbWarehouseId}`,
                {},
                {
                    headers: { Authorization: settings.wbApiKey, 'Content-Type': 'application/json' },
                    timeout: 10_000,
                },
            );
            return { warehouseId: settings.wbWarehouseId, ...res.data };
        } catch (err) {
            const e = err as AxiosError;
            return { error: e.message, status: e.response?.status, body: e.response?.data };
        }
    }

    // Получить список складов продавца — чтобы найти правильный ID
    async fetchWbWarehouses(storeId: string) {
        const settings = await this.getSettings(storeId);
        if (!settings?.wbApiKey) return { error: 'WB API ключ не задан' };
        try {
            const res = await axios.get(
                'https://marketplace-api.wildberries.ru/api/v3/warehouses',
                {
                    headers: { Authorization: settings.wbApiKey },
                    timeout: 10_000,
                },
            );
            return res.data;
        } catch (err) {
            const e = err as AxiosError;
            return { error: e.message, status: e.response?.status, body: e.response?.data };
        }
    }

    // ─── Process Marketplace Orders ──────────────────────────────────────────────
    async processWbOrders(storeId: string) {
        const settings = await this.getSettings(storeId);
        if (!settings?.wbApiKey) return;

        try {
            const res = await axios.get('https://marketplace-api.wildberries.ru/api/v3/orders/new', {
                headers: { Authorization: settings.wbApiKey },
                timeout: 15_000,
            });

            const wbOrders = res.data?.orders ?? [];
            if (wbOrders.length === 0) return;

            for (const order of wbOrders) {
                const orderId = String(order.id);

                // Проверяем, не обрабатывали ли мы этот заказ уже
                const existing = await this.prisma.marketplaceOrder.findFirst({
                    where: { marketplaceOrderId: orderId, storeId }
                });
                if (existing) continue;

                const barcode = order.skus?.[0];
                const article = order.article;

                let product = null;
                if (barcode) {
                    product = await this.prisma.product.findFirst({
                        where: { wbBarcode: barcode, storeId }
                    });
                }

                // Fallback: ищем по нашему внутреннему артикулу (SKU)
                if (!product && article) {
                    product = await this.prisma.product.findFirst({
                        where: { sku: article, storeId }
                    });

                    // (Auto-heal) Если нашли товар по артикулу, но у него еще не был прописан wbBarcode, пропишем!
                    if (product && barcode && !product.wbBarcode) {
                        await this.prisma.product.update({
                            where: { id: product.id },
                            data: { wbBarcode: barcode }
                        });
                        this.logger.log(`[Store ${storeId}] [WB Auto-Heal] Привязан баркод ${barcode} к артикулу ${product.sku}`);
                        product.wbBarcode = barcode;
                    }
                }

                if (!product) {
                    this.logger.warn(`[Store ${storeId}] [WB Order] Товар с баркодом ${barcode} или артикулом ${article} не найден. Пропуск.`);
                    continue;
                }

                const qty = order.amount || 1;

                // 1. Уменьшаем наш склад
                await this.prisma.product.update({
                    where: { id: product.id },
                    data: { total: { decrement: qty } }
                });

                // 2. Логируем в аудит
                await this.prisma.auditLog.create({
                    data: {
                        actionType: 'ORDER_DEDUCTED' as any,
                        productId: product.id,
                        productSku: product.sku,
                        delta: -qty,
                        actorEmail: 'system-wb',
                        note: `Заказ WB #${orderId}`,
                        beforeTotal: product.total,
                        afterTotal: product.total - qty,
                        storeId: storeId
                    }
                });

                // 3. Запоминаем заказ
                await this.prisma.marketplaceOrder.create({
                    data: {
                        marketplaceOrderId: orderId,
                        marketplace: 'WB',
                        productSku: product.sku,
                        productNames: product.name,
                        quantity: qty,
                        status: 'NEW',
                        totalAmount: order.price ? order.price / 100 : null,
                        marketplaceCreatedAt: order.createdAt ? new Date(order.createdAt) : new Date(),
                        deliveryMethod: 'WB',
                        storeId: storeId
                    }
                });

                this.logger.log(`[Store ${storeId}] [WB Order] Processed #${orderId}, SKU: ${product.sku}, Qty: ${qty}`);

                // 4. Сразу пушим новый остаток
                await this.syncProductToMarketplaces(product.id, storeId);
            }
        } catch (e: any) {
            this.logger.error(`[Store ${storeId}] [WB Orders] Error: ${e.message}`);
        }
    }

    async processOzonOrders(storeId: string) {
        const settings = await this.getSettings(storeId);
        if (!settings?.ozonApiKey || !settings?.ozonClientId) return;

        try {
            const now = new Date();
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

            const res = await axios.post('https://api-seller.ozon.ru/v3/posting/fbs/list', {
                filter: {
                    since: sevenDaysAgo.toISOString(),
                    to: now.toISOString()
                },
                dir: 'DESC',
                offset: 0,
                limit: 100,
                with: { analytics_data: true }
            }, {
                headers: { 'Client-Id': settings.ozonClientId, 'Api-Key': settings.ozonApiKey },
                timeout: 15_000,
            });

            const postings = res.data?.result?.postings ?? [];
            if (postings.length === 0) return;

            for (const posting of postings) {
                const postingNumber = posting.posting_number;

                const existing = await this.prisma.marketplaceOrder.findFirst({
                    where: { marketplaceOrderId: postingNumber, storeId }
                });

                if (existing) {
                    const newStatus = posting.status?.toLowerCase();
                    const oldStatus = existing.status?.toLowerCase();

                    if (newStatus && oldStatus !== newStatus) {
                        await this.prisma.marketplaceOrder.update({
                            where: { id: existing.id },
                            data: { status: posting.status }
                        });

                        if (newStatus === 'cancelled' && oldStatus !== 'cancelled') {
                            for (const item of posting.products) {
                                const product = await this.prisma.product.findFirst({
                                    where: { sku: item.offer_id, storeId }
                                });
                                if (product) {
                                    const qty = item.quantity;
                                    await this.prisma.product.update({
                                        where: { id: product.id },
                                        data: { total: { increment: qty } }
                                    });

                                    await this.prisma.auditLog.create({
                                        data: {
                                            actionType: ActionType.STOCK_ADJUSTED,
                                            productId: product.id,
                                            productSku: product.sku,
                                            delta: qty,
                                            actorEmail: 'system-ozon',
                                            note: `Возврат: Отмена Ozon #${postingNumber}`,
                                            beforeTotal: product.total,
                                            afterTotal: product.total + qty,
                                            storeId: storeId
                                        }
                                    });
                                    this.logger.log(`[Store ${storeId}] [Ozon Cancel] Refunded #${postingNumber}, ${product.sku}, +${qty}`);
                                    await this.syncProductToMarketplaces(product.id, storeId);
                                }
                            }
                        }
                    }
                    continue;
                }

                // Фильтруем статусы
                const allowedStatuses = ['awaiting_packaging', 'awaiting_deliver', 'delivering', 'delivered'];
                if (!allowedStatuses.includes(posting.status?.toLowerCase())) continue;

                for (const item of posting.products) {
                    const product = await this.prisma.product.findFirst({
                        where: { sku: item.offer_id, storeId }
                    });

                    if (!product) continue;

                    const qty = item.quantity;

                    // 1. Уменьшаем склад
                    await this.prisma.product.update({
                        where: { id: product.id },
                        data: { total: { decrement: qty } }
                    });

                    // 2. Логируем
                    await this.prisma.auditLog.create({
                        data: {
                            actionType: 'ORDER_DEDUCTED' as any,
                            productId: product.id,
                            productSku: product.sku,
                            delta: -qty,
                            actorEmail: 'system-ozon',
                            note: `Заказ Ozon #${postingNumber}`,
                            beforeTotal: product.total,
                            afterTotal: product.total - qty,
                            storeId: storeId
                        }
                    });

                    this.logger.log(`[Store ${storeId}] [Ozon Order] Processed #${postingNumber}, ${product.sku}, -${qty}`);
                }

                // Запоминаем отправление
                await this.prisma.marketplaceOrder.create({
                    data: {
                        marketplaceOrderId: postingNumber,
                        marketplace: 'OZON',
                        productSku: posting.products.map((p: any) => p.offer_id).join(', '),
                        quantity: posting.products.reduce((acc: number, p: any) => acc + p.quantity, 0),
                        status: posting.status,
                        totalAmount: posting.products.reduce((acc: number, p: any) => acc + (parseFloat(p.price) * p.quantity), 0),
                        shipmentDate: posting.shipment_date ? new Date(posting.shipment_date) : null,
                        marketplaceCreatedAt: posting.in_process_at ? new Date(posting.in_process_at) : null,
                        deliveryMethod: posting.delivery_method?.name || 'Ozon',
                        productNames: posting.products.map((p: any) => p.name).join(', '),
                        storeId: storeId
                    }
                });

                // Пушим обновления
                for (const item of posting.products) {
                    const p = await this.prisma.product.findFirst({
                        where: { sku: item.offer_id, storeId }
                    });
                    if (p) await this.syncProductToMarketplaces(p.id, storeId);
                }
            }
        } catch (e: any) {
            this.logger.error(`[Store ${storeId}] [Ozon Orders] Error: ${e.message}`);
        }
    }

    async syncProductMetadata(storeId: string, updatePhotos: boolean = true) {
        const settings = await this.getSettings(storeId);
        if (!settings) {
            this.logger.error(`[Store ${storeId}] No settings found for metadata sync`);
            return { success: false, error: 'Settings not configured' };
        }

        const products = await this.prisma.product.findMany({
            where: { storeId, deletedAt: null }
        });

        this.logger.log(`[Store ${storeId}] Metadata Sync START. Products: ${products.length}. WB Key: ${!!settings.wbApiKey}, Ozon Key: ${!!settings.ozonApiKey}`);
        if (products.length === 0) return { success: true, updated: 0 };

        let updatedCount = 0;

        const fixUrl = (url: any): string | null => {
            if (!url || typeof url !== 'string' || !url.trim()) return null;
            if (url.startsWith('//')) return `https:${url}`;
            return url;
        };

        // 1. WB Metadata
        if (settings.wbApiKey) {
            try {
                this.logger.log(`[Store ${storeId}] [WB] Requesting cards/list (v2) with cursor...`);
                const res = await axios.post('https://content-api.wildberries.ru/content/v2/get/cards/list', {
                    settings: {
                        cursor: { limit: 100, nmID: 0 },
                        filter: { withOnlyDeleted: false }
                    }
                }, {
                    headers: { Authorization: settings.wbApiKey },
                    timeout: 25_000
                });

                const cards = res.data?.cards ?? [];
                this.logger.log(`[Store ${storeId}] [WB] Received ${cards.length} cards.`);

                if (cards.length === 0) {
                    this.logger.warn(`[Store ${storeId}] [WB] 0 cards returned. Check API Key permissions or product availability. Total: ${res.data?.cursor?.total}`);
                }

                for (const card of cards) {
                    const vendorCode = card.vendorCode?.toString().trim().toLowerCase();
                    const product = products.find(p => {
                        const localSku = (p.sku || '').trim().toLowerCase();
                        const localBarcode = (p.wbBarcode || '').trim().toLowerCase();
                        return localSku === vendorCode || (localBarcode && localBarcode === vendorCode);
                    });

                    if (!product) continue;

                    let photoUrl = null;
                    if (Array.isArray(card.photos) && card.photos.length > 0) {
                        const first = card.photos[0];
                        photoUrl = fixUrl(first.big || first);
                    } else if (Array.isArray(card.mediaUrls) && card.mediaUrls.length > 0) {
                        photoUrl = fixUrl(card.mediaUrls[0]);
                    }

                    this.logger.log(`[Store ${storeId}] [WB COMPARE] ${product.sku} DB="${product.photo}" API="${photoUrl}"`);

                    const updates: any = {};
                    if (card.title && product.name !== card.title && (!product.name || product.name.length < 5)) {
                        updates.name = card.title;
                    }

                    if (updatePhotos && photoUrl && product.photo !== photoUrl) {
                        this.logger.log(`[Store ${storeId}] [WB] Updating photo ${product.sku} -> ${photoUrl}`);
                        updates.photo = photoUrl;
                    }

                    if (Object.keys(updates).length > 0) {
                        await this.prisma.product.update({
                            where: { id: product.id },
                            data: updates
                        });
                        updatedCount++;
                    }
                }
            } catch (e: any) {
                const errorData = e.response?.data ? JSON.stringify(e.response.data) : e.message;
                this.logger.error(`[Store ${storeId}] [WB Metadata] Error: ${errorData}`);
            }
        }

        // 2. Ozon Metadata
        if (settings.ozonApiKey && settings.ozonClientId) {
            try {
                const skus = products.map(p => p.sku).filter(Boolean);
                this.logger.log(`[Store ${storeId}] [Ozon] Preparing request for ${skus.length} SKUs`);

                if (skus.length > 0) {
                    const res = await axios.post('https://api-seller.ozon.ru/v3/product/info/list', {
                        offer_id: skus
                    }, {
                        headers: { 'Client-Id': settings.ozonClientId, 'Api-Key': settings.ozonApiKey },
                        timeout: 25_000
                    });

                    const items = res.data?.result?.items ?? res.data?.items ?? [];
                    this.logger.log(`[Store ${storeId}] [Ozon] Received ${items.length} items from API`);

                    for (const item of items) {
                        this.logger.log(`[Store ${storeId}] [Ozon ITEM] ${item.offer_id}: ${JSON.stringify(item)}`);

                        const offerId = item.offer_id?.toString().trim().toLowerCase();
                        const product = products.find(p => (p.sku || '').trim().toLowerCase() === offerId);
                        if (!product) continue;

                        let primaryImg = null;
                        if (Array.isArray(item.primary_image) && item.primary_image.length > 0) {
                            primaryImg = item.primary_image[0];
                        } else if (typeof item.primary_image === 'string') {
                            primaryImg = item.primary_image;
                        } else if (Array.isArray(item.images) && item.images.length > 0) {
                            primaryImg = item.images[0];
                        }

                        const photoUrl = fixUrl(primaryImg);
                        this.logger.log(`[Store ${storeId}] [Ozon COMPARE] ${product.sku} DB="${product.photo}" API="${photoUrl}"`);

                        const updates: any = {};
                        if (item.name && product.name !== item.name && (!product.name || product.name.length < 5)) {
                            updates.name = item.name;
                        }

                        if (updatePhotos && photoUrl && product.photo !== photoUrl) {
                            this.logger.log(`[Store ${storeId}] [Ozon] Updating photo ${product.sku} -> ${photoUrl}`);
                            updates.photo = photoUrl;
                        }

                        if (Object.keys(updates).length > 0) {
                            await this.prisma.product.update({
                                where: { id: product.id },
                                data: updates
                            });
                            updatedCount++;
                        }
                    }
                }
            } catch (e: any) {
                const errorData = e.response?.data ? JSON.stringify(e.response.data) : e.message;
                this.logger.error(`[Store ${storeId}] [Ozon Metadata] Error: ${errorData}`);
            }
        }

        this.logger.log(`[Store ${storeId}] Metadata Sync FINISHED. Updated: ${updatedCount}`);
        return { success: true, updated: updatedCount };
    }

    // ─── Order Details Fetching ──────────────────────────────────────────
    async forcePollOrders(storeId: string) {
        try {
            await this.processWbOrders(storeId);
            await this.processOzonOrders(storeId);
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    async getMarketplaceOrders(storeId: string, query: any) {
        const { page = 1, limit = 20, status, dateFrom, dateTo, marketplace } = query;
        const pageNumber = parseInt(page as string, 10);
        const limitNumber = parseInt(limit as string, 10);
        const skip = (pageNumber - 1) * limitNumber;

        const where: any = { storeId };
        if (marketplace && marketplace !== 'ALL') {
            where.marketplace = marketplace;
        }
        if (status) {
            where.status = { equals: status, mode: 'insensitive' };
        }
        if (dateFrom || dateTo) {
            const dateFilter: any = {};
            if (dateFrom) dateFilter.gte = new Date(dateFrom);
            if (dateTo) {
                const end = new Date(dateTo);
                end.setHours(23, 59, 59, 999);
                dateFilter.lte = end;
            }
            where.OR = [
                { marketplaceCreatedAt: dateFilter },
                { marketplaceCreatedAt: null, createdAt: dateFilter }
            ];
        }

        const [items, total] = await Promise.all([
            this.prisma.marketplaceOrder.findMany({
                where,
                orderBy: [
                    { marketplaceCreatedAt: { sort: 'desc', nulls: 'last' } },
                    { createdAt: 'desc' }
                ],
                skip,
                take: limitNumber
            }),
            this.prisma.marketplaceOrder.count({ where })
        ]);

        return {
            data: items,
            meta: {
                total,
                page: pageNumber,
                limit: limitNumber,
                lastPage: Math.ceil(total / limitNumber)
            }
        };
    }

    async getOrderDetails(orderId: string, storeId: string) {
        const order = await this.prisma.marketplaceOrder.findFirst({
            where: { id: orderId, storeId }
        });

        if (!order) return { success: false, error: 'Заказ не найден' };

        const settings = await this.getSettings(storeId);

        if (order.marketplace === 'OZON' && settings?.ozonApiKey && settings?.ozonClientId) {
            try {
                const res = await axios.post('https://api-seller.ozon.ru/v3/posting/fbs/get', {
                    posting_number: order.marketplaceOrderId,
                    with: { analytics_data: true, financial_data: true }
                }, {
                    headers: { 'Client-Id': settings.ozonClientId, 'Api-Key': settings.ozonApiKey },
                    timeout: 10_000,
                });

                return { success: true, marketplace: 'OZON', data: res.data?.result };
            } catch (err: any) {
                this.logger.error(`[Store ${storeId}] [Ozon Details] Error: ${err.message}`);
                return { success: false, error: 'Ошибка получения данных Ozon' };
            }
        }

        if (order.marketplace === 'WB' && settings?.wbApiKey) {
            try {
                const baseDate = order.marketplaceCreatedAt || order.createdAt || new Date();
                const dateFrom = Math.floor(new Date(baseDate.getTime() - 4 * 24 * 60 * 60 * 1000).getTime() / 1000);

                const res = await axios.get(`https://marketplace-api.wildberries.ru/api/v3/orders?limit=1000&next=0&dateFrom=${dateFrom}`, {
                    headers: { Authorization: settings.wbApiKey },
                    timeout: 15_000,
                });

                const orders = res.data?.orders ?? [];
                let wbOrder = orders.find((o: any) => String(o.id) === order.marketplaceOrderId);

                if (!wbOrder) {
                    const newRes = await axios.get(`https://marketplace-api.wildberries.ru/api/v3/orders/new`, {
                        headers: { Authorization: settings.wbApiKey },
                        timeout: 15_000,
                    });
                    const newOrders = newRes.data?.orders ?? [];
                    wbOrder = newOrders.find((o: any) => String(o.id) === order.marketplaceOrderId);
                }

                return { success: true, marketplace: 'WB', data: wbOrder || null };
            } catch (err: any) {
                this.logger.error(`[Store ${storeId}] [WB Details] Error: ${err.message}`);
                return { success: false, error: 'Ошибка получения данных WB' };
            }
        }

        return { success: false, error: 'API ключи маркетплейса не настроены' };
    }
}
