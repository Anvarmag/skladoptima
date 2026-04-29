# TASK_FILES_4 — Replace/Delete Flow, Cleanup Lifecycle и Reconciliation

> Модуль: `17-files-s3`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `10h`
- Зависимости:
  - `TASK_FILES_1`
  - `TASK_FILES_2`
  - `TASK_FILES_3`
  - согласован `18-worker`
- Что нужно сделать:
  - реализовать `POST /api/v1/files/:fileId/replace` и `DELETE /api/v1/files/:fileId`;
  - при replace атомарно переключать доменную ссылку на новый `file_id`;
  - переводить старые/удаленные/неподтвержденные файлы в cleanup lifecycle;
  - реализовать cleanup/reconcile jobs для `replaced`, `orphaned`, `deleted` файлов;
  - закрепить retention window = `7 дней` для `replaced / orphaned / deleted`.
- Критерий закрытия:
  - replace flow не ломает карточку товара;
  - orphan/replaced files не висят бесконтрольно;
  - broken record/object references выявляются и диагностируются через reconciliation.

**Что сделано**

### 1. `StorageService.deleteObject` — [storage.service.ts](apps/api/src/modules/files/storage.service.ts)

Добавлен `DeleteObjectCommand` из `@aws-sdk/client-s3`. Метод возвращает `true` при успехе или если объект уже отсутствует (404 = idempotent); бросает при других ошибках с логом метрики `storage_delete_error`.

### 2. Новые константы — [files.constants.ts](apps/api/src/modules/files/files.constants.ts)

- `RETENTION_WINDOW_DAYS = 7` — retention window для replaced/orphaned/deleted (system-analytics §22)
- `ORPHAN_WINDOW_SEC = 1800` (30 мин) — окно, после которого `uploading` без `confirm` становится `orphaned`; значение кратно 2× TTL presigned PUT URL

### 3. DTO — [dto/replace-file.dto.ts](apps/api/src/modules/files/dto/replace-file.dto.ts)

`ReplaceFileDto` с полем `newFileId: UUID`. Новый файл должен быть уже в статусе `active` (после `/confirm`).

### 4. `FilesService.replaceFile` — [files.service.ts](apps/api/src/modules/files/files.service.ts)

`POST /files/:fileId/replace { newFileId }`:
- RBAC (OWNER/ADMIN/MANAGER)
- Параллельный lookup: `oldFile` (active, tenantId) и `newFile` (active, tenantId)
- Валидация: newFile ≠ oldFile, одинаковый entityType/entityId (entity mismatch → 400)
- Атомарная транзакция: `oldFile→replaced`, `Product.mainImageFileId→newFileId`, lifecycle events (`file_replaced` + `file_became_active_via_replace`) для обоих файлов
- Метрика `file_replaced`
- Карточка товара не ломается: `mainImageFileId` атомарно переключается внутри одной транзакции

### 5. `FilesService.deleteFile` — [files.service.ts](apps/api/src/modules/files/files.service.ts)

`DELETE /files/:fileId`:
- RBAC
- Найти файл в статусе `active` или `replaced` (tenant-scoped)
- Транзакция: `status→deleted`, `deletedAt=now`, `Product.mainImageFileId→null` (если файл был текущим), lifecycle event `file_deleted`
- Метрика `file_deleted`

### 6. `FilesService.runCleanup` — [files.service.ts](apps/api/src/modules/files/files.service.ts)

`POST /files/cleanup/reconcile` — трёхфазный global job:

**Фаза 1a — Orphan marking**: `uploading` файлы старше `ORPHAN_WINDOW_SEC` → `orphaned` + lifecycle event `upload_orphaned`.

**Фаза 1b — Retention marking**: `replaced/orphaned/deleted` старше `RETENTION_WINDOW_DAYS` → `cleanup_pending` (batch update).

**Фаза 2 — Purge**: до 100 `cleanup_pending` файлов за запуск:
- `StorageService.deleteObject(objectKey)` → hard-delete DB record при успехе
- При ошибке S3: `status→cleanup_failed` + lifecycle event `cleanup_failed` (с сообщением ошибки)

**Фаза 3 — Reconcile**: до 50 `active`/`uploading` файлов (старейшие первыми), HeadObject:
- Если объект отсутствует в S3 → `status→orphaned` + lifecycle event `reconcile_object_missing`

Возвращает результат `{ orphaned, cleanupPending, purged, purgeFailed, reconciled }`. Метрика `cleanup_backlog`.

### 7. Новые endpoints в контроллере — [files.controller.ts](apps/api/src/modules/files/files.controller.ts)

| Method | Path | Guard |
|--------|------|-------|
| `POST` | `/files/cleanup/reconcile` | RequireActiveTenantGuard |
| `POST` | `/files/:fileId/replace` | + TenantWriteGuard |
| `DELETE` | `/files/:fileId` | + TenantWriteGuard |

`cleanup/reconcile` объявлен **до** параметрических маршрутов `/:fileId/*` для корректного routing в NestJS.

### Архитектурные решения

- Replace требует, чтобы `newFile` уже был в `active` (клиент прошёл полный upload+confirm flow). Это сохраняет разделение ответственности между confirm и replace.
- Delete — только логическое: S3 объект не трогается немедленно, retention window = 7 дней защищает от случайного удаления и позволяет браузерному кешу клиента корректно устареть.
- Reconcile ограничен 50 записями за запуск — защита от таймаута при большом количестве файлов; повторные вызовы обработают остальные.
- `deleteObject` idempotent: 404 из S3 трактуется как успех — cleanup не застревает на уже удалённых объектах.
