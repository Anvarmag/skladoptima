import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import axios, { AxiosError } from 'axios';

@Injectable()
export class SyncService implements OnModuleInit {
    private readonly logger = new Logger(SyncService.name);
    // Для предотвращения эффекта "пинг-понга" (бесконечных циклов синхронизации)
    // Храним время последнего ПУША на маркетплейс для каждого товара по его ID
    private lastPush = new Map<string, { wb?: number, ozon?: number }>();
    private readonly COOLDOWN_MS = 2 * 60_000; // 2 минуты "режима тишины"

    constructor(private readonly prisma: PrismaService) { }

    onModuleInit() {
        // Фоновый опрос маркетплейсов каждые 60 секунд на стороне сервера
        const INTERVAL_MS = 60_000;
        setTimeout(async () => {
            this.logger.log('Background marketplace poll started (every 60s)');
            const run = async () => {
                try {
                    const wbResult = await this.pullFromWb();
                    if ((wbResult as any).updated > 0) {
                        this.logger.log(`Background pull: updated ${(wbResult as any).updated} products from WB`);
                    }

                    // 1.1 Sync WB FBO
                    const wbFboResult = await this.pullWbFbo();
                    if ((wbFboResult as any)?.updated > 0) {
                        this.logger.log(`Background pull: updated ${(wbFboResult as any).updated} FBO products from WB`);
                    }

                    // 2. Sync from Ozon
                    const ozonResult = await this.pullFromOzon();
                    if ((ozonResult as any).updated > 0) {
                        this.logger.log(`Background pull: updated ${(ozonResult as any).updated} products from Ozon`);
                    }

                    // 3. Process NEW Orders (NEW Source of Truth)
                    await this.processWbOrders();
                    await this.processOzonOrders();

                    // 4. Update Metadata (Photos/Names) periodically
                    // To avoid over-polling, we could do this less often, but 60s is fine for initial setup
                    await this.syncProductMetadata();
                } catch (e: any) {
                    this.logger.warn(`Background marketplace poll error: ${e?.message}`);
                }
            };
            run();
            setInterval(run, INTERVAL_MS);
        }, 5_000);
    }
    private async getSettings(): Promise<any> {
        const rows = await this.prisma.$queryRawUnsafe<any[]>(
            `SELECT * FROM "MarketplaceSettings" LIMIT 1`
        );
        return rows[0] ?? null;
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
    async syncProductToMarketplaces(productId: string) {
        const settings = await this.getSettings();
        if (!settings) return { success: false, error: 'Settings not configured' };

        const product = await this.prisma.product.findUnique({ where: { id: productId } });
        if (!product || product.deletedAt) return { success: false, error: 'Product not found' };

        // available - это то, что мы физически можем продать прямо сейчас
        const available = Math.max(0, product.total);

        const results = { wb: { success: false, error: 'Not configured' }, ozon: { success: false, error: 'Not configured' } };

        const [wb, ozon] = await Promise.all([
            this.syncToWb(settings, product, available),
            this.syncToOzon(settings, product, available),
        ]);

        return { wb, ozon, amount: available };
    }

    // ─── Pull from WB → update our DB ────────────────────────────────────────────
    async pullFromWb() {
        const settings = await this.getSettings();
        if (!settings?.wbApiKey) return { success: false, error: 'WB API ключ не задан' };
        if (!settings?.wbWarehouseId) return { success: false, error: 'ID склада WB не задан' };

        try {
            // Fetch all our barcodes to check their stock on WB
            const localProducts = await this.prisma.$queryRawUnsafe<any[]>(
                `SELECT "wbBarcode" FROM "Product" WHERE "deletedAt" IS NULL AND "wbBarcode" IS NOT NULL`
            );
            const skus = [...new Set(localProducts.map(p => p.wbBarcode))].filter(Boolean);

            if (skus.length === 0) return { success: true, updated: 0, total: 0, message: 'Нет товаров с WB-баркодами' };

            const res = await axios.post(
                `https://marketplace-api.wildberries.ru/api/v3/stocks/${settings.wbWarehouseId}`,
                { skus },
                { headers: { Authorization: settings.wbApiKey, 'Content-Type': 'application/json' }, timeout: 15_000 },
            );

            const wbStocks: Array<{ sku: string; amount: number }> = res.data?.stocks ?? [];
            if (wbStocks.length === 0) return { success: true, updated: 0, total: 0, message: 'Нет товаров на WB-складе' };

            // Get all our products that have wbBarcode set
            const products = await this.prisma.$queryRawUnsafe<any[]>(
                `SELECT id, sku, "wbBarcode", total, reserved, "wbFbs", "ozonFbs" FROM "Product" WHERE "deletedAt" IS NULL AND "wbBarcode" IS NOT NULL`
            );

            // Build map: wbBarcode → product
            const barcodeMap = new Map<string, any>();
            for (const p of products) barcodeMap.set(p.wbBarcode, p);

            const now = Date.now();
            let updatedCount = 0;
            const ozonUpdates: any[] = [];

            for (const stock of wbStocks) {
                const product = barcodeMap.get(stock.sku);
                if (!product) continue;

                // Ping-Pong prevention
                const lastWbPush = this.lastPush.get(product.id)?.wb || 0;
                if (now - lastWbPush < this.COOLDOWN_MS) {
                    continue;
                }

                // 1. Всегда обновляем кэшированное поле в БД (аналитика)
                await this.prisma.$executeRawUnsafe(
                    `UPDATE "Product" SET "wbFbs" = $1 WHERE id = $2`,
                    stock.amount, product.id
                );

                // Если наше расчетное значение "Total" расходится с WB
                const currentAvailable = Math.max(0, product.total);
                if (stock.amount !== currentAvailable) {
                    this.logger.log(`[Reconcile WB] Mismatch for ${product.sku}: WB=${stock.amount}, App=${currentAvailable}. Adding to push queue.`);
                    const wbReconcileQueue = (this as any).wbReconcileQueue || [];
                    wbReconcileQueue.push({ id: product.id, sku: product.sku, wbBarcode: product.wbBarcode, amount: currentAvailable });
                    (this as any).wbReconcileQueue = wbReconcileQueue;
                }
            }

            // Push updates back to WB if we have mismatches
            const wbReconcile = (this as any).wbReconcileQueue || [];
            if (wbReconcile.length > 0) {
                await this.syncBatchToWb(settings, wbReconcile);
                (this as any).wbReconcileQueue = [];
                updatedCount += wbReconcile.length;
            }

            return { success: true, updated: updatedCount, total: wbStocks.length };
        } catch (err) {
            const e = err as AxiosError;
            return { success: false, error: e.message, body: e.response?.data };
        }
    }

    // ─── Fetch WB FBO Stocks ─────────────────────────────────────────────────────
    async pullWbFbo() {
        const settings = await this.getSettings();
        if (!settings?.wbApiKey) return { success: false, error: 'WB API ключ не задан' };

        try {
            // "dateFrom" determines how far back to look for stock updates. A long time ago is fine.
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
                where: { deletedAt: null, wbBarcode: { not: null } }
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
            // Can be 401/403 if statistics API not allowed on this token
            const msg = err.response?.status === 401 || err.response?.status === 403
                ? 'Нет прав на API Статистики WB'
                : err.message;
            this.logger.error(`[WB FBO] Error: ${msg}`);
            return { success: false, error: msg };
        }
    }

    // ─── Полная выгрузка всего на Ozon ─────────────────────────────────────────
    async syncAllToOzon() {
        const settings = await this.getSettings();
        if (!settings?.ozonApiKey || !settings?.ozonClientId || !settings?.ozonWarehouseId) return { success: false, error: 'Ozon ключи или склад не настроены' };

        const products = await this.prisma.$queryRawUnsafe<any[]>(
            `SELECT id, sku, "wbBarcode", total, reserved, "wbFbs", "ozonFbs" FROM "Product" WHERE "deletedAt" IS NULL`
        );
        const skus = products.map(p => p.sku).filter(Boolean);
        if (skus.length === 0) return { success: true, updated: 0, total: 0 };

        let updatedCount = 0;
        const now = Date.now();
        const chunkSize = 100;

        for (let i = 0; i < products.length; i += chunkSize) {
            const chunk = products.slice(i, i + chunkSize);
            const itemsToPush: any[] = [];

            for (const product of chunk) {
                const cd = this.lastPush.get(product.id)?.ozon || 0;
                if (now - cd < this.COOLDOWN_MS) continue;

                const [updatedProduct] = await this.prisma.$queryRawUnsafe<any[]>(
                    `SELECT total, reserved FROM "Product" WHERE id = $1`,
                    product.id
                );

                if (updatedProduct) {
                    const newTotal = updatedProduct.total;
                    const newAvailable = Math.max(0, newTotal);
                    const lastKnownOzon = product.ozonFbs || 0;

                    if (newAvailable !== lastKnownOzon) {
                        itemsToPush.push({ id: product.id, sku: product.sku, amount: newAvailable });
                    }
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
    async pullFromOzon() {
        const settings = await this.getSettings();
        if (!settings?.ozonApiKey || !settings?.ozonClientId) return { success: false, error: 'Ozon API ключи не заданы' };

        try {
            // 1. Получаем наши товары с SKU
            const products = await this.prisma.$queryRawUnsafe<any[]>(
                `SELECT id, sku, "wbBarcode", total, reserved, "wbFbs", "ozonFbs" FROM "Product" WHERE "deletedAt" IS NULL`
            );
            const skus = products.map(p => p.sku).filter(Boolean);
            if (skus.length === 0) return { success: true, updated: 0, total: 0 };

            // 2. Запрашиваем остатки у Ozon через v4 (возвращает и FBS и FBO за один запрос)
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
            const wbUpdates: any[] = [];

            for (const item of ozonItems) {
                const product = productMap.get(item.offer_id);
                if (!product) continue;

                // Извлекаем FBS и FBO из массива stocks
                const fbsEntry = item.stocks?.find((s: any) => s.type === 'fbs');
                const fboEntry = item.stocks?.find((s: any) => s.type === 'fbo');
                const ozonFbsPresent = fbsEntry?.present ?? 0;
                const ozonFbsReserved = fbsEntry?.reserved ?? 0;
                const ozonFboPresent = fboEntry?.present ?? 0;

                // Очередное обновление: всегда обновляем кэш по FBS/FBO и РЕЗЕРВ (аналитика)
                await this.prisma.$executeRawUnsafe(
                    `UPDATE "Product" SET "ozonFbs" = $1, "ozonFbo" = $2, "reserved" = $3 WHERE id = $4`,
                    ozonFbsPresent, ozonFboPresent, ozonFbsReserved, product.id
                );

                // Если наше расчетное значение "Total" расходится с Ozon
                const currentAvailable = Math.max(0, product.total);
                if (ozonFbsPresent !== currentAvailable) {
                    this.logger.log(`[Reconcile Ozon] Mismatch for ${product.sku}: Ozon=${ozonFbsPresent}, App=${currentAvailable}. Adding to push queue.`);
                    const ozonReconcileQueue = (this as any).ozonReconcileQueue || [];
                    ozonReconcileQueue.push({ id: product.id, sku: product.sku, amount: currentAvailable });
                    (this as any).ozonReconcileQueue = ozonReconcileQueue;
                }
            }

            // Push updates back to Ozon if we have mismatches
            const ozonReconcile = (this as any).ozonReconcileQueue || [];
            if (ozonReconcile.length > 0) {
                await this.syncBatchToOzon(settings, ozonReconcile);
                (this as any).ozonReconcileQueue = [];
                updatedCount += ozonReconcile.length;
            }

            return { success: true, updated: updatedCount, total: ozonItems.length };
        } catch (err) {
            const e = err as AxiosError;
            this.logger.error(`Ozon Pull Loop error: ${e.message}`);
            return { success: false, error: e.message, body: e.response?.data };
        }
    }

    // ─── Test connections ─────────────────────────────────────────────────────────
    async testWbConnection() {
        const settings = await this.getSettings();
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

    async testOzonConnection() {
        const settings = await this.getSettings();
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
    async fetchWbStocks() {
        const settings = await this.getSettings();
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
    async fetchWbWarehouses() {
        const settings = await this.getSettings();
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
    async processWbOrders() {
        const settings = await this.getSettings();
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
                const existing = await (this.prisma as any).marketplaceOrder.findUnique({
                    where: { marketplaceOrderId: orderId }
                });
                if (existing) continue;

                const barcode = order.skus?.[0];
                const article = order.article;

                let product = null;
                if (barcode) {
                    product = await (this.prisma.product as any).findUnique({
                        where: { wbBarcode: barcode }
                    });
                }

                // Fallback: ищем по нашему внутреннему артикулу (SKU)
                if (!product && article) {
                    product = await (this.prisma.product as any).findUnique({
                        where: { sku: article }
                    });

                    // (Auto-heal) Если нашли товар по артикулу, но у него еще не был прописан wbBarcode, пропишем!
                    if (product && barcode && !product.wbBarcode) {
                        await this.prisma.$executeRawUnsafe(
                            `UPDATE "Product" SET "wbBarcode" = $1 WHERE id = $2`,
                            barcode, product.id
                        );
                        this.logger.log(`[WB Auto-Heal] Привязан баркод ${barcode} к артикулу ${product.sku}`);
                        product.wbBarcode = barcode; // апдейтим в памяти
                    }
                }

                if (!product) {
                    this.logger.warn(`[WB Order] Товар с баркодом ${barcode} или артикулом ${article} не найден в базе. Пропуск.`);
                    continue;
                }

                const qty = order.amount || 1;

                // 1. Уменьшаем наш склад АТОМАРНО
                await this.prisma.$executeRawUnsafe(
                    `UPDATE "Product" SET "total" = "total" - $1 WHERE id = $2`,
                    qty, product.id
                );

                // 2. Логируем в аудит
                await (this.prisma as any).auditLog.create({
                    data: {
                        actionType: 'ORDER_DEDUCTED' as any,
                        productId: product.id,
                        productSku: product.sku,
                        delta: -qty,
                        actorEmail: 'system-wb',
                        note: `Заказ WB #${orderId}`,
                        beforeTotal: (product as any).total || 0,
                        afterTotal: ((product as any).total || 0) - qty
                    }
                });

                // 3. Запоминаем заказ с деталями
                await (this.prisma as any).marketplaceOrder.create({
                    data: {
                        marketplaceOrderId: orderId,
                        marketplace: 'WB',
                        productSku: product.sku,
                        productNames: product.name,
                        quantity: qty,
                        status: 'NEW',
                        totalAmount: order.price ? order.price / 100 : null, // WB дает в копейках
                        marketplaceCreatedAt: order.createdAt ? new Date(order.createdAt) : new Date(),
                        deliveryMethod: 'WB'
                    }
                });

                this.logger.log(`[WB Order] Processed order #${orderId}, SKU: ${product.sku}, Qty: ${qty}`);

                // 4. Сразу пушим новый остаток на все площадки
                await this.syncProductToMarketplaces(product.id);
            }
        } catch (e: any) {
            this.logger.error(`[WB Orders] Error: ${e.message}`);
        }
    }

    async processOzonOrders() {
        const settings = await this.getSettings();
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

                const existing = await (this.prisma as any).marketplaceOrder.findUnique({
                    where: { marketplaceOrderId: postingNumber }
                });

                if (existing) {
                    const newStatus = posting.status?.toLowerCase();
                    const oldStatus = existing.status?.toLowerCase();

                    if (newStatus && oldStatus !== newStatus) {
                        await (this.prisma as any).marketplaceOrder.update({
                            where: { id: existing.id },
                            data: { status: posting.status }
                        });

                        if (newStatus === 'cancelled' && oldStatus !== 'cancelled') {
                            for (const item of posting.products) {
                                const product = await this.prisma.product.findUnique({ where: { sku: item.offer_id } });
                                if (product) {
                                    const qty = item.quantity;
                                    await this.prisma.$executeRawUnsafe(
                                        `UPDATE "Product" SET "total" = "total" + $1 WHERE id = $2`,
                                        qty, product.id
                                    );

                                    await (this.prisma as any).auditLog.create({
                                        data: {
                                            actionType: 'STOCK_ADJUSTED' as any, // using existing enum value
                                            productId: product.id,
                                            productSku: product.sku,
                                            delta: qty,
                                            actorEmail: 'system-ozon',
                                            note: `Возврат остатков: Отмена заказа Ozon #${postingNumber}`,
                                            beforeTotal: product.total || 0,
                                            afterTotal: (product.total || 0) + qty
                                        }
                                    });
                                    this.logger.log(`[Ozon Cancel] Refunded #${postingNumber}, SKU: ${product.sku}, Qty: +${qty}`);
                                    await this.syncProductToMarketplaces(product.id);
                                }
                            }
                        }
                    }
                    continue;
                }

                // Фильтруем статусы, которые нам интересны
                const allowedStatuses = ['awaiting_packaging', 'awaiting_deliver', 'delivering', 'delivered'];
                if (!allowedStatuses.includes(posting.status?.toLowerCase())) {
                    this.logger.log(`[Ozon Order] Skipping posting #${postingNumber} with status ${posting.status}`);
                    continue;
                }

                for (const item of posting.products) {
                    const product = await this.prisma.product.findUnique({
                        where: { sku: item.offer_id }
                    });

                    if (!product) {
                        this.logger.warn(`[Ozon Order] Product ${item.offer_id} not found. Skipping.`);
                        continue;
                    }

                    const qty = item.quantity;

                    // 1. Уменьшаем склад
                    await this.prisma.$executeRawUnsafe(
                        `UPDATE "Product" SET "total" = "total" - $1 WHERE id = $2`,
                        qty, product.id
                    );

                    // 2. Логируем
                    await (this.prisma as any).auditLog.create({
                        data: {
                            actionType: 'ORDER_DEDUCTED' as any,
                            productId: product.id,
                            productSku: product.sku,
                            delta: -qty,
                            actorEmail: 'system-ozon',
                            note: `Заказ Ozon #${postingNumber}`,
                            beforeTotal: (product as any).total || 0,
                            afterTotal: ((product as any).total || 0) - qty
                        }
                    });

                    this.logger.log(`[Ozon Order] Processed posting #${postingNumber}, SKU: ${product.sku}, Qty: ${qty}`);
                }

                // Запоминаем отправление целиком с деталями
                await (this.prisma as any).marketplaceOrder.create({
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
                        productNames: posting.products.map((p: any) => p.name).join(', ')
                    }
                });

                // Пушим обновления
                for (const item of posting.products) {
                    const p = await this.prisma.product.findUnique({ where: { sku: item.offer_id } });
                    if (p) await this.syncProductToMarketplaces(p.id);
                }
            }
        } catch (e: any) {
            const errorBody = e.response?.data ? JSON.stringify(e.response.data) : '';
            this.logger.error(`[Ozon Orders] Error: ${e.message}. Details: ${errorBody}`);
        }
    }

    async syncProductMetadata() {
        const settings = await this.getSettings();
        const products = await this.prisma.product.findMany({ where: { deletedAt: null } });
        if (products.length === 0) return { success: true, updated: 0 };

        let updatedCount = 0;
        this.logger.log(`[Metadata] Starting photo sync for ${products.length} products`);

        // 1. WB Metadata (Photos)
        if (settings?.wbApiKey) {
            try {
                const res = await axios.post('https://content-api.wildberries.ru/content/v2/get/cards/list', {
                    settings: { cursor: { limit: 100 }, filter: { withPhoto: -1 } }
                }, {
                    headers: { Authorization: settings.wbApiKey },
                    timeout: 15_000
                });

                const cards = res.data?.cards ?? res.data?.data ?? [];
                this.logger.log(`[WB Metadata] Got ${cards.length} cards from WB. First 5 vendorCodes: ${cards.slice(0, 5).map((c: any) => c.vendorCode).join(', ')}`);
                this.logger.log(`[WB Metadata] Our product SKUs: ${products.map(p => p.sku).join(', ')}`);

                for (const card of cards) {
                    const vendorCode = card.vendorCode || card.nmID?.toString();
                    const product = products.find(p => p.sku === vendorCode);
                    const photoUrl = card.mediaFiles?.[0] || card.photos?.[0]?.big || card.photos?.[0]?.c246x328;
                    if (product && photoUrl) {
                        this.logger.log(`[WB Metadata] Match: ${product.sku}, photo=${product.photo ? 'EXISTS' : 'EMPTY'}, new photoUrl=${photoUrl.substring(0, 60)}`);
                        await this.prisma.product.update({
                            where: { id: product.id },
                            data: { photo: photoUrl }
                        });
                        updatedCount++;
                    }
                }
            } catch (e: any) {
                this.logger.error(`[WB Metadata] Error: ${e.message}`);
            }
        }

        // 2. Ozon Metadata (Photos)
        if (settings?.ozonApiKey && settings?.ozonClientId) {
            try {
                const offerIds = products.map(p => p.sku);

                const res = await axios.post('https://api-seller.ozon.ru/v3/product/info/list', {
                    offer_id: offerIds,
                }, {
                    headers: { 'Client-Id': settings.ozonClientId, 'Api-Key': settings.ozonApiKey },
                    timeout: 15_000
                });

                const items = res.data?.result?.items ?? res.data?.items ?? [];
                this.logger.log(`[Ozon Metadata] Got ${items.length} items from Ozon`);

                for (const item of items) {
                    const product = products.find(p => p.sku === item.offer_id);
                    const photoUrl = item.primary_image || item.images?.[0];
                    if (product && photoUrl) {
                        this.logger.log(`[Ozon Metadata] Updating photo for ${product.sku}: ${photoUrl.substring(0, 80)}...`);
                        await this.prisma.product.update({
                            where: { id: product.id },
                            data: { photo: photoUrl }
                        });
                        updatedCount++;
                    }
                }
            } catch (e: any) {
                this.logger.error(`[Ozon Metadata] Error: ${e.message}`);
            }
        }

        this.logger.log(`[Metadata] Done. Updated ${updatedCount} photos`);
        return { success: true, updated: updatedCount };
    }
    // ─── Order Details Fetching ──────────────────────────────────────────
    async forcePollOrders() {
        try {
            await this.processWbOrders();
            await this.processOzonOrders();
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    async getMarketplaceOrders(query: any) {
        const { page = 1, limit = 20, status, dateFrom, dateTo, marketplace } = query;
        const pageNumber = parseInt(page as string, 10);
        const limitNumber = parseInt(limit as string, 10);
        const skip = (pageNumber - 1) * limitNumber;

        const where: any = {};
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
            (this.prisma as any).marketplaceOrder.findMany({
                where,
                orderBy: [
                    { marketplaceCreatedAt: { sort: 'desc', nulls: 'last' } },
                    { createdAt: 'desc' }
                ],
                skip,
                take: limitNumber
            }),
            (this.prisma as any).marketplaceOrder.count({ where })
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

    async getOrderDetails(orderId: string) {
        const order = await (this.prisma as any).marketplaceOrder.findUnique({
            where: { id: orderId }
        });

        if (!order) return { success: false, error: 'Заказ не найден' };

        const settings = await this.getSettings();

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
                this.logger.error(`[Ozon Details] Error: ${err.message}`);
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
                this.logger.error(`[WB Details] Error: ${err.message}`);
                return { success: false, error: 'Ошибка получения данных WB' };
            }
        }

        return { success: false, error: 'API ключи маркетплейса не настроены' };
    }
}
