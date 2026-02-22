/**
 * server.js — основной файл бэкенда Skladoptima
 * Стек: Express + Prisma ORM + SQLite
 * Порт: 3000
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { updateWbStock, updateOzonStock } = require('./services/marketplace.service');
const { runSync } = require('./services/sync.service');
const cron = require('node-cron');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'skladoptima_secret_key_2024';

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:4173'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'store-id'],
}));
app.use(express.json());

// Auth Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// ─── Auth API ─────────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
    const { email, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
            data: { email, password: hashedPassword }
        });
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
        res.status(201).json({ token, user: { id: user.id, email: user.email } });
    } catch (err) {
        console.error('[AUTH REGISTER ERROR]', err);
        res.status(400).json({ error: 'Email already exists or error occurs' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user: { id: user.id, email: user.email } });
    } catch (err) {
        console.error('[AUTH LOGIN ERROR]', err);
        res.status(500).json({ error: 'Server error during login' });
    }
});

// ─── Store API ────────────────────────────────────────────────────────────────

app.get('/api/stores', authenticateToken, async (req, res) => {
    const stores = await prisma.store.findMany({ where: { userId: req.user.id } });
    res.json(stores);
});

app.post('/api/stores', authenticateToken, async (req, res) => {
    const {
        name,
        wbToken, wbWarehouseId,
        ozonClientId, ozonApiKey, ozonWarehouseId
    } = req.body;

    try {
        const store = await prisma.store.create({
            data: {
                name,
                wbToken: wbToken || null,
                wbWarehouseId: wbWarehouseId || null,
                ozonClientId: ozonClientId || null,
                ozonApiKey: ozonApiKey || null,
                ozonWarehouseId: ozonWarehouseId || null,
                userId: req.user.id
            }
        });
        res.status(201).json(store);
    } catch (err) {
        console.error('[POST /api/stores]', err);
        res.status(400).json({ error: 'Error creating store' });
    }
});

app.delete('/api/stores/:id', authenticateToken, async (req, res) => {
    try {
        await prisma.store.delete({
            where: { id: req.params.id, userId: req.user.id }
        });
        res.status(204).send();
    } catch (err) {
        res.status(400).json({ error: 'Error deleting store' });
    }
});

app.put('/api/stores/:id', authenticateToken, async (req, res) => {
    const {
        name,
        wbToken, wbWarehouseId,
        ozonClientId, ozonApiKey, ozonWarehouseId
    } = req.body;

    try {
        const store = await prisma.store.update({
            where: { id: req.params.id, userId: req.user.id },
            data: {
                name,
                wbToken: wbToken || null,
                wbWarehouseId: wbWarehouseId || null,
                ozonClientId: ozonClientId || null,
                ozonApiKey: ozonApiKey || null,
                ozonWarehouseId: ozonWarehouseId || null
            }
        });
        res.json(store);
    } catch (err) {
        console.error('[PUT /api/stores/:id]', err);
        res.status(400).json({ error: 'Error updating store' });
    }
});

// ─── Настройки (Settings) ─────────────────────────────────────────────────────

app.get('/api/settings', async (req, res) => {
    try {
        const settings = await prisma.settings.findUnique({ where: { id: 'global' } });
        res.json(settings || {});
    } catch (err) {
        res.status(500).json({ error: 'Ошибка получения настроек' });
    }
});

app.post('/api/settings', async (req, res) => {
    try {
        const settings = await prisma.settings.upsert({
            where: { id: 'global' },
            update: req.body,
            create: { id: 'global', ...req.body },
        });
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сохранения настроек' });
    }
});

// ─── Health-check ─────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── GET /api/products ────────────────────────────────────────────────────────

app.get('/api/products', authenticateToken, async (req, res) => {
    const storeId = req.headers['store-id'];
    if (!storeId) return res.json([]);

    try {
        const products = await prisma.product.findMany({
            where: { storeId },
            orderBy: { name: 'asc' }
        });
        res.json(products);
    } catch (err) {
        console.error('[GET /api/products]', err.message);
        res.status(500).json({ error: 'Ошибка получения списка товаров' });
    }
});

// ─── POST /api/products ───────────────────────────────────────────────────────
/**
 * Принимает массив товаров, сохраняет через upsert по sku.
 */
