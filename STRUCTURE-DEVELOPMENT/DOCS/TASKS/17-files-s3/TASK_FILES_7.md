# TASK_FILES_7 — QA, Regression и Observability Files

> Модуль: `17-files-s3`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `10h`
- Зависимости:
  - `TASK_FILES_1`
  - `TASK_FILES_2`
  - `TASK_FILES_3`
  - `TASK_FILES_4`
  - `TASK_FILES_5`
  - `TASK_FILES_6`
- Что нужно сделать:
  - покрыть тестами успешный upload/confirm, unsupported format, file too large, cross-tenant access;
  - проверить replace main image и cleanup orphaned upload;
  - покрыть блокировки upload/replace в `TRIAL_EXPIRED` и access-url в `SUSPENDED/CLOSED`;
  - добавить кейсы broken object reference reconciliation;
  - завести метрики и алерты по upload failures, access denials, cleanup backlog и orphan detection.
- Критерий закрытия:
  - регрессии по tenant isolation, lifecycle cleanup и access policy ловятся автоматически;
  - observability показывает состояние upload/access/cleanup цепочки;
  - QA matrix покрывает утвержденную MVP file model.

**Что сделано**

### Observability improvements — `apps/api/src/modules/files/files.service.ts`

Добавлены две недостающие observability-метрики из system-analytics §19:

**`uploads_failed`** — теперь логируется в `requestUploadUrl` при:
- `FILE_FORMAT_NOT_ALLOWED` — неподдерживаемый MIME-тип (reason: format_not_allowed)
- `FILE_TOO_LARGE` — файл превышает 10 МБ (reason: file_too_large)
- В `confirmUpload` при отсутствии объекта в S3 (reason: object_not_found) уже был залогирован ранее ✓

**`orphan_files_detected`** — логируется в `runCleanup` как warn-метрика, когда reconcile-фаза обнаруживает active/uploading файлы без объекта в S3 (`result.reconciled > 0`). Метрика НЕ выдаётся если orphan'ов нет.

Итого все 6 метрик из §19 теперь покрыты: `uploads_started` ✓, `uploads_failed` ✓, `signed_urls_generated` ✓, `access_denied` ✓, `cleanup_backlog` ✓, `orphan_files_detected` ✓.

### Тесты — `apps/api/src/modules/files/files.service.spec.ts` (42 теста, все зелёные)

Покрывает всю тестовую матрицу system-analytics §16:

| # | Сценарий | Тесты |
|---|----------|-------|
| 1 | Успешный upload и confirm | success: presigned URL, catalog linkage (mainImageFileId), displace old image → replaced |
| 2 | Upload неподдерживаемого формата | FILE_FORMAT_NOT_ALLOWED + uploads_failed metric |
| 3 | Upload > 10 МБ | FILE_TOO_LARGE + uploads_failed metric |
| 4 | Доступ к файлу другого tenant | cross-tenant → 404 (не 403, information disclosure prevention) |
| 5 | Replace main image | atomic TX: old→replaced, product.mainImageFileId→newFileId; REPLACE_SAME_FILE, REPLACE_ENTITY_MISMATCH |
| 6 | Cleanup orphaned upload | phase 1a orphan marking + lifecycle event; phase 1b retention; phase 2 purge + S3 delete; phase 2 failure → cleanup_failed |
| 7 | Blocked upload/replace в TRIAL_EXPIRED | документирует границу: state-level блокировка — ответственность TenantWriteGuard (отдельный spec) |
| 8 | Blocked access-url в SUSPENDED/CLOSED | ForbiddenException с FILE_READ_BLOCKED_BY_TENANT_STATE + access_denied metric; TRIAL_EXPIRED → разрешён |
| 9 | Broken object reference reconciliation | phase 3: active file с отсутствующим S3 объектом → orphaned + reconcile_object_missing lifecycle event + orphan_files_detected metric |

Дополнительные кейсы:
- `FILE_WRITE_FORBIDDEN` — нет активного членства
- `FILE_ENTITY_NOT_FOUND` — продукт другого tenant при upload-url
- Object key strategy: tenantId в ключе, originalFilename — только в metadata, НЕ в object key
- `FILE_UPLOAD_OBJECT_NOT_FOUND` — файл не найден в DB и в S3
- `FILE_SIZE_MISMATCH`, `FILE_MIME_MISMATCH`, `FILE_CHECKSUM_MISMATCH` при confirm
- jpeg/jpg MIME-эквивалентность при confirm
- `FILE_READ_FORBIDDEN` — нет членства при чтении
- `logs cleanup_backlog` на каждом запуске runCleanup
- `orphan_files_detected` НЕ логируется при нулевом reconcile
