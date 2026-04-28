# TASK_CATALOG_1 — Data Model, Master Product и Channel Mappings

> Модуль: `05-catalog`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - утверждена системная аналитика `05-catalog`
- Что нужно сделать:
  - завести `products`, `product_channel_mappings`, `catalog_import_jobs`, `catalog_import_job_items`;
  - закрепить master product model с единым внутренним SKU и множественными channel mappings;
  - ввести ограничения `UNIQUE(tenant_id, sku)` и `UNIQUE(tenant_id, marketplace, external_product_id)`;
  - предусмотреть поля `source_of_truth`, `main_image_file_id`, lifecycle `active/deleted`, а также служебные поля `created_by`, `updated_by`, `deleted_at`;
  - явно закрепить provenance для mapping/import сущностей, чтобы источник строки и канал изменения восстанавливались без ручной реконструкции;
  - согласовать модель с `inventory`, `orders`, `finance`, `files`.
- Критерий закрытия:
  - data model соответствует `05-catalog`;
  - master product и external mapping не смешиваются;
  - constraints защищают SKU integrity и mapping uniqueness;
  - по данным можно восстановить, кто и каким путем изменил master-каталог.

**Что сделано**

**Дата выполнения:** 2026-04-26

### 1. schema.prisma — новые enum-типы
Добавлено 6 новых enum-типов:
- `ProductSourceOfTruth` (MANUAL, IMPORT, SYNC) — провенанс источника изменения товара
- `ProductStatus` (ACTIVE, DELETED) — явный lifecycle-статус
- `ChannelMarketplace` (WB, OZON, YANDEX_MARKET, SITE) — маркетплейс для channel mapping
- `ImportJobStatus` (PREVIEW, PROCESSING, COMPLETED, FAILED, CANCELLED)
- `ImportJobSource` (API_SYNC, EXCEL)
- `ImportItemAction` (CREATE, UPDATE, SKIP, MANUAL_REVIEW)

### 2. schema.prisma — расширение модели Product
Добавлены поля:
- `brand String? @db.VarChar(128)` — бренд товара
- `barcode String? @db.VarChar(128)` — универсальный штрихкод (отдельно от wbBarcode)
- `mainImageFileId String?` — ссылка на главное фото (будет FK к Files/S3 модулю)
- `sourceOfTruth ProductSourceOfTruth @default(MANUAL)` — источник последнего изменения
- `status ProductStatus @default(ACTIVE)` — явный lifecycle-статус (синхронизирован с deletedAt)
- `createdBy String?` — UUID пользователя-создателя (FK → User, ON DELETE SET NULL)
- `updatedBy String?` — UUID пользователя-редактора (FK → User, ON DELETE SET NULL)
- Отношения: `createdByUser`, `updatedByUser`, `channelMappings`
- Индекс: `@@index([tenantId, status])`

### 3. schema.prisma — новые модели каталога
- **`ProductChannelMapping`** — маппинг внутреннего SKU на внешний marketplace item.
  - UNIQUE(tenantId, marketplace, externalProductId) — защита от дублей
  - Хранит: marketplace, externalProductId, externalSku, isAutoMatched, createdBy
- **`CatalogImportJob`** — задача на импорт каталога.
  - Поля: source, status, totalRows, createdCount, updatedCount, errorCount, idempotencyKey, createdBy, finishedAt
  - Индексы: (tenantId, createdAt), (tenantId, status)
- **`CatalogImportJobItem`** — строки import job.
  - Поля: rowNumber, rawPayload (JSONB), validationErrors (JSONB), action
  - ON DELETE CASCADE от CatalogImportJob

### 4. Миграция SQL
Файл: `apps/api/prisma/migrations/20260426050000_catalog_data_model/migration.sql`
- CREATE TYPE для 6 новых enum-типов
- ALTER TABLE Product: добавлены 7 новых колонок
- Data migration: `UPDATE Product SET status = 'DELETED' WHERE deletedAt IS NOT NULL`
- CREATE TABLE для ProductChannelMapping, CatalogImportJob, CatalogImportJobItem
- Все FK, UNIQUE и индексы

### 5. product.service.ts
- Сигнатуры `create`, `update`, `remove`, `importFromWb` дополнены параметром `userId?: string`
- `create`: устанавливает `status=ACTIVE, sourceOfTruth=MANUAL, createdBy, updatedBy`
- `update`: устанавливает `updatedBy, sourceOfTruth=MANUAL`
- `remove`: устанавливает `status=DELETED, updatedBy`
- Восстановление (create при deletedAt != null): устанавливает `status=ACTIVE, sourceOfTruth=MANUAL`
- `importFromWb`: устанавливает `sourceOfTruth=IMPORT, createdBy/updatedBy`
- `findAll` фильтрует по `status: ACTIVE` (в дополнение к `deletedAt: null`)

### 6. product.controller.ts
- Все методы передают `req.user.id` как `userId` в сервис

### 7. DTO
- `CreateProductDto`: добавлены `brand?: string`, `barcode?: string`
- `UpdateProductDto`: добавлены `brand?: string`, `barcode?: string`

### Критерии закрытия — выполнено
- [x] data model соответствует `05-catalog` — все таблицы и поля из аналитики присутствуют
- [x] master product и external mapping не смешиваются — ProductChannelMapping отдельная таблица
- [x] constraints защищают SKU integrity и mapping uniqueness — UNIQUE(tenantId,sku) и UNIQUE(tenantId,marketplace,externalProductId)
- [x] по данным можно восстановить, кто и каким путем изменил master-каталог — createdBy, updatedBy, sourceOfTruth