app.post('/api/products', authenticateToken, async (req, res) => {
    const storeId = req.headers['store-id'];
    if (!storeId) return res.status(400).json({ error: 'store-id header required' });

    const items = req.body;
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Ожидается непустой массив товаров' });
    }

    try {
        const results = await Promise.all(
            items.map((item) =>
                prisma.product.upsert({
                    where: { sku_storeId: { sku: item.sku, storeId } },
                    update: {
                        barcode: item.barcode ?? undefined,
                        name: item.name,
                        stock_master: item.stock_master !== undefined ? Number(item.stock_master) : undefined,
                        stock_wb: item.stock_wb !== undefined ? Number(item.stock_wb) : undefined,
                        stock_ozon: item.stock_ozon !== undefined ? Number(item.stock_ozon) : undefined,
                    },
                    create: {
                        sku: item.sku,
                        barcode: item.barcode ?? null,
                        name: item.name,
                        stock_master: Number(item.stock_master) || 0,
                        stock_wb: Number(item.stock_wb) || 0,
                        stock_ozon: Number(item.stock_ozon) || 0,
                        storeId,
                    },
                })
            )
        );
        res.status(200).json({ message: `Обработано: ${results.length}`, data: results });
    } catch (err) {
        console.error('[POST /api/products]', err.message);
        res.status(500).json({ error: 'Ошибка сохранения товаров' });
    }
});

// ─── PUT /api/products/:sku ───────────────────────────────────────────────────
/**
 * Обновляет остатки.
 * Body: {
 *   stock_master: number,
 *   keys?: {
 *     wbToken: string, wbWarehouseId: string,
 *     ozonClientId: string, ozonApiKey: string
 *   }
 * }
 *
 * Логика:
 * 1. Сохранить stock_master в БД
 * 2. Если переданы ключи — отправить остатки в WB и Ozon параллельно
 * 3. Если маркетплейс ответил успешно — обновить stock_wb / stock_ozon в БД
 */
app.put('/api/products/:sku', authenticateToken, async (req, res) => {
    const { sku } = req.params;
    const storeId = req.headers['store-id'];
    const { stock_master, stock_wb, stock_ozon } = req.body;

    if (!storeId) return res.status(400).json({ error: 'store-id header required' });

    // Собираем поля для локального обновления
    const localData = {};
    if (stock_master !== undefined) localData.stock_master = Number(stock_master);
    if (stock_wb !== undefined) localData.stock_wb = Number(stock_wb);
    if (stock_ozon !== undefined) localData.stock_ozon = Number(stock_ozon);

    try {
        // 0. Находим товар и магазин
        const existing = await prisma.product.findUnique({
            where: { sku_storeId: { sku, storeId } },
            include: { store: true }
        });

        if (!existing) {
            return res.status(404).json({ error: `Товар с SKU "${sku}" не найден в этом магазине` });
        }

        // 1. Сохраняем в локальную БД
        let product = await prisma.product.update({
            where: { sku_storeId: { sku, storeId } },
            data: localData
        });

        // 2. Синхронизируем маркетплейсы через данные магазина
        if (stock_master !== undefined) {
            const amount = Number(stock_master);
            const marketplaceUpdates = {};
            const store = existing.store;

            let wbPromise = Promise.resolve({ success: false, skip: true });
            let ozonPromise = Promise.resolve({ success: false, skip: true });

            // WB Sync
            if (store.wbToken && store.wbWarehouseId) {
                if (!existing.barcode) {
                    console.warn(`[WB] ⚠️ SKU="${sku}" — нет штрихкода`);
                } else {
                    wbPromise = updateWbStock(existing.barcode, amount, store.wbToken, store.wbWarehouseId);
                }
            }

            // Ozon Sync
            if (store.ozonClientId && store.ozonApiKey && store.ozonWarehouseId) {
                ozonPromise = updateOzonStock(sku, amount, store.ozonClientId, store.ozonApiKey, store.ozonWarehouseId);
            }

            const [wbResult, ozonResult] = await Promise.all([wbPromise, ozonPromise]);

            if (wbResult.success) marketplaceUpdates.stock_wb = amount;
            if (ozonResult.success) marketplaceUpdates.stock_ozon = amount;

            if (Object.keys(marketplaceUpdates).length > 0) {
                product = await prisma.product.update({
                    where: { sku_storeId: { sku, storeId } },
                    data: marketplaceUpdates
                });
            }

            product._marketplaces = {
                wb: wbResult.skip ? 'skipped' : wbResult.success ? 'ok' : 'error',
                ozon: ozonResult.skip ? 'skipped' : ozonResult.success ? 'ok' : 'error',
            };
        }

        res.json(product);
    } catch (err) {
        console.error('[PUT /api/products/:sku]', err.message);
        res.status(500).json({ error: 'Ошибка обновления остатков' });
    }
});

// ─── Фоновая синхронизация (каждые 30 секунд) ──────────────────────────────────
setInterval(runSync, 30000);

// ─── Раздача статики ─────────────────────────────────────────────────────────

// Если фронтенд собран, отдаем его
app.use(express.static(path.join(__dirname, '../dist')));

// SPA fallback: любой маршрут, не попавший в API, отдает index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
});

// ─── Запуск сервера ───────────────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`✅ Backend запущен: http://localhost:${PORT}`);
    console.log(`   Health-check:    http://localhost:${PORT}/health`);
    console.log(`   Products API:    http://localhost:${PORT}/api/products`);
});
