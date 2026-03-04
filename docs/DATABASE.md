# Схема базы данных — Sklad Optima

> **ORM:** Prisma 5 | **СУБД:** PostgreSQL 15  
> **Файл схемы:** `apps/api/prisma/schema.prisma`  
> **Сид:** `apps/api/prisma/seed.ts` (создаёт admin@sklad.ru / admin777)

---

## Обзор моделей

| Модель | Роль | Ключевые особенности |
|--------|------|---------------------|
| `User` | Пользователи системы | UUID PK, уникальный email, bcrypt password |
| `Product` | Товары (ядро) | SKU, фото, остатки (total/reserved), WB/Ozon cached stock, soft-delete |
| `AuditLog` | Журнал действий | Все CRUD-операции и корректировки остатков |
| `MarketplaceOrder` | Обработанные заказы МП | Дедупликация по `marketplaceOrderId`, WB и Ozon |
| `MarketplaceSettings` | API-ключи маркетплейсов | Singleton (id='1'), Ozon + WB credentials |

---

## Модель `User`

```prisma
model User {
  id        String   @id @default(uuid())
  email     String   @unique
  password  String              // bcrypt hash
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

- **Аутентификация**: JWT создаётся с `{ email, sub: id }`, хранится в httpOnly cookie.
- **Создание**: через `seed.ts` (admin@sklad.ru) или вручную.

---

## Модель `Product`

```prisma
model Product {
  id        String    @id @default(uuid())
  sku       String    @unique           // артикул продавца
  name      String
  photo     String?                      // URL или /uploads/filename
  total     Int       @default(0)        // МАСТЕР-остаток
  reserved  Int       @default(0)        // зарезервировано
  wbBarcode String?   @unique            // штрихкод для WB API

  // Кэшированные остатки маркетплейсов
  ozonFbs   Int       @default(0)
  ozonFbo   Int       @default(0)
  wbFbs     Int       @default(0)
  wbFbo     Int       @default(0)

  deletedAt DateTime?                    // Soft delete (не null = удалён)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### Вычисляемые поля (не хранятся в БД)
- **`available`** = `MAX(0, total - reserved)` — вычисляется на лету в `ProductService.findAll()` и `findOne()`.

### Важные детали
- **`total`** — "мастер-склад". Изменяется через: ручную корректировку, импорт с WB, прямой ввод, sync-дельту.
- **`wbBarcode`** — добавлен через raw SQL migration в `ProductService.onModuleInit()`. Используется для мэтчинга товаров при pull с WB.
- **`ozonFbs`/`ozonFbo`/`wbFbs`/`wbFbo`** — кэш. Обновляются при каждом pull-цикле. Используются для вычисления дельты.
- **Soft delete** — `DELETE /products/:id` ставит `deletedAt`, все запросы фильтруют `WHERE deletedAt IS NULL`.

---

## Модель `AuditLog`

```prisma
model AuditLog {
  id          String     @id @default(uuid())
  actionType  ActionType
  createdAt   DateTime   @default(now())
  productId   String?
  productSku  String?
  beforeTotal Int?
  afterTotal  Int?
  delta       Int?
  beforeName  String?
  afterName   String?
  actorEmail  String      // email пользователя или "system-wb" / "system-ozon"
  note        String?
}
```

### ActionType Enum

```prisma
enum ActionType {
  PRODUCT_CREATED     // создание товара
  PRODUCT_UPDATED     // редактирование info (название, SKU, фото)
  PRODUCT_DELETED     // soft-delete
  STOCK_ADJUSTED      // ручная корректировка ±N
  ORDER_DEDUCTED      // списание по заказу маркетплейса
}
```

### Кто пишет в аудит?
| Actor | Когда |
|-------|-------|
| `admin@sklad.ru` | Ручные действия через UI |
| `system-wb` | Обработка заказов WB |
| `system-ozon` | Обработка заказов Ozon |

---

## Модель `MarketplaceOrder`

```prisma
model MarketplaceOrder {
  id                 String    @id @default(uuid())
  marketplaceOrderId String    @unique    // WB Order ID или Ozon Posting Number
  marketplace        String               // "WB" или "OZON"
  productSku         String?
  productNames       String?
  quantity           Int
  status             String?              // "NEW", "awaiting_packaging", "delivered"...
  totalAmount        Float?               // Сумма (руб)
  currency           String?  @default("RUB")
  shipmentDate       DateTime?
  marketplaceCreatedAt DateTime?
  deliveryMethod     String?
  createdAt          DateTime @default(now())
  processedAt        DateTime @default(now())
}
```

### Назначение
- Хранит **обработанные** заказы для предотвращения двойного списания (дедупликация по `marketplaceOrderId`).
- Заполняется модулем `SyncService` при обработке новых заказов.

---

## Модель `MarketplaceSettings`

```prisma
model MarketplaceSettings {
  id              String   @id @default(dbgenerated("1")) @unique  // Singleton
  ozonClientId    String?
  ozonApiKey      String?
  ozonWarehouseId String?   // добавлено через raw SQL migration
  wbApiKey        String?
  wbStatApiKey    String?   // добавлено через raw SQL migration
  wbWarehouseId   String?   // добавлено через raw SQL migration
  updatedAt       DateTime @updatedAt
}
```

### Особенности
- **Singleton**: всегда одна запись с `id='1'`. Создаётся в `SettingsService.onModuleInit()`.
- Некоторые колонки (`ozonWarehouseId`, `wbWarehouseId`, `wbStatApiKey`) добавлены через raw SQL `ALTER TABLE`, а не через Prisma migrate. Это сделано чтобы не требовать `prisma generate` при каждом обновлении.
- Чтение/запись — через `$queryRawUnsafe` / `$executeRawUnsafe`.

---

## Миграции

Расположение: `apps/api/prisma/migrations/`

Запуск:
```bash
cd apps/api
npx prisma migrate dev --name <name>
```

### Runtime-миграции (raw SQL в коде)
- `ProductService.onModuleInit()` → `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "wbBarcode" TEXT`
- `SettingsService.onModuleInit()` → `ALTER TABLE "MarketplaceSettings" ADD COLUMN IF NOT EXISTS "ozonWarehouseId"/"wbWarehouseId"/"wbStatApiKey"`

---

## ER-диаграмма

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────────┐
│    User      │     │    Product       │     │    AuditLog          │
│──────────────│     │──────────────────│     │──────────────────────│
│ id (PK)      │     │ id (PK)          │◄────│ productId            │
│ email (UK)   │     │ sku (UK)         │     │ productSku           │
│ password     │     │ name             │     │ actionType (enum)    │
│ createdAt    │     │ photo            │     │ actorEmail           │
│ updatedAt    │     │ total            │     │ delta, before/after  │
└──────────────┘     │ reserved         │     │ note                 │
                     │ wbBarcode (UK)   │     └──────────────────────┘
                     │ ozonFbs/Fbo      │
                     │ wbFbs/Fbo        │     ┌──────────────────────┐
                     │ deletedAt        │     │ MarketplaceOrder     │
                     └──────────────────┘     │──────────────────────│
                                              │ marketplaceOrderId(UK)│
┌──────────────────────┐                      │ marketplace (WB/OZON)│
│ MarketplaceSettings  │                      │ productSku           │
│──────────────────────│                      │ quantity, status     │
│ id='1' (Singleton)   │                      │ totalAmount          │
│ ozon*/wb* keys       │                      └──────────────────────┘
└──────────────────────┘
```

> **Примечание**: Между моделями нет Prisma-relations (FK). Связь Product ↔ AuditLog / MarketplaceOrder — нежёсткая, через `productId`/`productSku` как обычные строки.
