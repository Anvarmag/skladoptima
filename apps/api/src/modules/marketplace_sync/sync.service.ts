import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ActionType, MarketplaceType, OrderFulfillmentMode } from '@prisma/client';
import axios, { AxiosError } from 'axios';
import { SyncPreflightService } from '../sync-runs/sync-preflight.service';
import { OrdersIngestionService } from '../orders/orders-ingestion.service';

@Injectable()
export class SyncService implements OnModuleInit {
    private readonly logger = new Logger(SyncService.name);
    // Для предотвращения эффекта "пинг-понга" (бесконечных циклов синхронизации)
    // Храним время последнего ПУША на маркетплейс для каждого товара по его ID
    private lastPush = new Map<string, { wb?: number, ozon?: number }>();
    private readonly COOLDOWN_MS = 2 * 60_000; // 2 минуты "режима тишины"

    constructor(
        private readonly prisma: PrismaService,
        // TASK_SYNC_3: shared preflight для tenant/account/credentials policy.
        // Было: inline `_isTenantPaused` без проверки lifecycle/credentials и
        // без structured-лога. Стало: единый policy guard, общий с manual API.
        private readonly preflight: SyncPreflightService,
        // TASK_ORDERS_2: dual-write в новый orders domain. Legacy
        // `MarketplaceOrder` остаётся (читатели ещё не переключены), но
        // каждый order event теперь дополнительно проходит идемпотентный
        // ingestion в `Order/OrderItem/OrderEvent`.
        private readonly ordersIngestion: OrdersIngestionService,
    ) { }

