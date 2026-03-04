# API Reference — Sklad Optima

> **Фреймворк:** NestJS 11  
> **Глобальный prefix:** `/api`  
> **Аутентификация:** JWT в httpOnly cookie (глобальный guard, `@Public()` для открытых)  
> **Валидация:** `ValidationPipe` с `whitelist: true`, `forbidNonWhitelisted: true`

---

## Auth Controller — `apps/api/src/auth/auth.controller.ts`

### `POST /api/auth/login` 🔓 Public

Вход в систему. Устанавливает JWT cookie.

**Body (JSON):**
```json
{
  "email": "admin@sklad.ru",
  "password": "admin777"
}
```

**Response 200:**
```json
{
  "message": "Logged in successfully",
  "user": { "id": "uuid", "email": "admin@sklad.ru", "createdAt": "..." }
}
```

**Cookie установлен:**
- `Authentication` = JWT token
- `httpOnly: true`, `secure: true` (only prod), `sameSite: strict` (prod) / `lax` (dev)
- `maxAge: 7 дней`

**Response 401:** `Invalid email or password`

---

### `POST /api/auth/logout` 🔓 Public

Очистка cookie.

**Response 200:**
```json
{ "message": "Logged out successfully" }
```

---

### `GET /api/auth/me` 🔒 JWT

Текущий пользователь.

**Response 200:**
```json
{ "id": "uuid", "email": "admin@sklad.ru" }
```

---

## Product Controller — `apps/api/src/product/product.controller.ts`

### `GET /api/products` 🔒 JWT

Список товаров с пагинацией и поиском.

**Query params:**
| Параметр | Тип | Default | Описание |
|----------|-----|---------|----------|
| `page` | number | 1 | Номер страницы |
| `limit` | number | 20 | Элементов на странице |
| `search` | string | — | Поиск по `name` и `sku` (ILIKE) |

**Response 200:**
```json
{
  "data": [
    {
      "id": "uuid",
      "sku": "ART-001",
      "name": "Товар",
      "photo": "/uploads/123.jpg",
      "total": 50,
      "reserved": 5,
      "available": 45,
      "wbBarcode": "2043309181375",
      "ozonFbs": 10, "ozonFbo": 0,
      "wbFbs": 10, "wbFbo": 0,
      "createdAt": "...", "updatedAt": "..."
    }
  ],
  "meta": { "total": 100, "page": 1, "lastPage": 5 }
}
```

---

### `GET /api/products/:id` 🔒 JWT

Один товар по ID.

**Response 200:** Объект товара + `available`  
**Response 404:** `Product not found`

---

### `POST /api/products` 🔒 JWT

Создание товара. **multipart/form-data** (для загрузки фото).

**Form fields:**
| Поле | Тип | Обязательно | Описание |
|------|-----|------------|----------|
| `name` | string | ✅ | Название товара |
| `sku` | string | ✅ | Артикул (уникальный) |
| `wbBarcode` | string | — | WB штрихкод |
| `initialTotal` | string (number) | — | Начальный остаток (default: "0") |
| `photo` | File | — | Изображение товара |

**Response 201:** Созданный товар  
**Response 400:** `SKU already exists`

---

### `PUT /api/products/:id` 🔒 JWT

Обновление товара. **multipart/form-data**.

**Form fields:**
| Поле | Тип | Описание |
|------|-----|----------|
| `name` | string | Новое название |
| `sku` | string | Новый артикул |
| `wbBarcode` | string | WB штрихкод |
| `ozonFbs` | number | Ручной FBS Ozon |
| `ozonFbo` | number | Ручной FBO Ozon |
| `wbFbs` | number | Ручной FBS WB |
| `wbFbo` | number | Ручной FBO WB |
| `photo` | File | Новое изображение |

**Response 200:** Обновлённый товар

---

### `DELETE /api/products/:id` 🔒 JWT

Soft-delete (ставит `deletedAt`).

**Response 200:**
```json
{ "message": "Product deleted successfully" }
```

---

### `POST /api/products/:id/stock-adjust` 🔒 JWT

Корректировка остатка.

**Body:**
```json
{
  "delta": -5,
  "note": "Ручная корректировка"
}
```

**DTO валидация** (`AdjustStockDto`):
- `delta`: IsNumber, IsNotEmpty
- `note`: IsString, IsOptional

