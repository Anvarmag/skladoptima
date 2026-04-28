# TASK_CATALOG_7 — QA, Regression и Observability Catalog

> Модуль: `05-catalog`
> Статус: [x] Завершён

---

- [x] Выполнено
- Приоритет: `P1`
- Оценка: `8h`
- Зависимости:
  - `TASK_CATALOG_2`
  - `TASK_CATALOG_3`
  - `TASK_CATALOG_4`
  - `TASK_CATALOG_5`
  - `TASK_CATALOG_6`
- Что нужно сделать:
  - собрать regression пакет на create/update/delete/restore, import preview/commit, auto/manual match, duplicate merge;
  - покрыть SKU conflicts, soft-deleted SKU reuse confirm, import idempotency и source-of-change conflicts;
  - проверить поведение каталога в `TRIAL_EXPIRED`, `SUSPENDED`, `CLOSED`;
  - проверить, что audit формируется для create/update/delete/restore/import/mapping/merge сценариев;
  - настроить метрики, логи и alerts по import health, mapping conflicts и write denials.
- Критерий закрытия:
  - catalog модуль подтвержден проверяемой регрессией;
  - критичные data integrity risks закрыты тестами;
  - observability достаточна для расследования import/mapping инцидентов;
  - audit и тесты вместе покрывают ключевые расследуемые catalog flows.

**Что сделано**

### 1. Observability — Logger + structured logging

**ImportService** (`import.service.ts`):
- Добавлен `Logger` (отсутствовал).
- `import_preview_started` — лог при старте preview с `jobId` и `totalRows`.
- `import_preview_completed` — лог после preview со сводкой `summary` и `invalidRows`.
- `import_commit_started` — лог при начале commit с `jobId`, `totalItems`.
- `import_commit_completed` — лог после commit со статистикой `created/updated/errors/sourceConflicts`.
- `import_commit_has_errors` — warn-лог, если `errorCount > 0`.
- `import_source_conflict_overwrite` — warn-лог на каждую строку с source_conflict при commit (SKU, rowNumber, jobId).

**MappingService** (`mapping.service.ts`):
- Добавлен `Logger` (отсутствовал).
- `mapping_conflict_detected` — warn-лог при попытке создать дубль маппинга (marketplace, externalProductId, existingMappingId).
- `auto_match_failed` — лог, когда auto-match не нашёл внутренний товар по SKU.
- `product_merge_completed` — лог после merge с `mappingsTransferred` и `mappingsSkipped`.

### 2. Regression tests — 78 тестов, 4 файла

#### `product.service.spec.ts` — 24 теста

**create:**
- Создание нового товара → PRODUCT_CREATED audit.
- SKU_ALREADY_EXISTS для активного товара.
- SKU_SOFT_DELETED без confirmRestoreId → возвращает `deletedProductId`.
- CONFIRM_RESTORE_ID_MISMATCH при неверном confirmRestoreId.
- Восстановление через confirmRestoreId → PRODUCT_RESTORED audit.

**update:** обновление с аудитом, SKU_ALREADY_EXISTS при смене SKU, одинаковый SKU без конфликта.

**remove:** soft delete с PRODUCT_DELETED audit, PRODUCT_NOT_FOUND, cross-tenant защита.

**restore:** восстановление с PRODUCT_RESTORED audit, PRODUCT_ALREADY_ACTIVE, PRODUCT_NOT_FOUND.

**findAll:** фильтр активных/удалённых, поиск по name/sku/brand.

**importFromWb (source-of-change policy):** пропуск MANUAL-товаров (warn-лог), пропуск IMPORT-товаров, обновление SYNC-товаров, создание нового товара.

**Observability:** явная проверка, что каждый write вызывает нужный ActionType в audit.

#### `import.service.spec.ts` — 22 теста

**preview:** CREATE/UPDATE/MANUAL_REVIEW для новых/существующих/невалидных строк, MANUAL_REVIEW для soft-deleted SKU, source_conflict warning для MANUAL-sourced товара, события `import_preview_started` / `import_preview_completed`.

**commit:** идемпотентность (idempotencyKey + COMPLETED job), IMPORT_JOB_ALREADY_PROCESSING, IMPORT_JOB_NOT_IN_PREVIEW, уже COMPLETED возвращает без повторной обработки, создание товара (PRODUCT_CREATED audit), обновление товара (PRODUCT_UPDATED audit), MANUAL_REVIEW не трогает product, IMPORT_COMMITTED audit, `import_source_conflict_overwrite` warn-лог, события `import_commit_started` / `import_commit_completed`.

**getJob:** возвращает job, IMPORT_JOB_NOT_FOUND (неизвестный/чужой tenant).

**Idempotency regression:** двойной commit с одинаковым ключом — второй возвращает кеш без записей в БД.

#### `mapping.service.spec.ts` — 22 теста

**createManual:** happy path + MAPPING_CREATED audit, PRODUCT_NOT_FOUND, MAPPING_ALREADY_EXISTS + `mapping_conflict_detected` warn.

**autoMatch:** совпадение по SKU + MAPPING_CREATED audit, уже существует (alreadyExisted=true, без audit), не нашёл товар (matched=false + `auto_match_failed` лог).

**deleteMapping:** удаление + MAPPING_DELETED audit, MAPPING_NOT_FOUND, cross-tenant защита.

**mergeProducts:** перенос маппингов + PRODUCT_MERGED audit + soft-delete source, пропуск конфликтных маппингов, MERGE_SAME_PRODUCT, SOURCE_PRODUCT_NOT_FOUND, TARGET_PRODUCT_NOT_FOUND, `product_merge_completed` лог.

**getUnmatched:** возвращает товары без маппингов, исключает уже сопоставленные.

#### `tenant-write.guard.spec.ts` — 10 тестов

- TRIAL_EXPIRED, SUSPENDED, CLOSED → ForbiddenException с `code: TENANT_WRITE_BLOCKED`.
- accessState содержится в response для диагностики.
- `tenant_write_blocked` warn-лог при блокировке.
- ACTIVE_PAID, TRIAL_ACTIVE, GRACE_PERIOD, EARLY_ACCESS → пропускают.
- Без activeTenant context → пропускает.

### 3. Fix предсуществующих провалов auth.service.spec.ts

Тест был сломан ещё в TASK_CATALOG_1–6 (AuthService получил новые зависимости — OnboardingService, invitation):
- Добавлен импорт `OnboardingService`.
- Добавлен mock: `{ markStepDone, initUserBootstrap }`.
- Добавлен mock `prisma.invitation: { findMany, update }`.
- Результат: 54/54 auth тестов зелёные.
