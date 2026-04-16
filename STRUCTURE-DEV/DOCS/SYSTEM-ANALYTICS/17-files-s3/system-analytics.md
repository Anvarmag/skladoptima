# Файлы / S3 — Системная аналитика (Dev Spec)

> Статус: [ ] Черновик / [x] На review / [ ] Утверждено
> Последнее обновление: 2026-04-15

## 1. Назначение

Модуль обеспечивает загрузку, хранение и безопасную выдачу медиа-файлов товаров через объектное хранилище (S3-compatible), с tenant-изоляцией и lifecycle cleanup.

## 2. Функциональный контур и границы

### Что входит в модуль
- безопасная загрузка файлов;
- хранение file metadata и tenant ownership;
- выдача файлов через signed URL/private access;
- replace/cleanup lifecycle для media;
- контроль изоляции доступа к объектам.

### Что не входит в модуль
- полноценный DAM/медиа-редактор;
- тяжелый image-processing pipeline beyond agreed thumbnails;
- публичный CDN без tenant isolation;
- каталог товаров и бизнес-атрибуты, кроме ссылок на file records.

### Главный результат работы модуля
- медиа хранятся в объектном хранилище безопасно, воспроизводимо и без утечки файлов между tenant.

## 3. Акторы и зоны ответственности

| Актор | Что делает | Ограничения / комментарии |
|------|------------|----------------------------|
| Owner/Admin/Manager | Загружает и меняет файлы | Только в рамках своих сущностей и tenant |
| File service | Управляет metadata и signed access | Центральный слой доступа |
| Object storage | Хранит binary objects | Не содержит бизнес-логики |
| Cleanup worker | Удаляет obsolete/orphan files | Только по политике lifecycle |

## 4. Базовые сценарии использования

### Сценарий 1. Загрузка файла
1. Пользователь инициирует upload.
2. Backend валидирует размер, mime и tenant scope.
3. Создается metadata record и/или presigned upload flow.
4. После успешной загрузки объект связывается с доменной сущностью.

### Сценарий 2. Выдача файла
1. Клиент запрашивает доступ к media.
2. Backend проверяет tenant ownership и права.
3. Возвращает signed URL или proxy-stream.
4. Доступ живет ограниченный TTL.

### Сценарий 3. Замена и cleanup
1. Пользователь загружает новый файл для сущности.
2. Доменная ссылка атомарно переключается на новый `file_id`.
3. Старый файл переводится в cleanup pending.
4. Worker физически удаляет объект после retention window.

## 5. Зависимости и интеграции

- Catalog (main product image)
- IAM/Secrets (доступ к S3)
- Worker (cleanup jobs)
- Audit

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `POST` | `/api/v1/files/upload-url` | Owner/Admin/Manager | Получить pre-signed URL для upload |
| `POST` | `/api/v1/files/confirm` | Owner/Admin/Manager | Подтвердить загруженный файл |
| `GET` | `/api/v1/files/:fileId/access-url` | User | Получить временную ссылку на чтение |
| `POST` | `/api/v1/files/:fileId/replace` | Owner/Admin/Manager | Замена файла |
| `DELETE` | `/api/v1/files/:fileId` | Owner/Admin | Логическое удаление/отвязка |

## 7. Примеры вызова API

```bash
curl -X POST /api/v1/files/upload-url \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"entityType":"PRODUCT_MAIN_IMAGE","entityId":"prd_...","mimeType":"image/jpeg","sizeBytes":512000}'
```

```json
{
  "fileId": "fil_...",
  "uploadUrl": "https://s3...signed",
  "objectKey": "tenant_x/products/fil_...jpg",
  "expiresInSec": 900
}
```

## 8. Модель данных (PostgreSQL)

### `files`
- `id UUID PK`, `tenant_id UUID`
- `entity_type ENUM(product_main_image)`
- `entity_id UUID`
- `object_key TEXT NOT NULL`
- `bucket VARCHAR(128) NOT NULL`
- `mime_type VARCHAR(128)`, `size_bytes BIGINT`
- `original_filename TEXT`
- `status ENUM(uploading, active, replaced, deleted)`
- `uploaded_by UUID`, `uploaded_at`, `created_at`, `updated_at`, `deleted_at`