    async onModuleInit() {
        if (process.env.IS_WORKER !== 'true') {
            this.logger.log('Background poll disabled in API, skipping.');
            return;
        }

        // Фоновый опрос маркетплейсов каждые 60 секунд на стороне сервера
        const INTERVAL_MS = 60_000;
        setTimeout(async () => {
            this.logger.log('Background multi-tenant marketplace poll started');
            const run = async () => {
                try {
                    const stores = await this.prisma.tenant.findMany();
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

    async syncStore(tenantId: string) {
        // TASK_SYNC_3: preflight на уровне tenant'а (без attached account).
        // Если tenant в TRIAL_EXPIRED/SUSPENDED/CLOSED — все внешние API
        // calls приостанавливаются.
        const tenantDecision = await this.preflight.runPreflight(tenantId, null, {
            operation: 'scheduled_poll',
            checkConcurrency: false,
        });
        if (!tenantDecision.allowed) {
            return { success: false, paused: true, reason: tenantDecision.reason };
        }

        // Per-account preflight: проверяем lifecycleStatus/credentialStatus
        // для каждого active marketplace account. Если хотя бы один аккаунт
        // прошёл — этот канал работает; остальные тихо пропускаем.
        const accounts = await this.prisma.marketplaceAccount.findMany({
            where: { tenantId, lifecycleStatus: 'ACTIVE' },
            select: { id: true, marketplace: true, credentialStatus: true },
        });

        const allowedMarketplaces = new Set<string>();
        for (const acc of accounts) {
            const decision = await this.preflight.runPreflight(tenantId, acc.id, {
                operation: 'scheduled_poll',
                checkConcurrency: false,
            });
            if (decision.allowed) {
                allowedMarketplaces.add(acc.marketplace);
            }
        }

        if (allowedMarketplaces.size === 0) {
            return { success: false, paused: true, reason: 'NO_ELIGIBLE_ACCOUNTS' };
        }

        this.logger.log(`Starting scheduled sync for Store ${tenantId} (allowed: ${[...allowedMarketplaces].join(',')})`);

        if (allowedMarketplaces.has('WB')) {
            const wbResult: any = await this.pullFromWb(tenantId);
            if (wbResult?.updated > 0) {
                this.logger.log(`[Store ${tenantId}] WB FBS pull: updated ${wbResult.updated} products`);
            }
            await this.processWbOrders(tenantId);
        }
        if (allowedMarketplaces.has('OZON')) {
            await this.pullFromOzon(tenantId);
            await this.processOzonOrders(tenantId);
        }
        await this.syncProductMetadata(tenantId, false);
    }

    async fullSync(tenantId: string) {
        const decision = await this.preflight.runPreflight(tenantId, null, {
            operation: 'full_sync',
            checkConcurrency: false,
        });
        if (!decision.allowed) {
            return {
                success: false,
                paused: true,
                reason: decision.reason,
                message: 'Marketplace integrations blocked by policy',
            };
        }
        this.logger.log(`[Store ${tenantId}] Starting FULL SYNC...`);
        try {
            // 0. Discovery (Import new products first)
            await this.importProductsFromWb(tenantId);
            await this.importProductsFromOzon(tenantId);

            // 1. Stocks & Prices
            await this.pullFromWb(tenantId);
            await this.pullFromOzon(tenantId);

            // 2. History
            await this.pullHistoryFromWb(tenantId, 30);
            await this.pullHistoryFromOzon(tenantId, 30);

            // 3. Pull metadata (ratings, photos)
            await this.syncProductMetadata(tenantId, true);

            this.logger.log(`[Store ${tenantId}] FULL SYNC COMPLETE.`);
            return { success: true, message: 'Данные успешно синхронизированы' };
        } catch (e: any) {
            this.logger.error(`[Store ${tenantId}] FULL SYNC FAILED: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    private async getSettings(tenantId: string): Promise<any> {
        const wb = await this.prisma.marketplaceAccount.findFirst({
            where: { tenantId, marketplace: 'WB' as any }
        });
        const ozon = await this.prisma.marketplaceAccount.findFirst({
            where: { tenantId, marketplace: 'OZON' as any }
        });

        if (!wb && !ozon) return null;

        return {
            wbApiKey: wb?.apiKey,
            wbStatApiKey: wb?.statApiKey,
            wbWarehouseId: wb?.warehouseId,
            ozonClientId: ozon?.clientId,
            ozonApiKey: ozon?.apiKey,
            ozonWarehouseId: ozon?.warehouseId,
        };
    }

    private async updateMarketplaceStatus(tenantId: string, marketplace: 'WB' | 'OZON', error?: string | null) {
        try {
            const type = marketplace === 'WB' ? ('WB' as any) : ('OZON' as any);
            const account = await this.prisma.marketplaceAccount.findFirst({
                where: { tenantId, marketplace: type }
            });
            if (account) {
                 await this.prisma.marketplaceAccount.update({
                      where: { id: account.id },
                      data: {
                          lastSyncAt: new Date(),
                          lastSyncStatus: error ? 'ERROR' : 'SUCCESS',
                          lastSyncError: error || null
                      }
                 });
            }
        } catch (e: any) {
            this.logger.error(`Failed to update sync status for store ${tenantId}: ${e.message}`);
        }
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
    async syncProductToMarketplaces(productId: string, tenantId: string) {
        const decision = await this.preflight.runPreflight(tenantId, null, {
            operation: 'product_push',
            checkConcurrency: false,
        });
        if (!decision.allowed) {
            return {
                success: false,
                paused: true,
                reason: decision.reason,
                message: 'Marketplace push blocked by policy',
            };
        }

        const settings = await this.getSettings(tenantId);
        if (!settings) return { success: false, error: 'Settings not configured' };

        const product = await this.prisma.product.findUnique({
            where: { id: productId }
        });
        if (!product || product.tenantId !== tenantId || product.deletedAt) {
            return { success: false, error: 'Product not found or access denied' };
        }

        // available — effective qty в управляемом FBS-контуре. По §15 push
        // должен использовать только StockBalance (isExternal=false), но в MVP
        // StockBalance заполняется лениво при первой adjustment'е, поэтому
        // фоллбек на Product.total - reserved сохраняет совместимость.
        const balances = await this.prisma.stockBalance.findMany({
            where: { tenantId, productId: product.id, isExternal: false },
            select: { available: true },
        });
        const available = balances.length > 0
            ? balances.reduce((s, b) => s + Math.max(0, b.available), 0)
            : Math.max(0, product.total - product.reserved);

        const [wb, ozon] = await Promise.all([
            this.syncToWb(settings, product, available),
            this.syncToOzon(settings, product, available),
        ]);

        return { wb, ozon, amount: available };
    }

    // ─── Pull from WB → update our DB ────────────────────────────────────────────
    async pullFromWb(tenantId: string) {
        const settings = await this.getSettings(tenantId);
        if (!settings?.wbApiKey) return { success: false, error: 'WB API ключ не задан' };
        if (!settings?.wbWarehouseId) return { success: false, error: 'ID склада WB не задан' };

        try {
            // Fetch all our barcodes to check their stock on WB
            const localProducts = await this.prisma.product.findMany({
                where: { tenantId, deletedAt: null, wbBarcode: { not: null } },
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
                where: { tenantId, deletedAt: null, wbBarcode: { not: null } }
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
                    this.logger.log(`[Store ${tenantId}] [Reconcile WB] Mismatch for ${product.sku}: WB=${stock.amount}, App=${currentAvailable}. Adding to push queue.`);
                    wbReconcileQueue.push({ id: product.id, sku: product.sku, wbBarcode: product.wbBarcode, amount: currentAvailable });
                }
            }

            // Push updates back to WB if we have mismatches
            if (wbReconcileQueue.length > 0) {
                await this.syncBatchToWb(settings, wbReconcileQueue);
                updatedCount += wbReconcileQueue.length;
            }

            await this.updateMarketplaceStatus(tenantId, 'WB', null);
            return { success: true, updated: updatedCount, total: wbStocks.length };
        } catch (err) {
            const e = err as AxiosError;
            const errorMsg = e.response?.data ? JSON.stringify(e.response.data) : e.message;
            await this.updateMarketplaceStatus(tenantId, 'WB', errorMsg);
            return { success: false, error: e.message, body: e.response?.data };
        }
    }

    // ─── Fetch WB FBO Stocks ─────────────────────────────────────────────────────
    async pullWbFbo(tenantId: string) {
        const settings = await this.getSettings(tenantId);
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
                where: { tenantId, deletedAt: null, wbBarcode: { not: null } }
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
            this.logger.error(`[Store ${tenantId}] [WB FBO] Error: ${msg}`);
            return { success: false, error: msg };
        }
    }

    // ─── Полная выгрузка всего на Ozon ─────────────────────────────────────────
    async syncAllToOzon(tenantId: string) {
        const settings = await this.getSettings(tenantId);
        if (!settings?.ozonApiKey || !settings?.ozonClientId || !settings?.ozonWarehouseId) return { success: false, error: 'Ozon ключи или склад не настроены' };

        const products = await this.prisma.product.findMany({
            where: { tenantId, deletedAt: null }
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
    async pullFromOzon(tenantId: string) {
        const settings = await this.getSettings(tenantId);
        if (!settings?.ozonApiKey || !settings?.ozonClientId) return { success: false, error: 'Ozon API ключи не заданы' };

        try {
            // 1. Получаем наши товары с SKU
            const products = await this.prisma.product.findMany({
                where: { tenantId, deletedAt: null }
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
                    this.logger.log(`[Store ${tenantId}] [Reconcile Ozon] Mismatch for ${product.sku}: Ozon=${ozonFbsPresent}, App=${currentAvailable}. Adding to push queue.`);
                    ozonReconcileQueue.push({ id: product.id, sku: product.sku, amount: currentAvailable });
                }
            }

            // Push updates back to Ozon if we have mismatches
            if (ozonReconcileQueue.length > 0) {
                await this.syncBatchToOzon(settings, ozonReconcileQueue);
                updatedCount += ozonReconcileQueue.length;
            }

            await this.updateMarketplaceStatus(tenantId, 'OZON', null);
            return { success: true, updated: updatedCount, total: ozonItems.length };
        } catch (err) {
            const e = err as AxiosError;
            const errorMsg = e.response?.data ? JSON.stringify(e.response.data) : e.message;
            await this.updateMarketplaceStatus(tenantId, 'OZON', errorMsg);
            this.logger.error(`[Store ${tenantId}] Ozon Pull Loop error: ${e.message}`);
            return { success: false, error: e.message, body: e.response?.data };
        }
    }

    // ─── Test connections ─────────────────────────────────────────────────────────
    async testWbConnection(tenantId: string) {
        const settings = await this.getSettings(tenantId);
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

    async testOzonConnection(tenantId: string) {
        const settings = await this.getSettings(tenantId);
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
    async fetchWbStocks(tenantId: string) {
        const settings = await this.getSettings(tenantId);
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
    async fetchWbWarehouses(tenantId: string) {
        const settings = await this.getSettings(tenantId);
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
    async processWbOrders(tenantId: string) {
        const settings = await this.getSettings(tenantId);
        if (!settings?.wbApiKey) return;

        // TASK_ORDERS_2: account id для provenance в `Order.marketplaceAccountId`.
        // Если по какой-то причине аккаунт исчез между preflight и сюда — пропускаем
        // dual-write в orders domain, но legacy `MarketplaceOrder` всё равно работает.
        const wbAccount = await this.prisma.marketplaceAccount.findFirst({
            where: { tenantId, marketplace: MarketplaceType.WB, lifecycleStatus: 'ACTIVE' },
            select: { id: true },
        });

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
                    where: { marketplaceOrderId: orderId, tenantId }
                });
                if (existing) continue;

                const barcode = order.skus?.[0];
                const article = order.article;

                let product = null;
                if (barcode) {
                    product = await this.prisma.product.findFirst({
                        where: { wbBarcode: barcode, tenantId }
                    });
                }

                // Fallback: ищем по нашему внутреннему артикулу (SKU)
                if (!product && article) {
                    product = await this.prisma.product.findFirst({
                        where: { sku: article, tenantId }
                    });

                    // (Auto-heal) Если нашли товар по артикулу, но у него еще не был прописан wbBarcode, пропишем!
                    if (product && barcode && !product.wbBarcode) {
                        await this.prisma.product.update({
                            where: { id: product.id },
                            data: { wbBarcode: barcode }
                        });
                        this.logger.log(`[Store ${tenantId}] [WB Auto-Heal] Привязан баркод ${barcode} к артикулу ${product.sku}`);
                        product.wbBarcode = barcode;
                    }
                }

                if (!product) {
                    this.logger.warn(`[Store ${tenantId}] [WB Order] Товар с баркодом ${barcode} или артикулом ${article} не найден. Пропуск.`);
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
                        actorUserId: 'system-wb',
                        note: `Заказ WB #${orderId}`,
                        beforeTotal: product.total,
                        afterTotal: product.total - qty,
                        tenantId: tenantId
                    }
                });

                // 3. Запоминаем заказ (legacy)
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
                        tenantId: tenantId
                    }
                });

                // 3b. TASK_ORDERS_2: dual-write в новый orders domain.
                // external_event_id для нового заказа стабилен в рамках
                // /orders/new feed: пока заказ не сменил статус, WB
                // возвращает тот же id. Используем `wb_<id>@new` как
                // ключ идемпотентности.
                if (wbAccount) {
                    const occurredAt = order.createdAt ? new Date(order.createdAt) : new Date();
                    const result = await this.ordersIngestion.ingest({
                        tenantId,
                        marketplaceAccountId: wbAccount.id,
                        marketplace: MarketplaceType.WB,
                        marketplaceOrderId: orderId,
                        externalEventId: `wb_${orderId}@new`,
                        externalStatus: 'new',
                        fulfillmentMode: OrderFulfillmentMode.FBS,
                        occurredAt,
                        orderCreatedAt: occurredAt,
                        items: [{
                            productId: product.id,
                            sku: product.sku,
                            name: product.name,
                            quantity: qty,
                            price: order.price ? order.price / 100 : null,
                        }],
                        payload: { rawOrderId: orderId },
                    });
                    if (result.outcome === 'BLOCKED_BY_POLICY' || result.outcome === 'FAILED') {
                        this.logger.warn(
                            `[Store ${tenantId}] [WB Order] orders-domain ingest result=${result.outcome}`,
                        );
                    }
                }

                this.logger.log(`[Store ${tenantId}] [WB Order] Processed #${orderId}, SKU: ${product.sku}, Qty: ${qty}`);

                // 4. Сразу пушим новый остаток
                await this.syncProductToMarketplaces(product.id, tenantId);
            }
        } catch (e: any) {
            this.logger.error(`[Store ${tenantId}] [WB Orders] Error: ${e.message}`);
        }
    }

    async processOzonOrders(tenantId: string) {
        const settings = await this.getSettings(tenantId);
        if (!settings?.ozonApiKey || !settings?.ozonClientId) return;

        // TASK_ORDERS_2: account для provenance в orders domain.
        const ozonAccount = await this.prisma.marketplaceAccount.findFirst({
            where: { tenantId, marketplace: MarketplaceType.OZON, lifecycleStatus: 'ACTIVE' },
            select: { id: true },
        });

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

                // TASK_ORDERS_2: подготовим input для orders-domain ingestion.
                // external_event_id привязан к статусу posting'а: для одного
                // и того же статуса повторная доставка дедуплицируется по
                // UNIQUE на OrderEvent. Смена статуса даст новый event id.
                const ingestItems = (posting.products ?? []).map((p: any) => ({
                    sku: p.offer_id,
                    name: p.name,
                    quantity: p.quantity,
                    price: p.price ? parseFloat(p.price) : null,
                }));

                const existing = await this.prisma.marketplaceOrder.findFirst({
                    where: { marketplaceOrderId: postingNumber, tenantId }
                });

                if (existing) {
                    const newStatus = posting.status?.toLowerCase();
                    const oldStatus = existing.status?.toLowerCase();

                    if (newStatus && oldStatus !== newStatus) {
                        await this.prisma.marketplaceOrder.update({
                            where: { id: existing.id },
                            data: { status: posting.status }
                        });

                        // TASK_ORDERS_2: dual-write status_changed в orders domain.
                        // Идемпотентность: external_event_id привязан к новому
                        // статусу — повторная доставка того же status_change
                        // отбьётся UNIQUE и станет DUPLICATE_IGNORED.
                        if (ozonAccount) {
                            await this.ordersIngestion.ingest({
                                tenantId,
                                marketplaceAccountId: ozonAccount.id,
                                marketplace: MarketplaceType.OZON,
                                marketplaceOrderId: postingNumber,
                                externalEventId: `ozon_${postingNumber}@${posting.status}`,
                                externalStatus: posting.status,
                                fulfillmentMode: OrderFulfillmentMode.FBS,
                                occurredAt: posting.in_process_at ? new Date(posting.in_process_at) : new Date(),
                                items: ingestItems,
                                payload: { rawStatus: posting.status, posting_number: postingNumber },
                            });
                        }

                        if (newStatus === 'cancelled' && oldStatus !== 'cancelled') {
                            for (const item of posting.products) {
                                const product = await this.prisma.product.findFirst({
                                    where: { sku: item.offer_id, tenantId }
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
                                            actorUserId: 'system-ozon',
                                            note: `Возврат: Отмена Ozon #${postingNumber}`,
                                            beforeTotal: product.total,
                                            afterTotal: product.total + qty,
                                            tenantId: tenantId
                                        }
                                    });
                                    this.logger.log(`[Store ${tenantId}] [Ozon Cancel] Refunded #${postingNumber}, ${product.sku}, +${qty}`);
                                    await this.syncProductToMarketplaces(product.id, tenantId);
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
                        where: { sku: item.offer_id, tenantId }
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
                            actorUserId: 'system-ozon',
                            note: `Заказ Ozon #${postingNumber}`,
                            beforeTotal: product.total,
                            afterTotal: product.total - qty,
                            tenantId: tenantId
                        }
                    });

                    this.logger.log(`[Store ${tenantId}] [Ozon Order] Processed #${postingNumber}, ${product.sku}, -${qty}`);
                }

                // Запоминаем отправление (legacy)
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
                        tenantId: tenantId
                    }
                });

                // TASK_ORDERS_2: dual-write новой инкарнации заказа в orders domain.
                // Сматчиваем productId на каталог тут же, чтобы matchStatus
                // выставился MATCHED для тех строк, где SKU нашёлся.
                if (ozonAccount) {
                    const matchedItems = await Promise.all(
                        ingestItems.map(async (it: any) => {
                            const p = it.sku
                                ? await this.prisma.product.findFirst({
                                      where: { tenantId, sku: it.sku },
                                      select: { id: true },
                                  })
                                : null;
                            return { ...it, productId: p?.id ?? null };
                        }),
                    );
                    await this.ordersIngestion.ingest({
                        tenantId,
                        marketplaceAccountId: ozonAccount.id,
                        marketplace: MarketplaceType.OZON,
                        marketplaceOrderId: postingNumber,
                        externalEventId: `ozon_${postingNumber}@${posting.status}`,
                        externalStatus: posting.status,
                        fulfillmentMode: OrderFulfillmentMode.FBS,
                        occurredAt: posting.in_process_at ? new Date(posting.in_process_at) : new Date(),
                        orderCreatedAt: posting.in_process_at ? new Date(posting.in_process_at) : null,
                        items: matchedItems,
                        payload: { rawStatus: posting.status, posting_number: postingNumber },
                    });
                }

                // Пушим обновления
                for (const item of posting.products) {
                    const p = await this.prisma.product.findFirst({
                        where: { sku: item.offer_id, tenantId }
                    });
                    if (p) await this.syncProductToMarketplaces(p.id, tenantId);
                }
            }
        } catch (e: any) {
            this.logger.error(`[Store ${tenantId}] [Ozon Orders] Error: ${e.message}`);
        }
    }

    async syncProductMetadata(tenantId: string, updatePhotos: boolean = true) {
        const settings = await this.getSettings(tenantId);
        if (!settings) {
            this.logger.error(`[Store ${tenantId}] No settings found for metadata sync`);
            return { success: false, error: 'Settings not configured' };
        }

        const products = await this.prisma.product.findMany({
            where: { tenantId, deletedAt: null }
        });

        this.logger.log(`[Store ${tenantId}] Metadata Sync START. Products: ${products.length}. WB Key: ${!!settings.wbApiKey}, Ozon Key: ${!!settings.ozonApiKey}`);
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
                this.logger.log(`[Store ${tenantId}] [WB] Requesting cards/list (v2) with cursor...`);
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
                this.logger.log(`[Store ${tenantId}] [WB] Received ${cards.length} cards.`);

                if (cards.length === 0) {
                    this.logger.warn(`[Store ${tenantId}] [WB] 0 cards returned. Check API Key permissions or product availability. Total: ${res.data?.cursor?.total}`);
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

                    this.logger.log(`[Store ${tenantId}] [WB COMPARE] ${product.sku} DB="${product.photo}" API="${photoUrl}"`);

                    const updates: any = {};
                    if (card.title && product.name !== card.title && (!product.name || product.name.length < 5)) {
                        updates.name = card.title;
                    }

                    if (updatePhotos && photoUrl && product.photo !== photoUrl) {
                        this.logger.log(`[Store ${tenantId}] [WB] Updating photo ${product.sku} -> ${photoUrl}`);
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
                await this.updateMarketplaceStatus(tenantId, 'WB', null);
            } catch (e: any) {
                const errorData = e.response?.data ? JSON.stringify(e.response.data) : e.message;
                this.logger.error(`[Store ${tenantId}] [WB Metadata] Error: ${errorData}`);
                await this.updateMarketplaceStatus(tenantId, 'WB', errorData);
            }
        }

        // 2. Ozon Metadata
        if (settings.ozonApiKey && settings.ozonClientId) {
            try {
                const skus = products.map(p => p.sku).filter(Boolean);
                this.logger.log(`[Store ${tenantId}] [Ozon] Preparing request for ${skus.length} SKUs`);

                if (skus.length > 0) {
                    const res = await axios.post('https://api-seller.ozon.ru/v3/product/info/list', {
                        offer_id: skus
                    }, {
                        headers: { 'Client-Id': settings.ozonClientId, 'Api-Key': settings.ozonApiKey },
                        timeout: 25_000
                    });

                    const items = res.data?.result?.items ?? res.data?.items ?? [];
                    this.logger.log(`[Store ${tenantId}] [Ozon] Received ${items.length} items from API`);

                    for (const item of items) {
                        this.logger.log(`[Store ${tenantId}] [Ozon ITEM] ${item.offer_id}: ${JSON.stringify(item)}`);

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
                        this.logger.log(`[Store ${tenantId}] [Ozon COMPARE] ${product.sku} DB="${product.photo}" API="${photoUrl}"`);

                        const updates: any = {};
                        if (item.name && product.name !== item.name && (!product.name || product.name.length < 5)) {
                            updates.name = item.name;
                        }

                        if (updatePhotos && photoUrl && product.photo !== photoUrl) {
                            this.logger.log(`[Store ${tenantId}] [Ozon] Updating photo ${product.sku} -> ${photoUrl}`);
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
                    await this.updateMarketplaceStatus(tenantId, 'OZON', null);
                }
            } catch (e: any) {
                const errorData = e.response?.data ? JSON.stringify(e.response.data) : e.message;
                this.logger.error(`[Store ${tenantId}] [Ozon Metadata] Error: ${errorData}`);
                await this.updateMarketplaceStatus(tenantId, 'OZON', errorData);
            }
        }

        this.logger.log(`[Store ${tenantId}] Metadata Sync FINISHED. Updated: ${updatedCount}`);
        return { success: true, updated: updatedCount };
    }

    // ─── Order Details Fetching ──────────────────────────────────────────
    async forcePollOrders(tenantId: string) {
        try {
            await this.processWbOrders(tenantId);
            await this.processOzonOrders(tenantId);
            return { success: true };
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    async getMarketplaceOrders(tenantId: string, query: any) {
        const { page = 1, limit = 20, status, dateFrom, dateTo, marketplace } = query;
        const pageNumber = parseInt(page as string, 10);
        const limitNumber = parseInt(limit as string, 10);
        const skip = (pageNumber - 1) * limitNumber;

        const where: any = { tenantId };
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

    async getOrderDetails(orderId: string, tenantId: string) {
        const order = await this.prisma.marketplaceOrder.findFirst({
            where: { id: orderId, tenantId }
        });

        if (!order) return { success: false, error: 'Заказ не найден' };

        const settings = await this.getSettings(tenantId);

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
                this.logger.error(`[Store ${tenantId}] [Ozon Details] Error: ${err.message}`);
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
                this.logger.error(`[Store ${tenantId}] [WB Details] Error: ${err.message}`);
                return { success: false, error: 'Ошибка получения данных WB' };
            }
        }

        return { success: false, error: 'API ключи маркетплейса не настроены' };
    }

    async pullHistoryFromWb(tenantId: string, days: number = 30) {
        const settings = await this.getSettings(tenantId);
        if (!settings?.wbApiKey) return;
        this.logger.log(`[Store ${tenantId}] Pulling WB history (last ${days} days)`);

        try {
            // Simplified: Pulling orders (marketplace-api doesn't give deep history easily without statistics-api)
            // But we'll at least run the standard process which gets 'new' orders.
            await this.processWbOrders(tenantId);
        } catch (e: any) {
            this.logger.error(`[Store ${tenantId}] WB History Pull Failed: ${e.message}`);
        }
    }

    async pullHistoryFromOzon(tenantId: string, days: number = 30) {
        const settings = await this.getSettings(tenantId);
        if (!settings?.ozonApiKey || !settings?.ozonClientId) return;

        try {
            const now = new Date();
            const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

            const res = await axios.post('https://api-seller.ozon.ru/v3/posting/fbs/list', {
                filter: { since: since.toISOString(), to: now.toISOString() },
                dir: 'DESC', limit: 100, with: { analytics_data: true }
            }, {
                headers: { 'Client-Id': settings.ozonClientId, 'Api-Key': settings.ozonApiKey },
                timeout: 30_000,
            });

            const postings = res.data?.result?.postings ?? [];
            for (const posting of postings) {
                const exists = await this.prisma.marketplaceOrder.findFirst({
                    where: { marketplaceOrderId: posting.posting_number, tenantId }
                });

                if (!exists) {
                    await this.prisma.marketplaceOrder.create({
                        data: {
                            marketplaceOrderId: posting.posting_number,
                            marketplace: 'OZON',
                            productSku: posting.products[0]?.offer_id,
                            productNames: posting.products.map((p: any) => p.name).join(', '),
                            quantity: posting.products.reduce((acc: number, p: any) => acc + p.quantity, 0),
                            status: posting.status,
                            totalAmount: posting.products.reduce((acc: number, p: any) => acc + (parseFloat(p.price) * p.quantity), 0),
                            marketplaceCreatedAt: posting.in_process_at ? new Date(posting.in_process_at) : new Date(),
                            tenantId
                        }
                    });
                }
            }
        } catch (e: any) {
            this.logger.error(`[Store ${tenantId}] Ozon History Pull Failed: ${e.message}`);
        }
    }

    async importProductsFromWb(tenantId: string) {
        const settings = await this.getSettings(tenantId);
        if (!settings?.wbApiKey) return;

        this.logger.log(`[Store ${tenantId}] Importing products from WB...`);
        try {
            const res = await axios.post('https://content-api.wildberries.ru/content/v2/get/cards/list', {
                settings: { cursor: { limit: 100 }, filter: { withPhoto: -1 } }
            }, {
                headers: { Authorization: settings.wbApiKey },
                timeout: 30_000
            });

            const cards = res.data?.cards || [];
            for (const card of cards) {
                const sku = card.vendorCode?.toString();
                if (!sku) continue;

                const existing = await this.prisma.product.findFirst({
                    where: { sku, tenantId }
                });

                if (!existing) {
                    await this.prisma.product.create({
                        data: {
                            sku,
                            name: card.title || sku,
                            tenantId,
                            total: 0,
                            reserved: 0,
                            wbBarcode: card.sizes?.[0]?.skus?.[0]?.toString() || null,
                            category: card.subjectName || null,
                            width: card.dimensions?.width || null,
                            height: card.dimensions?.height || null,
                            length: card.dimensions?.length || null,
                        }
                    });
                } else {
                    // Update existing with metadata if missing
                    await this.prisma.product.update({
                        where: { id: existing.id },
                        data: {
                            deletedAt: null,
                            category: existing.category || card.subjectName || null,
                            width: existing.width || card.dimensions?.width || null,
                            height: existing.height || card.dimensions?.height || null,
                            length: existing.length || card.dimensions?.length || null,
                        }
                    });
                }
            }
            await this.updateMarketplaceStatus(tenantId, 'WB', null);
        } catch (e: any) {
            const err = e.response?.data ? JSON.stringify(e.response.data) : e.message;
            this.logger.error(`[Store ${tenantId}] WB Product Import Failed: ${err}`);
            await this.updateMarketplaceStatus(tenantId, 'WB', err);
        }
    }

    async importProductsFromOzon(tenantId: string) {
        const settings = await this.getSettings(tenantId);
        if (!settings?.ozonApiKey || !settings?.ozonClientId) return;

        this.logger.log(`[Store ${tenantId}] Importing products from Ozon...`);
        try {
            const res = await axios.post('https://api-seller.ozon.ru/v2/product/list', {
                limit: 1000
            }, {
                headers: { 'Client-Id': settings.ozonClientId, 'Api-Key': settings.ozonApiKey },
                timeout: 30_000
            });

            const items = res.data?.result?.items || [];
            const productIds = items.map((i: any) => i.product_id);

            if (productIds.length > 0) {
                const infoRes = await axios.post('https://api-seller.ozon.ru/v2/product/info/list', {
                    product_id: productIds
                }, {
                    headers: { 'Client-Id': settings.ozonClientId, 'Api-Key': settings.ozonApiKey },
                    timeout: 30_000
                });

                const details = infoRes.data?.result?.items || [];
                for (const item of details) {
                    const sku = item.offer_id?.toString();
                    if (!sku) continue;

                    const existing = await this.prisma.product.findFirst({
                        where: { sku, tenantId }
                    });

                    if (!existing) {
                        await this.prisma.product.create({
                            data: {
                                sku,
                                name: item.name || sku,
                                tenantId,
                                total: 0,
                                reserved: 0,
                                category: item.category_id?.toString() || null,
                                width: item.width || null,
                                height: item.height || null,
                                length: item.depth || null,
                                weight: item.weight || null,
                            }
                        });
                    } else {
                        await this.prisma.product.update({
                            where: { id: existing.id },
                            data: {
                                deletedAt: null,
                                category: existing.category || item.category_id?.toString() || null,
                                width: existing.width || item.width || null,
                                height: existing.height || item.height || null,
                                length: existing.length || item.depth || null,
                                weight: existing.weight || item.weight || null,
                            }
                        });
                    }
                }
            }
            await this.updateMarketplaceStatus(tenantId, 'OZON', null);
        } catch (e: any) {
            const err = e.response?.data ? JSON.stringify(e.response.data) : e.message;
            this.logger.error(`[Store ${tenantId}] Ozon Product Import Failed: ${err}`);
            await this.updateMarketplaceStatus(tenantId, 'OZON', err);
        }
    }
}
