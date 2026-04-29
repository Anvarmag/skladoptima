# TASK_FILES_3 — Signed Access URL, Read Policy и Tenant Isolation

> Модуль: `17-files-s3`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_FILES_1`
  - `TASK_FILES_2`
- Что нужно сделать:
  - реализовать `GET /api/v1/files/:fileId/access-url`;
  - выдавать только короткоживущий `signed URL` без backend proxy streaming в основном user path;
  - проверять tenant ownership и user RBAC перед выдачей ссылки;
  - заблокировать cross-tenant access технически и прикладно;
  - обеспечить private storage model без публичного bucket path.
- Критерий закрытия:
  - user-facing доступ идет через signed URL и не становится постоянной публичной ссылкой;
  - межтенантный доступ невозможен;
  - read policy соответствует access-state и RBAC.

**Что сделано**

Реализован полный flow чтения файлов через presigned GET URL:

### 1. `StorageService` — метод `presignedGetUrl`

Добавлен метод `presignedGetUrl(objectKey, expiresInSec)` в [storage.service.ts](apps/api/src/modules/files/storage.service.ts). Использует `GetObjectCommand` из `@aws-sdk/client-s3` и `getSignedUrl` из presigner. Bucket path пользователю никогда не раскрывается — только подписанный URL с истекающим сроком.

### 2. `files.constants.ts` — новые константы

Добавлены в [files.constants.ts](apps/api/src/modules/files/files.constants.ts):
- `DEFAULT_ACCESS_TTL_SEC = 300` (5 минут, короткоживущий TTL по system-analytics §18)
- `READ_BLOCKED_STATES = new Set(['SUSPENDED', 'CLOSED'])` — `TRIAL_EXPIRED` **намеренно исключён**: read существующих активных файлов разрешён при `TRIAL_EXPIRED` (system-analytics §14)

### 3. `FilesService` — два новых guard-метода + `getAccessUrl`

Добавлены в [files.service.ts](apps/api/src/modules/files/files.service.ts):

- `assertCanRead(tenantId, userId)` — проверяет наличие ACTIVE membership любой роли (все члены tenant могут читать)
- `assertReadAllowedByTenantState(accessState)` — блокирует `SUSPENDED`/`CLOSED` с кодом `FILE_READ_BLOCKED_BY_TENANT_STATE`, логирует метрику `access_denied`
- `getAccessUrl(tenantId, userId, fileId, accessState?)`:
  1. Проверяет access-state (SUSPENDED/CLOSED → 403)
  2. Проверяет RBAC (active membership)
  3. Lookup файла: `{ id: fileId, tenantId, status: active }` — tenant-scope на уровне БД делает cross-tenant доступ технически невозможным; при несоответствии возвращает 404 (а не 403) — не раскрывает факт существования объекта в другом тенанте (information disclosure protection)
  4. Генерирует presigned GET URL (TTL из `STORAGE_ACCESS_TTL_SEC` env || 300s)
  5. Создаёт `FileLifecycleEvent(access_url_issued)` с `userId` и `expiresInSec`
  6. Логирует метрику `signed_urls_generated` с `kind: 'get'`
  7. Возвращает `{ fileId, accessUrl, expiresInSec }`

### 4. `FilesController` — GET endpoint

Добавлен в [files.controller.ts](apps/api/src/modules/files/files.controller.ts):
- `GET /api/files/:fileId/access-url`
- Использует `RequireActiveTenantGuard` (от класса), без `TenantWriteGuard` — это read operation
- Передаёт `req.activeTenant?.accessState` в сервис для access-state check

### Безопасность и изоляция

| Угроза | Защита |
|--------|--------|
| Cross-tenant access | Lookup `{ id, tenantId }` — невозможно получить файл чужого tenant |
| Information disclosure | 404 вместо 403 при cross-tenant запросе |
| Постоянная публичная ссылка | TTL 5 мин, bucket никогда не возвращается клиенту |
| SUSPENDED/CLOSED tenant | 403 с кодом `FILE_READ_BLOCKED_BY_TENANT_STATE` |
| TRIAL_EXPIRED tenant | Read разрешён для активных файлов (по аналитике §14) |
