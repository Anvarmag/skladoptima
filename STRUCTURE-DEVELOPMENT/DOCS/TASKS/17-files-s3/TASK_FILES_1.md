# TASK_FILES_1 — File Metadata, Object Key Strategy и Lifecycle Data Model

> Модуль: `17-files-s3`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `9h`
- Зависимости:
  - утверждена системная аналитика `17-files-s3`
  - согласованы `05-catalog`, `18-worker`
- Что нужно сделать:
  - завести `files` и `file_lifecycle_events`;
  - закрепить object key strategy `{tenant_id}/products/{file_id}.{ext}`;
  - зафиксировать lifecycle `uploading`, `active`, `replaced`, `deleted`, `orphaned`, `cleanup_pending`, `cleanup_failed`;
  - хранить `mime_type`, `size_bytes`, `checksum_sha256`, `original_filename`, `uploaded_by`, `deleted_at`;
  - не использовать оригинальное имя файла, SKU или пользовательские названия в object key.
- Критерий закрытия:
  - data model покрывает metadata, lifecycle и cleanup сценарии;
  - object key tenant-aware и не содержит бизнес-секретов;
  - локальный диск исключен как постоянное хранилище.

---

## Что сделано

### 1. Анализ текущего состояния

Перед реализацией изучено текущее MVP:
- `ServeStaticModule` раздаёт локальную папку `./uploads` без tenant-изоляции
- Multer сохраняет файлы на диск по схеме `{timestamp}-{random}.{ext}`
- `Product.photo` — строковый путь к локальному файлу (`/uploads/filename.jpg`)
- `Product.mainImageFileId` — поле UUID уже добавлено в БД (миграция `20260426050000_catalog_data_model`) и в DTOs, но было **мёртвым кодом**: ни File-таблицы, ни сервиса не существовало
- Задача: реализовать полноценный data model под S3, закрепить object key strategy и FK, сохранив обратную совместимость с legacy `photo` полем

### 2. Новые enum'ы в `schema.prisma`

Добавлены 4 enum'а (раздел "Files / S3 enums"):

| Enum | Значения |
|------|---------|
| `FileEntityType` | `product_main_image` |
| `FileStatus` | `uploading`, `active`, `replaced`, `deleted`, `orphaned`, `cleanup_pending`, `cleanup_failed` |
| `FileStorageProvider` | `s3_compatible` |
| `FileVisibility` | `private` |

### 3. Модель `File` в `schema.prisma`

Создана полная модель `File` с:
- `id`, `tenantId` — идентификатор и tenant ownership (с CASCADE delete)
- `entityType FileEntityType`, `entityId String?` — к какой доменной сущности привязан файл
- `objectKey TEXT` — строго `{tenant_id}/products/{file_id}.{ext}`, без бизнес-данных
- `bucket VARCHAR(128)`, `storageProvider FileStorageProvider` — координаты объектного хранилища
- `mimeType VARCHAR(128)`, `sizeBytes BIGINT`, `checksumSha256 VARCHAR(64)` — metadata и integrity
- `originalFilename TEXT` — хранится только как metadata, в object key НИКОГДА не попадает
- `status FileStatus DEFAULT uploading`, `visibility FileVisibility DEFAULT private`
- `uploadedBy`, `uploadedAt`, `deletedAt`, `createdAt`, `updatedAt`
- relation `products Product[] @relation("ProductMainImage")` — обратная связь
- Индексы: `(tenantId, status)`, `(tenantId, entityType, entityId)`, `(tenantId, createdAt DESC)`

### 4. Модель `FileLifecycleEvent` в `schema.prisma`

- `id`, `fileId` (FK → File с CASCADE delete), `eventType VARCHAR(64)`, `payload JSONB`, `createdAt`
- Индекс: `(fileId, createdAt DESC)` — для быстрого fetch истории событий

### 5. Обновление модели `Product`

Добавлена Prisma relation:
```prisma
mainImage File? @relation("ProductMainImage", fields: [mainImageFileId], references: [id], onDelete: SetNull)
```
`ON DELETE SET NULL` гарантирует: удаление File обнуляет `Product.mainImageFileId` без broken reference.

### 6. Обновление модели `Tenant`

Добавлена обратная связь `files File[]` — для cascade queries и явного отражения ownership в ORM.

### 7. Миграция `20260428280000_files_data_model`

Файл `apps/api/prisma/migrations/20260428280000_files_data_model/migration.sql`:
- `CREATE TYPE` для 4 enum'ов
- `CREATE TABLE "File"` с полным набором колонок
- `CREATE TABLE "FileLifecycleEvent"` с CASCADE FK на File
- 4 индекса на обеих таблицах
- FK: `File.tenantId → Tenant.id CASCADE`, `FileLifecycleEvent.fileId → File.id CASCADE`
- FK: `Product.mainImageFileId → File.id ON DELETE SET NULL` — связывает существующий мёртвый UUID-столбец с реальной таблицей

### 8. `prisma generate` — успешно

Prisma Client (v5.21.1) пересобран с новыми типами `File`, `FileLifecycleEvent`, `FileEntityType`, `FileStatus`, `FileStorageProvider`, `FileVisibility`.

### Критерии закрытия — выполнены

- [x] Data model покрывает metadata, lifecycle и cleanup сценарии
- [x] Object key strategy `{tenant_id}/products/{file_id}.{ext}` закреплена в schema комментариях и в migration SQL
- [x] Object key не содержит оригинального имени файла, SKU или бизнес-секретов
- [x] Локальный диск исключён как постоянное хранилище (legacy `photo` поле остаётся для backward compat до полной миграции в TASK_FILES_3)
- [x] `Product.mainImageFileId` теперь имеет реальный FK constraint, а не мёртвый UUID-столбец