### `file_lifecycle_events`
- `id UUID PK`, `file_id UUID`, `event_type`, `payload JSONB`, `created_at`

## 9. Сценарии и алгоритмы (step-by-step)

1. Клиент запрашивает `upload-url` с метаданными файла.
2. Сервер создает `files(status=uploading)` и выдает pre-signed PUT URL.
3. После upload клиент вызывает `confirm`; сервер проверяет object existence/size/mime.
4. Файл переводится в `active`, привязывается к `product.main_image_file_id`.
5. При замене новый файл становится активным, старый `replaced` и уходит в cleanup pipeline.

## 10. Валидации и ошибки

- Разрешенные форматы: `jpg/jpeg/png/webp`.
- Лимит размера: `<= 10 MB`.
- Ошибки:
  - `VALIDATION_ERROR: FILE_FORMAT_NOT_ALLOWED`
  - `VALIDATION_ERROR: FILE_TOO_LARGE`
  - `FORBIDDEN: CROSS_TENANT_FILE_ACCESS`

## 11. Чеклист реализации

- [ ] Таблица `files` + lifecycle events.
- [ ] Pre-signed upload/download flows.
- [ ] Tenant-aware object key strategy.
- [ ] Cleanup job replaced/orphaned files.
- [ ] Аудит upload/replace/delete.

## 12. Критерии готовности (DoD)

- Локальный диск не используется как постоянное хранилище.
- Межтенантный доступ к файлам технически невозможен.
- Замена фото не ломает карточку товара.

## 13. Object key strategy

- Формат: `{tenant_id}/products/{file_id}.{ext}`
- Нельзя использовать оригинальное имя файла как часть object key
- Оригинальное имя хранится только в БД как metadata

## 14. Upload/download flow

### Upload
1. Клиент получает pre-signed PUT URL
2. Загружает файл напрямую в S3
3. Вызывает `confirm`
4. Backend проверяет object existence и metadata

### Download
1. Клиент запрашивает `access-url`
2. Backend проверяет tenant access
3. Возвращает pre-signed GET URL с коротким TTL

## 15. Cleanup и lifecycle

- `uploading -> active`
- `active -> replaced`
- `active/replaced -> deleted`

### Cleanup jobs
- orphaned uploads без `confirm`
- replaced files старше retention window
- deleted files после hard-purge job

## 16. Тестовая матрица

- Успешный upload и confirm.
- Upload неподдерживаемого формата.
- Upload > 10MB.
- Доступ к файлу другого tenant.
- Replace main image.
- Cleanup orphaned upload.

## 17. Фазы внедрения

1. `files` table и metadata.
2. Presigned upload/download API.
3. Product image linkage.
4. Replace flow.
5. Cleanup worker jobs + audit.

## 18. Нефункциональные требования и SLA

- Upload/download flows должны поддерживать private storage model и не полагаться на публичный bucket.
- Read access к metadata и signed URL generation: `p95 < 300 мс`.
- Файлы и metadata должны связываться transactionally enough, чтобы не плодить orphan records при типовых сбоях.
- Cleanup должен быть безопасным и отложенным, чтобы не удалять файлы, на которые еще ссылается UI/cache.

## 19. Observability, логи и алерты

- Метрики: `uploads_started`, `uploads_failed`, `signed_urls_generated`, `access_denied`, `cleanup_backlog`, `orphan_files_detected`.
- Логи: validation failures, object key creation, replace operations, cleanup decisions.
- Алерты: любой cross-tenant successful access, всплеск upload failures, backlog cleanup growth, broken reference rate.
- Dashboards: file upload health, access security monitor, cleanup lifecycle board.

## 20. Риски реализации и архитектурные замечания

- Нельзя строить модуль на локальном диске как долгосрочной стратегии, если продукт мульти-инстансный.
- Metadata и object lifecycle нужно проектировать вместе, иначе неизбежны orphan objects и битые ссылки.
- Прямая выдача bucket path пользователю без signed policy неприемлема для tenant-isolated продукта.
- При последующем добавлении thumbnail/transform flows они должны оставаться производными от исходного file record, а не отдельной неуправляемой моделью.
