# Файлы / S3 — Системная аналитика

> Статус: [x] На review
> Последнее обновление: 2026-04-18
> Связанный раздел: `17-files-s3`

## 1. Назначение модуля

Модуль обеспечивает загрузку, хранение и безопасную выдачу медиа-файлов товаров через объектное хранилище (S3-compatible), с tenant-изоляцией и lifecycle cleanup.

### Текущее состояние (as-is)

- сейчас приложение раздает локальную папку `uploads` через `ServeStaticModule`, без отдельного files/S3 домена;
- выделенного backend-модуля object storage и file lifecycle в текущем коде нет;
- документация уже описывает более зрелый media/storage слой, чем текущая реализация на локальных загрузках.

### Целевое состояние (to-be)

- files должны стать отдельным модулем с upload URL, confirm, access URL, replace и delete lifecycle;
- объекты должны храниться в S3-совместимом хранилище с tenant-aware ключами и signed URLs;
- временные и замененные файлы должны управляться через cleanup политику, а не вручную;
- модуль должен быть согласован с `catalog`, `tenant access state` и audit policy, чтобы замена медиа не ломала карточку товара и не обходила write restrictions.


## 2. Функциональный контур и границы

### Что входит в модуль
- безопасная загрузка файлов;
- хранение file metadata и tenant ownership;
- выдача файлов через signed URL/private access;
- replace/cleanup lifecycle для media;
- контроль изоляции доступа к объектам;
- защита от orphan records/objects и broken product references.

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
| Owner/Admin | Загружает, заменяет и удаляет файлы | Только в рамках своих сущностей и tenant |
| Manager | Просматривает файлы | Write-операции только если это разрешено catalog RBAC, иначе read-only |
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

### Сценарий 4. Tenant в ограниченном состоянии
1. Tenant переходит в `TRIAL_EXPIRED`.
2. Доступ к уже существующим product images на чтение сохраняется.
3. Новые upload/replace/delete блокируются как write-операции.
4. При `SUSPENDED/CLOSED` новые signed access URLs не выдаются в пользовательском контуре, кроме внутренних support/admin сценариев по отдельной политике.

## 5. Зависимости и интеграции

- Catalog (main product image)
- IAM/Secrets (доступ к S3)
- Worker (cleanup jobs)
- Audit
- Tenant access-state policy

## 6. API-контракт (внедрить)

| Метод | Endpoint | Auth | Назначение |
|------|----------|------|------------|
| `POST` | `/api/v1/files/upload-url` | Owner/Admin/Manager | Получить pre-signed URL для upload |
| `POST` | `/api/v1/files/confirm` | Owner/Admin/Manager | Подтвердить загруженный файл |
| `GET` | `/api/v1/files/:fileId/access-url` | User | Получить временную ссылку на чтение |
| `POST` | `/api/v1/files/:fileId/replace` | Owner/Admin/Manager | Замена файла |
| `DELETE` | `/api/v1/files/:fileId` | Owner/Admin | Логическое удаление/отвязка |
| `POST` | `/api/v1/files/cleanup/reconcile` | Internal | Сверка orphan objects/records |

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

### Frontend поведение

- Текущее состояние: выделенного UI управления файлами и media library в текущем web-клиенте нет.
- Целевое состояние: product/media сценарии должны работать через upload flow, preview и replacement без прямой работы с файловой системой.
- UX-правило: пользователь не должен видеть техническую реализацию storage, только понятные состояния загрузки, подтверждения и замены.
- В MVP продуктовый UI опирается на сценарий `single main image` для товара, даже если модель хранения потом расширится.
- При `TRIAL_EXPIRED` preview существующих фото работает, но upload/replace/delete CTA скрываются или блокируются.

## 8. Модель данных (PostgreSQL)

### `files`
- `id UUID PK`, `tenant_id UUID`
- `entity_type ENUM(product_main_image)`
- `entity_id UUID`
- `object_key TEXT NOT NULL`
- `bucket VARCHAR(128) NOT NULL`
- `storage_provider ENUM(s3_compatible) NOT NULL`
- `mime_type VARCHAR(128)`, `size_bytes BIGINT`
- `checksum_sha256 VARCHAR(64) NULL`
- `original_filename TEXT`
- `status ENUM(uploading, active, replaced, deleted, orphaned, cleanup_pending, cleanup_failed)`
- `visibility ENUM(private) NOT NULL DEFAULT 'private'`
- `uploaded_by UUID`, `uploaded_at`, `created_at`, `updated_at`, `deleted_at`

### `file_lifecycle_events`
- `id UUID PK`, `file_id UUID`, `event_type`, `payload JSONB`, `created_at`

