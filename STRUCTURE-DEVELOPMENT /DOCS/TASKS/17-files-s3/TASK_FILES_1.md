# TASK_FILES_1 — File Metadata, Object Key Strategy и Lifecycle Data Model

> Модуль: `17-files-s3`
> Статус: [ ] Не начат / [ ] В работе / [ ] Завершён

---

- [ ] Выполнено
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

**Что сделано**

- Не выполнено.