**Response 200:** Обновлённый товар  
**Response 400:** `Total stock cannot be negative`

---

### `POST /api/products/import` 🔒 JWT

Массовый импорт товаров (из WB Excel).

**Body:**
```json
{
  "items": [
    { "sku": "ART-001", "name": "Товар 1", "wbBarcode": "123456" },
    { "sku": "ART-002", "name": "Товар 2" }
  ]
}
```

**Response 200:**
```json
{ "success": true, "created": 1, "updated": 1 }
```

---

## Audit Controller — `apps/api/src/audit/audit.controller.ts`

### `GET /api/audit` 🔒 JWT

Журнал действий с фильтрацией.

**Query params:**
| Параметр | Тип | Default | Описание |
|----------|-----|---------|----------|
| `page` | number | 1 | Страница |
| `limit` | number | 20 | Размер |
| `actionType` | ActionType enum | — | Фильтр типа |
| `search` | string | — | Поиск по SKU |

**Response 200:** То же, что products — `{ data: [...], meta: { total, page, lastPage } }`

---

## Sync Controller — `apps/api/src/sync/sync.controller.ts`

### `POST /api/sync/product/:id` 🔒 JWT

Push остатка товара на WB и Ozon.

**Response 200:**
```json
{
  "wb": { "success": true },
  "ozon": { "success": true },
  "amount": 45
}
```

---

### `POST /api/sync/test/wb` 🔒 JWT
Тест подключения к WB API.

### `POST /api/sync/test/ozon` 🔒 JWT
Тест подключения к Ozon API.

### `POST /api/sync/pull/wb` 🔒 JWT
Ручной pull остатков со склада WB.

### `POST /api/sync/metadata` 🔒 JWT
Обновить фото/названия из карточек маркетплейсов.

### `GET /api/sync/orders` 🔒 JWT
Список обработанных заказов (последние 100, отсортированы по дате).

### `GET /api/sync/wb/stocks` 🔒 JWT
Debug: текущие остатки на складе WB.

### `GET /api/sync/wb/warehouses` 🔒 JWT
Debug: список складов WB продавца.

---

## Settings Controller — `apps/api/src/settings/settings.controller.ts`

### `GET /api/settings/marketplaces` 🔒 JWT

Получить текущие API-ключи маркетплейсов.

**Response 200:**
```json
{
  "id": "1",
  "ozonClientId": "...",
  "ozonApiKey": "...",
  "ozonWarehouseId": "...",
  "wbApiKey": "...",
  "wbWarehouseId": "...",
  "updatedAt": "..."
}
```

---

### `PUT /api/settings/marketplaces` 🔒 JWT

Обновить ключи.

**Body (JSON):** любые из полей `ozonClientId`, `ozonApiKey`, `ozonWarehouseId`, `wbApiKey`, `wbStatApiKey`, `wbWarehouseId`.

---

## Health Controller — `apps/api/src/health/health.controller.ts`

### `GET /api/health` 🔓 Public

**Response 200:**
```json
{ "status": "ok" }
```

Используется в Docker healthcheck для контейнера `api`.

---

## DTO (Data Transfer Objects)

| Файл | Класс | Поля |
|------|-------|------|
| `auth/dto/login.dto.ts` | `LoginDto` | `email: string`, `password: string` |
| `product/dto/create-product.dto.ts` | `CreateProductDto` | `name`, `sku`, `wbBarcode?`, `initialTotal?` |
| `product/dto/update-product.dto.ts` | `UpdateProductDto` | `name?`, `sku?`, `wbBarcode?`, `ozonFbs?`... |
| `product/dto/adjust-stock.dto.ts` | `AdjustStockDto` | `delta: number`, `note?: string` |
| `settings/dto/update-settings.dto.ts` | `UpdateSettingsDto` | Все marketplace поля optional |

---

## Загрузка файлов

- **Хранение:** `apps/api/uploads/` (том `uploads_data` в Docker)
- **Доступ:** `GET /uploads/<filename>` — `ServeStaticModule`
- **Обработка:** Multer `diskStorage`, имя = `<timestamp>-<random>.<ext>`
- **Proxy (dev):** Vite proxy `/uploads` → `localhost:3000`
