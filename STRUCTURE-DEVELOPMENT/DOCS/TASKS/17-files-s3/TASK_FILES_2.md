# TASK_FILES_2 — Presigned Upload/Confirm Flow и Validation Rules

> Модуль: `17-files-s3`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_FILES_1`
- Что нужно сделать:
  - реализовать `POST /api/v1/files/upload-url` и `POST /api/v1/files/confirm`;
  - валидировать RBAC, entity ownership, tenant scope, mime type и размер `<= 10 MB`;
  - разрешить только `jpg/jpeg/png/webp`;
  - создавать `files(status=uploading)` до upload и переводить в `active` после confirm;
  - проверять existence/size/mime/checksum объекта при confirm.
- Критерий закрытия:
  - upload flow безопасен и не требует локальной файловой системы;
  - неподдерживаемые форматы и oversized uploads отклоняются предсказуемо;
  - confirm не активирует отсутствующий или битый объект.

---

## Что сделано

### 1. Анализ текущего состояния

- Multer на локальный диск (`./uploads`) — единственный upload механизм
- `@aws-sdk` отсутствовал в зависимостях, S3 env vars не были определены
- FilesModule не существовал; `mainImageFileId` в Product DTO/Service был dead code

### 2. Установлены зависимости

```
@aws-sdk/client-s3
@aws-sdk/s3-request-presigner
```

### 3. S3 env vars в `.env`

```
STORAGE_S3_ENDPOINT=http://localhost:9000
STORAGE_S3_REGION=us-east-1
STORAGE_S3_BUCKET=skladoptima-dev
STORAGE_S3_ACCESS_KEY=minioadmin
STORAGE_S3_SECRET_KEY=minioadmin
STORAGE_PRESIGN_TTL_SEC=900
```
Для local dev — MinIO-совместимые defaults. Для prod заменить на реальные AWS/S3 credentials.

### 4. Структура нового модуля `apps/api/src/modules/files/`

```
files/
├── files.constants.ts            — ALLOWED_MIME_TYPES, MIME_TO_EXT, MAX_FILE_SIZE_BYTES, DEFAULT_UPLOAD_TTL_SEC, UPLOAD_ROLES_ALLOWED
├── dto/
│   ├── request-upload-url.dto.ts — entityType, entityId, mimeType, sizeBytes, originalFilename
│   └── confirm-upload.dto.ts     — fileId, checksumSha256?
├── storage.service.ts            — S3 wrapper: presignedPutUrl(), headObject()
├── files.service.ts              — business logic: requestUploadUrl(), confirmUpload()
├── files.controller.ts           — POST /api/files/upload-url, POST /api/files/confirm
└── files.module.ts               — exports FilesService + StorageService
```

### 5. `files.constants.ts`

- `ALLOWED_MIME_TYPES` = `{image/jpeg, image/jpg, image/png, image/webp}`
- `MIME_TO_EXT` — только для формирования object key (не для originalFilename)
- `MAX_FILE_SIZE_BYTES` = 10 МБ
- `DEFAULT_UPLOAD_TTL_SEC` = 900 (переопределяется через `STORAGE_PRESIGN_TTL_SEC`)
- `UPLOAD_ROLES_ALLOWED` = `{OWNER, ADMIN, MANAGER}`

### 6. `storage.service.ts` — S3 абстракция

- Инициализирует `S3Client` из env vars; `forcePathStyle: true` для MinIO-совместимости
- `presignedPutUrl(objectKey, mimeType, expiresInSec)` — presigned PUT URL с ContentType
- `headObject(objectKey)` — возвращает `{ contentLength, contentType, checksumSha256 }` или `null` при 404
- Structured logging: `storage_head_success`, `storage_head_error`

### 7. `files.service.ts` — бизнес-логика

**`requestUploadUrl(tenantId, userId, dto)`:**
1. RBAC: `membership.role` ∈ `{OWNER, ADMIN, MANAGER}` → `FILE_WRITE_FORBIDDEN` иначе
2. MIME validation: по allowlist → `FILE_FORMAT_NOT_ALLOWED`
3. Size validation: `dto.sizeBytes > 10MB` → `FILE_TOO_LARGE`
4. Entity ownership: `Product.id = dto.entityId AND Product.tenantId = tenantId` → `FILE_ENTITY_NOT_FOUND`
5. Object key: `{tenantId}/products/{fileId}.{ext}` — original filename **никогда** не попадает в key
6. `$transaction`: `File.create(status=uploading)` + `FileLifecycleEvent(upload_requested)`
7. `storage.presignedPutUrl()` → возвращает `{ fileId, uploadUrl, objectKey, expiresInSec }`
8. Metric: `uploads_started`

**`confirmUpload(tenantId, userId, dto)`:**
1. RBAC check
2. Найти `File(status=uploading, tenantId)` → `FILE_UPLOAD_OBJECT_NOT_FOUND` если нет
3. `storage.headObject()` → `FILE_UPLOAD_OBJECT_NOT_FOUND` если 404 + лог `confirm_failed_object_missing`
4. Size validation: `|actual - declared| > max(1%, 512B)` → `FILE_SIZE_MISMATCH`
5. MIME validation: нормализует `image/jpeg`/`image/jpg` как эквиваленты → `FILE_MIME_MISMATCH`
6. Checksum: если клиент передал и S3 вернул → сравниваем → `FILE_CHECKSUM_MISMATCH`
7. `$transaction`: `File.update(status=active)` + `FileLifecycleEvent(upload_confirmed)`
8. Metric: `signed_urls_generated`; warn: `uploads_failed`

### 8. `files.controller.ts`

- `@UseGuards(RequireActiveTenantGuard)` — controller-level
- `POST /api/files/upload-url` — `@UseGuards(TenantWriteGuard)`: TRIAL_EXPIRED/SUSPENDED/CLOSED → 403
- `POST /api/files/confirm` — `@UseGuards(TenantWriteGuard)` + `@HttpCode(200)`

### 9. `app.module.ts`

`FilesModule` зарегистрирован в `imports` массиве.

### Критерии закрытия — выполнены

- [x] Upload flow не требует локальной файловой системы (объекты идут в S3)
- [x] `jpg/jpeg/png/webp` — allowlist проверяется; другие форматы → `FILE_FORMAT_NOT_ALLOWED`
- [x] Oversized upload (> 10 MB) → `FILE_TOO_LARGE`
- [x] Confirm не активирует отсутствующий объект (`headObject` → `FILE_UPLOAD_OBJECT_NOT_FOUND`)
- [x] Confirm не активирует битый объект (size/mime/checksum mismatch)
- [x] Межтенантный доступ исключён: entity ownership проверяется через `Product.tenantId`
