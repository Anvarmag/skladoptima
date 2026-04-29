# TASK_FILES_5 — Access-State Guards, Catalog Linkage и Audit

> Модуль: `17-files-s3`
> Статус: [ ] Не начат / [ ] В работе / [x] Завершён

---

- [x] Выполнено
- Приоритет: `P0`
- Оценка: `8h`
- Зависимости:
  - `TASK_FILES_2`
  - `TASK_FILES_3`
  - `TASK_FILES_4`
  - согласованы `02-tenant`, `05-catalog`, `16-audit`
- Что нужно сделать:
  - при `TRIAL_EXPIRED` разрешить только read существующих активных файлов;
  - при `TRIAL_EXPIRED` блокировать upload/replace/delete как write-операции;
  - при `SUSPENDED/CLOSED` блокировать user-facing access-url и любые write-actions;
  - согласовать linkage с `catalog.main_image_file_id` для модели `single main image per product`;
  - писать audit на upload/confirm/replace/delete и критичные cleanup decisions.
- Критерий закрытия:
  - files module не обходит tenant access policy;
  - связь с catalog стабильна и не создает битых product references;
  - audit покрывает ключевые file lifecycle changes.

**Что сделано**

### 1. Access-state guards — верификация полноты

Access-state policy была реализована в предыдущих задачах и проверена:
- Write operations (`upload-url`, `confirm`, `replace`, `delete`): `TenantWriteGuard` блокирует `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED` → соответствует system-analytics §14 ✓
- Read (`access-url`): `assertReadAllowedByTenantState` блокирует только `SUSPENDED`/`CLOSED`; `TRIAL_EXPIRED` разрешён для чтения активных файлов ✓
- `RequireActiveTenantGuard` на уровне класса гарантирует наличие tenant context для всех endpoints ✓

### 2. Catalog Linkage в `confirmUpload` — [files.service.ts](apps/api/src/modules/files/files.service.ts)

**Это был пропущенный шаг из system-analytics §9 п.5**: "Файл переводится в `active`, привязывается к `product.main_image_file_id`."

Добавлена логика внутри транзакции `confirmUpload`:
- Для `FileEntityType.product_main_image`: находим `product` по `entityId`
- Если `product.mainImageFileId` уже указывает на другой файл → этот старый файл **атомарно** переходит в `replaced` + lifecycle event `file_displaced_by_upload`
- `product.mainImageFileId` обновляется до нового `file.id` внутри той же транзакции
- В ответе добавлено поле `displacedFileId` (если произошло вытеснение)
- Карточка товара никогда не получает битую ссылку: всё в одной DB transaction

Это решает модель `single main image per product` без необходимости явного вызова `/replace` для типового flow.

### 3. Audit Events — [audit-event-catalog.ts](apps/api/src/modules/audit/audit-event-catalog.ts)

Добавлены в `AUDIT_DOMAINS`, `AUDIT_EVENTS` и `EVENT_DOMAIN_MAP`:
- `FILES: 'FILES'` — новый домен
- `FILE_UPLOADED` — после confirm (файл стал active и привязан к product)
- `FILE_REPLACED` — после явного replace endpoint
- `FILE_DELETED` — после логического удаления
- `FILE_CLEANUP_PURGED` — после физического удаления из S3 (критичное cleanup решение)

### 4. Coverage Contract — [audit-coverage.contract.ts](apps/api/src/modules/audit/audit-coverage.contract.ts)

Добавлен модуль `files` с обязательными событиями: `FILE_UPLOADED`, `FILE_REPLACED`, `FILE_DELETED`.

### 5. FilesModule ← AuditModule — [files.module.ts](apps/api/src/modules/files/files.module.ts)

Добавлен `imports: [AuditModule]`. `AuditService` теперь доступен через DI в `FilesService`.

### 6. AuditService в FilesService — [files.service.ts](apps/api/src/modules/files/files.service.ts)

- Инъекция `AuditService` в конструктор
- `assertCanWrite` рефакторен: теперь возвращает `role: string` (без лишнего DB query в caller)
- Audit вызовы:
  - `confirmUpload` → `FILE_UPLOADED` (actorType=user, source=api, after включает `displacedFileId`)
  - `replaceFile` → `FILE_REPLACED` (actorType=user, source=api, before/after)
  - `deleteFile` → `FILE_DELETED` (actorType=user, source=api, before/after)
  - `runCleanup` (purge loop) → `FILE_CLEANUP_PURGED` (actorType=system, source=worker, tenantId из записи файла)
- Все audit вызовы **не** бросают исключения (`.catch(logger.error)`) — failure аудита не должен откатывать файловую операцию

### Архитектурные решения

| Вопрос | Решение |
|--------|---------|
| Когда линковать файл к product? | В `confirm`, не в отдельном endpoint — уменьшает кол-во шагов в типовом flow |
| Что делать со старым файлом при confirm нового? | Атомарно → `replaced` в той же транзакции (не в cleanup, сразу) |
| Audit failures → rollback? | Нет: `.catch` логирует, но не пробрасывает — файл уже сохранён |
| Cleanup purge audit — без tenantId в runCleanup | Берём `tenantId` из самой записи файла (select включает поле) |
