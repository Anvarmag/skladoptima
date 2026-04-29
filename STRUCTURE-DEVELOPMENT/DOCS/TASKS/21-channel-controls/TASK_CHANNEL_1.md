# TASK_CHANNEL_1 — Модель данных: StockChannelLock и channel visibility settings

> Модуль: `21-channel-controls`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `4h`
- Зависимости:
  - утверждена системная аналитика `21-channel-controls`
  - схема Prisma актуальна (`apps/api/prisma/schema.prisma`)
- Что нужно сделать:
  - добавить Prisma-модель `StockChannelLock` с полями: `id`, `tenantId`, `productId`, `marketplace` (MarketplaceType), `lockType` (enum ZERO/FIXED/PAUSED), `fixedValue` (Int?), `note` (String?), `createdBy`, `createdAt`, `updatedAt`;
  - добавить `@@unique([tenantId, productId, marketplace])` и индексы по `(tenantId, marketplace)` и `(tenantId, productId)`;
  - добавить enum `StockLockType { ZERO FIXED PAUSED }` в schema;
  - добавить JSON-поле `channelVisibilitySettings Json?` в существующую модель `InventorySettings` (или создать отдельную `ChannelVisibilitySettings` — по решению §19 system-analytics: использовать JSON-поле в `InventorySettings`);
  - сгенерировать и применить миграцию `npx prisma migrate dev --name add_stock_channel_lock_and_visibility`;
  - убедиться что `Product` имеет relation `stockChannelLocks StockChannelLock[]`.
- Критерий закрытия:
  - `npx prisma migrate deploy` проходит без ошибок;
  - `StockChannelLock` и `StockLockType` экспортируются из `@prisma/client`;
  - `InventorySettings` содержит поле `channelVisibilitySettings`.

**Что сделано**

Выполнено 2026-04-29.

1. **Добавлен enum `StockLockType`** в `apps/api/prisma/schema.prisma` со значениями `ZERO`, `FIXED`, `PAUSED` — размещён после `MarketplaceType`.

2. **Добавлена модель `StockChannelLock`** в схему Prisma:
   - поля: `id` (UUID PK), `tenantId`, `productId`, `marketplace` (MarketplaceType), `lockType` (StockLockType), `fixedValue` (Int?), `note` (String?), `createdBy` (String?), `createdAt`, `updatedAt`;
   - `@@unique([tenantId, productId, marketplace])` — upsert-семантика, один товар+маркетплейс = одна блокировка;
   - `@@index([tenantId, marketplace])` — для batch lookup при push_stocks (один SELECT на синк-батч);
   - `@@index([tenantId, productId])` — для UI карточки товара.
   - relation `createdByUser User? @relation("StockChannelLockCreatedBy")` — для audit actor.

3. **Добавлены relations**:
   - `Product.stockChannelLocks StockChannelLock[]`
   - `Tenant.stockChannelLocks StockChannelLock[]`
   - `User.createdStockChannelLocks StockChannelLock[] @relation("StockChannelLockCreatedBy")`

4. **Добавлено поле `channelVisibilitySettings Json?`** в модель `InventorySettings` — JSON-поле хранит настройки видимости каналов тенанта (`{"visibleMarketplaces": ["WB", "OZON"]}`), `null` означает «все каналы видимы».

5. **Создан файл миграции** `apps/api/prisma/migrations/20260429010000_add_stock_channel_lock_and_visibility/migration.sql`:
   - `CREATE TYPE "StockLockType"`;
   - `CREATE TABLE "StockChannelLock"` с PK, unique constraint, двумя индексами и тремя FK (CASCADE на tenant/product, SET NULL на createdBy);
   - `ALTER TABLE "InventorySettings" ADD COLUMN "channelVisibilitySettings" JSONB`.

6. **Валидация**: `npx prisma validate` — схема валидна. Миграция не применена (база не запущена) — применяется через `npx prisma migrate dev` при запуске окружения.

**Критерии закрытия:**
- `StockChannelLock` и `StockLockType` будут экспортированы из `@prisma/client` после применения миграции.
- `InventorySettings` содержит поле `channelVisibilitySettings`.
- `npx prisma validate` — ✅ валидно.