## 9. Сценарии и алгоритмы (step-by-step)

1. Клиент запрашивает `upload-url` с метаданными файла.
2. Сервер проверяет tenant state, RBAC, entity ownership и допустимость write-операции.
3. Создает `files(status=uploading)` и выдает pre-signed PUT URL.
4. После upload клиент вызывает `confirm`; сервер проверяет object existence/size/mime/checksum.
5. Файл переводится в `active`, привязывается к `product.main_image_file_id`.
6. При замене новый файл становится активным, старый `replaced` и уходит в cleanup pipeline.
7. Если confirm не пришел в TTL, запись и объект помечаются как `orphaned` и подлежат cleanup.

## 10. Валидации и ошибки

- Разрешенные форматы: `jpg/jpeg/png/webp`.
- Лимит размера: `<= 10 MB`.
- `upload-url` нельзя выдавать для чужого `entity_id` или сущности другого tenant.
- Для `TRIAL_EXPIRED` write-операции запрещены, но read access к уже активным product images разрешен.
- Для `SUSPENDED/CLOSED` выдача user-facing access URL блокируется.
- Ошибки:
  - `VALIDATION_ERROR: FILE_FORMAT_NOT_ALLOWED`
  - `VALIDATION_ERROR: FILE_TOO_LARGE`
  - `FORBIDDEN: CROSS_TENANT_FILE_ACCESS`
  - `FORBIDDEN: FILE_WRITE_BLOCKED_BY_TENANT_STATE`
  - `FORBIDDEN: FILE_READ_BLOCKED_BY_TENANT_STATE`
  - `NOT_FOUND: FILE_UPLOAD_OBJECT_NOT_FOUND`

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
- Orphan uploads и replaced files попадают в управляемый cleanup lifecycle.

## 13. Object key strategy

- Формат: `{tenant_id}/products/{file_id}.{ext}`
- Нельзя использовать оригинальное имя файла как часть object key
- Оригинальное имя хранится только в БД как metadata
- Object key не должен содержать бизнес-секреты, SKU или пользовательские названия

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

### Access-state policy
- `ACTIVE`: upload/read/replace/delete разрешены по RBAC.
- `TRIAL_EXPIRED`: только read существующих активных файлов.
- `SUSPENDED`: user-facing access URL не выдаются, write запрещен.
- `CLOSED`: user-facing access URL не выдаются, cleanup идет по retention policy.

## 15. Cleanup и lifecycle

- `uploading -> active`
- `active -> replaced`
- `active/replaced -> deleted`
- `uploading -> orphaned`
- `replaced/orphaned/deleted -> cleanup_pending -> purged`

### Cleanup jobs
- orphaned uploads без `confirm`
- replaced files старше retention window
- deleted files после hard-purge job
- records без объекта в storage получают reconciliation flag и требуют диагностического алерта

## 16. Тестовая матрица

- Успешный upload и confirm.
- Upload неподдерживаемого формата.
- Upload > 10MB.
- Доступ к файлу другого tenant.
- Replace main image.
- Cleanup orphaned upload.
- Blocked upload/replace в `TRIAL_EXPIRED`.
- Blocked access-url в `SUSPENDED/CLOSED`.
- Broken object reference reconciliation.

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
- Signed access URL должны жить короткий TTL и не переиспользоваться как постоянные публичные ссылки.

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
- Если рано разрешить множественные product media без явной ordering/model policy, каталог быстро получит несогласованную UX и сложный replace flow.

## 21. Открытые вопросы к продукту и архитектуре

- Для MVP открытых product/blocking questions не осталось.

## 22. Подтвержденные решения

- В MVP основная модель доступа к файлам подтверждена через `signed URL`, без backend proxy streaming для основного пользовательского трафика.
- Продуктовая модель MVP подтверждена как `single main image per product`.
- Multi-image gallery и расширенная media ordering policy уходят в future scope.
- Retention window для `replaced / orphaned / deleted` файлов в MVP = `7 дней`.

## 23. Чеклист готовности раздела

- [ ] Текущее и целевое состояние раздела зафиксированы.
- [ ] Backend API, frontend поведение и модель данных согласованы между собой.
- [ ] Async-процессы, observability и тестовая матрица описаны.
- [ ] Риски, ограничения и rollout-порядок зафиксированы.

## 24. История изменений

| Дата | Изменение | Автор |
|------|-----------|-------|
| 2026-04-18 | Документ приведен к единой глубине system analytics | Codex |
| 2026-04-18 | Добавлены tenant access-state policy, lifecycle cleanup и открытые решения по access model/media scope/retention | Codex |
| 2026-04-18 | Зафиксированы confirmed decisions по signed access, single-image MVP scope и retention window | Codex |
