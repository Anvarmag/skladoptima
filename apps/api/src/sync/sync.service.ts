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
                    // 1. Sync from WB
                    const wbResult = await this.pullFromWb();
                    if ((wbResult as any).updated > 0) {
                        this.logger.log(`Background pull: updated ${(wbResult as any).updated} products from WB`);
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

    // ─── Main sync ────────────────────────────────────────────────────────────────
    async syncProductToMarketplaces(productId: string) {
        const [products, settings] = await Promise.all([
            this.prisma.$queryRawUnsafe<any[]>(
                `SELECT *, "wbBarcode" FROM "Product" WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1`,
                productId
            ),
            this.getSettings(),
        ]);

        const product = products?.[0];
        if (!product) return { wb: { success: false, error: 'Товар не найден' }, ozon: { success: false, error: 'Товар не найден' } };

        const available = Math.max(0, product.total - product.reserved);
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

                // Delta logic: На сколько реально изменился остаток на WB с момента последней синхронизации?
                const lastKnownWb = product.wbFbs || 0;
                const delta = stock.amount - lastKnownWb;

                // 1. Всегда обновляем кэшированное поле в БД
                await this.prisma.$executeRawUnsafe(
                    `UPDATE "Product" SET "wbFbs" = $1 WHERE id = $2`,
                    stock.amount, product.id
                );

                // 2. Если есть разница — это либо продажа (-), либо приход (+) на WB. 
                // ПРИМЕНЯЕМ АТОМАРНОЕ ИЗМЕНЕНИЕ к нашему МАСТЕР-складу (Total).
                if (delta !== 0) {
                    await this.prisma.$executeRawUnsafe(
                        `UPDATE "Product" SET "total" = "total" + $1 WHERE id = $2`,
                        delta, product.id
                    );

                    // Fetch updated total for propagation (to be safe)
                    const [updatedProduct] = await this.prisma.$queryRawUnsafe<any[]>(
                        `SELECT total, reserved FROM "Product" WHERE id = $1`,
                        product.id
                    );
                    const newTotal = updatedProduct.total;
                    const newAvailable = Math.max(0, newTotal - (updatedProduct.reserved || 0));

                    this.logger.log(`[Pull WB] Delta ${delta > 0 ? '+' : ''}${delta} applied atomically. Master Total: ${product.total} -> ${newTotal}`);

                    // 3. Собираем для групповой отправки на Ozon
                    ozonUpdates.push({ id: product.id, sku: product.sku, amount: newAvailable });
                    updatedCount++;
                } else {
                    // Разницы нет (Delta=0), но вдруг мы просто разошлись в значениях?
                    // (Например, прошлый пуш на WB упал, и там зависло старое число)
                    const currentAvailable = Math.max(0, (product.total || 0) - (product.reserved || 0));
                    if (stock.amount !== currentAvailable) {
                        this.logger.log(`[Reconcile WB] Mismatch for ${product.sku}: WB=${stock.amount}, App=${currentAvailable}. Adding to push queue.`);
                        // Добавляем в очередь на ПУШ обратно на WB (чтобы исправить его)
                        // Но пушим через syncBatchToWb в конце метода
                        const wbReconcileQueue = (this as any).wbReconcileQueue || [];
                        wbReconcileQueue.push({ id: product.id, sku: product.sku, wbBarcode: product.wbBarcode, amount: currentAvailable });
                        (this as any).wbReconcileQueue = wbReconcileQueue;
                    }
                }
            }

            // Sync batches
            if (ozonUpdates.length > 0) await this.syncBatchToOzon(settings, ozonUpdates);

            const wbReconcile = (this as any).wbReconcileQueue || [];
            if (wbReconcile.length > 0) {
                await this.syncBatchToWb(settings, wbReconcile);
                (this as any).wbReconcileQueue = [];
            }

            return { success: true, updated: updatedCount, total: wbStocks.length };
        } catch (err) {
            const e = err as AxiosError;
            return { success: false, error: e.message, body: e.response?.data };
        }
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
                const ozonFboPresent = fboEntry?.present ?? 0;

                // Всегда обновляем кэш по FBS/FBO
                await this.prisma.$executeRawUnsafe(
                    `UPDATE "Product" SET "ozonFbs" = $1, "ozonFbo" = $2 WHERE id = $3`,
                    ozonFbsPresent, ozonFboPresent, product.id
                );

                // Ping-Pong prevention для FBS
                const lastOzonPush = this.lastPush.get(product.id)?.ozon || 0;
                if (now - lastOzonPush < this.COOLDOWN_MS) {
                    this.logger.debug(`Ping-Pong prevention: skipping Ozon FBS delta for ${product.sku}`);
                    continue;
                }

                // Delta logic: применяем изменение FBS к мастер-складу
                const lastKnownOzon = product.ozonFbs || 0;
                const delta = ozonFbsPresent - lastKnownOzon;

                if (delta !== 0) {
                    await this.prisma.$executeRawUnsafe(
                        `UPDATE "Product" SET "total" = "total" + $1 WHERE id = $2`,
                        delta, product.id
                    );

                    const [updatedProduct] = await this.prisma.$queryRawUnsafe<any[]>(
                        `SELECT total, reserved FROM "Product" WHERE id = $1`,
                        product.id
                    );
                    const newTotal = updatedProduct.total;
                    const newAvailable = Math.max(0, newTotal - (updatedProduct.reserved || 0));

                    this.logger.log(`[Pull Ozon] Delta ${delta > 0 ? '+' : ''}${delta} applied. FBO: ${ozonFboPresent}. Master Total: ${product.total} -> ${newTotal}`);

                    if (product.wbBarcode) {
                        wbUpdates.push({ id: product.id, sku: product.sku, wbBarcode: product.wbBarcode, amount: newAvailable });
                    }
                    updatedCount++;
                }
            }

            if (wbUpdates.length > 0) await this.syncBatchToWb(settings, wbUpdates);

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

                // Ищем товар по баркоду (в WB заказе массив skus, берем первый)
                const barcode = order.skus?.[0];
                if (!barcode) continue;

                const product = await (this.prisma.product as any).findUnique({
                    where: { wbBarcode: barcode }
                });
                if (!product) {
                    this.logger.warn(`[WB Order] Product with barcode ${barcode} not found. Skipping.`);
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
                if (existing) continue;

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

        // 1. WB Metadata (Photos)
        if (settings?.wbApiKey) {
            try {
                // WB prefers batch of 100 for cards
                for (let i = 0; i < products.length; i += 100) {
                    const batch = products.slice(i, i + 100);
                    // Filter those without photo or just update all

                    const res = await axios.post('https://marketplace-api.wildberries.ru/content/v2/get/cards/list', {
                        settings: { cursor: { limit: 100 }, filter: { withStocks: false } }
                    }, {
                        headers: { Authorization: settings.wbApiKey },
                        timeout: 15_000
                    });

                    const cards = res.data?.cards ?? [];
                    for (const card of cards) {
                        const product = products.find(p => p.sku === card.vendorCode);
                        if (product && card.mediaFiles?.[0]) {
                            await this.prisma.product.update({
                                where: { id: product.id },
                                data: { photo: card.mediaFiles[0] }
                            });
                            updatedCount++;
                        }
                    }
                }
            } catch (e: any) {
                this.logger.error(`[WB Metadata] Error: ${e.message}`);
            }
        }

        // 2. Ozon Metadata (Photos)
        if (settings?.ozonApiKey && settings?.ozonClientId) {
            try {
                for (let i = 0; i < products.length; i += 100) {
                    const batch = products.slice(i, i + 100);
                    const offerIds = batch.map(p => p.sku);

                    const res = await axios.post('https://api-seller.ozon.ru/v4/product/info/attributes', {
                        filter: { offer_id: offerIds, visibility: 'ALL' },
                        limit: 100
                    }, {
                        headers: { 'Client-Id': settings.ozonClientId, 'Api-Key': settings.ozonApiKey },
                        timeout: 15_000
                    });

                    const items = res.data?.result ?? [];
                    for (const item of items) {
                        const product = products.find(p => p.sku === item.offer_id);
                        if (product && item.images?.[0]?.file_name) {
                            await this.prisma.product.update({
                                where: { id: product.id },
                                data: { photo: item.images[0].file_name }
                            });
                            updatedCount++;
                        }
                    }
                }
            } catch (e: any) {
                this.logger.error(`[Ozon Metadata] Error: ${e.message}`);
            }
        }

        return { success: true, updated: updatedCount };
    }
}
