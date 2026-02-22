import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:4173'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// ─── Health check ─────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── GET /api/products ────────────────────────────────────────
// Возвращает список всех товаров
app.get('/api/products', async (req, res) => {
    try {
        const products = await prisma.product.findMany({
            orderBy: { id: 'asc' },
        });
        res.json(products);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка получения товаров' });
    }
});

// ─── GET /api/products/:id ────────────────────────────────────
app.get('/api/products/:id', async (req, res) => {
    const id = Number(req.params.id);
    try {
        const product = await prisma.product.findUnique({ where: { id } });
        if (!product) return res.status(404).json({ error: 'Товар не найден' });
        res.json(product);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка получения товара' });
    }
});

// ─── POST /api/products ───────────────────────────────────────
// Создаёт новый товар
app.post('/api/products', async (req, res) => {
    const { sku, barcode, name, stock_wb = 0, stock_ozon = 0 } = req.body;

    if (!sku || !name) {
        return res.status(400).json({ error: 'Поля sku и name обязательны' });
    }

    try {
        const product = await prisma.product.create({
            data: { sku, barcode, name, stock_wb, stock_ozon },
        });
        res.status(201).json(product);
    } catch (err) {
        if (err.code === 'P2002') {
            return res.status(409).json({ error: 'Товар с таким SKU уже существует' });
        }
        console.error(err);
        res.status(500).json({ error: 'Ошибка создания товара' });
    }
});

// ─── PUT /api/products/:id ────────────────────────────────────
// Обновляет данные или остатки товара
app.put('/api/products/:id', async (req, res) => {
    const id = Number(req.params.id);
    const { sku, barcode, name, stock_wb, stock_ozon } = req.body;

    const data = {};
    if (sku !== undefined) data.sku = sku;
    if (barcode !== undefined) data.barcode = barcode;
    if (name !== undefined) data.name = name;
    if (stock_wb !== undefined) data.stock_wb = Number(stock_wb);
    if (stock_ozon !== undefined) data.stock_ozon = Number(stock_ozon);

    if (Object.keys(data).length === 0) {
        return res.status(400).json({ error: 'Нет полей для обновления' });
    }

    try {
        const product = await prisma.product.update({ where: { id }, data });
        res.json(product);
    } catch (err) {
        if (err.code === 'P2025') {
            return res.status(404).json({ error: 'Товар не найден' });
        }
        console.error(err);
        res.status(500).json({ error: 'Ошибка обновления товара' });
    }
});

// ─── PUT /api/products/:id/stock ─────────────────────────────
// Удобный эндпоинт только для обновления остатков
app.put('/api/products/:id/stock', async (req, res) => {
    const id = Number(req.params.id);
    const { stock_wb, stock_ozon } = req.body;

    const data = {};
    if (stock_wb !== undefined) data.stock_wb = Number(stock_wb);
    if (stock_ozon !== undefined) data.stock_ozon = Number(stock_ozon);

    try {
        const product = await prisma.product.update({ where: { id }, data });
        res.json(product);
    } catch (err) {
        if (err.code === 'P2025') {
            return res.status(404).json({ error: 'Товар не найден' });
        }
        console.error(err);
        res.status(500).json({ error: 'Ошибка обновления остатков' });
    }
});

// ─── Start server ─────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`✅ Backend запущен: http://localhost:${PORT}`);
});
