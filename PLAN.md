# SkladOptima — Product Roadmap & Sprint Plan

> **Единый документ планирования.** Обновляется при старте каждого спринта.
> Дата последнего обновления: апрель 2026

---

## Содержание

1. [Состояние на старт](#1-состояние-на-старт)
2. [Целевая архитектура](#2-целевая-архитектура)
3. [База данных — текущее состояние и цель](#3-база-данных)
4. [Логика синхронизации WB/Ozon](#4-логика-синхронизации)
5. [Roadmap Overview](#5-roadmap-overview)
6. [Q2 2026 — Фундамент](#6-q2-2026--фундамент) ← текущий квартал
7. [Q3 2026 — Монетизация](#7-q3-2026--монетизация)
8. [Q4 2026 — Глубина продукта](#8-q4-2026--глубина-продукта)
9. [Q1 2027 — Рост и масштаб](#9-q1-2027--рост-и-масштаб)
10. [Инфраструктура и деплой](#10-инфраструктура-и-деплой)
11. [Что НЕ делаем](#11-что-не-делаем)

---

## 1. Состояние на старт

### Что уже работает ✅

- JWT авторизация (httpOnly cookies, 7 дней), Telegram WebApp login
- Мультитенантность: `Tenant` / `User` / `Membership` в Prisma схеме
- Каталог товаров: CRUD, фото через Multer, SKU, soft-delete
- Синхронизация остатков WB + Ozon (каждые 60 сек, ping-pong protection)
- Импорт товаров из WB Excel
- Заказы: автосписание остатков при появлении нового заказа с WB/Ozon
- Юнит-экономика, ABC-аналитика (A=0–80%, B=80–95%, C=95–100%)
- Audit log по изменениям склада
- React 19 фронт: Products, Analytics, UnitEconomics, Orders, History, Settings

### Что сломано или отсутствует ❌

| Проблема | Приоритет |
|----------|-----------|
| JWT несёт `storeId` вместо `tenantId + membershipId` | P0 |
| Runtime ALTER TABLE в `onModuleInit()` вместо нормальных Prisma-миграций | P0 |
| `MarketplaceSettings` — singleton anti-pattern (id='1'), нужно мигрировать в `MarketplaceAccount` | P0 |
| Файлы хранятся на диске app-сервера (Multer → `/uploads`) — S3 нужен | P0 |
| Worker не выделен — sync занимает CPU основного HTTP-процесса | P1 |
| Нет UI/API управления командой (Membership в DB есть, интерфейса нет) | P1 |
| Нет биллинга, подписок, тарифных лимитов | Q3 |
| Нет реферальной системы, промокодов | Q3 |
| Нет email-уведомлений | Q3 |
| Frontend — flat структура, нет FSD | Q4 |
| Нет `packages/` shared types | Q4 |

---

## 2. Целевая архитектура

```
skladoptima/
├── apps/
│   ├── api/        NestJS — HTTP API, бизнес-логика
│   ├── web/        React 19 — SPA с FSD структурой
│   ├── worker/     NestJS — sync, email jobs, cron, retry
│   └── landing/    (Q4) Лендинг
├── packages/
│   ├── types/      Shared TypeScript типы
│   └── config/     Shared env конфиг
├── infra/          Docker, nginx
├── docs/           Технический справочник (API.md, SYNC.md)
└── PLAN.md         ← этот файл
```

### Поток данных (целевой)

```
Browser → React SPA (Nginx/Vite)
              │ axios + httpOnly cookie
              ▼
         NestJS API :3000
              │ Prisma ORM
              ▼
         PostgreSQL ←── NestJS Worker (sync, jobs, email)
                              │
                    ┌─────────┴─────────┐
               WB API             Ozon API
```

### Доменная модель

```
Tenant ──┬── Membership[] ──── User
         ├── MarketplaceAccount[] (WB, Ozon)
         ├── Product[] / StockMovement[]
         ├── Subscription ──── TariffPlan
         └── AccessState: EARLY_ACCESS | TRIAL_ACTIVE | TRIAL_EXPIRED
                          ACTIVE_PAID | GRACE_PERIOD | SUSPENDED | CLOSED

User ────── ReferralLink → ReferralReward
            PromoRedemption
            Invitation[]
```

### Роли (не смешивать с AccessState)

| Роль | Что может |
|------|-----------|
| `OWNER` | Всё: биллинг, удаление тенанта, управление ролями |
| `ADMIN` | Товары, склад, маркетплейсы, приглашение сотрудников. Не может менять тариф |
| `MANAGER` | Товары, остатки, аналитика. Не видит API-ключи и биллинг |
| `STAFF` | Только просмотр, ограниченные складские операции |

---

## 3. База данных

### Текущая схема (что есть в `schema.prisma`)

```
Tenant          — id, name, accessState, taxSystem, vatThresholdExceeded
User            — id, email, password, telegramId
Membership      — id, userId, tenantId, role (OWNER|ADMIN|MANAGER|STAFF)
MarketplaceAccount — id, tenantId, name, marketplace, apiKey, statApiKey, clientId, warehouseId, lastSyncAt
Product         — id, tenantId, sku, name, photo(local!), total, reserved, wbFbs, wbFbo, ozonFbs, ozonFbo, deletedAt
MarketplaceOrder — id, tenantId, marketplaceOrderId, marketplace, productSku, quantity, status, totalAmount
MarketplaceReport — id, tenantId, reportId, periodStart/End, salesAmount, returnsAmount...
AuditLog        — id, tenantId, actionType, actorUserId, productId, delta, beforeTotal, afterTotal
```

### Технический долг в БД ⚠️

**1. Runtime ALTER TABLE миграции (критично)**
В коде есть `onModuleInit()` которые добавляют колонки через raw SQL:
- `ProductService.onModuleInit()` → `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "wbBarcode"`
- `SettingsService.onModuleInit()` → `ALTER TABLE "MarketplaceSettings" ADD COLUMN IF NOT EXISTS ...`

Это **anti-pattern**: колонки не в `schema.prisma`, нет типов в Prisma Client, нет истории миграций.
Нужно: перенести в нормальные Prisma-миграции (Sprint 2.1).

**2. MarketplaceSettings singleton (устарел)**
Старая таблица `MarketplaceSettings` (id='1') — deprecated. Заменена на `MarketplaceAccount`, но в коде может ещё остаться обращение к старому паттерну. Нужна аудит и чистка.

**3. Нет индексов по tenantId**
Все tenant-scoped таблицы (Product, MarketplaceOrder, AuditLog, MarketplaceReport) не имеют явного `@@index([tenantId])`. При росте данных — критично.

### Целевая схема — что нужно добавить

**Sprint 2.1 — Индексы + fix runtime migrations:**
```prisma
// Добавить @@index во все tenant-scoped модели
model Product     { ... @@index([tenantId]) @@index([tenantId, sku]) }
model AuditLog    { ... @@index([tenantId]) @@index([tenantId, createdAt]) }
model MarketplaceOrder { ... @@index([tenantId]) @@index([tenantId, marketplaceCreatedAt]) }

// wbBarcode — перенести из runtime ALTER TABLE в schema.prisma
// (уже есть в schema, убрать onModuleInit логику)
```

**Sprint 2.2 — Invitation:**
```prisma
model Invitation {
  id        String    @id @default(uuid())
  email     String
  role      Role      @default(MANAGER)
  token     String    @unique @default(uuid())
  expiresAt DateTime
  usedAt    DateTime?
  tenantId  String
  tenant    Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  createdAt DateTime  @default(now())
  @@index([tenantId])
  @@index([token])
}
```

**Sprint 2.4 — StockMovement:**
```prisma
enum StockMovementType {
  MANUAL_ADD MANUAL_REMOVE SYNC_WB SYNC_OZON ORDER_DEDUCTED ADJUSTMENT
}

model StockMovement {
  id          String            @id @default(uuid())
  productId   String
  product     Product           @relation(fields: [productId], references: [id], onDelete: Cascade)
  type        StockMovementType
  delta       Int
  reason      String?
  actorUserId String?
  actorUser   User?             @relation(fields: [actorUserId], references: [id])
  tenantId    String
  createdAt   DateTime          @default(now())
  @@index([productId])
  @@index([tenantId, createdAt])
}
```

**Sprint 3.1 — Billing:**
```prisma
model TariffPlan {
  id                     String  @id @default(uuid())
  name                   String  @unique
  price                  Float
  maxProducts            Int     // -1 = безлимит
  maxMarketplaceAccounts Int
  maxMembers             Int
  hasAdvancedAnalytics   Boolean @default(false)
  hasApiAccess           Boolean @default(false)
  auditLogRetentionDays  Int     @default(30)
  isActive               Boolean @default(true)
  subscriptions          Subscription[]
}

model Subscription {
  id                 String             @id @default(uuid())
  tenantId           String             @unique
  tenant             Tenant             @relation(fields: [tenantId], references: [id])
  planId             String
  plan               TariffPlan         @relation(fields: [planId], references: [id])
  status             SubscriptionStatus
  currentPeriodStart DateTime
  currentPeriodEnd   DateTime
  cancelAtPeriodEnd  Boolean            @default(false)
  externalPaymentId  String?
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt
}

enum SubscriptionStatus { ACTIVE PAST_DUE CANCELLED PAUSED TRIALING }
```

**Sprint 3.3 — Referral:**
```prisma
model ReferralLink {
  id        String          @id @default(uuid())
  code      String          @unique
  ownerId   String
  owner     User            @relation(fields: [ownerId], references: [id])
  rewards   ReferralReward[]
  createdAt DateTime        @default(now())
}

model ReferralReward {
  id               String       @id @default(uuid())
  linkId           String
  link             ReferralLink @relation(fields: [linkId], references: [id])
  referredTenantId String
  rewardType       RewardType
  value            Float
  status           RewardStatus @default(PENDING)
  appliedAt        DateTime?
  createdAt        DateTime     @default(now())
}

model PromoCode {
  id        String    @id @default(uuid())
  code      String    @unique
  discount  Float
  type      PromoType // PERCENT | FIXED
  maxUses   Int?
  usedCount Int       @default(0)
  expiresAt DateTime?
  isActive  Boolean   @default(true)
}

enum RewardType  { DISCOUNT_MONTH BONUS_CASH EXTRA_DAYS }
enum RewardStatus { PENDING APPLIED EXPIRED }
enum PromoType   { PERCENT FIXED }
```

### Политика миграций

- **Только `prisma migrate dev`** — никаких `$executeRawUnsafe` для структурных изменений
- Каждая миграция: `prisma migrate dev --name <what_changed>`
- Перед применением в prod: `prisma migrate deploy`
- Индексы добавлять вместе с моделью, не отдельной миграцией
- S3 ключи файлов хранить с префиксом тенанта: `{tenantId}/products/{filename}`

---

## 4. Логика синхронизации

> Это важный технический контекст. Не ломать без понимания.

### Текущий цикл (каждые 60 сек)

```
syncAllTenants()
  └── для каждого тенанта с настроенными ключами:
       1. pullFromWb()        — стянуть FBS остатки с WB склада
       2. processWbOrders()   — списать остатки по новым заказам WB
       3. syncProductMetadata() — обновить фото/названия с WB и Ozon
       4. pullFromOzon()      — стянуть FBS+FBO остатки с Ozon
       5. processOzonOrders() — списать остатки по новым заказам Ozon FBS
```

### Ping-Pong Prevention ⚠️

**Проблема:** Если мы запушили остаток 10 на WB, то через 60 сек `pullFromWb()` получит 10 обратно. Если был старый кэш 8, система подумает "дельта +2" и увеличит `total`. Бесконечный цикл.

**Решение (cooldown):** `syncCooldowns: Map<productId, timestamp>` — после push на маркетплейс ставится кулдаун на **2 минуты**. `pullFromWb/Ozon` пропускают товары в кулдауне.

### WB API endpoints

| Действие | Endpoint |
|----------|----------|
| Pull FBS остатков | `GET suppliers-api.wildberries.ru/api/v3/stocks/{warehouseId}` |
| Push остатков | `PUT suppliers-api.wildberries.ru/api/v3/stocks/{warehouseId}` |
| Новые заказы | Заказы статус `0` за последние 7 дней |
| Метаданные карточек | `POST /content/v2/get/cards/list` по nmIDs |

### Ozon API endpoints

| Действие | Endpoint |
|----------|----------|
| Pull FBS остатков | `POST api-seller.ozon.ru/v1/product/info/stocks-by-warehouse/fbs` |
| Pull FBO остатков | `POST api-seller.ozon.ru/v2/product/info/stocks` |
| Push остатков | `POST api-seller.ozon.ru/v2/products/stocks` |
| Новые FBS заказы | `POST api-seller.ozon.ru/v3/posting/fbs/list` (статусы: `awaiting_packaging`, `awaiting_deliver`, `delivering`) |
| Метаданные | `POST /v2/product/info/list` по skus |

### Важные нюансы

- **FBO заказы Ozon** — не списываются из `total`. Маркетплейс сам отгружает с их склада. `ozonFbo` обновляется только для отображения.
- **WB FBO** — пока не поддерживается (нет в WB Statistics API).
- **Дедупликация заказов** — по `marketplaceOrderId` в `MarketplaceOrder`. Заказ списывается только один раз.
- **Связь товаров с WB** — через `wbBarcode` (nmID). Без баркода sync не работает.
- **Мастер-остаток** — `Product.total`. Все изменения идут через него. `wbFbs/ozonFbs` — кэш.

---

## 5. Roadmap Overview

| Квартал | Фокус | Ключевой результат |
|---------|-------|-------------------|
| **Q2 2026** (апр–июн) | Фундамент | Правильный auth, fix DB tech debt, worker, S3, управление командой, история остатков |
| **Q3 2026** (июл–сен) | Монетизация | Тарифы, оплата подписок, реферальная система, email-уведомления |
| **Q4 2026** (окт–дек) | Глубина | FSD фронт, расширенная аналитика, admin-панель, лендинг |
| **Q1 2027** (янв–мар) | Масштаб | Мониторинг, производительность, публичный API, CI/CD |

---

## 6. Q2 2026 — Фундамент

> **Цель:** Превратить MVP в масштабируемую основу. После Q2 продукт технически готов к монетизации.

---

### Sprint 2.1 — Auth Fix + DB Tech Debt
**Даты:** 1–14 апреля 2026

#### Задачи

**[2.1-1] Audit: найти все storeId в коде**
- `grep -r "storeId\|store_id\|req.user.store" apps/api/src/`
- Задокументировать список файлов

**[2.1-2] Fix: JWT payload → tenantId + membershipId + role**
- `apps/api/src/modules/auth/auth.service.ts` — изменить payload: `{ sub: userId, tenantId, membershipId, role }`
- `apps/api/src/modules/auth/jwt.strategy.ts` — обновить validate() метод
- Заменить все `req.user.storeId` → `req.user.tenantId` по всему api
- Проверить `apps/web/src/context/AuthContext.tsx` — поле `store` в ответе /auth/me

**[2.1-3] Fix: убрать runtime ALTER TABLE из onModuleInit()**
- Найти все `$executeRawUnsafe` и `$queryRawUnsafe` в `SettingsService` и `ProductService`
- Убедиться что `wbBarcode` уже есть в `schema.prisma` (есть) → удалить raw SQL добавление колонки
- Удалить `MarketplaceSettings` onModuleInit если singleton создаётся там (заменено на `MarketplaceAccount`)

**[2.1-4] Fix: добавить индексы по tenantId**
```prisma
// В schema.prisma добавить @@index к каждой модели:
model Product          { ... @@index([tenantId])  @@index([tenantId, sku]) }
model AuditLog         { ... @@index([tenantId])  @@index([tenantId, createdAt]) }
model MarketplaceOrder { ... @@index([tenantId])  @@index([tenantId, marketplaceCreatedAt]) }
model MarketplaceReport{ ... @@index([tenantId]) }
model Membership       { ... @@index([tenantId]) }
```
- Миграция: `prisma migrate dev --name add_tenant_indexes`

**[2.1-5] Audit: проверить tenant isolation во всех модулях**
- Каждый `prisma.*.findMany()` должен содержать `where: { tenantId }`
- Модули для проверки: catalog, inventory, analytics, finance, audit, marketplace_sync, marketplace
- Список найденных нарушений → исправить

**[2.1-6] Fix: регистрация — одна транзакция**
- `apps/api/src/modules/auth/auth.service.ts` — метод register()
- Должно быть: `prisma.$transaction([createUser, createTenant, createMembership])`
- Membership.role = OWNER
- Проверить что при ошибке всё откатывается

**[2.1-7] Fix: User.isInternalAdmin для команды SkladOptima**
```prisma
model User { ... isInternalAdmin Boolean @default(false) }
```
- Миграция: `prisma migrate dev --name add_internal_admin`
- Обновить seed.ts: admin@sklad.ru → `isInternalAdmin: true`

#### ✅ Результат спринта
- JWT содержит tenantId, membershipId, role
- Нет `storeId` нигде в коде
- Индексы добавлены, скорость запросов выросла
- Runtime SQL миграций нет
- Регистрация — атомарная транзакция

---

### Sprint 2.2 — Team Management
**Даты:** 15–28 апреля 2026

#### Задачи

**[2.2-1] Prisma: модель Invitation**
```prisma
model Invitation {
  id        String    @id @default(uuid())
  email     String
  role      Role      @default(MANAGER)
  token     String    @unique @default(uuid())
  expiresAt DateTime
  usedAt    DateTime?
  tenantId  String
  tenant    Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  createdAt DateTime  @default(now())
  @@index([tenantId])
  @@index([token])
}
// Добавить в Tenant: invitations Invitation[]
```
- Миграция: `prisma migrate dev --name add_invitation`

**[2.2-2] Backend: модуль team**
- Создать `apps/api/src/modules/team/team.module.ts`
- Endpoints:
  - `GET /api/team` — список сотрудников тенанта
  - `POST /api/team/invite` — создать Invitation (body: email, role)
  - `PUT /api/team/:membershipId/role` — сменить роль (только OWNER/ADMIN)
  - `DELETE /api/team/:membershipId` — удалить сотрудника (только OWNER)

**[2.2-3] Backend: RBAC декоратор**
- Создать `apps/api/src/common/decorators/require-role.decorator.ts`
- `@RequireRole(Role.OWNER, Role.ADMIN)` → проверяет `req.user.role`
- Создать `RolesGuard` — применять на нужные эндпоинты

**[2.2-4] Backend: принятие инвайта**
- `GET /api/invite/:token` — @Public() — вернуть email и роль инвайта
- `POST /api/invite/:token/accept` — @Public() — принять инвайт
  - Если user с таким email уже есть → создать Membership
  - Если нет → создать User + Membership
  - Пометить `invitation.usedAt = now()`

**[2.2-5] Frontend: управление командой в Settings**
- Добавить таб "Команда" в `/app/settings`
- Таблица: email, роль, дата добавления, кнопки (сменить роль, удалить)
- Форма: email + select роли + кнопка "Пригласить"
- Показывать ожидающие инвайты (email + статус)
- Кнопки управления видны только OWNER/ADMIN

**[2.2-6] Frontend: страница принятия инвайта**
- Маршрут `/invite/:token` — @Public
- Если авторизован → кнопка "Присоединиться к [TenantName]"
- Если нет → форма регистрации с pre-filled email

#### ✅ Результат спринта
- OWNER может приглашать сотрудников по email
- Роли: OWNER / ADMIN / MANAGER / STAFF
- UI в настройках работает
- Pending инвайты отображаются

---

### Sprint 2.3 — Worker + S3
**Даты:** 29 апреля – 12 мая 2026

#### Задачи

**[2.3-1] Audit: что нужно перенести из api в worker**
- Найти все `setInterval`, `@Cron`, sync-логику в `apps/api/src/`
- Составить список: что остаётся в api, что уходит в worker

**[2.3-2] Scaffold: создать apps/worker**
- `cd apps && npx @nestjs/cli new worker --package-manager npm`
- Добавить в root `package.json` workspaces, добавить `npm run worker` скрипт
- Настроить `@nestjs/schedule` для cron задач
- Добавить сервис в `docker-compose.yml`

**[2.3-3] Move: sync логика → worker**
- Перенести `marketplace_sync` модуль в `apps/worker/src/modules/sync/`
- В api убрать `setInterval` из sync
- Worker запускает sync через `@Cron('*/1 * * * *')`
- API может триггерить ручной sync через shared DB флаг или direct HTTP к worker

**[2.3-4] S3: Storage Service**
- Добавить `@aws-sdk/client-s3` в apps/api
- `apps/api/src/modules/storage/storage.service.ts`:
  ```typescript
  async uploadFile(buffer: Buffer, key: string, mimeType: string): Promise<string>
  async deleteFile(key: string): Promise<void>
  ```
- Env vars: `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`
- Ключи файлов: `{tenantId}/products/{uuid}.{ext}`

**[2.3-5] Fix: Multer → S3**
- Заменить `diskStorage` на `memoryStorage` в Multer config
- В product upload controller → `StorageService.uploadFile(file.buffer, key, file.mimetype)`
- В `Product.photo` хранить S3 URL
- Добавить удаление старого файла при замене фото
- Убрать `ServeStaticModule` (или оставить временно для legacy `/uploads`)

**[2.3-6] Docker: обновить compose**
```yaml
worker:
  build: ./apps/worker
  environment:
    - DATABASE_URL=${DATABASE_URL}
    - S3_ENDPOINT=${S3_ENDPOINT}
    # ... остальные env
  depends_on:
    - postgres
```

**[2.3-7] Prisma: MarketplaceSyncLog**
```prisma
model MarketplaceSyncLog {
  id          String   @id @default(uuid())
  tenantId    String
  marketplace MarketplaceType
  status      String   // SUCCESS | ERROR
  error       String?
  duration    Int?     // ms
  createdAt   DateTime @default(now())
  @@index([tenantId, createdAt])
}
```
- Миграция: `prisma migrate dev --name add_sync_log`
- Worker пишет в эту таблицу результат каждого sync цикла

#### ✅ Результат спринта
- Worker — отдельный Docker контейнер
- Sync не грузит API HTTP-процесс
- Фото хранятся в S3 с prefix по tenantId
- Логи sync в БД

---

### Sprint 2.4 — Stock Management
**Даты:** 13–26 мая 2026

#### Задачи

**[2.4-1] Audit: текущая логика корректировки остатков**
- Читаем `apps/api/src/modules/catalog/product.service.ts` — метод stock-adjust
- Как сейчас пишется в AuditLog
- Что отображается на фронте в Products

**[2.4-2] Prisma: StockMovement**
```prisma
enum StockMovementType {
  MANUAL_ADD MANUAL_REMOVE SYNC_WB SYNC_OZON ORDER_DEDUCTED ADJUSTMENT IMPORT
}

model StockMovement {
  id          String            @id @default(uuid())
  productId   String
  product     Product           @relation(fields: [productId], references: [id], onDelete: Cascade)
  type        StockMovementType
  delta       Int
  warehouse   String?           // "WB_FBS" | "WB_FBO" | "OZON_FBS" | "OZON_FBO" | "OWN"
  reason      String?
  actorUserId String?
  actorUser   User?             @relation(fields: [actorUserId], references: [id])
  tenantId    String
  createdAt   DateTime          @default(now())
  @@index([productId])
  @@index([tenantId, createdAt])
}
// Добавить в Product: stockMovements StockMovement[]
```
- Миграция: `prisma migrate dev --name add_stock_movement`

**[2.4-3] Backend: расширить stock-adjust endpoint**
- `POST /api/products/:id/stock/adjust`
  - Body: `{ delta: number, warehouse: string, reason: string }`
  - Создаёт StockMovement + обновляет `Product.total`
  - Пишет в AuditLog (обратная совместимость)

**[2.4-4] Backend: история движений**
- `GET /api/products/:id/stock/history`
  - Query: `type?, dateFrom?, dateTo?, limit?, offset?`
  - Возвращает: `{ data: StockMovement[], meta: { total } }`

**[2.4-5] Worker: sync создаёт StockMovement**
- `pullFromWb()` при изменении остатка → создаёт `StockMovement(type: SYNC_WB)`
- `pullFromOzon()` → `StockMovement(type: SYNC_OZON)`
- `processWbOrders()` → `StockMovement(type: ORDER_DEDUCTED)`

**[2.4-6] Frontend: модальное окно корректировки**
- На Products — кнопка "±" у каждого товара
- Модалка: числовое поле delta (+/-), select склада, textarea причины
- После отправки → обновить строку в таблице

**[2.4-7] Frontend: история в карточке товара**
- При клике на строку товара — боковая панель
- Таблица истории: тип (иконка), дата, дельта (+/-N), причина, кто изменил

#### ✅ Результат спринта
- Полная история остатков по каждому товару
- Ручные корректировки с указанием причины и склада
- Sync пишет в историю автоматически
- UI: боковая панель с историей

---

### Sprint 2.5 — Stabilization
**Даты:** 27 мая – 9 июня 2026

#### Задачи

**[2.5-1] E2E: регистрация → инвайт → принятие**
- Написать тест: register → POST /team/invite → GET /invite/:token → accept → проверить Membership

**[2.5-2] E2E: sync цикл**
- Mock WB API → запустить sync → Product.wbFbs обновился → StockMovement создался

**[2.5-3] Security: проверить все эндпоинты на 401**
- `curl` без cookie на каждый эндпоинт → ожидаем 401
- Особое внимание: POST/PUT/DELETE операции

**[2.5-4] Fix: error handling в worker**
- Ошибка одного тенанта не должна ронять sync всех тенантов
- `try/catch` вокруг каждого тенанта
- `lastSyncStatus = 'ERROR'` + запись в `MarketplaceSyncLog`

**[2.5-5] Performance: пагинация везде**
- Products: default limit 50, max 100
- Orders: default limit 20
- History/Audit: default limit 50
- Везде cursor или offset+limit

**[2.5-6] Refactor: API-вызовы на фронте**
- Создать `apps/web/src/api/`:
  - `products.ts`, `orders.ts`, `analytics.ts`, `team.ts`, `settings.ts`, `auth.ts`
- Убрать inline axios из компонентов

**[2.5-7] Инфраструктура: HTTPS + CORS**
- После настройки SSL: `FORCE_HTTPS=true` в .env на сервере
- `CORS_ORIGIN=https://app.skladoptima.ru` в .env
- В TG BotFather → Menu Button → `https://app.skladoptima.ru/app`
- Проверить `secure` флаг на cookie

#### ✅ Результат Q2
- JWT правильный, tenant isolation надёжная
- DB tech debt убран (нет runtime ALTER TABLE)
- Worker отдельно, S3 для файлов
- Управление командой работает
- Полная история остатков
- E2E тесты проходят

---

## 7. Q3 2026 — Монетизация

> **Цель:** Пользователи могут платить. Реферальная система привлекает новых.

---

### Sprint 3.1 — Billing Foundation
**Даты:** 10–23 июня 2026

#### Задачи

**[3.1-1] Prisma: TariffPlan + Subscription**
```prisma
model TariffPlan {
  id                     String  @id @default(uuid())
  name                   String  @unique
  price                  Float
  maxProducts            Int     // -1 = безлимит
  maxMarketplaceAccounts Int
  maxMembers             Int
  hasAdvancedAnalytics   Boolean @default(false)
  hasApiAccess           Boolean @default(false)
  auditLogRetentionDays  Int     @default(30)
  isActive               Boolean @default(true)
  subscriptions          Subscription[]
}

model Subscription {
  id                 String             @id @default(uuid())
  tenantId           String             @unique
  tenant             Tenant             @relation(fields: [tenantId], references: [id])
  planId             String
  plan               TariffPlan         @relation(fields: [planId], references: [id])
  status             SubscriptionStatus
  currentPeriodStart DateTime
  currentPeriodEnd   DateTime
  cancelAtPeriodEnd  Boolean            @default(false)
  externalPaymentId  String?
  promoCodeId        String?
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt
}

enum SubscriptionStatus { ACTIVE PAST_DUE CANCELLED PAUSED TRIALING }
// Добавить в Tenant: subscription Subscription?
```
- Миграция: `prisma migrate dev --name add_billing`

**[3.1-2] Seed: тарифные планы**
- В `prisma/seed.ts` добавить планы:
  - Free: 0₽, 50 товаров, 1 маркетплейс, 1 сотрудник
  - Basic: 1290₽, 500 товаров, 2 маркетплейса, 3 сотрудника
  - Pro: 2990₽, безлимит товаров (-1), 5 маркетплейсов, 10 сотрудников + аналитика
  - Business: 5990₽, всё безлимит + API доступ

**[3.1-3] Backend: LimitsService**
- `apps/api/src/modules/billing/limits.service.ts`
- `canAddProduct(tenantId): Promise<boolean>`
- `canAddMarketplace(tenantId): Promise<boolean>`
- `canAddMember(tenantId): Promise<boolean>`
- Внедрить в: ProductService.create(), team/invite, MarketplaceAccount создание

**[3.1-4] Backend: billing endpoints**
- `GET /api/billing/current` — текущий план + использование лимитов
  ```json
  {
    "plan": { "name": "Basic", "price": 1290 },
    "usage": { "products": 45, "maxProducts": 500, "members": 2, "maxMembers": 3 },
    "status": "ACTIVE",
    "currentPeriodEnd": "2026-07-10"
  }
  ```
- `GET /api/billing/plans` — список тарифов

**[3.1-5] Frontend: раздел подписки в Settings**
- Таб "Подписка" в `/app/settings`
- Текущий план + прогресс-бары лимитов
- Кнопка "Сменить тариф" → список планов

**[3.1-6] Frontend: paywall при TRIAL_EXPIRED / SUSPENDED**
- Middleware в React Router: если `tenant.accessState` в статусах блокировки → показать `/billing` экран
- OWNER видит кнопку "Выбрать тариф", остальные — "Обратитесь к владельцу"

#### ✅ Результат спринта
- Тарифные планы в DB
- Лимиты применяются
- UI: отображение тарифа и использования
- Paywall при истечении доступа

---

### Sprint 3.2 — Payment Integration
**Даты:** 24 июня – 7 июля 2026

#### Задачи

**[3.2-1] Выбор платёжного шлюза**
- Сравнить ЮKassa vs Тинькофф Pay: комиссии, API, скорость подключения
- Задокументировать выбор

**[3.2-2] Backend: PaymentService**
- `createPaymentSession(tenantId, planId, promoCode?)` → URL оплаты
- `handleWebhookEvent(event)` → обработка success/failure
- Конфигурация через env: `PAYMENT_SECRET_KEY`, `PAYMENT_SHOP_ID`

**[3.2-3] Backend: webhook endpoint**
- `POST /api/billing/webhook` @Public()
- Верификация подписи запроса
- `payment.succeeded` → создать/обновить Subscription, AccessState → ACTIVE_PAID
- `payment.failed` → Subscription.status = PAST_DUE
- Запись в AuditLog (type: SUBSCRIPTION_CHANGED)

**[3.2-4] Worker cron: автопродление**
- Каждый день: найти Subscription где `currentPeriodEnd < now + 3 days`
- Создать новый платёж
- Если `cancelAtPeriodEnd = true` → не продлевать, перевести в CANCELLED
- Grace period: при неуспехе → AccessState = GRACE_PERIOD, email OWNER-у

**[3.2-5] Prisma: PaymentLog**
```prisma
model PaymentLog {
  id            String   @id @default(uuid())
  tenantId      String
  externalId    String   @unique
  amount        Float
  status        String
  planId        String?
  createdAt     DateTime @default(now())
  @@index([tenantId])
}
```
- Миграция: `prisma migrate dev --name add_payment_log`

**[3.2-6] Frontend: страница выбора тарифа**
- `/app/billing` — карточки планов (Free, Basic, Pro, Business)
- Поле промокода с кнопкой "Применить"
- Кнопка "Подключить" → редирект на payment URL
- После оплаты → редирект на `/app/settings?tab=billing`

#### ✅ Результат спринта
- Оплата работает через платёжный шлюз
- Webhook обновляет AccessState
- Worker продлевает подписку
- Grace period при неуплате

---

### Sprint 3.3 — Referral System
**Даты:** 8–21 июля 2026

#### Задачи

**[3.3-1] Prisma: ReferralLink + ReferralReward + PromoCode**
(схема приведена в разделе БД выше)
- Миграция: `prisma migrate dev --name add_referral_promo`
- Добавить `referralLinkId String?` в Tenant (кто пригласил)

**[3.3-2] Backend: автосоздание ReferralLink при регистрации**
- В `auth.service.ts` register() → `prisma.referralLink.create({ data: { code: nanoid(8), ownerId } })`
- `GET /api/referral/my-link` → код + URL
- `GET /api/referral/stats` → кол-во рефералов, заработанные бонусы

**[3.3-3] Backend: обработка реферального кода при регистрации**
- Поле `refCode` в RegisterDto (опционально)
- При создании Tenant: найти ReferralLink по коду → сохранить referralLinkId
- `POST /api/referral/reward/:referredTenantId` — вызывается после первой оплаты рефераа
  → создать ReferralReward(PENDING) → при следующей оплате рефера → APPLIED

**[3.3-4] Backend: промокоды**
- `POST /api/billing/validate-promo` — проверить промокод
- При создании payment session с промокодом → применить скидку
- Инкрементировать `PromoCode.usedCount`

**[3.3-5] Frontend: страница реферальной программы**
- `/app/referral` (добавить в навигацию)
- Реферальная ссылка + кнопка "Скопировать"
- Статистика: X рефералов, бонус Y ₽
- Таблица начислений

**[3.3-6] Frontend: промокод на странице оплаты**
- Input + кнопка "Применить"
- Показывать итоговую сумму после скидки

#### ✅ Результат спринта
- Каждый пользователь имеет реферальную ссылку
- Бонус начисляется после первой оплаты реферала
- Промокоды работают при оплате

---

### Sprint 3.4 — Email Notifications
**Даты:** 22 июля – 4 августа 2026

#### Задачи

**[3.4-1] Worker: EmailService**
- `apps/worker/src/modules/notifications/email.service.ts`
- Использовать `nodemailer` + Yandex Cloud Postbox (SES-compatible)
- Env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

**[3.4-2] Email шаблоны**
- `invite.html` — приглашение сотрудника (кнопка принятия)
- `welcome.html` — приветствие после регистрации
- `trial-expiring.html` — за 3 дня до конца триала
- `payment-success.html` — успешная оплата
- `payment-failed.html` — неуспешная оплата (grace period)
- `stock-alert.html` — критически низкий остаток (<7 дней)

**[3.4-3] Trigger: инвайт**
- При создании Invitation → worker job → `EmailService.sendInvite(email, token, tenantName)`

**[3.4-4] Cron: подписочные уведомления**
- За 7 дней до `currentPeriodEnd` → `trial-expiring` email OWNER-у
- После webhook `payment.succeeded` → `payment-success` email

**[3.4-5] Cron: алерты по остаткам**
- Раз в сутки: найти товары где `total / dailyVelocity < 7` (velocity из analytics)
- Сгруппировать по тенанту → отправить `stock-alert` email OWNER-у

**[3.4-6] Prisma: NotificationLog**
```prisma
model NotificationLog {
  id        String   @id @default(uuid())
  tenantId  String?
  userId    String?
  type      String
  recipient String
  status    String   // SENT | FAILED
  error     String?
  createdAt DateTime @default(now())
  @@index([tenantId])
}
```
- Миграция: `prisma migrate dev --name add_notification_log`

#### ✅ Результат Q3
- Платные подписки работают
- Реферальная система привлекает новых пользователей
- Email уведомления: инвайты, биллинг, алерты остатков
- Продукт генерирует выручку

---

## 8. Q4 2026 — Глубина продукта

> **Цель:** Расширенная аналитика, admin-панель, публичный лендинг, FSD.

---

### Sprint 4.1 — Frontend Architecture (FSD)
**Даты:** 5–18 августа 2026

**Целевая структура:**
```
apps/web/src/
├── app/          Router, providers, global styles
├── pages/        Route-level компоненты (тонкие оболочки)
├── widgets/      Самодостаточные блоки (ProductTable, AnalyticsChart, Sidebar)
├── features/     Действия (adjustStock, inviteTeamMember, applyPromo)
├── entities/     Бизнес-сущности + их API (product, user, subscription)
├── shared/
│   ├── ui/       Button, Input, Modal, Table, Badge, Spinner, Card
│   ├── api/      axios instance + все API вызовы
│   ├── hooks/    useAuth, usePagination, useDebounce
│   └── config/   env, constants
└── processes/    Многошаговые флоу (onboarding, checkout)
```

**Задачи:**
- `[4.1-1]` Создать структуру директорий
- `[4.1-2]` Вынести все axios вызовы в `shared/api/`
- `[4.1-3]` Создать `shared/ui/` компоненты (Button, Input, Modal, Table, Badge)
- `[4.1-4]` Мигрировать каждую страницу на новую структуру (по одной)

---

### Sprint 4.2 — Advanced Analytics
**Даты:** 19 августа – 1 сентября 2026

**Задачи:**
- `[4.2-1]` `GET /api/analytics/compare?period1=...&period2=...` — сравнение периодов
- `[4.2-2]` Прогноз остатков: `daysUntilStockout = total / dailyVelocity`
- `[4.2-3]` Расширенный гео-отчёт: топ-10 регионов + динамика
- `[4.2-4]` Сводный дашборд на главной: 4 KPI карточки + 2 графика
- `[4.2-5]` Экспорт в Excel с BOM для корректного открытия в MS Office
- `[4.2-6]` Ограничить расширенную аналитику тарифом Pro+

---

### Sprint 4.3 — Admin Panel
**Даты:** 2–15 сентября 2026

**Задачи:**
- `[4.3-1]` Backend: `GET /api/admin/tenants` — список тенантов (guard: isInternalAdmin)
- `[4.3-2]` Backend: `PUT /api/admin/tenants/:id/access` — ручное изменение AccessState
- `[4.3-3]` Backend: `POST /api/admin/tenants/:id/grant` — manual access grant
- `[4.3-4]` Backend: `GET /api/admin/stats` — DAU, MAU, подписки по типу
- `[4.3-5]` Frontend: `/admin` — таблица тенантов, фильтры, кнопки действий

---

### Sprint 4.4 — Landing Page
**Даты:** 16–29 сентября 2026

**Задачи:**
- `[4.4-1]` Scaffold `apps/landing` (Next.js или Astro)
- `[4.4-2]` Страница `/` — hero, фичи, тарифы, CTA
- `[4.4-3]` Страница `/pricing` — полные тарифы с кнопками
- `[4.4-4]` Реферальные ссылки через лендинг
- `[4.4-5]` SEO: og-теги, sitemap

#### ✅ Результат Q4
- Frontend масштабируем (FSD)
- Расширенная аналитика на Pro+ тарифах
- Admin-панель для команды SkladOptima
- Публичный лендинг → регистрация

---

## 9. Q1 2027 — Рост и масштаб

### Sprint 5.1 — Observability (январь 2027)
- `[5.1-1]` Sentry в api, worker, web
- `[5.1-2]` Structured logging: pino в api и worker
- `[5.1-3]` Health checks для всех сервисов
- `[5.1-4]` Prometheus metrics endpoint в api
- `[5.1-5]` CI/CD: GitHub Actions → автодеплой на VPS

### Sprint 5.2 — Performance (февраль 2027)
- `[5.2-1]` pg slow query log → найти и оптимизировать медленные запросы
- `[5.2-2]` Redis кэш для тяжёлых analytics запросов (TTL 5 мин)
- `[5.2-3]` Cursor-based пагинация для больших таблиц
- `[5.2-4]` Архивирование AuditLog старше 1 года (отдельная таблица)
- `[5.2-5]` CDN для статики

### Sprint 5.3 — Public API (март 2027)
- `[5.3-1]` API ключи для тенантов (Business тариф)
- `[5.3-2]` Rate limiting по API ключу
- `[5.3-3]` Swagger/OpenAPI документация
- `[5.3-4]` Webhook-и: `stock.updated`, `order.new`

---

## 10. Инфраструктура и деплой

### Baseline (текущий контур)

| Сервис | Конфиг | Стоимость |
|--------|--------|-----------|
| Managed PostgreSQL | 4 CPU / 8 GB / 80 GB NVMe | 2500 ₽/мес |
| App Server (api + web) | 2 vCPU / 6 GB / 50 GB | 932 ₽/мес |
| Worker Server | 2 vCPU / 3 GB / 50 GB | 860 ₽/мес |
| Redis | 2 vCPU / 2 GB / 30 GB | 660 ₽/мес |
| S3 Storage | 100 GB | 210 ₽/мес |
| Yandex Postbox (email) | — | ~0 ₽/мес |
| **Итого** | | **~5200 ₽/мес** |

### Переменные окружения (`.env.example`)

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/skladoptima

# JWT
JWT_SECRET=минимум_32_символа_секретный_ключ

# Server
PORT=3000
CORS_ORIGIN=http://localhost:5173
FORCE_HTTPS=false

# S3
S3_ENDPOINT=https://storage.yandexcloud.net
S3_BUCKET=skladoptima
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_REGION=ru-central1

# Email (Yandex Postbox)
SMTP_HOST=
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@skladoptima.ru

# Payments
PAYMENT_SECRET_KEY=
PAYMENT_SHOP_ID=

# Telegram
TELEGRAM_BOT_TOKEN=

# Admin seed
ADMIN_EMAIL=admin@sklad.ru
ADMIN_PASSWORD=admin777

# Frontend
VITE_API_URL=
```

### Бэкапы PostgreSQL (добавить в Q1 2027)
```bash
# Cron на сервере — раз в сутки в 3:00
0 3 * * * pg_dump $DATABASE_URL | gzip > /backups/dump_$(date +%Y%m%d).sql.gz
# Хранить последние 30 дней
find /backups -name "*.sql.gz" -mtime +30 -delete
```

### Триггеры масштабирования

| Сервис | Триггер | Действие |
|--------|---------|----------|
| Worker | очередь копится, CPU > 80%, sync lag > 5 мин | апгрейд RAM/CPU |
| PostgreSQL | slow queries, CPU > 70%, disk > 70% | апгрейд / read replica |
| App Server | p95 > 500ms, CPU > 70% | второй инстанс + load balancer |
| Redis | memory > 80%, evictions | апгрейд RAM |

---

## 11. Что НЕ делаем

- **Не Kubernetes** до >500 активных тенантов
- **Не микросервисы** — modular monolith до конца 2026
- **Не GraphQL** — REST достаточно
- **Не Bull Queue** пока Worker справляется с `@Cron` — добавить только если очереди реально копятся
- **Не `packages/`** заранее — только когда реально есть дублирование между apps
- **Не amend коммиты** в main — только новые коммиты
- **Не хранить секреты** в коде и git истории

---

## Технические справочники

Актуальные технические документы (не планирование, а reference):

- [docs/API.md](docs/API.md) — существующие API endpoints
- [docs/SYNC.md](docs/SYNC.md) — детали алгоритма синхронизации (ping-pong prevention)
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Docker Compose, деплой на VPS
- [apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma) — источник правды по схеме БД

---

*Обновлять этот файл при: старте нового спринта, изменении приоритетов, завершении квартала.*
